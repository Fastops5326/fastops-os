$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$engineDir = Join-Path $root ".fastops-engine"
$outLog = Join-Path $engineDir "api-stdout.log"
$errLog = Join-Path $engineDir "api-stderr.log"

if (-not (Test-Path $engineDir)) {
  New-Item -ItemType Directory -Path $engineDir -Force | Out-Null
}

# Start detached so this script can exit immediately.
Start-Process `
  -FilePath "cmd.exe" `
  -ArgumentList "/c", "cd /d `"$root`" && npm start" `
  -WindowStyle Hidden `
  -RedirectStandardOutput $outLog `
  -RedirectStandardError $errLog
