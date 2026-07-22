@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-pi-web-30142.ps1"

if errorlevel 1 (
  echo.
  echo pi-web startup failed. Press any key to close this window.
  pause >nul
)
