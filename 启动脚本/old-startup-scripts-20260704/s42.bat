@echo off
cd /d "%~dp0"
start "pi-web" /MIN node node_modules\next\dist\bin\next dev -p 30142
exit
