"""제한적인 정규화. 해석할 수 없는 값을 추측하거나 정답을 추론하지 않는다."""

import re
import unicodedata
from decimal import Decimal, InvalidOperation

CHOICES = str.maketrans({c: str(i) for i, c in enumerate("①②③④⑤⑥⑦⑧⑨⑩", 1)})
MISSING = {"", "?", "미정", "없음", "별도", "별도첨부", "해당없음", "-", "확인필요"}
KINDS = {"객관식": "", "선택형": "", "선다형": "", "서답형": "서답형", "서술형": "서답형", "논술형": "서답형", "단답형": "서답형"}


def text(value: object) -> str:
    if value is None:
        return ""
    return unicodedata.normalize("NFC", str(value)).strip()


def header(value: object) -> str:
    return re.sub(r"[\s:：()（）._-]", "", text(value))


def question_number(value: object, kind: object = "") -> str | None:
    if isinstance(value, bool):
        return None
    raw = re.sub(r"\s+", "", text(value))
    # XLSX에서 정수 문항번호가 1.0으로 저장된 경우.
    raw = re.sub(r"^(\d+)\.0$", r"\1", raw)
    match = re.fullmatch(r"(?:(객관식|선택형|선다형|서답형|서술형|논술형|단답형))?(\d{1,4})(?:[-－](\d{1,3}))?(?:번|[.)])?", raw)
    if not match:
        return None
    prefix, main, sub = match.groups()
    kind_text = re.sub(r"\s+", "", text(kind))
    if kind_text and kind_text not in KINDS:
        return None
    if prefix and kind_text and KINDS[prefix] != KINDS[kind_text]:
        return None
    if int(main) < 1 or (sub is not None and int(sub) < 1):
        return None
    prefix = KINDS.get(prefix or kind_text, "")
    return f"{prefix + ' ' if prefix else ''}{int(main)}" + (f"-{int(sub)}" if sub else "")


def answer(value: object) -> str | None:
    if isinstance(value, bool):
        return None
    raw = text(value)
    if header(raw) in MISSING or raw.startswith(("=", "#")):
        return None
    raw = re.sub(r"\s+", " ", raw)
    # 원문이 모두 원문자일 때만 붙어 있는 복수 정답을 분리한다.
    if re.fullmatch(r"[①-⑩\s,、/]+", raw):
        nums = [c.translate(CHOICES) for c in raw if c in "①②③④⑤⑥⑦⑧⑨⑩"]
        return ",".join(sorted(set(nums), key=int))
    raw = raw.translate(CHOICES)
    if re.fullmatch(r"\d+\.0", raw):
        raw = raw[:-2]
    if re.fullmatch(r"\d+(?:\s*[,、/]\s*\d+)*", raw):
        return ",".join(str(n) for n in sorted({int(n) for n in re.split(r"\s*[,、/]\s*", raw)}))
    # 서답형 문자열은 공백 정리 이외의 의미/동의어 추론을 하지 않는다.
    if any(c in raw for c in ("?", "~", "|")):
        return None
    return raw


def points(value: object) -> Decimal | None:
    if isinstance(value, bool):
        return None
    raw = re.sub(r"\s+", "", text(value)).removesuffix("점")
    if not re.fullmatch(r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?", raw):
        return None
    try:
        result = Decimal(raw.replace(",", ""))
    except InvalidOperation:
        return None
    return result if result.is_finite() and 0 < result <= 10000 else None

