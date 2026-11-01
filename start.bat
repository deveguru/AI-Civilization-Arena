@echo off
REM One-click start for Windows: creates a virtualenv, installs deps, runs the server.
cd /d "%~dp0"
chcp 65001 >nul
if not exist .venv (
  echo Creating virtual environment...
  python -m venv .venv || (echo Python 3.10+ is required: https://www.python.org/downloads/ & pause & exit /b 1)
)
call .venv\Scripts\activate.bat
python -m pip install -q --upgrade pip
pip install -q -r requirements.txt
start "" http://127.0.0.1:8080
python run.py %*
pause
