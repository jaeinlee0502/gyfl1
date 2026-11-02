"""교사가 선택한 위치에만 저장하는 XLSX 보고서. 원본 덮어쓰기를 방지한다."""

import os
import re
import tempfile
from datetime import datetime
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from .models import CheckResult, Status
from .paths import local_path

COLORS = {Status.ERROR.value: "FDE2E2", Status.REVIEW.value: "FFF1CD", Status.OK.value: "DCF3E4"}
ILLEGAL_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _append(sheet, values):
    sheet.append([None] * len(values))
    for column, value in enumerate(values, 1):
        cell = sheet.cell(sheet.max_row, column)
        if value is not None:
            # 원문이 '=...'로 시작해도 Excel 수식/외부 링크로 실행하지 않는다.
            cell.value = ILLEGAL_XML.sub("", str(value))[:32767]
            cell.data_type = "s"
        cell.alignment = Alignment(vertical="top", wrap_text=True)


def save_report(result: CheckResult, destination: str | Path) -> Path:
    target = local_path(destination)
    if target.suffix.lower() != ".xlsx":
        raise ValueError("보고서 파일 확장자는 .xlsx여야 합니다.")
    for source in (result.exam.path, result.info.path):
        if target == source.resolve() or target.exists() and os.path.samefile(target, source):
            raise ValueError("원본 문서에는 보고서를 저장할 수 없습니다. 다른 이름/위치를 선택해 주세요.")
    if not target.parent.is_dir():
        raise ValueError("저장 폴더가 존재하지 않습니다.")
    book = Workbook()
    summary = book.active
    summary.title = "점검 요약"
    for row in [
        ("항목", "내용"),
        ("프로그램", "시험출제 통합점검기 · 1단계 MVP"),
        ("저장 시각(실행 PC)", datetime.now().isoformat(timespec="seconds")),
        ("판정", result.status.value),
        ("오류 / 확인 필요 / 정상 (점검 항목 수)", f"{result.count(Status.ERROR)} / {result.count(Status.REVIEW)} / {result.count(Status.OK)}"),
        ("시험 원안지", str(result.exam.path)), ("문항정보표", str(result.info.path)),
        ("기준 총점(교사 지정)", result.expected_total if result.expected_total is not None else "미지정"),
        ("범위", "문항번호·정답·배점 메타데이터 대조. 문항 내용·사실관계·정답의 타당성 검증 및 AI 기능은 미구현."),
        ("해석", "오류는 확실한 추출값 간 불일치 후보입니다. 정상도 출제 승인이나 문서 전체의 무오류를 뜻하지 않습니다. 교사가 원문을 보고 최종 판단하세요."),
        ("개인정보", "이 보고서에는 원본 경로와 추출 원문이 포함됩니다. 학교의 문서 보관 규정에 따라 관리하세요."),
        ("긴 원문", "Excel 셀 한도(32,767자)를 넘는 원문은 보고서에서 잘립니다. 전체 값은 앱의 추출 미리보기와 원본으로 확인하세요."),
    ]:
        _append(summary, row)
    findings = book.create_sheet("점검 결과")
    _append(findings, ("구분", "문항번호", "점검 내용", "판단 이유", "시험 원안지 근거", "문항정보표 근거", "규칙 코드"))
    for item in result.findings:
        _append(findings, (item.status.value, item.number, item.title, item.message,
                           "\n\n".join(e.display() for e in item.exam_evidence),
                           "\n\n".join(e.display() for e in item.info_evidence), item.code))
        findings.cell(findings.max_row, 1).fill = PatternFill("solid", fgColor=COLORS[item.status.value])
    for title, doc in [("원안지 추출", result.exam), ("정보표 추출", result.info)]:
        sheet = book.create_sheet(title)
        _append(sheet, ("문항번호", "정답(정규화)", "배점", "추출 수준", "원본 위치", "원본에서 읽은 값"))
        for q in doc.questions:
            _append(sheet, (q.number, q.answer or "읽지 못함", q.points if q.points is not None else "읽지 못함",
                            "표 값" if q.reliable else "확인 필요", q.evidence.location, q.evidence.text))
    for sheet in book:
        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        for cell in sheet[1]:
            cell.font = Font(bold=True, color="FFFFFF")
            cell.fill = PatternFill("solid", fgColor="244B68")
        for i in range(1, sheet.max_column + 1):
            sheet.column_dimensions[get_column_letter(i)].width = 55 if i >= 4 else 26
    summary.column_dimensions["B"].width = 105
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".exam-report-", suffix=".xlsx", dir=target.parent, delete=False) as stream:
            temporary = Path(stream.name)
        book.save(temporary)
        os.replace(temporary, target)
    finally:
        book.close()
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return target

