$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Port = 30142
$Url = "http://localhost:$Port/"
$ProjectDir = Split-Path -Parent $PSScriptRoot
$NextBin = Join-Path $ProjectDir "node_modules\next\dist\bin\next"
$BuildDir = Join-Path $ProjectDir ".next"
$BuildIdFile = Join-Path $BuildDir "BUILD_ID"
$LogDir = Join-Path $PSScriptRoot "logs"
$StateDir = Join-Path $PSScriptRoot "state"
$StdoutLog = Join-Path $LogDir "pi-web-30142.out.log"
$StderrLog = Join-Path $LogDir "pi-web-30142.err.log"
$PidFile = Join-Path $StateDir "pi-web-30142.pid"

function Test-PiWebReady {
    param([string]$TargetUrl)

    try {
        $response = Invoke-WebRequest -Uri $TargetUrl -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
    }
    catch {
        return $false
    }
}

function Get-PortOwnerIds {
    param([int]$TargetPort)

    $connections = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue
    if (-not $connections) {
        return @()
    }

    return @($connections | Select-Object -ExpandProperty OwningProcess -Unique)
}

function Stop-StalePortOwners {
    param([int]$TargetPort)

    $ownerIds = @(Get-PortOwnerIds -TargetPort $TargetPort)
    foreach ($ownerId in $ownerIds) {
        $process = Get-Process -Id $ownerId -ErrorAction SilentlyContinue
        if (-not $process) {
            continue
        }

        Write-Host "Stopping stale process on port $TargetPort (PID $ownerId, $($process.ProcessName))..."
        Stop-Process -Id $ownerId -Force -ErrorAction SilentlyContinue
    }

    if ($ownerIds.Count -gt 0) {
        Start-Sleep -Seconds 2
    }
}

function Stop-RecordedPiWebProcess {
    if (-not (Test-Path -LiteralPath $PidFile)) {
        return
    }

    $rawPid = Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1
    $recordedPid = 0
    if (-not [int]::TryParse($rawPid, [ref]$recordedPid)) {
        return
    }

    $recordedProcess = Get-Process -Id $recordedPid -ErrorAction SilentlyContinue
    if ($recordedProcess) {
        Write-Host "Stopping previous pi-web launcher process (PID $recordedPid, $($recordedProcess.ProcessName))..."
        Stop-Process -Id $recordedPid -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }
}

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
New-Item -ItemType Directory -Path $StateDir -Force | Out-Null

Write-Host "pi-web recovery launcher"
Write-Host "Target: $Url"

if (Test-PiWebReady -TargetUrl $Url) {
    Write-Host "pi-web is already running."
    Start-Process $Url
    Start-Sleep -Seconds 2
    exit 0
}

$portOwners = @(Get-PortOwnerIds -TargetPort $Port)
if ($portOwners.Count -gt 0) {
    Write-Host "Port $Port is occupied, but the page is not responding."
    Stop-StalePortOwners -TargetPort $Port
}
Stop-RecordedPiWebProcess

if (-not (Test-Path -LiteralPath $NextBin)) {
    throw "Next.js launcher not found: $NextBin. Run npm install in $ProjectDir first."
}

$nodeCommand = Get-Command node -ErrorAction Stop
$nodeExe = $nodeCommand.Source
$nextMode = if (Test-Path -LiteralPath $BuildIdFile) { "start" } else { "dev" }
$arguments = @(
    ('"{0}"' -f $NextBin),
    $nextMode,
    "-p",
    "$Port"
) -join " "

Write-Host "Starting pi-web in the background with next $nextMode..."
Write-Host "Logs:"
Write-Host "  $StdoutLog"
Write-Host "  $StderrLog"

if (Test-Path -LiteralPath $StdoutLog) {
    Remove-Item -LiteralPath $StdoutLog -Force
}
if (Test-Path -LiteralPath $StderrLog) {
    Remove-Item -LiteralPath $StderrLog -Force
}

$process = Start-Process `
    -FilePath $nodeExe `
    -ArgumentList $arguments `
    -WorkingDirectory $ProjectDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $StdoutLog `
    -RedirectStandardError $StderrLog `
    -PassThru

Set-Content -LiteralPath $PidFile -Value $process.Id -Encoding ASCII

$ready = $false
for ($i = 1; $i -le 45; $i++) {
    Start-Sleep -Seconds 1
    $process.Refresh()
    if ($process.HasExited) {
        Write-Host "pi-web exited before it became ready."
        if (Test-Path -LiteralPath $StderrLog) {
            Get-Content -LiteralPath $StderrLog -Tail 20 -ErrorAction SilentlyContinue
        }
        exit 1
    }

    if (Test-PiWebReady -TargetUrl $Url) {
        $ready = $true
        break
    }

    if (($i % 5) -eq 0) {
        Write-Host "Waiting for pi-web... $i/45 seconds"
    }
}

if (-not $ready) {
    Write-Host "pi-web was started, but the page did not respond within 45 seconds."
    Write-Host "PID: $($process.Id)"
    Write-Host "Check logs above for details."
    exit 1
}

Write-Host "pi-web is ready: $Url"
Write-Host "The service is running in the background. Closing this window will not stop it."
Start-Process $Url
Start-Sleep -Seconds 3
