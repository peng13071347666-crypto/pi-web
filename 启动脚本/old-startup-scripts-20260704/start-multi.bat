@echo off
REM pi-web 多实例启动脚本 (Windows)
REM 用法: start-multi.bat [端口号]
REM 例如: start-multi.bat 30142 30143 30144

if "%~1"=="" (
    set PORTS=30142
) else (
    set PORTS=%*
)

for %%p in (%PORTS%) do (
    echo 启动 pi-web 实例在端口 %%p...
    start "pi-web-%%p" cmd /c "npx next dev -p %%p"
    echo   URL: http://localhost:%%p
    echo.
)

echo 所有实例已启动！
