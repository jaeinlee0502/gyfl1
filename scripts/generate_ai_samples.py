"""가상 AI 검토 자료만 생성. 실제 시험/학생 정보가 포함되지 않는다."""
from pathlib import Path

import fitz
from openpyxl import Workbook


def main():
    root = Path(__file__).resolve().parents[1] / "samples"
    doc = fitz.open()
    texts = [
        "가상 시험 · AI 검토 개발 예제 (실제 시험 아님)\n\n"
        "1. 빈칸 (가), (나)에 들어갈 숫자를 순서대로 고르시오.\n\n"
        "[자료] 사과 2개와 사과 3개를 합치면 사과 (가)개이다.\n\n"
        "① 5, 2   ② 4, 3   ③ 3, 4   ④ 2, 5   ⑤ 1, 6\n\n"
        "[개발용 안내] 의도한 결함: 자료에 (나)가 없음.\n"
        "이 안내가 없는 실제 문항의 오류 탐지를 보장하지 않음.",
        "가상 시험 · AI 검토 개발 예제 (실제 시험 아님)\n\n"
        "2. 2 + 3의 값은?\n\n① 4   ② 5   ③ 6   ④ 7   ⑤ 8\n\n"
        "[개발용 안내] 의도한 답: ②. 가상 정보표에는 ①로 기록함.",
    ]
    for text in texts:
        page = doc.new_page(width=595, height=842)
        page.insert_textbox(fitz.Rect(45, 55, 550, 790), text, fontname="korea", fontsize=13)
    doc.save(root / "ai_review_fixture.pdf")
    doc[0].get_pixmap(matrix=fitz.Matrix(1.2, 1.2)).save(root / "ai_review_fixture.png")
    doc.close()
    book = Workbook()
    sheet = book.active
    sheet.title = "가상 정보표"
    sheet.append(["문항번호", "정답", "배점", "비고"])
    sheet.append([1, "①", 50, "LOCAL_ONLY_SENTINEL_8F31"])
    sheet.append([2, "①", 50, "가상 불일치 검증용"])
    sheet.append(["합계", "", 100, ""])
    book.save(root / "ai_info_fixture.xlsx")
    print("가상 AI 예제 PDF/PNG/정보표 생성 완료")


if __name__ == "__main__":
    main()
