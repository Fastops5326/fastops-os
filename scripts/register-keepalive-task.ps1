$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$startScript = Join-Path $root "scripts\start-api.ps1"
$keepaliveScript = Join-Path $root "scripts\keepalive.ps1"
$taskStart = "FastOps-API-Autostart"
$taskKeepalive = "FastOps-API-KeepAlive"

$actionStart = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`""

$actionKeepalive = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$keepaliveScript`""

$triggerLogon = New-ScheduledTaskTrigger -AtLogOn
$triggerRepeat = New-ScheduledTaskTrigger `
  -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 1) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable

try { Unregister-ScheduledTask -TaskName $taskStart -Confirm:$false -ErrorAction SilentlyContinue } catch {}
try { Unregister-ScheduledTask -TaskName $taskKeepalive -Confirm:$false -ErrorAction SilentlyContinue } catch {}

Register-ScheduledTask -TaskName $taskStart -Action $actionStart -Trigger $triggerLogon -Settings $settings -Description "FastOps API autostart on logon" | Out-Null
Register-ScheduledTask -TaskName $taskKeepalive -Action $actionKeepalive -Trigger $triggerRepeat -Settings $settings -Description "FastOps API + tunnel keepalive every minute" | Out-Null

Start-ScheduledTask -TaskName $taskKeepalive

Write-Host "Registered tasks:"
Get-ScheduledTask -TaskName $taskStart, $taskKeepalive | Select-Object TaskName, State | Format-Table -AutoSize
