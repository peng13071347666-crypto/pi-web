@echo off
REM pi-web 多实例管理器 (Windows CMD)
REM 用法: pi-web-manager.bat [start|stop|status|restart] [端口号]

if "%~1"=="" (
    echo 用法: pi-web-manager.bat [start^|stop^|status^|restart] [端口号]
    echo.
    echo 示例:
    echo   pi-web-manager.bat start 30142 30143 30144
    echo   pi-web-manager.bat stop 30142
    echo   pi-web-manager.bat status
    echo   pi-web-manager.bat restart 30142
    exit /b 1
)

powershell -ExecutionPolicy Bypass -File "%~dp0pi-web-manager.ps1" %*
