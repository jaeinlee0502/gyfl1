@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\pythonw.exe" (
  echo 먼저 README의 설치 절차를 완료해 주세요.
  pause
  exit /b 1
)
start "시험출제 통합점검기" ".venv\Scripts\pythonw.exe" "run_app.py"
