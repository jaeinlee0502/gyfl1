"""개인/시험 정보가 없는 2쪽 정보표. 실제 문항·정답·배점 조합을 복사하지 않는다."""

import argparse
from pathlib import Path

import pymupdf


def generate(path: Path):
    with pymupdf.open() as pdf:
        first = pdf.new_page()

        def put(page, x, y, value, size=10):
            page.insert_text((x, y), str(value), fontname="korea", fontsize=size)

        put(first, 45, 40, "개발용 가상 문항정보표 · 실제 학교/학생/시험 정보 없음")
        put(first, 45, 60, "총 문항수 7 문항")
        put(first, 45, 80, "총점 100점  선택형 70점  서답형 30점")
        put(first, 255, 102, "선택형 문항")
        for x, text in [(50, "문항번호"), (120, "내용영역"), (275, "성취기준"), (430, "난이도"), (490, "배점"), (535, "정답")]:
            put(first, x, 127, text)

        def choice(page, n, y):
            put(page, 67, y, n)
            put(page, 120, y-5, "가상 영역")
            put(page, 120, y+8, "둘째 줄")
            put(page, 275, y, "가상 기준")
            put(page, 440, y, "○")
            put(page, 495, y, 14)
            put(page, 542, y, n)

        for n in [1, 2, 3]:
            choice(first, n, 165+(n-1)*52)
        put(first, 285, 798, "1 / 2")
        second = pdf.new_page()
        choice(second, 4, 80)
        choice(second, 5, 132)
        put(second, 255, 180, "서답형 문항")
        for n, y in [(1, 212), (2, 268)]:
            put(second, 67, y, n)
            put(second, 120, y, "가상 서답 영역")
            put(second, 275, y, "가상 기준")
            put(second, 495, y, 15)
            for offset, text in [(-21, "서답형"), (-7, "채점 기"), (7, "준표 참"), (21, "조")]:
                put(second, 530, y+offset, text)
        put(second, 240, 318, "총합계")
        put(second, 493, 318, "100")
        put(second, 240, 340, "비율(%)")
        put(second, 493, 340, "100")
        put(second, 285, 798, "2 / 2")
        path.parent.mkdir(parents=True, exist_ok=True)
        pdf.save(path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1]/"samples/info_table_fixture.pdf")
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit("파일이 이미 있습니다. 다른 출력 경로를 선택해 주세요.")
    generate(args.output)
