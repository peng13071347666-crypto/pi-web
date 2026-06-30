@echo off
echo 正在启动 5 个 pi-web 实例...
echo.

start "实例1" cmd /c "cd /d "%~dp0" && npx next dev -p 30142"
echo 启动实例1: http://localhost:30142

start "实例2" cmd /c "cd /d "%~dp0" && npx next dev -p 30143"
echo 启动实例2: http://localhost:30143

start "实例3" cmd /c "cd /d "%~dp0" && npx next dev -p 30144"
echo 启动实例3: http://localhost:30144

start "实例4" cmd /c "cd /d "%~dp0" && npx next dev -p 30145"
echo 启动实例4: http://localhost:30145

start "实例5" cmd /c "cd /d "%~dp0" && npx next dev -p 30146"
echo 启动实例5: http://localhost:30146

echo.
echo 所有实例已启动！
echo.
echo 收藏以下地址：
echo   http://localhost:30142
echo   http://localhost:30143
echo   http://localhost:30144
echo   http://localhost:30145
echo   http://localhost:30146
echo.
pause
