import time

import pytest
from openpyxl import load_workbook
from PySide6.QtTest import QTest
from PySide6.QtWidgets import QApplication, QFileDialog, QMessageBox

from exam_checker.models import Status
from exam_checker.ui import MainWindow


@pytest.fixture(scope="module")
def app():
    application = QApplication.instance() or QApplication([])
    yield application


def test_teacher_flow_preview_filter_export_and_invalidation(app, samples, tmp_path, monkeypatch):
    window = MainWindow()
    window.show()
    window.exam_path.setText(str(samples / "exam.docx"))
    window.info_path.setText(str(samples / "info_errors.xlsx"))
    window.check_button.click()
    deadline = time.monotonic() + 15
    while window.worker is not None and time.monotonic() < deadline:
        QTest.qWait(20)
    assert window.worker is None, "작업 스레드가 완료되지 않았습니다."
    assert window.result is not None
    assert window.result.status == Status.ERROR
    assert window.preview_tables[0].rowCount() == 5
    assert window.export_button.isEnabled()
    window.status_filter.setCurrentText("오류")
    assert window.findings_table.rowCount() == window.result.count(Status.ERROR)
    window.findings_table.selectRow(0)
    assert "시험 원안지" in window.detail.toPlainText()
    assert "시트" in window.detail.toPlainText() or "표 1" in window.detail.toPlainText()
    target = tmp_path / "교사 점검 보고서.xlsx"
    monkeypatch.setattr(QFileDialog, "getSaveFileName", lambda *args: (str(target), ""))
    monkeypatch.setattr(QMessageBox, "information", lambda *args: QMessageBox.StandardButton.Ok)
    window.export_button.click()
    book = load_workbook(target)
    assert book["점검 결과"].max_row > 1
    book.close()
    window.total.setValue(80)
    assert window.result is None
    assert not window.export_button.isEnabled()
    assert window.findings_table.rowCount() == 0
    window.close()


def test_bad_input_is_reported_and_does_not_leave_stale_results(app, samples, monkeypatch):
    warnings = []
    monkeypatch.setattr(QMessageBox, "warning", lambda *args: warnings.append(args[-1]))
    window = MainWindow()
    window.exam_path.setText(str(samples / "scan_only.pdf"))
    window.info_path.setText(str(samples / "info_ok.xlsx"))
    window.start_check()
    deadline = time.monotonic() + 15
    while window.worker is not None and time.monotonic() < deadline:
        QTest.qWait(20)
    assert warnings and "OCR" in warnings[0]
    assert window.result is None
    assert not window.export_button.isEnabled()
    assert window.check_button.isEnabled()
    window.close()
