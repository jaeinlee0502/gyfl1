from pathlib import Path

import pymupdf

from ..models import Evidence, ExtractedDocument
from .common import ExtractionError, note, parse_lines


def read_pdf(path: Path) -> ExtractedDocument:
    doc = ExtractedDocument(path, complete=False)
    lines = []
    with pymupdf.open(path) as pdf:
        if pdf.needs_pass:
            raise ExtractionError("암호화된 PDF는 지원하지 않습니다. 복사본의 암호를 해제해 주세요.")
        if len(pdf) > 1000:
            raise ExtractionError("1,000쪽을 초과하는 PDF는 지원하지 않습니다.")
        empty_pages = []
        for index, page in enumerate(pdf, 1):
            content = page.get_text("text", sort=True)
            if not content.strip():
                empty_pages.append(index)
            if "\ufffd" in content:
                note(doc, "PDF에 해석 불가능한 글자가 있습니다. 정답·배점 추출을 신뢰할 수 없습니다.", Evidence(f"PDF {index}쪽", "문자 매핑 오류"))
            lines.extend((f"PDF {index}쪽 · 줄 {i}", line) for i, line in enumerate(content.splitlines(), 1))
        if not any(line.strip() for _, line in lines):
            raise ExtractionError("읽을 수 있는 텍스트가 없는 PDF입니다. 스캔 PDF의 OCR은 제공하지 않습니다. 원본에서 텍스트 PDF 또는 HWPX로 다시 저장해 주세요.")
        if empty_pages:
            note(doc, "텍스트가 없는 쪽이 있습니다. 스캔/그림 속 문항은 추출하지 못합니다.", Evidence("PDF", "텍스트 없는 쪽: " + ", ".join(map(str, empty_pages))))
        parse_lines(doc, lines, pdf=True)
    return doc
