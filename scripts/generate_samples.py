"""가상의 자료만 생성한다. --force 없이는 기존 파일을 덮어쓰지 않는다."""

import argparse
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

import pymupdf
from docx import Document
from openpyxl import Workbook
from openpyxl.styles import Font

BASE_ROWS = [(i, str(i), 20) for i in range(1, 6)]
NAMES = ["exam.docx", "info_ok.xlsx", "info_errors.xlsx", "info_total_error.xlsx",
         "info_review.xlsx", "exam_text.pdf", "scan_only.pdf", "exam_fixture.hwpx"]


def make_xlsx(path, rows, total=100):
    book = Workbook()
    sheet = book.active
    sheet.title = "가상 문항정보표"
    sheet.append(["가상 자료 · 실제 출제/학생 정보 없음"])
    sheet.append(["문항번호", "정답", "배점"])
    for row in rows:
        sheet.append(row)
    sheet.append(["합계", None, total])
    for cell in sheet[2]:
        cell.font = Font(bold=True)
    for key, width in [("A", 42), ("B", 20), ("C", 20)]:
        sheet.column_dimensions[key].width = width
    book.save(path)
    book.close()


def make_hwpx_fixture(path):
    # 어댑터 테스트용 최소 XML fixture. 한글 편집기용 완전한 문서 생성기는 아니다.
    ns = "http://www.hancom.co.kr/hwpml/2011/paragraph"
    ET.register_namespace("hp", ns)
    root = ET.Element("{http://www.hancom.co.kr/hwpml/2011/section}sec")
    paragraph = ET.SubElement(root, f"{{{ns}}}p")
    run = ET.SubElement(paragraph, f"{{{ns}}}run")
    table = ET.SubElement(run, f"{{{ns}}}tbl", {"rowCnt": "7", "colCnt": "3"})
    for ri, values in enumerate([("문항번호", "정답", "배점"), *BASE_ROWS, ("합계", "", 100)]):
        row = ET.SubElement(table, f"{{{ns}}}tr")
        for ci, value in enumerate(values):
            cell = ET.SubElement(row, f"{{{ns}}}tc")
            sub = ET.SubElement(cell, f"{{{ns}}}subList")
            p = ET.SubElement(sub, f"{{{ns}}}p")
            r = ET.SubElement(p, f"{{{ns}}}run")
            ET.SubElement(r, f"{{{ns}}}t").text = str(value)
            ET.SubElement(cell, f"{{{ns}}}cellAddr", {"colAddr": str(ci), "rowAddr": str(ri)})
            ET.SubElement(cell, f"{{{ns}}}cellSpan", {"colSpan": "1", "rowSpan": "1"})
    with ZipFile(path, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("mimetype", "application/hwp+zip", compress_type=ZIP_STORED)
        archive.writestr("Contents/section0.xml", ET.tostring(root, encoding="utf-8", xml_declaration=True))


def generate(output: Path, force=False):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    if not force and any((output / name).exists() for name in NAMES):
        raise FileExistsError("기존 샘플 파일이 있습니다. 새 폴더를 선택하거나 --force를 명시해 주세요.")
    exam = Document()
    exam.add_heading("가상 시험 원안지 · 점검 연습용", 0)
    exam.add_paragraph("모든 문항은 프로그램 개발용 가상 자료입니다. 실제 학생·시험 정보가 없습니다.")
    exam.add_paragraph("선지 예시: ① 1개 ② 2개 ③ 3개 ④ 4개 ⑤ 5개. 아래 표는 대조할 문항 메타데이터입니다.")
    table = exam.add_table(rows=1, cols=4)
    table.style = "Table Grid"
    for cell, label in zip(table.rows[0].cells, ("문항번호", "정답", "배점", "가상 문항")):
        cell.text = label
    for number, answer, points in BASE_ROWS:
        values = (str(number), answer, str(points), f"가상 상자에 색종이가 {number}개 있다. 색종이는 몇 개인가?")
        for cell, value in zip(table.add_row().cells, values):
            cell.text = value
    for cell, value in zip(table.add_row().cells, ("합계", "", "100", "")):
        cell.text = value
    exam.save(output / "exam.docx")
    make_xlsx(output / "info_ok.xlsx", BASE_ROWS)
    make_xlsx(output / "info_errors.xlsx", [(1, "①", 20), (2, "③", 20), (3, "③", 10), (5, "⑤", 20), (5, "⑤", 20)])
    make_xlsx(output / "info_total_error.xlsx", [(1, "1", 19), *BASE_ROWS[1:]])
    make_xlsx(output / "info_review.xlsx", [(1, "1", 20), (2, "2", "=10+10"), (3, None, 20), *BASE_ROWS[3:]])
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        page.insert_text((48, 60), "가상 시험 원안지 · 텍스트 추출 연습용", fontname="korea", fontsize=13)
        for number, answer, points in BASE_ROWS:
            page.insert_text((48, 95 + number * 35), f"{number}. 가상 색종이 {number}개의 개수는? [정답: {answer}] [배점: {points}점]", fontname="korea", fontsize=10)
        page.insert_text((48, 320), "총점: 100점", fontname="korea", fontsize=10)
        pdf.save(output / "exam_text.pdf")
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        pixmap = pymupdf.Pixmap(pymupdf.csRGB, (0, 0, 100, 100), False)
        pixmap.clear_with(220)
        page.insert_image(pymupdf.Rect(40, 40, 300, 300), pixmap=pixmap)
        pdf.save(output / "scan_only.pdf")
    make_hwpx_fixture(output / "exam_fixture.hwpx")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "samples")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    generate(args.output, args.force)
    print("가상 샘플 생성 완료")

