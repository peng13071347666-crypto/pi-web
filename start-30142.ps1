# pi-web 30142 一键启动脚本
$port = 30142

# 检查端口是否已在监听
$listening = netstat -ano | Select-String ":$port.*LISTENING"
if ($listening) {
    Write-Host "[跳过] pi-web $port 已在运行" -ForegroundColor Yellow
    Write-Host "访问: http://localhost:$port"
    Start-Sleep -Seconds 2
    exit 0
}

# 启动实例
Write-Host "[启动] pi-web $port..." -ForegroundColor Green

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$batContent = "@echo off`ncd /d `"$scriptDir`"`nnpx next dev -p $port"
$batFile = "$env:TEMP\pi-web-$port.bat"
$batContent | Out-File -FilePath $batFile -Encoding ASCII

Start-Process -FilePath $batFile -WindowStyle Minimized

Write-Host "[完成] 已启动 http://localhost:$port" -ForegroundColor Green
Start-Sleep -Seconds 2
