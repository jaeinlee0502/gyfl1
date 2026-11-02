from decimal import Decimal

import pytest

from exam_checker import normalize as n


@pytest.mark.parametrize("raw,expected", [("①", "1"), ("③①", "1,3"), ("3 / 1", "1,3"),
                                          (2.0, "2"), ("가상  답안", "가상 답안"), ("?", None), ("=A1", None)])
def test_answers(raw, expected):
    assert n.answer(raw) == expected


@pytest.mark.parametrize("raw,expected", [("2.5점", Decimal("2.5")), ("1,000", Decimal("1000")),
                                          ("2,5", None), (True, None), ("=10+10", None), ("-1", None)])
def test_scores_are_decimal_or_unknown(raw, expected):
    assert n.points(raw) == expected


def test_number_kind_and_subquestions():
    assert n.question_number("01번") == "1"
    assert n.question_number("서술형 01-02") == "서답형 1-2"
    assert n.question_number(1, "객관식") == "1"
    assert n.question_number(1, "단답형") == "서답형 1"
    assert n.question_number("서술형 1", "객관식") is None
    assert n.question_number("1", "불명확한 유형") is None
    assert n.question_number("0") is None

