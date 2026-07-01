@echo off
chcp 65001 >nul
title pi-web-check

:: 检查端口
netstat -ano | findstr ":30142.*LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo [跳过] pi-web 30142 已在运行
    timeout /t 2 >nul
    exit
)

:: 用 start 命令启动新窗口
echo [启动] pi-web 30142...
start "pi-web-30142" /D "%~dp0" cmd /k "npx next dev -p 30142"
echo [完成] 已启动
timeout /t 2 >nul
