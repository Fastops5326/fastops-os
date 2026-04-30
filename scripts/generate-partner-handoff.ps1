$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$envPath = Join-Path $root ".env"
$outPath = Join-Path $env:USERPROFILE "Desktop\FASTOPS-PARTNER-SECRETS.txt"

if (-not (Test-Path $envPath)) {
  throw ".env not found at $envPath"
}

$lines = Get-Content $envPath
function Read-Env([string]$name) {
  $line = $lines | Where-Object { $_ -match "^$name=" } | Select-Object -First 1
  if (-not $line) { return "" }
  return $line.Substring($name.Length + 1).Trim()
}

$apiKey = Read-Env "FASTOPS_EXTERNAL_CDP_API_KEY"
$signingSecret = Read-Env "FASTOPS_EXTERNAL_CDP_SIGNING_SECRET"

if (-not $apiKey) { throw "FASTOPS_EXTERNAL_CDP_API_KEY missing in .env" }
if (-not $signingSecret) { throw "FASTOPS_EXTERNAL_CDP_SIGNING_SECRET missing in .env" }

$content = @"
FastOps Partner Connection Handoff
Generated: $(Get-Date -Format o)

Base URL:
https://api.fastops.ai

Endpoint:
POST /api/external/messages

Required headers:
Content-Type: application/json
x-fastops-api-key: $apiKey
x-fastops-signature: <hex hmac sha256 of raw request body using shared secret below>

Shared signing secret:
$signingSecret

Allowed senders:
partner-agent-01, partner-agent-02, pt-agent-01, nick-agent-01, nick-agent-02, fastops_remote

Minimal body:
{
  "sender": "partner-agent-01",
  "message": "Hello from partner environment",
  "messageId": "partner-<unique-id>"
}
"@

Set-Content -Path $outPath -Value $content -Encoding UTF8
Write-Host "Wrote partner handoff file: $outPath"
