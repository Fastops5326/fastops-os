# /fastops-wave - OneDrive-Safe Wave Execution

Combined workflow that handles OneDrive sync, wave coordination, and parallel execution in one command.

## Skill Metadata
- **Name**: fastops-wave
- **Trigger**: `/fastops-wave`
- **Purpose**: Execute wave tasks with OneDrive pause/resume for safe multi-agent work

## Overview

This skill provides the safest method for multi-agent parallel work on OneDrive-synced directories. It combines three operations:

1. **OneDrive Sync** - Ensure all changes are synced to cloud, then pause OneDrive
2. **Wave Execution** - Enter the claim/execute/complete loop
3. **OneDrive Resume** - Resume sync when all tasks are complete

## Usage

```
/fastops-wave               # Full workflow with OneDrive handling
/fastops-wave --skip-sync   # Skip initial OneDrive sync (already paused)
/fastops-wave --status      # Show status without starting execution
```

## Full Workflow

```
PHASE 1: PREPARE
================
1. Check for .wave/state.json
   - If not found: ERROR - run /wave init first
2. Run /onedrive sync
   - Ensures OneDrive is up-to-date
   - Pauses OneDrive for safe parallel work
3. Display wave status dashboard

PHASE 2: EXECUTE LOOP
=====================
4. Claim next available task
   - If none available and all complete: go to Phase 3
   - If none available but tasks in progress: wait or exit
5. Read task specification from specs/{TASK}.md
6. Execute the implementation
7. Run /wave complete to mark task done
8. Loop back to step 4

PHASE 3: CLEANUP
================
9. Display final status
10. Run /onedrive resume to restart OneDrive sync
11. Report completion summary
```

## Why OneDrive Pause/Resume?

OneDrive sync breaks file atomicity assumptions:

| Scenario | Without OneDrive Pause | With OneDrive Pause |
|----------|----------------------|---------------------|
| Two agents claim same task | Race condition via cloud sync (30-60s delay) | Local-only operations, deterministic |
| Agent writes file | May conflict with cloud version | No cloud interference |
| Lock file creation | May be replicated with delay | Atomic, local only |

By pausing OneDrive during parallel work, we eliminate cloud sync interference entirely.

## Implementation Steps

### Step 1: Check Prerequisites

```bash
# Check if wave state exists
if [ -f ".wave/state.json" ]; then
  echo "Wave state found"
else
  echo "ERROR: No .wave/state.json found"
  echo "Run /wave init to initialize wave coordination"
  exit 1
fi
```

### Step 2: Sync and Pause OneDrive

Use the `/onedrive` skill:

```bash
# PowerShell command to sync and pause
$oneDrivePath = "$env:LOCALAPPDATA\Microsoft\OneDrive\OneDrive.exe"

# Check sync status
$logPath = "$env:LOCALAPPDATA\Microsoft\OneDrive\logs\Business1\SyncDiagnostics.log"
# Wait for SyncProgressState = 0 (up-to-date)

# Then shutdown OneDrive
& "$oneDrivePath" /shutdown
```

### Step 3: Show Wave Status

```bash
node test-parallel/wave.js status
```

Or read and display `.wave/state.json` directly.

### Step 4: Execute Loop

```javascript
while (true) {
  // Claim next task
  const task = await claimTask();

  if (!task) {
    if (allTasksComplete()) {
      break; // Done!
    }
    // Other agents still working
    await sleep(5000);
    continue;
  }

  // Execute the task
  await executeSpec(task.spec);

  // Mark complete
  await completeTask(task.id);
}
```

### Step 5: Resume OneDrive

```bash
# PowerShell command to resume
$oneDrivePath = "$env:LOCALAPPDATA\Microsoft\OneDrive\OneDrive.exe"
Start-Process -FilePath "$oneDrivePath" -ArgumentList "/background"
```

## Output Format

```
================================================================================
                         FASTOPS WAVE EXECUTION
================================================================================

PHASE 1: PREPARING
------------------
[OK] Wave state found: .wave/state.json
[OK] Project: my-project
[..] Syncing OneDrive...
[OK] OneDrive paused

WAVE STATUS:
+------------------------------------------------------------+
|  * AUTH         complete                                   |
|  ~ API          claimed by terminal-12345                  |
|  o UI           waiting for: API                           |
|  o TESTS        available                                  |
+------------------------------------------------------------+

PHASE 2: EXECUTING
------------------
[CLAIM] Claiming next available task...
[OK] Claimed: TESTS
[EXEC] Reading spec: specs/TESTS.md
[..] Implementing...
[OK] Implementation complete
[DONE] Marked TESTS as complete

[CLAIM] Claiming next available task...
[INFO] No available tasks (UI waiting on API)
[INFO] Other agents still working - exiting

PHASE 3: CLEANUP
----------------
[..] Resuming OneDrive...
[OK] OneDrive resumed

================================================================================
SUMMARY: Completed 1 task (TESTS). 1 task remaining (UI).
================================================================================
```

## Error Handling

| Error | Handling |
|-------|----------|
| No .wave/state.json | Exit with instructions to run /wave init |
| OneDrive not found | Skip OneDrive handling, continue with wave execution |
| Task execution fails | Mark task as failed, exit loop, resume OneDrive |
| Lock acquisition timeout | Retry 3 times, then exit gracefully |

## Multi-Terminal Usage

For maximum parallelism:

1. Open N terminal windows
2. In FIRST terminal: run `/fastops-wave` (handles OneDrive pause)
3. In OTHER terminals: run `/fastops-wave --skip-sync`
4. Each terminal claims and executes different tasks
5. When all tasks done, any terminal triggers OneDrive resume

## Related Commands

| Command | Description |
|---------|-------------|
| `/fastops` | Original command (auto-detects wave state) |
| `/wave status` | Show wave coordination status |
| `/wave claim` | Claim next available task |
| `/wave complete` | Mark current task complete |
| `/onedrive sync` | Sync and pause OneDrive |
| `/onedrive resume` | Resume OneDrive sync |

## Prerequisites

1. **Wave initialized**: `.wave/state.json` must exist with task definitions
2. **Specs created**: `specs/{TASK}.md` for each task
3. **Dependencies mapped**: Tasks define their dependencies in state.json
4. **OneDrive installed** (optional): For sync pause/resume functionality

## State File Requirements

`.wave/state.json` must have this structure:

```json
{
  "project": "project-name",
  "description": "What we're building",
  "tasks": {
    "TASK_ID": {
      "status": "available|claimed|complete",
      "spec": "specs/TASK_ID.md",
      "description": "Human-readable description",
      "depends": ["OTHER_TASK_ID"]
    }
  }
}
```

## Best Practices

1. **One human operator**: Have one person start `/fastops-wave` in the first terminal
2. **Start others with --skip-sync**: Avoid multiple agents trying to pause OneDrive
3. **Keep specs atomic**: Each spec should be independently implementable
4. **Define dependencies clearly**: Blocked tasks avoid wasted work
5. **Check status periodically**: Run `/wave status` to monitor progress
