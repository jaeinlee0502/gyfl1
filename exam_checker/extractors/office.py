"""Office 표 및 HWPX XML의 제한적 로컬 파싱."""

import re
from pathlib import Path

from defusedxml import ElementTree as SafeET
from docx import Document
from openpyxl import load_workbook

from ..models import Evidence, ExtractedDocument
from .common import (MAX_ROWS, ExtractionError, LINE_NUMBER, Row, checked_zip, note,
                     note_unparsed_block, parse_lines, parse_rows)


def read_xlsx(path: Path) -> ExtractedDocument:
    with checked_zip(path):
        pass
    doc = ExtractedDocument(path)
    # 수식 캐시를 정답/배점으로 믿지 않는다. 외부 통합문서 링크도 로드하지 않는다.
    book = load_workbook(path, read_only=True, data_only=False, keep_links=False)
    try:
        for sheet in book:
            # 생성 프로그램에 따라 dimension 값이 틀릴 수 있어 실제 XML 행을 읽는다.
            sheet.reset_dimensions()
            rows = []
            for i, cells in enumerate(sheet.iter_rows(), 1):
                if i > MAX_ROWS or len(cells) > 100:
                    raise ExtractionError("시트는 20,000행 / 100열 이내여야 합니다. 필요한 문항 표만 복사해 주세요.")
                rows.append(Row(tuple(c.value for c in cells), f"시트 ‘{sheet.title}’ · 행 {i}",
                                all(c.data_type != "f" for c in cells)))
            before = len(doc.questions)
            if not parse_rows(doc, rows):
                note_unparsed_block(doc, rows)
            if sheet.sheet_state != "visible" and len(doc.questions) > before:
                note(doc, "숨겨진 시트에도 문항 데이터가 있습니다. 추출 미리보기에서 포함 여부를 확인해 주세요.", Evidence(f"시트 ‘{sheet.title}’", "숨겨진 시트"))
    finally:
        book.close()
    return doc


def read_docx(path: Path) -> ExtractedDocument:
    with checked_zip(path):
        pass
    doc = ExtractedDocument(path)
    source = Document(path)
    if source.element.body.xpath(".//w:ins | .//w:del | .//w:sdt | .//w:txbxContent | .//w:altChunk"):
        note(doc, "변경 추적/콘텐츠 컨트롤/텍스트 상자 등 지원 범위 밖의 구조가 있습니다. 추출 범위를 확인해 주세요.", Evidence(path.name, "기본 표·문단 외 구조 감지"))
    matched = False
    unknown = []
    for table_index, table in enumerate(source.tables, 1):
        if len(table.rows) > MAX_ROWS:
            raise ExtractionError("표의 행 수가 지원 한도를 초과했습니다.")
        rows = []
        for row_index, row in enumerate(table.rows, 1):
            cells = row.cells
            # 병합된 데이터를 정답/배점으로 복제하지 않는다.
            reliable = len({id(c._tc) for c in cells}) == len(cells)
            reliable = reliable and not any(c._tc.xpath("./w:tcPr/w:vMerge") for c in cells)
            reliable = reliable and not any(c.tables or c._tc.xpath(".//w:fldSimple | .//w:instrText | .//w:drawing | .//w:pict") for c in cells)
            rows.append(Row(tuple(c.text for c in cells), f"표 {table_index} · 행 {row_index}", reliable))
        if parse_rows(doc, rows):
            matched = True
        else:
            unknown.append(rows)
    lines = [(f"본문 문단 {i}", p.text) for i, p in enumerate(source.paragraphs, 1) if p.text.strip()]
    if not matched:
        parse_lines(doc, lines)
    else:
        for rows in unknown:
            note_unparsed_block(doc, rows)
        if any(LINE_NUMBER.match(line) for _, line in lines):
            note(doc, "문항 표와 번호가 있는 본문이 함께 있습니다. 표만 대조했으며 본문과 표의 일치는 별도 확인이 필요합니다.", Evidence(path.name, "표 우선 추출 · 본문은 대조에서 제외"))
    return doc


def local_name(element):
    return element.tag.rsplit("}", 1)[-1]


def element_text(element):
    # HWPX의 줄바꿈/탭을 값의 경계로 보존한다.
    parts = []
    for child in element.iter():
        name = local_name(child)
        if name == "t":
            parts.append(child.text or "")
        elif name in {"lineBreak", "tab"}:
            parts.append(" ")
    return "".join(parts).strip()


def read_hwpx(path: Path) -> ExtractedDocument:
    doc = ExtractedDocument(path)
    lines, unknown = [], []
    matched = False
    with checked_zip(path) as archive:
        sections = sorted((n for n in archive.namelist() if re.fullmatch(r"Contents/section\d+\.xml", n)),
                          key=lambda n: int(re.search(r"\d+", n)[0]))
        if not sections:
            raise ExtractionError("HWPX의 Contents/section*.xml을 찾을 수 없습니다. 한글에서 HWPX로 다시 저장해 주세요.")
        for section in sections:
            root = SafeET.fromstring(archive.read(section))
            tables = [e for e in root.iter() if local_name(e) == "tbl"]
            table_children = {id(e) for table in tables for e in table.iter()}
            for ti, table in enumerate(tables, 1):
                rows = []
                for ri, tr in enumerate((c for c in table if local_name(c) == "tr"), 1):
                    cells = [c for c in tr if local_name(c) == "tc"]
                    values, reliable = [], True
                    for ci, cell in enumerate(cells):
                        spans = [e for e in cell if local_name(e) == "cellSpan"]
                        if any(e.get("rowSpan", "1") != "1" or e.get("colSpan", "1") != "1" for e in spans):
                            reliable = False
                        addresses = [e for e in cell if local_name(e) == "cellAddr"]
                        if any(e.get("colAddr") != str(ci) or e.get("rowAddr") != str(ri - 1) for e in addresses):
                            reliable = False
                        if any(local_name(e) in {"pic", "equation", "ole", "tbl"} for e in cell.iter()):
                            reliable = False
                        values.append(element_text(cell))
                    rows.append(Row(tuple(values), f"{section} · 표 {ti} · 행 {ri}", reliable))
                if len(rows) > MAX_ROWS:
                    raise ExtractionError("표의 행 수가 지원 한도를 초과했습니다.")
                if parse_rows(doc, rows):
                    matched = True
                else:
                    unknown.append(rows)
            for pi, paragraph in enumerate((e for e in root.iter() if local_name(e) == "p"), 1):
                if id(paragraph) not in table_children:
                    value = element_text(paragraph)
                    if value:
                        lines.append((f"{section} · 문단 {pi}", value))
    if not matched:
        parse_lines(doc, lines)
    else:
        for rows in unknown:
            note_unparsed_block(doc, rows)
        if any(LINE_NUMBER.match(line) for _, line in lines):
            note(doc, "문항 표를 우선 추출했습니다. 번호가 있는 본문과 표의 일치는 별도로 확인해 주세요.", Evidence(path.name, "본문은 대조에서 제외"))
    return doc

