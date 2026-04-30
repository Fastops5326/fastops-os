# /wave complete - Mark Task as Complete

## Skill Metadata
- **Name**: wave-complete
- **Trigger**: `/wave complete`
- **Purpose**: Mark the currently claimed task as complete and free it for dependent tasks

## Overview

Marks your currently claimed task as complete, recording the completion timestamp and unblocking any dependent tasks in the wave.

## Usage

```
/wave complete
```

## What It Does

1. Acquires file lock on state.json
2. Finds the task claimed by this terminal
3. Updates status to 'complete' with completion timestamp
4. Releases lock
5. Shows which tasks are now unblocked
6. Displays updated status dashboard

## Implementation

Run the wave coordination script:

```bash
node .fastops/wave/wave.js complete
```

Or if using the test-parallel location:

```bash
node test-parallel/wave.js complete
```

## Output Format

### Successful Completion

```
Task AUTH marked complete!

Unblocked tasks: API, USERS

+============================================================+
|            WAVE COORDINATION STATUS                        |
+============================================================+
|  Project: my-project                                       |
+============================================================+
|  * AUTH         complete                                   |
|  o API          available                                  |
|  o UI           waiting for: API                           |
+============================================================+

Legend: o available  o blocked  ~ in progress  * complete
```

### No Task Claimed

```
No task is currently claimed.

Claim one with: /wave claim
```

## State Changes

When a task is completed:

**Before:**
```json
{
  "AUTH": {
    "status": "claimed",
    "claimedBy": "terminal-12345-abc",
    "claimedAt": "2026-02-02T10:35:00Z"
  }
}
```

**After:**
```json
{
  "AUTH": {
    "status": "complete",
    "claimedBy": "terminal-12345-abc",
    "claimedAt": "2026-02-02T10:35:00Z",
    "completedAt": "2026-02-02T11:15:00Z"
  }
}
```

## Unblocking Dependent Tasks

After completion, the system checks which tasks had this as a dependency:

```javascript
// Check if this unblocked anything
const nowAvailable = [];
for (const [id, task] of Object.entries(state.tasks)) {
  if (task.status === 'available' && dependenciesMet(state, id)) {
    if (task.depends && task.depends.includes(completedTaskId)) {
      nowAvailable.push(id);
    }
  }
}
```

Newly unblocked tasks are displayed so other agents know they can claim them.

## Workflow

The typical workflow is:

1. `/wave claim` - Claim a task
2. Read and implement the specification
3. Test your implementation
4. `/wave complete` - Mark it done
5. Repeat with `/wave claim` or use `/wave execute` for auto-loop

## Important Notes

- Only call `/wave complete` after you have **fully implemented** the task
- The task should be tested and working before marking complete
- Other agents may be waiting on your task as a dependency
- Premature completion can cause cascade failures

## Related Commands

- `/wave status` - View all task statuses
- `/wave claim` - Claim another task
- `/wave execute` - Auto-execute loop
- `/wave reset` - Reset all tasks (testing only)
