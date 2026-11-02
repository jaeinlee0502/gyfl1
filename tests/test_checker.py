from decimal import Decimal
from pathlib import Path

import pytest

from exam_checker.checker import compare
from exam_checker.models import Evidence, ExtractedDocument, ExtractionNote, Question, Status
from exam_checker.service import check_files


def test_normal_case(samples):
    result = check_files(samples / "exam.docx", samples / "info_ok.xlsx")
    assert result.status == Status.OK
    assert len(result.findings) == 14
    assert all(f.status == Status.OK for f in result.findings)
    assert all(f.exam_evidence or f.info_evidence for f in result.findings)


def test_all_main_error_categories(samples):
    result = check_files(samples / "exam.docx", samples / "info_errors.xlsx")
    errors = {(f.code, f.number) for f in result.findings if f.status == Status.ERROR}
    assert {("answer", "2"), ("points", "3"), ("missing", "4"), ("duplicate", "5")} <= errors
    assert any(f.code == "ambiguous_pair" and f.number == "5" for f in result.findings)
    assert any(f.code == "total" and f.status == Status.REVIEW for f in result.findings)


def test_total_error_and_teacher_total_override(samples):
    result = check_files(samples / "exam.docx", samples / "info_total_error.xlsx")
    assert any(f.code == "total" and f.status == Status.ERROR and "99" in f.message for f in result.findings)
    result = check_files(samples / "exam.docx", samples / "info_ok.xlsx", Decimal("80"))
    assert sum(f.code == "total" and f.status == Status.ERROR for f in result.findings) == 2


def test_uncertainty_does_not_become_error(samples):
    result = check_files(samples / "exam.docx", samples / "info_review.xlsx")
    assert result.status == Status.REVIEW
    result = check_files(samples / "exam_text.pdf", samples / "info_errors.xlsx")
    assert not any(f.status == Status.ERROR and f.code in {"missing", "answer", "points"} for f in result.findings)


def test_same_file_rejected(samples):
    with pytest.raises(ValueError, match="서로 다른"):
        check_files(samples / "info_ok.xlsx", samples / "info_ok.xlsx")


def document(numbers, *, complete=True, reliable=True):
    doc = ExtractedDocument(Path("가상.xlsx"), complete=complete)
    doc.questions = [Question(n, "1", Decimal("50"), Evidence("가상 행 " + n, n), reliable) for n in numbers]
    return doc


def test_both_empty_or_same_gap_never_passes():
    assert compare(document([]), document([])).status == Status.REVIEW
    result = compare(document(["1", "3"]), document(["1", "3"]))
    assert any(f.code == "sequence" and f.status == Status.REVIEW for f in result.findings)
    assert result.status == Status.REVIEW


def test_missing_question_with_partial_extraction_is_review():
    left = document(["1", "2"])
    right = document(["1"], complete=False)
    right.notes.append(ExtractionNote("가상 추출 실패", Evidence("행2", "?")))
    result = compare(left, right)
    assert [f.status for f in result.findings if f.code == "missing"] == [Status.REVIEW]


def test_question_types_separate_number_spaces():
    result = compare(document(["1", "서답형 1"]), document(["1", "서답형 1"]))
    assert result.status == Status.OK
    assert not any(f.code == "duplicate" for f in result.findings)


def test_decimal_points_do_not_accumulate_binary_rounding():
    left, right = document(["1", "2"]), document(["1", "2"])
    for doc in [left, right]:
        doc.questions = [Question(str(i), "1", Decimal(value), Evidence("가상", value))
                         for i, value in [(1, "0.1"), (2, "0.2")]]
    assert compare(left, right, Decimal("0.3")).status == Status.OK


@pytest.mark.parametrize("value", ["0", "-1", "NaN", "Infinity", "10001"])
def test_invalid_expected_total_rejected(value):
    with pytest.raises(ValueError, match="기준 총점"):
        compare(document(["1"]), document(["1"]), Decimal(value))

