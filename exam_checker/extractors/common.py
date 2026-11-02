import re
from dataclasses import dataclass
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from .. import normalize as norm
from ..models import DeclaredTotal, Evidence, ExtractedDocument, ExtractionNote, Question


class ExtractionError(ValueError):
    """교사에게 그대로 표시할 수 있는 입력 오류 안내."""


MAX_ROWS = 20000
HEADERS = {
    "number": {"문항번호", "문제번호", "문항", "번호"},
    "answer": {"정답", "답", "모범답안", "예시답안"},
    "points": {"배점", "점수"},
    "kind": {"문항유형", "유형", "구분"},
}
TOTAL_HEADERS = {"합계", "총점", "총배점", "배점합계"}


@dataclass(frozen=True)
class Row:
    values: tuple[object, ...]
    location: str
    reliable: bool = True

    @property
    def evidence(self):
        return Evidence(self.location, " | ".join(norm.text(v) for v in self.values))


def checked_zip(path: Path) -> ZipFile:
    """압축 해제 없이 검사. XML entity는 각 어댑터에서 defusedxml로 차단."""
    try:
        archive = ZipFile(path)
    except BadZipFile as exc:
        raise ExtractionError("유효한 Office/HWPX 파일이 아닙니다. 확장자만 변경하지 말고 원래 프로그램에서 다시 저장해 주세요.") from exc
    infos = archive.infolist()
    if len({i.filename for i in infos}) != len(infos):
        archive.close()
        raise ExtractionError("문서 안에 중복된 구성요소가 있습니다. 원래 프로그램에서 복사본을 다시 저장해 주세요.")
    if len(infos) > 5000 or sum(i.file_size for i in infos) > 100 * 1024 * 1024:
        archive.close()
        raise ExtractionError("문서의 압축 해제 크기/구성요소가 지원 한도를 초과했습니다.")
    if any(i.flag_bits & 1 for i in infos):
        archive.close()
        raise ExtractionError("암호화된 문서는 지원하지 않습니다. 복사본의 암호를 해제해 주세요.")
    return archive


def note(doc: ExtractedDocument, message: str, evidence: Evidence):
    doc.complete = False
    doc.notes.append(ExtractionNote(message, evidence))


def parse_rows(doc: ExtractedDocument, rows: list[Row]) -> bool:
    """첫 30행에서 명시적인 헤더를 찾는다. 서로 다른 표/시트는 별도로 호출한다."""
    columns = None
    for index, row in enumerate(rows[:30]):
        found = {key: [i for i, value in enumerate(row.values) if norm.header(value) in aliases]
                 for key, aliases in HEADERS.items()}
        if found["number"] and (found["answer"] or found["points"]):
            if any(len(indices) > 1 for indices in found.values()):
                note(doc, "같은 항목의 헤더가 여러 개여서 열을 결정할 수 없습니다. 표를 분리해 주세요.", row.evidence)
                return True
            columns = {key: indices[0] for key, indices in found.items() if indices}
            break
    if columns is None:
        return False
    if not rows[index].reliable:
        note(doc, "표 헤더에 병합/수식/좌표 이상이 있어 열 해석을 확인해야 합니다.", rows[index].evidence)
    if "answer" not in columns or "points" not in columns:
        note(doc, "정답 또는 배점 열이 없습니다. 없는 값은 추정하지 않습니다.", rows[index].evidence)
    for row in rows[index + 1:]:
        if not any(norm.text(v) for v in row.values):
            continue

        def cell(key):
            i = columns.get(key)
            return row.values[i] if i is not None and i < len(row.values) else None

        raw_number = cell("number")
        if norm.header(raw_number) in HEADERS["number"]:
            # 반복 헤더가 열을 바꾸면 기존 위치를 그대로 해석하지 않는다.
            if all(norm.header(cell(key)) in HEADERS[key] for key in columns):
                continue
            note(doc, "반복 헤더의 열 배치가 달라 이후 행의 추출을 중단했습니다.", row.evidence)
            break
        is_total = norm.header(raw_number) in TOTAL_HEADERS
        if not norm.text(raw_number):
            is_total = any(norm.header(v) in TOTAL_HEADERS for v in row.values)
        if is_total:
            value = norm.points(cell("points"))
            if value is None or not row.reliable:
                note(doc, "표기된 총점이 수식이거나 불명확하여 읽을 수 없습니다.", row.evidence)
            else:
                doc.totals.append(DeclaredTotal(value, row.evidence))
            continue
        number = norm.question_number(raw_number, cell("kind"))
        if number is None:
            note(doc, "문항번호/유형을 해석하지 못한 행이 있습니다. 누락·총점 판정에 주의해 주세요.", row.evidence)
            continue
        ans, score = norm.answer(cell("answer")), norm.points(cell("points"))
        if ans is None or score is None or not row.reliable:
            missing = "·".join(label for label, value in [("정답", ans), ("배점", score)] if value is None)
            note(doc, f"{number}번: {missing or '표 구조'} 확인 필요. 빈칸·수식·병합·불명확한 값은 추정하지 않습니다.", row.evidence)
        doc.questions.append(Question(number, ans, score, row.evidence, row.reliable))
    return True


