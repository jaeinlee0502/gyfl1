from decimal import Decimal
import re
from zipfile import ZipFile

import pymupdf
import pytest
from docx import Document
from openpyxl import Workbook

from exam_checker.extractors import ExtractionError, extract


@pytest.mark.parametrize("filename", ["exam.docx", "info_ok.xlsx", "exam_fixture.hwpx"])
def test_supported_metadata_tables(samples, filename):
    doc = extract(samples / filename)
    assert doc.complete
    assert len(doc.questions) == 5
    assert doc.questions[1].answer == "2"
    assert doc.questions[2].points == Decimal("20")
    assert doc.totals[0].points == 100
    assert all(q.reliable and q.evidence.location and q.evidence.text for q in doc.questions)


def test_pdf_has_page_evidence_and_is_always_uncertain(samples):
    doc = extract(samples / "exam_text.pdf")
    assert not doc.complete
    assert len(doc.questions) == 5
    assert [q.answer for q in doc.questions] == ["1", "2", "3", "4", "5"]
    assert all(q.points == 20 and not q.reliable and "PDF 1쪽" in q.evidence.location for q in doc.questions)


def test_formula_cache_is_never_trusted(samples):
    doc = extract(samples / "info_review.xlsx")
    assert doc.questions[1].points is None
    assert doc.questions[2].answer is None
    assert "=10+10" in doc.questions[1].evidence.text
    assert not doc.complete


def test_scan_pdf_gives_actionable_message(samples):
    with pytest.raises(ExtractionError, match="OCR"):
        extract(samples / "scan_only.pdf")


@pytest.mark.parametrize("extension", ["hwp", "xls", "doc", "xlsm"])
def test_unsupported_format_gives_actionable_message(tmp_path, extension):
    with pytest.raises(ExtractionError, match="HWPX|지원 형식"):
        extract(tmp_path / ("가상." + extension))


def test_encrypted_pdf_is_rejected(tmp_path):
    path = tmp_path / "locked.pdf"
    with pymupdf.open() as pdf:
        pdf.new_page().insert_text((40, 60), "fictional")
        pdf.save(path, encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="fictional", user_pw="fictional")
    with pytest.raises(ExtractionError, match="암호화"):
        extract(path)


def test_broken_office_file_is_not_empty_success(tmp_path):
    path = tmp_path / "broken.xlsx"
    path.write_text("가상 손상 파일", encoding="utf-8")
    with pytest.raises(ExtractionError, match="유효한"):
        extract(path)


def test_hwpx_entities_are_rejected(tmp_path):
    path = tmp_path / "unsafe.hwpx"
    with ZipFile(path, "w") as archive:
        archive.writestr("Contents/section0.xml", '<!DOCTYPE x [<!ENTITY a SYSTEM "file:///nonexistent">]><x>&a;</x>')
    with pytest.raises(ExtractionError):
        extract(path)


def test_unknown_rows_and_hidden_sheets_lower_coverage(tmp_path):
    path = tmp_path / "ambiguous.xlsx"
    book = Workbook()
    sheet = book.active
    sheet.append(["문항번호", "정답", "배점"])
    sheet.append([1, 1, 100])
    sheet.append(["번호 알 수 없음", 2, 10])
    hidden = book.create_sheet("숨긴 가상 자료")
    hidden.sheet_state = "hidden"
    hidden.append(["문항번호", "정답", "배점"])
    hidden.append([2, 2, 20])
    book.save(path)
    book.close()
    doc = extract(path)
    assert not doc.complete
    assert any("숨겨진" in item.message for item in doc.notes)
    assert any("문항번호" in item.message for item in doc.notes)


def test_docx_body_with_no_answer_is_review_not_omitted(tmp_path):
    path = tmp_path / "body.docx"
    document = Document()
    document.add_paragraph("1. 가상 색종이의 개수는? [20점]")
    document.add_paragraph("2. 가상 물체의 색은? [정답: 파랑] [배점: 80점]")
    document.save(path)
    doc = extract(path)
    assert len(doc.questions) == 2
    assert doc.questions[0].answer is None
    assert doc.questions[0].points == 20
    assert doc.questions[1].answer == "파랑"
    assert not doc.complete


def test_merged_docx_data_is_uncertain(tmp_path):
    path = tmp_path / "merged.docx"
    source = Document()
    table = source.add_table(rows=3, cols=3)
    for row, values in zip(table.rows, [("문항번호", "정답", "배점"), ("1", "1", "50"), ("2", "2", "50")]):
        for c, value in zip(row.cells, values):
            c.text = value
    table.cell(1, 2).merge(table.cell(2, 2)).text = "50"
    source.save(path)
    doc = extract(path)
    assert not doc.complete
    assert not all(q.reliable for q in doc.questions)


def test_incorrect_xlsx_dimensions_do_not_hide_rows(samples, tmp_path):
    path = tmp_path / "dimensions.xlsx"
    with ZipFile(samples / "info_ok.xlsx") as source, ZipFile(path, "w") as target:
        for info in source.infolist():
            data = source.read(info.filename)
            if info.filename == "xl/worksheets/sheet1.xml":
                data = re.sub(rb'<dimension ref="[^"]+"', b'<dimension ref="A1:A1"', data)
            target.writestr(info, data)
    doc = extract(path)
    assert len(doc.questions) == 5
    assert doc.complete


def test_hwpx_invalid_cell_coordinates_are_not_trusted(samples, tmp_path):
    path = tmp_path / "coordinates.hwpx"
    with ZipFile(samples / "exam_fixture.hwpx") as source, ZipFile(path, "w") as target:
        for info in source.infolist():
            data = source.read(info.filename)
            if info.filename == "Contents/section0.xml":
                data = data.replace(b'colAddr="1"', b'colAddr="2"')
            target.writestr(info, data)
    doc = extract(path)
    assert not doc.complete
    assert len(doc.questions) == 5
    assert not any(q.reliable for q in doc.questions)

