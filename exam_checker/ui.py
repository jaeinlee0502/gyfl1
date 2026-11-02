"""한국어 PySide6 UI. 추출/대조는 작업 스레드에서, 원문은 읽기 전용으로 표시한다."""

import sys
from decimal import Decimal
from pathlib import Path

from PySide6.QtCore import Qt, QThread, Signal
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QApplication, QComboBox, QDoubleSpinBox, QFileDialog, QGroupBox, QHBoxLayout,
    QHeaderView, QLabel, QLineEdit, QMainWindow, QMessageBox, QPlainTextEdit,
    QProgressBar, QPushButton, QSplitter, QTableWidget, QTableWidgetItem,
    QTabWidget, QVBoxLayout, QWidget,
)

from .models import CheckResult, Status
from .report import save_report
from .service import check_files

FILE_FILTER = "지원 문서 (*.xlsx *.docx *.hwpx *.pdf);;모든 파일 (*)"
PALETTE = {Status.ERROR: "#fce5e5", Status.REVIEW: "#fff2ce", Status.OK: "#e3f3e9"}


class CheckWorker(QThread):
    completed = Signal(object)
    failed = Signal(str)

    def __init__(self, exam, info, total, parent=None):
        super().__init__(parent)
        self.paths = exam, info
        self.total = total

    def run(self):
        try:
            self.completed.emit(check_files(*self.paths, self.total))
        except (ValueError, OSError) as exc:
            self.failed.emit(str(exc))
        except Exception:
            self.failed.emit("점검 중 문제가 발생했습니다. 파일 형식과 읽기 권한을 확인해 주세요. 원본은 수정되지 않았습니다.")


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("시험출제 통합점검기 · 오프라인")
        self.resize(1250, 900)
        self.setMinimumSize(900, 660)
        self.result: CheckResult | None = None
        self.worker = None
        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)
        layout.setContentsMargins(24, 18, 24, 18)
        layout.setSpacing(12)
        title = QLabel("시험출제 통합점검기")
        title.setObjectName("title")
        layout.addWidget(title)
        intro = QLabel("오프라인 전용  |  원본 읽기 전용  |  문항번호·정답·배점 대조\n문항 내용·사실관계·정답의 타당성 및 AI 점검은 포함하지 않습니다.")
        intro.setWordWrap(True)
        layout.addWidget(intro)

        self.inputs = QGroupBox("1. 대조할 문서 선택")
        inputs_layout = QVBoxLayout(self.inputs)
        self.exam_path = QLineEdit()
        self.info_path = QLineEdit()
        for label, edit in [("시험 원안지", self.exam_path), ("문항정보표", self.info_path)]:
            line = QHBoxLayout()
            name = QLabel(label)
            name.setMinimumWidth(90)
            edit.setReadOnly(True)
            edit.setPlaceholderText("XLSX · DOCX · HWPX · 텍스트 PDF")
            edit.setAccessibleName(label + " 경로")
            browse = QPushButton("파일 선택…")
            browse.clicked.connect(lambda checked=False, field=edit: self.choose_file(field))
            line.addWidget(name)
            line.addWidget(edit, 1)
            line.addWidget(browse)
            inputs_layout.addLayout(line)
            edit.textChanged.connect(self.invalidate)
        hint = QLabel("권장: ‘문항번호 / 정답 / 배점’ 열이 있는 표. 구형 HWP는 HWPX로 저장해 주세요. 스캔 PDF의 OCR은 지원하지 않습니다.")
        hint.setWordWrap(True)
        inputs_layout.addWidget(hint)
        controls = QHBoxLayout()
        controls.addWidget(QLabel("교사 지정 기준 총점"))
        self.total = QDoubleSpinBox()
        self.total.setRange(0.01, 10000)
        self.total.setDecimals(2)
        self.total.setValue(100)
        self.total.setSuffix(" 점")
        self.total.setAccessibleName("교사 지정 기준 총점")
        self.total.valueChanged.connect(self.invalidate)
        controls.addWidget(self.total)
        controls.addStretch()
        self.samples = QComboBox()
        self.samples.addItems(["정상 가상 예제", "오류 가상 예제", "총점 오류 예제", "추출 확인 예제", "PDF 확인 예제"])
        controls.addWidget(self.samples)
        load_sample = QPushButton("예제 불러오기")
        load_sample.clicked.connect(self.load_sample)
        controls.addWidget(load_sample)
        inputs_layout.addLayout(controls)
        layout.addWidget(self.inputs)

        action = QHBoxLayout()
        self.check_button = QPushButton("2. 점검 시작")
        self.check_button.setObjectName("primary")
        self.check_button.setMinimumHeight(40)
        self.check_button.clicked.connect(self.start_check)
        action.addWidget(self.check_button)
        self.progress = QProgressBar()
        self.progress.setRange(0, 0)
        self.progress.setTextVisible(False)
        self.progress.hide()
        action.addWidget(self.progress, 1)
        action.addStretch()
        self.export_button = QPushButton("3. XLSX 보고서 저장…")
        self.export_button.setMinimumHeight(40)
        self.export_button.setEnabled(False)
        self.export_button.clicked.connect(self.export_report)
        action.addWidget(self.export_button)
        layout.addLayout(action)

        self.summary = QLabel("두 파일을 선택하고 점검을 시작하세요. 가상 예제로 먼저 사용 방법을 확인할 수 있습니다.")
        self.summary.setWordWrap(True)
        self.summary.setObjectName("summary")
        layout.addWidget(self.summary)
        self.tabs = QTabWidget()
        result_widget = QWidget()
        result_layout = QVBoxLayout(result_widget)
        toolbar = QHBoxLayout()
        toolbar.addWidget(QLabel("표시 항목"))
        self.status_filter = QComboBox()
        self.status_filter.addItems(["전체", "오류", "확인 필요", "정상"])
        self.status_filter.currentTextChanged.connect(self.populate_findings)
        toolbar.addWidget(self.status_filter)
        toolbar.addWidget(QLabel("행을 선택하면 아래에 원문 근거가 표시됩니다."))
        toolbar.addStretch()
        result_layout.addLayout(toolbar)
        splitter = QSplitter(Qt.Orientation.Vertical)
        self.findings_table = self.make_table(["구분", "문항", "점검 내용", "판단 이유"])
        self.findings_table.itemSelectionChanged.connect(self.show_evidence)
        splitter.addWidget(self.findings_table)
        self.detail = QPlainTextEdit()
        self.detail.setReadOnly(True)
        self.detail.setPlaceholderText("오류/확인 필요 항목을 선택해 원본 위치와 읽은 값을 확인하세요.")
        self.detail.setAccessibleName("선택한 항목의 원본 근거")
        splitter.addWidget(self.detail)
        splitter.setSizes([300, 160])
        result_layout.addWidget(splitter)
        self.tabs.addTab(result_widget, "점검 결과 · 원문 근거")
        self.preview_tables = []
        for title in ("시험 원안지 추출", "문항정보표 추출"):
            table = self.make_table(["문항", "정답", "배점", "추출 수준", "원본 위치", "읽은 원문"])
            self.preview_tables.append(table)
            self.tabs.addTab(table, title)
        layout.addWidget(self.tabs, 1)
        footer = QLabel("‘오류’는 불일치 후보이며 ‘정상’도 출제 승인을 뜻하지 않습니다. 교사가 원본을 확인하고 직접 판단하세요. 보고서는 원문 일부를 포함합니다.")
        footer.setWordWrap(True)
        layout.addWidget(footer)
        self.setStyleSheet("""
            QMainWindow { background: #f5f7fa; }
            QWidget { font-family: '맑은 고딕', 'Malgun Gothic', 'Noto Sans CJK KR', sans-serif; font-size: 13px; color: #243447; }
            QLabel#title { font-size: 25px; font-weight: 700; color: #183e5b; }
            QLabel#summary { background: #e8eef5; padding: 12px; border-radius: 6px; font-weight: 600; }
            QGroupBox { background: white; border: 1px solid #d6dfe7; border-radius: 6px; margin-top: 12px; padding: 14px; }
            QGroupBox::title { subcontrol-origin: margin; left: 12px; padding: 0 5px; font-weight: 600; }
            QPushButton { padding: 7px 15px; border: 1px solid #bccbd8; border-radius: 4px; background: white; }
            QPushButton:hover { background: #e7eff7; }
            QPushButton#primary { background: #245b83; color: white; border: none; font-weight: 700; }
            QPushButton:disabled { color: #87949f; background: #edf0f3; }
            QLineEdit, QDoubleSpinBox, QComboBox { background: white; padding: 6px; border: 1px solid #cdd7df; border-radius: 3px; }
            QTableWidget, QPlainTextEdit { background: white; border: 1px solid #d6dfe7; selection-background-color: #d8e9f6; selection-color: #183e5b; }
            QHeaderView::section { background: #e9eff5; padding: 8px; border: none; font-weight: 600; }
        """)

    @staticmethod
    def make_table(headers):
        table = QTableWidget(0, len(headers))
        table.setHorizontalHeaderLabels(headers)
        table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        table.setSelectionMode(QTableWidget.SelectionMode.SingleSelection)
        table.setWordWrap(True)
        table.verticalHeader().hide()
        table.horizontalHeader().setSectionResizeMode(QHeaderView.ResizeMode.ResizeToContents)
        table.horizontalHeader().setMaximumSectionSize(650)
        table.horizontalHeader().setStretchLastSection(True)
        return table

    def choose_file(self, field):
        path, _ = QFileDialog.getOpenFileName(self, "문서 선택", "", FILE_FILTER)
        if path:
            field.setText(path)

    def load_sample(self):
        root = Path(__file__).resolve().parent.parent / "samples"
        names = ["info_ok.xlsx", "info_errors.xlsx", "info_total_error.xlsx", "info_review.xlsx", "info_ok.xlsx"]
        exam = root / ("exam_text.pdf" if self.samples.currentIndex() == 4 else "exam.docx")
        info = root / names[self.samples.currentIndex()]
        if not exam.is_file() or not info.is_file():
            QMessageBox.information(self, "예제 파일 없음", "프로젝트의 samples 폴더를 확인해 주세요. README의 가상 샘플 생성 명령으로 다시 만들 수 있습니다.")
            return
        self.exam_path.setText(str(exam))
        self.info_path.setText(str(info))
        self.total.setValue(100)

    def invalidate(self, *args):
        self.result = None
        # 위젯 생성 중 발생하는 신호도 허용한다.
        if hasattr(self, "export_button"):
            self.export_button.setEnabled(False)
            self.summary.setText("입력 또는 기준이 바뀌었습니다. 점검을 다시 시작해 주세요.")
            self.findings_table.setRowCount(0)
            self.detail.clear()
            for table in self.preview_tables:
                table.setRowCount(0)

    def start_check(self):
        if self.worker is not None and self.worker.isRunning():
            return
        if not self.exam_path.text() or not self.info_path.text():
            QMessageBox.information(self, "문서를 선택해 주세요", "시험 원안지와 문항정보표를 각각 선택해 주세요.")
            return
        self.invalidate()
        self.inputs.setEnabled(False)
        self.check_button.setEnabled(False)
        self.progress.show()
        self.summary.setText("PC 안에서 문서를 읽고 대조하는 중입니다… 원본 파일은 수정하지 않습니다.")
        self.worker = CheckWorker(self.exam_path.text(), self.info_path.text(), Decimal(str(self.total.value())), self)
        self.worker.completed.connect(self.display_result)
        self.worker.failed.connect(self.check_failed)
        self.worker.finished.connect(self.check_finished)
        self.worker.start()

    def check_finished(self):
        self.inputs.setEnabled(True)
        self.check_button.setEnabled(True)
        self.progress.hide()
        worker, self.worker = self.worker, None
        if worker is not None:
            worker.deleteLater()

    def check_failed(self, message):
        self.summary.setText("점검하지 못했습니다. 안내에 따라 파일을 확인해 주세요.")
        QMessageBox.warning(self, "파일 확인 필요", message)

    def display_result(self, result):
        self.result = result
        self.summary.setText(
            f"점검 완료 · {result.status.value}  |  오류 {result.count(Status.ERROR)} · 확인 필요 {result.count(Status.REVIEW)} · 정상 {result.count(Status.OK)} (점검 항목 수)\n"
            f"추출 행: 시험 원안지 {len(result.exam.questions)}개 / 문항정보표 {len(result.info.questions)}개 · 각 추출 탭에서 원문과 대조하세요."
        )
        self.populate_findings()
        for table, doc in zip(self.preview_tables, (result.exam, result.info)):
            table.setRowCount(len(doc.questions))
            for row, q in enumerate(doc.questions):
                values = (q.number, q.answer if q.answer is not None else "읽지 못함",
                          str(q.points) if q.points is not None else "읽지 못함",
                          "표 값" if q.reliable else "확인 필요", q.evidence.location, q.evidence.text)
                for col, value in enumerate(values):
                    item = QTableWidgetItem(value)
                    item.setToolTip(value)
                    table.setItem(row, col, item)
            table.resizeRowsToContents()
        self.export_button.setEnabled(True)
        self.tabs.setCurrentIndex(0)

    def populate_findings(self, *args):
        self.detail.clear()
        self.findings_table.setRowCount(0)
        if self.result is None:
            return
        selected = self.status_filter.currentText()
        items = [item for item in self.result.findings if selected == "전체" or item.status.value == selected]
        # 먼저 확인할 항목이 위로 온다. 입력 순서를 보존하는 안정 정렬.
        rank = {Status.ERROR: 0, Status.REVIEW: 1, Status.OK: 2}
        items.sort(key=lambda f: rank[f.status])
        self.findings_table.setRowCount(len(items))
        for row, finding in enumerate(items):
            for col, value in enumerate((finding.status.value, finding.number, finding.title, finding.message)):
                item = QTableWidgetItem(value)
                item.setToolTip(value)
                item.setBackground(QColor(PALETTE[finding.status]))
                if col == 0:
                    item.setData(Qt.ItemDataRole.UserRole, finding)
                self.findings_table.setItem(row, col, item)
        self.findings_table.resizeRowsToContents()
        if items:
            self.findings_table.selectRow(0)

    def show_evidence(self):
        row = self.findings_table.currentRow()
        cell = self.findings_table.item(row, 0) if row >= 0 else None
        finding = cell.data(Qt.ItemDataRole.UserRole) if cell else None
        if finding is None or self.result is None:
            return
        parts = [f"[{finding.status.value}] {finding.number} · {finding.title}", finding.message]
        for label, doc, evidence in [("시험 원안지", self.result.exam, finding.exam_evidence),
                                     ("문항정보표", self.result.info, finding.info_evidence)]:
            parts += [f"\n{label}: {doc.path}", f"추출 방법: {doc.method}",
                      "\n\n".join(e.display() for e in evidence) or "대응하는 추출 근거 없음 — 원문에서 직접 확인하세요."]
        self.detail.setPlainText("\n".join(parts))

    def export_report(self):
        if self.result is None:
            return
        path, _ = QFileDialog.getSaveFileName(self, "점검 보고서 저장(원문 일부 포함)", "시험출제_점검보고서.xlsx", "Excel 보고서 (*.xlsx)")
        if not path:
            return
        if not Path(path).suffix:
            path += ".xlsx"
        try:
            save_report(self.result, path)
        except ValueError as exc:
            QMessageBox.warning(self, "저장할 수 없습니다", str(exc))
        except OSError:
            QMessageBox.warning(self, "저장할 수 없습니다", "원본과 다른 로컬 XLSX 경로를 선택해 주세요. Excel에서 열려 있는 파일은 닫고 폴더의 쓰기 권한도 확인해 주세요.")
        else:
            QMessageBox.information(self, "보고서 저장 완료", "선택한 위치에 XLSX 보고서를 저장했습니다. 원문 근거가 포함되어 있으니 안전하게 보관해 주세요.")

    def closeEvent(self, event):
        if self.worker is not None and self.worker.isRunning():
            event.ignore()
            self.summary.setText("점검이 진행 중입니다. 완료 후 창을 닫아 주세요.")
        else:
            super().closeEvent(event)


def run():
    from .offline import enable_network_guard

    enable_network_guard()
    app = QApplication.instance() or QApplication([sys.argv[0]])
    app.setApplicationName("시험출제 통합점검기")
    app.setOrganizationName("OfflineExamTools")
    window = MainWindow()
    window.show()
    return app.exec()
