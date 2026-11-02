import hashlib

import pytest
from openpyxl import load_workbook

from exam_checker.models import Evidence, Finding, Status
from exam_checker.report import save_report
from exam_checker.service import check_files


def test_report_has_evidence_and_never_changes_sources(samples, tmp_path):
    paths = [samples / "exam.docx", samples / "info_errors.xlsx"]
    before = [hashlib.sha256(p.read_bytes()).hexdigest() for p in paths]
    result = check_files(*paths)
    report = save_report(result, tmp_path / "report.xlsx")
    book = load_workbook(report)
    assert book.sheetnames == ["점검 요약", "점검 결과", "원안지 추출", "정보표 추출"]
    sheet = book["점검 결과"]
    assert sheet.max_row == len(result.findings) + 1
    assert any("시트" in str(c.value) for row in sheet for c in row)
    assert any("표 1" in str(c.value) for row in sheet for c in row)
    book.close()
    assert [hashlib.sha256(p.read_bytes()).hexdigest() for p in paths] == before


def test_formula_injection_is_written_as_text(samples, tmp_path):
    result = check_files(samples / "exam.docx", samples / "info_ok.xlsx")
    attack = '=HYPERLINK("https://invalid.example/", "fictional")'
    result.findings.append(Finding(Status.REVIEW, "fictional", "1", attack, attack, (Evidence("가상", attack),)))
    path = save_report(result, tmp_path / "safe.xlsx")
    book = load_workbook(path, data_only=False)
    cells = [c for sheet in book for row in sheet for c in row]
    assert any(c.value == attack and c.data_type == "s" for c in cells)
    assert not any(c.data_type == "f" or c.hyperlink for c in cells)
    book.close()


def test_report_cannot_overwrite_sources_or_hardlinks(samples, tmp_path):
    result = check_files(samples / "exam.docx", samples / "info_ok.xlsx")
    with pytest.raises(ValueError, match="原本|원본"):
        save_report(result, result.info.path)
    alias = tmp_path / "alias.xlsx"
    alias.hardlink_to(result.info.path)
    with pytest.raises(ValueError, match="원본"):
        save_report(result, alias)


def test_failed_save_leaves_existing_report_intact(samples, tmp_path, monkeypatch):
    result = check_files(samples / "exam.docx", samples / "info_ok.xlsx")
    target = tmp_path / "existing.xlsx"
    target.write_bytes(b"fictional previous report")

    def fail(*args):
        raise OSError("가상 저장 실패")

    monkeypatch.setattr("exam_checker.report.Workbook.save", fail)
    with pytest.raises(OSError):
        save_report(result, target)
    assert target.read_bytes() == b"fictional previous report"
    assert not list(tmp_path.glob(".exam-report-*"))

