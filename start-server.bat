@echo off
cd /d "%~dp0"
:: Run the bash script via Git Bash (bundled with pi)
bash "%~dp0start.sh" %*
pause
