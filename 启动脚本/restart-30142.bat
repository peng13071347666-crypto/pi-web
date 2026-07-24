@echo off
cd /d C:\Users\彭宏宣\pi-web
set LOG=C:\Users\彭宏宣\pi-web\启动脚本\logs\restart-30142.log
"C:\Users\彭宏宣\nodejs\node-v22.23.1-win-x64\node.exe" bin\pi-web.js --port 30142 >> "%LOG%" 2>&1
