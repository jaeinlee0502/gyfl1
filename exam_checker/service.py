"""UI/CLI에서 공통으로 호출하는 로컬 점검 파이프라인."""

from decimal import Decimal
from pathlib import Path

from .checker import compare
from .extractors import ExtractionError, extract
from .paths import local_path


def check_files(exam: str | Path, info: str | Path, expected_total=Decimal("100")):
    exam, info = local_path(exam), local_path(info)
    if exam == info or exam.is_file() and info.is_file() and exam.samefile(info):
        raise ExtractionError("서로 다른 시험 원안지와 문항정보표를 선택해 주세요.")
    return compare(extract(exam), extract(info), expected_total)

