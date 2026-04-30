$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$engineDir = Join-Path $root ".fastops-engine"
$logFile = Join-Path $engineDir "keepalive.log"
$localHealth = "http://127.0.0.1:3100/api/health"
$edgeHealth = "https://api.fastops.ai/api/health"
$cloudflaredExe = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$cloudflaredConfig = "$env:USERPROFILE\.cloudflared\config.yml"
$startScript = Join-Path $root "scripts\start-api.ps1"

if (-not (Test-Path $engineDir)) {
  New-Item -ItemType Directory -Path $engineDir -Force | Out-Null
}

function Write-Log([string]$message) {
  $line = "$(Get-Date -Format o) $message"
  Add-Content -Path $logFile -Value $line
}

function Test-HttpOk([string]$url) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 4
    return ($resp.StatusCode -eq 200)
  } catch {
    return $false
  }
}

function Ensure-Api {
  if (Test-HttpOk $localHealth) {
    Write-Log "local api healthy"
    return
  }

  # Kill stale API node process if present (same project only)
  try {
    $stale = Get-CimInstance Win32_Process | Where-Object {
      $_.Name -eq 'node.exe' -and
      $_.CommandLine -like '*fastops-os*dist/server/index.js*'
    }
    foreach ($p in $stale) {
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
      Write-Log "killed stale node pid=$($p.ProcessId)"
    }
  } catch {}

  & $startScript
  Start-Sleep -Seconds 3
  if (Test-HttpOk $localHealth) {
    Write-Log "api restarted successfully"
  } else {
    Write-Log "api restart attempted but still unhealthy"
  }
}

function Ensure-Tunnel {
  if (-not (Test-HttpOk $localHealth)) {
    Write-Log "skip tunnel check while local api is down"
    return
  }
  if (Test-HttpOk $edgeHealth) {
    Write-Log "edge healthy"
    return
  }

  # First try service (if available).
  try {
    $svc = Get-Service -Name "cloudflared" -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -ne 'Running') {
      Start-Service -Name "cloudflared" -ErrorAction Stop
      Write-Log "started cloudflared service"
      Start-Sleep -Seconds 2
      if (Test-HttpOk $edgeHealth) { return }
    }
  } catch {
    Write-Log "cloudflared service start failed: $($_.Exception.Message)"
  }

  # Fallback to user-level tunnel process.
  if ((Test-Path $cloudflaredExe) -and (Test-Path $cloudflaredConfig)) {
    $running = Get-CimInstance Win32_Process | Where-Object {
      $_.Name -eq 'cloudflared.exe' -and $_.CommandLine -like '*tunnel*run*'
    }
    if (-not $running) {
      Start-Process -FilePath $cloudflaredExe -ArgumentList "tunnel", "--config", $cloudflaredConfig, "run" -WindowStyle Hidden
      Write-Log "started user-level cloudflared tunnel"
      Start-Sleep -Seconds 3
    }
  } else {
    Write-Log "cloudflared binary/config missing"
  }

  if (Test-HttpOk $edgeHealth) {
    Write-Log "edge recovered"
  } else {
    Write-Log "edge still unhealthy"
  }
}

Ensure-Api
Ensure-Tunnel
