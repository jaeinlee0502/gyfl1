import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("info,code", [("info_ok.xlsx", 0), ("info_errors.xlsx", 1), ("info_review.xlsx", 2)])
def test_cli_runs_offline_and_writes_report(samples, tmp_path, info, code):
    report = tmp_path / "가상 보고서.xlsx"
    run = subprocess.run([sys.executable, "-m", "exam_checker", "check", "--exam", str(samples / "exam.docx"),
                          "--info", str(samples / info), "--report", str(report)],
                         cwd=ROOT, capture_output=True, text=True, encoding="utf-8", timeout=30)
    assert run.returncode == code, run.stderr
    assert "점검 완료" in run.stdout
    assert report.is_file()


def test_network_guard_blocks_outbound_socket_and_dns():
    script = '''
import socket
from exam_checker.offline import enable_network_guard
enable_network_guard()
enable_network_guard()
for operation in [lambda: socket.getaddrinfo("example.invalid", 443),
                  lambda: socket.socket().connect(("127.0.0.1", 1)),
                  lambda: socket.socket(type=socket.SOCK_DGRAM).sendto(b"fictional", ("127.0.0.1", 1))]:
    try:
        operation()
    except PermissionError as exc:
        assert "오프라인" in str(exc)
    else:
        raise AssertionError("network operation was not blocked")
print("blocked")
'''
    run = subprocess.run([sys.executable, "-c", script], cwd=ROOT, capture_output=True, text=True, timeout=10)
    assert run.returncode == 0, run.stderr
    assert "blocked" in run.stdout

