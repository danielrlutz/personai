@echo off
setlocal
REM PersonAI OS setup wizard — launches PowerShell setup.ps1
set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%setup.ps1" %*
exit /b %ERRORLEVEL%
