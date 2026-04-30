# /onedrive - OneDrive Sync Control for Parallel Agent Work

## Skill Metadata
- **Name**: onedrive
- **Trigger**: `/onedrive`
- **Purpose**: Toggle OneDrive sync on/off for safe parallel agent operations

## Overview

This skill provides atomic control over OneDrive sync to enable safe multi-agent work on OneDrive-synced codebases.

**The Problem**: OneDrive sync breaks file atomicity assumptions. Agents racing to claim contracts via filesystem operations can have their "atomic" mkdir/write operations replicated across machines with 30-60 second delays.

**The Solution**: Pause OneDrive during parallel work, sync only at boundaries.

## Usage

```
/onedrive sync     # Ensure all changes are synced to cloud, then pause OneDrive
/onedrive pause    # Immediately pause OneDrive (no sync verification)
/onedrive resume   # Resume OneDrive sync
/onedrive status   # Check current OneDrive status
```

## Protocol

### Before Parallel Agent Work
```
/onedrive sync
```
This will:
1. Ensure OneDrive is running
2. Wait for `SyncProgressState = 0` (fully synced)
3. Shutdown OneDrive
4. Confirm OneDrive is stopped

### After Parallel Agent Work
```
/onedrive resume
```
This will:
1. Start OneDrive with `/background`
2. Confirm OneDrive is running

## Implementation

The skill executes PowerShell commands to control OneDrive:

### OneDrive Paths
```powershell
# Per-user installation (most common)
$oneDrivePath = "$env:LOCALAPPDATA\Microsoft\OneDrive\OneDrive.exe"

# Per-machine installation (fallback)
$oneDrivePath = "C:\Program Files\Microsoft OneDrive\OneDrive.exe"
```

### Sync Status Check
```powershell
# Read SyncDiagnostics.log for sync state
$logPath = "$env:LOCALAPPDATA\Microsoft\OneDrive\logs\Business1\SyncDiagnostics.log"
$content = Get-Content $logPath -Raw
if ($content -match "SyncProgressState\s+(\d+)") {
    $state = $matches[1]
    # 0 or 16777216 = Up-to-date (safe to pause)
    # 8202 = Processing changes (wait)
}
```

### Shutdown Command
```powershell
& "$env:LOCALAPPDATA\Microsoft\OneDrive\OneDrive.exe" /shutdown
```

### Resume Command
```powershell
Start-Process -FilePath "$env:LOCALAPPDATA\Microsoft\OneDrive\OneDrive.exe" -ArgumentList "/background"
```

## SyncProgressState Values

| Code | Meaning |
|------|---------|
| `0` | Up-to-date - SAFE TO PAUSE |
| `16777216` | Up-to-date (variant) |
| `8202` | Processing changes - WAIT |
| `65536` | Paused |
| `8194` | Not syncing |

## Safety Notes

1. **Online-only files**: Files marked as "cloud only" cannot be opened while OneDrive is paused
2. **No admin rights required**: All operations work in user context
3. **Queued changes**: Any file changes during pause are queued and sync on resume
4. **Restart overhead**: Full shutdown/restart causes OneDrive to rescan - this is acceptable for bounded work sessions

## Integration with Project Chain

The claiming system should call `/onedrive sync` before spawning parallel agents:

```
1. /onedrive sync           # Sync and pause OneDrive
2. Spawn N parallel agents  # Work in true isolation
3. Agents complete work     # No cloud sync interference
4. /onedrive resume         # Resume sync, changes propagate
```

This eliminates the 3-second vs 60-second timing debate entirely - we simply don't race with cloud sync at all.

## Sources

- [Microsoft Support - Pause and Resume OneDrive](https://support.microsoft.com/en-us/office/how-to-pause-and-resume-sync-in-onedrive-2152bfa4-a2a5-4d3a-ace8-92912fb4421e)
- [OneDrive Monitoring with PowerShell](https://call4cloud.nl/onedrive-monitoring-syncprogressstate/)
- [PowerShell Administrator - Stop/Restart OneDrive](https://powershelladministrator.com/2018/02/09/stop-restart-pause-onedrive-for-business/)
