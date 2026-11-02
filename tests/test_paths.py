import pytest

from exam_checker.extractors import extract
from exam_checker.paths import local_path
from exam_checker.report import save_report
from exam_checker.service import check_files


@pytest.mark.parametrize("path", [r"\\server\share\가상.xlsx", "//server/share/fictional.xlsx", "https://invalid.example/a.pdf", "file://server/share/a.docx"])
def test_remote_path_rejected_before_document_read(path):
    with pytest.raises(ValueError, match="로컬"):
        local_path(path)
    with pytest.raises(ValueError, match="로컬"):
        extract(path)


def test_report_network_destination_is_rejected(samples):
    result = check_files(samples / "exam.docx", samples / "info_ok.xlsx")
    with pytest.raises(ValueError, match="로컬"):
        save_report(result, r"\\server\share\가상보고서.xlsx")


def test_same_input_under_different_hardlink_names_is_rejected(samples, tmp_path):
    original = samples / "info_ok.xlsx"
    alias = tmp_path / "same_document.xlsx"
    alias.hardlink_to(original)
    with pytest.raises(ValueError, match="서로 다른"):
        check_files(original, alias)
