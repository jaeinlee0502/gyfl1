"""문서 추출, 규칙 대조, UI가 공유하는 순수 데이터 모델."""

from dataclasses import dataclass, field
from decimal import Decimal
from enum import Enum
from pathlib import Path


class Status(str, Enum):
    ERROR = "오류"
    REVIEW = "확인 필요"
    OK = "정상"


@dataclass(frozen=True)
class Evidence:
    location: str
    text: str

    def display(self) -> str:
        return f"{self.location}\n{self.text}"


@dataclass(frozen=True)
class Question:
    number: str
    answer: str | None
    points: Decimal | None
    evidence: Evidence
    reliable: bool = True


@dataclass(frozen=True)
class ExtractionNote:
    message: str
    evidence: Evidence


@dataclass(frozen=True)
class DeclaredTotal:
    points: Decimal
    evidence: Evidence


@dataclass
class ExtractedDocument:
    path: Path
    questions: list[Question] = field(default_factory=list)
    notes: list[ExtractionNote] = field(default_factory=list)
    totals: list[DeclaredTotal] = field(default_factory=list)
    # 명시적 표의 모든 행을 해석한 경우만 True. 문서 전체의 의미 정확도를 뜻하지 않음.
    complete: bool = True
    method: str = "명시적 문항 표"


@dataclass(frozen=True)
class Finding:
    status: Status
    code: str
    number: str
    title: str
    message: str
    exam_evidence: tuple[Evidence, ...] = ()
    info_evidence: tuple[Evidence, ...] = ()


@dataclass
class CheckResult:
    exam: ExtractedDocument
    info: ExtractedDocument
    expected_total: Decimal | None
    findings: list[Finding]

    @property
    def status(self) -> Status:
        if any(f.status == Status.ERROR for f in self.findings):
            return Status.ERROR
        if any(f.status == Status.REVIEW for f in self.findings):
            return Status.REVIEW
        return Status.OK

    def count(self, status: Status) -> int:
        return sum(f.status == status for f in self.findings)

