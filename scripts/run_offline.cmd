@echo off
rem Run Vitra on Windows. Same flags as scripts\run_offline.sh and run_offline.ps1,
rem same code (app\launch.py). Examples:
rem   scripts\run_offline.cmd --check
rem   scripts\run_offline.cmd
rem   scripts\run_offline.cmd predict dev
rem Python: %VITRA_PYTHON%, else .venv\Scripts\python.exe, else py -3, else python.
setlocal
set "ROOT=%~dp0.."
set "PY=%VITRA_PYTHON%"
set "PYARG="
if not defined PY if exist "%ROOT%\.venv\Scripts\python.exe" set "PY=%ROOT%\.venv\Scripts\python.exe"
if not defined PY (
  where py >nul 2>nul && set "PY=py" && set "PYARG=-3"
)
if not defined PY set "PY=python"
pushd "%ROOT%"
"%PY%" %PYARG% -m app.launch %*
set "CODE=%ERRORLEVEL%"
popd
exit /b %CODE%
