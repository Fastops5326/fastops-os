# /wave status - View Wave Coordination Status

## Skill Metadata
- **Name**: wave-status
- **Trigger**: `/wave status`
- **Purpose**: Display the current state of all tasks in the wave coordination system

## Overview

Shows a visual dashboard of all tasks in the current wave, including their status, dependencies, and who has claimed them.

## Usage

```
/wave status
```

## What It Does

1. Reads `.wave/state.json` to get current coordination state
2. Displays a formatted table showing all tasks
3. Shows dependency relationships (which tasks are blocked)
4. Identifies which terminal/agent has claimed each task

## Implementation

Run the wave coordination script:

```bash
node .fastops/wave/wave.js status
```

Or if using the test-parallel location:

```bash
node test-parallel/wave.js status
```

## Output Format

```
+============================================================+
|            WAVE COORDINATION STATUS                        |
+============================================================+
|  Project: my-project                                       |
+============================================================+
|  * AUTH         complete                                   |
|  ~ API          claimed by terminal-12345                  |
|  o UI           waiting for: API                           |
|  o TESTS        available                                  |
+============================================================+

Legend: o available  o blocked  ~ in progress  * complete
```

## Status Icons

| Icon | Status | Meaning |
|------|--------|---------|
| `o` | available | Task can be claimed now |
| `o` | blocked | Task waiting for dependencies |
| `~` | claimed | Task being worked on by an agent |
| `*` | complete | Task finished |

## State File Location

The wave state is stored in:
```
.wave/
  state.json      # Coordination state
  state.lock      # Lock file (temporary)
  specs/          # Task specifications
```

## Example state.json

```json
{
  "project": "my-project",
  "description": "Building feature X",
  "tasks": {
    "AUTH": {
      "status": "complete",
      "spec": "specs/AUTH.md",
      "description": "Authentication system",
      "completedAt": "2026-02-02T10:30:00Z"
    },
    "API": {
      "status": "claimed",
      "spec": "specs/API.md",
      "description": "REST API endpoints",
      "depends": ["AUTH"],
      "claimedBy": "terminal-12345-abc",
      "claimedAt": "2026-02-02T10:35:00Z"
    },
    "UI": {
      "status": "available",
      "spec": "specs/UI.md",
      "description": "User interface",
      "depends": ["API"]
    }
  }
}
```

## Related Commands

- `/wave claim` - Claim the next available task
- `/wave complete` - Mark current task as complete
- `/wave execute` - Auto-execute loop
- `/wave init` - Initialize wave directory
