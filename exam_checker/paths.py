"""로컬 파일 경계. URL/UNC 및 Windows 네트워크 드라이브를 거절한다."""

import os
import re
from pathlib import Path


def _reject_remote(raw: str):
    if raw.startswith(("\\\\", "//")) or re.match(r"^[A-Za-z][A-Za-z0-9+.-]*://", raw):
        raise ValueError("오프라인 점검은 PC의 로컬 파일만 지원합니다. URL/네트워크 공유 대신 로컬 디스크의 복사본을 선택해 주세요.")


def _check_windows_drive(path: Path):
    if os.name == "nt":
        import ctypes
        from ctypes import wintypes

        drive_type = ctypes.windll.kernel32.GetDriveTypeW
        drive_type.argtypes = [wintypes.LPCWSTR]
        drive_type.restype = wintypes.UINT
        if drive_type(path.anchor) == 4:  # DRIVE_REMOTE
            raise ValueError("네트워크 드라이브는 지원하지 않습니다. PC의 로컬 디스크에 복사한 파일을 선택해 주세요.")


def local_path(value: str | Path) -> Path:
    raw = os.fspath(value)
    _reject_remote(raw)
    absolute = Path(raw).expanduser().absolute()
    _reject_remote(str(absolute))
    _check_windows_drive(absolute)
    resolved = absolute.resolve()
    _reject_remote(str(resolved))
    _check_windows_drive(resolved)
    return resolved

