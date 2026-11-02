"""1단계 결정적 대조 규칙. 불확실한 추출은 오류로 승격하지 않는다."""

import re
from collections import defaultdict
from decimal import Decimal

from .models import CheckResult, Evidence, ExtractedDocument, Finding, Question, Status


def _group(doc: ExtractedDocument) -> dict[str, list[Question]]:
    groups = defaultdict(list)
    for question in doc.questions:
        groups[question.number].append(question)
    return dict(groups)


def number_sort(number: str):
    parts = re.split(r"(\d+)", number)
    return tuple((0, int(p)) if p.isdigit() else (1, p) for p in parts)


def compare(exam: ExtractedDocument, info: ExtractedDocument,
            expected_total: Decimal | None = Decimal("100")) -> CheckResult:
    if expected_total is not None:
        expected_total = Decimal(str(expected_total))
        if not expected_total.is_finite() or expected_total <= 0 or expected_total > 10000:
            raise ValueError("기준 총점은 0보다 크고 10,000 이하인 수여야 합니다.")
    findings = []
    eg, ig = _group(exam), _group(info)

    def add(status, code, number, title, message, e=(), i=()):
        findings.append(Finding(status, code, number, title, message, tuple(e), tuple(i)))

    for side, doc, groups in [("시험 원안지", exam, eg), ("문항정보표", info, ig)]:
        def at_side(evidence):
            return {"e": evidence} if doc is exam else {"i": evidence}

        for item in doc.notes:
            add(Status.REVIEW, "extraction", "—", f"{side} 추출 확인", item.message,
                **at_side((item.evidence,)))
        if not doc.questions and not doc.notes:
            add(Status.REVIEW, "empty", "—", f"{side} 문항 없음", "문항 0개는 정상 판정의 근거가 될 수 없습니다.",
                **at_side((Evidence(doc.path.name, "문항 0개"),)))
        # 완전성이 낮아도 별도 note가 없는 외부 어댑터의 불확실성을 숨기지 않는다.
        if not doc.complete and not doc.notes:
            add(Status.REVIEW, "coverage", "—", f"{side} 추출 범위 확인", "추출의 완전성을 보장할 수 없습니다.")
        for number, items in groups.items():
            if len(items) > 1:
                status = Status.ERROR if doc.complete and all(q.reliable for q in items) else Status.REVIEW
                add(status, "duplicate", number, f"{side} 중복 문항번호",
                    f"같은 번호가 {len(items)}회 추출되었습니다. 유형 구분/원문 중복을 확인해 주세요.",
                    **at_side(tuple(q.evidence for q in items)))
        # 양쪽에 동시에 빠진 문항도 조용히 정상으로 처리하지 않는다. 의도적 비연속은 교사가 판단.
        sections = defaultdict(set)
        for number in groups:
            m = re.fullmatch(r"(서답형 )?(\d+)", number)
            if m:
                sections[m[1] or ""].add(int(m[2]))
        for prefix, numbers in sections.items():
            absent = sorted(set(range(1, max(numbers) + 1)) - numbers)
            if absent:
                shown = ", ".join(map(str, absent[:30])) + (" …" if len(absent) > 30 else "")
                add(Status.REVIEW, "sequence", "—", f"{side} 번호 연속성",
                    f"{prefix}번호 중 {shown}이 없습니다. 실제 누락인지 의도적인 번호 체계인지 확인해 주세요.",
                    **at_side(tuple(q.evidence for q in doc.questions[:1])))

    for number in sorted(eg.keys() | ig.keys(), key=number_sort):
        e, i = eg.get(number, []), ig.get(number, [])
        ee, ie = tuple(q.evidence for q in e), tuple(q.evidence for q in i)
        if not e or not i:
            # 반대 문서의 번호 자체도 불확실할 수 있으므로 양쪽을 모두 확인한다.
            reliable = bool(exam.questions and info.questions) and exam.complete and info.complete and all(q.reliable for q in e + i)
            absent = "시험 원안지" if not e else "문항정보표"
            add(Status.ERROR if reliable else Status.REVIEW, "missing", number, "누락 문항 후보",
                f"{absent}에서 같은 문항번호를 찾지 못했습니다." +
                ("" if reliable else " 추출 불확실성이 있어 원문 확인이 필요합니다."), ee, ie)
            continue
        if len(e) != 1 or len(i) != 1:
            add(Status.REVIEW, "ambiguous_pair", number, "일대일 대조 불가",
                "중복 번호의 어느 행이 대응하는지 결정할 수 없습니다. 중복을 먼저 확인해 주세요.", ee, ie)
            continue
        left, right = e[0], i[0]
        reliable = left.reliable and right.reliable
        mismatch_reliable = reliable and exam.complete and info.complete
        for code, label, lv, rv in [("answer", "정답", left.answer, right.answer),
                                    ("points", "배점", left.points, right.points)]:
            if lv is None or rv is None:
                add(Status.REVIEW, code, number, f"{label} 확인 필요", "빈칸·수식 또는 불명확한 값이 있어 대조하지 못했습니다.", ee, ie)
            elif lv != rv:
                add(Status.ERROR if mismatch_reliable else Status.REVIEW, code, number, f"{label} 불일치 후보",
                    f"시험 원안지: {lv} / 문항정보표: {rv}." + ("" if mismatch_reliable else " 추출 범위/정확도에 불확실성이 있어 원문 확인이 필요합니다."), ee, ie)
            else:
                add(Status.OK if reliable else Status.REVIEW, code, number,
                    f"{label} 일치" if reliable else f"{label} 추출값 일치·원문 확인",
                    f"양쪽 추출값: {lv}." + ("" if reliable else " 추출 정확도는 보장하지 않습니다."), ee, ie)

    for side, doc, groups in [("시험 원안지", exam, eg), ("문항정보표", info, ig)]:
        evidence = tuple(q.evidence for q in doc.questions) + tuple(t.evidence for t in doc.totals)
        kwargs = {"e": evidence} if doc is exam else {"i": evidence}
        known = sum((q.points for q in doc.questions if q.points is not None), Decimal(0))
        reliable = bool(doc.questions) and doc.complete and all(
            q.reliable and q.points is not None for q in doc.questions
        ) and all(len(items) == 1 for items in groups.values())
        if not reliable:
            add(Status.REVIEW, "total", "합계", f"{side} 총점 확인 필요",
                f"읽힌 행의 배점 소계는 {known}점입니다(중복 포함 가능). 누락·중복·불명확한 추출이 있어 총점 오류를 단정하지 않습니다.", **kwargs)
            continue
        targets = [("교사 지정 기준 총점", expected_total)] if expected_total is not None else []
        targets += [(f"원문 표기 총점 {index}", total.points) for index, total in enumerate(doc.totals, 1)]
        if not targets:
            add(Status.REVIEW, "total", "합계", f"{side} 총점 기준 없음", f"추출 배점 합계는 {known}점입니다. 대조할 기준 총점이 없습니다.", **kwargs)
        for label, target in targets:
            equal = known == target
            add(Status.OK if equal else Status.ERROR, "total", "합계", f"{side} 총점 {'일치' if equal else '불일치 후보'}",
                f"추출 배점 합계 {known}점 / {label} {target}점.", **kwargs)
    return CheckResult(exam, info, expected_total, findings)

