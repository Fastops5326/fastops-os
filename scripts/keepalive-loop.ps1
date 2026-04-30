$ErrorActionPreference = 'SilentlyContinue'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$keepalive = Join-Path $scriptDir "keepalive.ps1"

# Prevent duplicate loop instances.
$existing = Get-CimInstance Win32_Process | Where-Object {
  $_.Name -like 'powershell*' -and $_.CommandLine -like '*keepalive-loop.ps1*'
}
if ($existing.Count -gt 1) {
  exit 0
}

while ($true) {
  try {
    & $keepalive
  } catch {}
  Start-Sleep -Seconds 60
}
