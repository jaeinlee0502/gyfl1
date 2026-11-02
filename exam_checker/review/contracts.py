"""향후 로컬 모델 어댑터용 계약만 정의. 모델 로드·추론·다운로드는 미구현."""

from dataclasses import dataclass
from typing import Protocol

from ..models import Evidence


@dataclass(frozen=True)
class ReviewOpinion:
    question_number: str
    opinion: str
    evidence: tuple[Evidence, ...]
    uncertainty: str
    label: str = "검토 의견"


class LocalReviewer(Protocol):
    def review(self, question_text: str) -> list[ReviewOpinion]:
        """로컬 추론만 허용. 결과를 1단계 오류/정상 판정에 자동 병합하지 않는다."""
        ...

