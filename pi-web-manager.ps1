# pi-web 多实例管理器 (PowerShell)
# 用法:
#   .\pi-web-manager.ps1 start 30142 30143 30144  # 启动多个实例
#   .\pi-web-manager.ps1 stop 30142                # 停止指定实例
#   .\pi-web-manager.ps1 stop-all                  # 停止所有实例
#   .\pi-web-manager.ps1 status                    # 查看状态
#   .\pi-web-manager.ps1 restart 30142             # 重启指定实例

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("start", "stop", "stop-all", "status", "restart")]
    [string]$Action,
    
    [Parameter(ValueFromRemainingArguments=$true)]
    [int[]]$Ports = @()
)

function Get-PiWebProcesses {
    $processes = @()
    $netstat = netstat -ano | Select-String ":301\d+\s+.*LISTENING"
    foreach ($line in $netstat) {
        if ($line -match ":(301\d+)\s+.*LISTENING\s+(\d+)") {
            $port = $matches[1]
            $pid = $matches[2]
            $process = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($process -and $process.ProcessName -match "node") {
                $processes += @{
                    Port = [int]$port
                    PID = $pid
                    ProcessName = $process.ProcessName
                    StartTime = $process.StartTime
                }
            }
        }
    }
    return $processes
}

function Start-PiWebInstance {
    param([int]$Port)
    
    # 检查端口是否被占用
    $existing = Get-PiWebProcesses | Where-Object { $_.Port -eq $Port }
    if ($existing) {
        Write-Host "⚠️  端口 $Port 已被占用 (PID: $($existing.PID))" -ForegroundColor Yellow
        return
    }
    
    Write-Host "🚀 启动 pi-web 实例在端口 $Port..." -ForegroundColor Green
    Start-Process -FilePath "npx" -ArgumentList "next", "dev", "-p", $Port -WindowStyle Normal
    Write-Host "   URL: http://localhost:$Port" -ForegroundColor Cyan
}

function Stop-PiWebInstance {
    param([int]$Port)
    
    $processes = Get-PiWebProcesses | Where-Object { $_.Port -eq $Port }
    if ($processes) {
        foreach ($proc in $processes) {
            Write-Host "🛑 停止端口 $Port 的实例 (PID: $($proc.PID))..." -ForegroundColor Red
            Stop-Process -Id $proc.PID -Force
        }
    } else {
        Write-Host "⚠️  未找到端口 $Port 的实例" -ForegroundColor Yellow
    }
}

function Show-Status {
    $processes = Get-PiWebProcesses
    if ($processes.Count -eq 0) {
        Write-Host "📭 没有运行中的 pi-web 实例" -ForegroundColor Gray
        return
    }
    
    Write-Host "📊 pi-web 实例状态:" -ForegroundColor Green
    Write-Host ""
    Write-Host "端口      PID      启动时间" -ForegroundColor Gray
    Write-Host "-------- -------- --------" -ForegroundColor Gray
    
    foreach ($proc in ($processes | Sort-Object Port)) {
        $uptime = if ($proc.StartTime) { 
            (Get-Date) - $proc.StartTime | ForEach-Object { "{0:hh\:mm\:ss}" -f $_ }
        } else { "N/A" }
        Write-Host ("{0,-8} {1,-8} {2}" -f $proc.Port, $proc.PID, $uptime)
    }
    
    Write-Host ""
    Write-Host "💡 使用浏览器打开以下地址:" -ForegroundColor Cyan
    foreach ($proc in ($processes | Sort-Object Port)) {
        Write-Host "   http://localhost:$($proc.Port)" -ForegroundColor White
    }
}

# 主逻辑
switch ($Action) {
    "start" {
        if ($Ports.Count -eq 0) {
            $Ports = @(30142)
        }
        foreach ($port in $Ports) {
            Start-PiWebInstance -Port $port
        }
    }
    "stop" {
        if ($Ports.Count -eq 0) {
            Write-Host "❌ 请指定要停止的端口号" -ForegroundColor Red
            exit 1
        }
        foreach ($port in $Ports) {
            Stop-PiWebInstance -Port $port
        }
    }
    "stop-all" {
        $processes = Get-PiWebProcesses
        if ($processes.Count -eq 0) {
            Write-Host "📭 没有运行中的实例" -ForegroundColor Gray
        } else {
            foreach ($proc in $processes) {
                Stop-PiWebInstance -Port $proc.Port
            }
        }
    }
    "status" {
        Show-Status
    }
    "restart" {
        if ($Ports.Count -eq 0) {
            Write-Host "❌ 请指定要重启的端口号" -ForegroundColor Red
            exit 1
        }
        foreach ($port in $Ports) {
            Stop-PiWebInstance -Port $port
            Start-Sleep -Seconds 2
            Start-PiWebInstance -Port $port
        }
    }
}
