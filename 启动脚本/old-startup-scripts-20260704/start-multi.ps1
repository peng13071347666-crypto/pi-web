# pi-web 多实例启动脚本 (PowerShell)
# 用法: .\start-multi.ps1 -Ports 30142,30143,30144

param(
    [int[]]$Ports = @(30142)
)

foreach ($port in $Ports) {
    Write-Host "启动 pi-web 实例在端口 $port..." -ForegroundColor Green
    Start-Process -FilePath "npx" -ArgumentList "next", "dev", "-p", $port -WindowStyle Normal
    Write-Host "  URL: http://localhost:$port" -ForegroundColor Cyan
    Write-Host ""
}

Write-Host "所有实例已启动！" -ForegroundColor Yellow
Write-Host "使用 Get-Process node 查看进程" -ForegroundColor Gray
Write-Host "使用 Stop-Process -Id <PID> 停止实例" -ForegroundColor Gray
