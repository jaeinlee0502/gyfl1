"""입력 형식별 로컬 어댑터. OCR, 매크로 실행, 외부 링크 조회는 하지 않는다."""

from pathlib import Path

from ..paths import local_path
from .common import ExtractionError

SUPPORTED = {".xlsx", ".docx", ".hwpx", ".pdf"}


def extract(path: str | Path):
    from .office import read_docx, read_hwpx, read_xlsx
    from .pdf import read_pdf

    path = local_path(path)
    suffix = path.suffix.lower()
    if suffix == ".hwp":
        raise ExtractionError("구형 HWP는 지원하지 않습니다. 한글에서 HWPX로 저장하거나 텍스트 PDF로 변환해 주세요.")
    if suffix not in SUPPORTED:
        raise ExtractionError("지원 형식은 XLSX, DOCX, HWPX, 텍스트 PDF입니다. 암호·매크로 파일은 지원하지 않습니다.")
    if not path.is_file():
        raise ExtractionError("선택한 파일을 찾을 수 없습니다. 파일 경로와 읽기 권한을 확인해 주세요.")
    if path.stat().st_size > 50 * 1024 * 1024:
        raise ExtractionError("50MB를 초과한 파일은 지원하지 않습니다. 필요한 문항 부분을 별도 파일로 준비해 주세요.")
    try:
        document = {".xlsx": read_xlsx, ".docx": read_docx, ".hwpx": read_hwpx, ".pdf": read_pdf}[suffix](path)
    except ExtractionError:
        raise
    except Exception as exc:
        # 원문/라이브러리 예외를 로그에 남기지 않는다. 손상·암호화 파일은 명확히 거절한다.
        raise ExtractionError("파일을 읽지 못했습니다. 손상·암호화 여부와 실제 파일 형식을 확인해 주세요.") from exc
    if not document.questions:
        from ..models import Evidence, ExtractionNote

        document.complete = False
        document.notes.append(ExtractionNote(
            "문항을 추출하지 못했습니다. ‘문항번호 / 정답 / 배점’ 표 또는 안내된 본문 형식을 사용해 주세요.",
            Evidence(path.name, "추출된 문항 0개 — 정상으로 판정할 수 없음"),
        ))
    return document


__all__ = ["extract", "ExtractionError", "SUPPORTED"]