LINE_NUMBER = re.compile(r"^\s*(?:문항\s*)?((?:(?:객관식|선택형|서답형|서술형|논술형|단답형)\s*)?\d{1,4}(?:-\d{1,3})?)\s*(?:[.)]|번|(?=\s))\s*(.*)$")
ANSWER_MARKER = re.compile(r"정답\s*[:：]\s*([^\[\]【】;；|]+?)(?=\s+배점\s*[:：]|$|[\]】;；|])")
POINT_MARKER = re.compile(r"배점\s*[:：]\s*(\d+(?:\.\d+)?)\s*점?")
BRACKET_POINTS = re.compile(r"[\[【]\s*(\d+(?:\.\d+)?)\s*점\s*[\]】]")


def parse_lines(doc: ExtractedDocument, lines: list[tuple[str, str]], *, pdf=False):
    doc.method = "PDF 텍스트 본문(추정)" if pdf else "명시적 본문(추정)"
    note(doc, "본문 추출은 누락/읽기 순서를 보장하지 않습니다. 원문과 추출 미리보기를 반드시 확인해 주세요.", Evidence(doc.path.name, doc.method))
    for location, line in lines:
        line = norm.text(line)
        evidence = Evidence(location, line)
        total = re.fullmatch(r"(?:총점|합계)\s*[:：]\s*(\d+(?:\.\d+)?)\s*점?", line)
        if total:
            score = norm.points(total[1])
            if score is not None:
                doc.totals.append(DeclaredTotal(score, evidence))
            continue
        match = LINE_NUMBER.match(line)
        if not match:
            continue
        number = norm.question_number(match[1])
        if number is None:
            continue
        body = match[2]
        ans = ANSWER_MARKER.search(body)
        score = POINT_MARKER.search(body) or BRACKET_POINTS.search(body)
        doc.questions.append(Question(number, norm.answer(ans[1]) if ans else None,
                                      norm.points(score[1]) if score else None, evidence, False))
        if not ans or not score:
            note(doc, f"{number}번 본문에서 정답 또는 배점을 읽지 못했습니다. 문항 표로 보완해 주세요.", evidence)


def note_unparsed_block(doc: ExtractedDocument, rows: list[Row]):
    # 일반 설명 표는 무시하되 문항 데이터처럼 보이는 표를 조용히 버리지 않는다.
    candidates = [r for r in rows if r.values and norm.question_number(r.values[0]) is not None]
    if candidates:
        note(doc, "문항 행처럼 보이지만 지원하는 헤더가 없는 표/시트가 있습니다. 추출 범위를 확인해 주세요.", candidates[0].evidence)

