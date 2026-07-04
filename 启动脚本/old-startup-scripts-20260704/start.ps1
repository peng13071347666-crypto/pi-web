param(
    [int]$Port = 30141,
    [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projectDir

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  pi-web Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# 1. Check port
Write-Host "`n[1/4] Checking port $Port ..." -ForegroundColor Yellow
$existing = netstat -ano 2>$null | Select-String ":$Port " | Select-String "LISTENING"
if ($existing) {
    $oldPid = ($existing -split '\s+')[-1]
    Write-Host "  Port $Port in use by PID $oldPid, stopping..." -ForegroundColor Magenta
    Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Host "  Old process stopped" -ForegroundColor Green
}
else {
    Write-Host "  Port $Port is free" -ForegroundColor Green
}

# 2. Start server (detached, survives parent)
Write-Host "`n[2/4] Starting pi-web ..." -ForegroundColor Yellow

# Use a temp VBS script to launch completely detached on Windows
$vbsPath = "$env:TEMP\pi-web-launcher.vbs"
$nodeExe = (Get-Command node -ErrorAction Stop).Source
$scriptDir = (Get-Location).Path
@"
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "$scriptDir"
WshShell.Run """$nodeExe"" bin/pi-web.js", 0, False
"@ | Out-File -FilePath $vbsPath -Encoding ASCII

$vbsProc = Start-Process -FilePath "wscript.exe" -ArgumentList "//B","$vbsPath" -PassThru -NoNewWindow
Start-Sleep -Seconds 1

# Get PID of the actual node process (the detached one)
$nodePid = $null
Start-Sleep -Seconds 1
$allNode = Get-Process -Name node -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending
if ($allNode) {
    $nodePid = $allNode[0].Id
}

if ($nodePid) {
    Write-Host "  Process started (PID: $nodePid)" -ForegroundColor Green
}
else {
    Write-Host "  Process launched (checking...)" -ForegroundColor Yellow
}

# 3. Health check (max 30s)
Write-Host "`n[3/4] Waiting for server to be ready..." -ForegroundColor Yellow
$ready = $false
$maxWait = 30
for ($i = 1; $i -le $maxWait; $i++) {
    Start-Sleep -Seconds 1
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$Port" `
            -UseBasicParsing -TimeoutSec 2 -NoProxy
        if ($response.StatusCode -eq 200) {
            Write-Host "  Server ready! (took ${i}s)" -ForegroundColor Green
            $ready = $true
            break
        }
    }
    catch {
        # not ready yet
    }
    if ($i % 5 -eq 0) {
        Write-Host "  Still waiting... ($i/$maxWait sec)" -ForegroundColor DarkGray
    }
}

if (-not $ready) {
    Write-Host "  WARNING: Health check timed out" -ForegroundColor Red
    $stillAlive = Get-Process -Id $nodePid -ErrorAction SilentlyContinue
    if (-not $stillAlive) {
        Write-Host "  Process has exited" -ForegroundColor Red
    }
    else {
        Write-Host "  Process running but not responding, check logs" -ForegroundColor Yellow
    }
    Write-Host "`nPress any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

# 4. Open browser
if (-not $NoBrowser) {
    Write-Host "`n[4/4] Opening browser..." -ForegroundColor Yellow
    Start-Process "http://localhost:$Port"
    Write-Host "  Browser opened" -ForegroundColor Green
}

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  pi-web running at http://localhost:$Port" -ForegroundColor Cyan
Write-Host "  Close this window to stop the server" -ForegroundColor DarkGray
Write-Host "========================================" -ForegroundColor Cyan

Write-Host "`nPress Ctrl+C or close window to stop..."
try {
    while ($true) { Start-Sleep -Seconds 1 }
}
catch {
    Write-Host "`nShutting down..."
    if ($nodePid) {
        Stop-Process -Id $nodePid -Force -ErrorAction SilentlyContinue
    }
}
