# /wave claim - Claim a Task from the Wave

## Skill Metadata
- **Name**: wave-claim
- **Trigger**: `/wave claim [task-id]`
- **Purpose**: Claim the next available task (or a specific task) for execution

## Overview

Claims a task from the wave coordination system, preventing other agents from working on it. Shows the task specification after claiming so the agent can begin work.

## Usage

```
/wave claim           # Claim next available task
/wave claim API       # Claim specific task by ID
```

## What It Does

1. Acquires file lock on state.json (prevents race conditions)
2. Checks if this terminal already has a claimed task
3. Finds the next available task (with all dependencies met)
4. Updates task status to 'claimed' with terminal ID and timestamp
5. Releases lock
6. Displays the task specification content

## Implementation

Run the wave coordination script:

```bash
node .fastops/wave/wave.js claim [task-id]
```

Or if using the test-parallel location:

```bash
node test-parallel/wave.js claim [task-id]
```

## Output Format

### Successful Claim

```
Claimed task: API

Spec file: specs/API.md

Read the spec and implement it.
   When done, run: /wave complete

------------------------------------------------------------
SPEC CONTENT:
------------------------------------------------------------
# API Domain Contract

## Overview
Build REST API endpoints for the application...

[Full spec content displayed here]
------------------------------------------------------------
```

### Already Have a Task

```
You already have task AUTH claimed.

Complete it with: /wave complete
```

### No Available Tasks

```
No available tasks.

Some tasks are waiting for dependencies or claimed by others.
```

### All Tasks Complete

```
No available tasks.

All tasks complete!
```

## Claiming Logic

The system finds the first task where:
1. Status is `available`
2. All dependencies (if any) have status `complete`

```javascript
function findAvailableTask(state) {
  for (const [id, task] of Object.entries(state.tasks)) {
    if (task.status !== 'available') continue;

    const depsMet = (task.depends || []).every(depId =>
      state.tasks[depId]?.status === 'complete'
    );

    if (depsMet) return id;
  }
  return null;
}
```

## File Locking

Uses a simple lock file approach to prevent race conditions:

- Lock file: `.wave/state.lock`
- Timeout: 5 seconds
- Stale lock detection: 10 seconds

If two agents try to claim simultaneously:
1. First agent acquires lock, claims task
2. Second agent waits for lock
3. Second agent finds task already claimed, moves to next available

## Terminal ID

Each claiming session gets a unique ID:

```javascript
const TERMINAL_ID = `terminal-${process.pid}-${Date.now().toString(36)}`;
```

This allows tracking which terminal claimed which task.

## After Claiming

Once you have claimed a task:

1. Read and understand the spec content (displayed automatically)
2. Implement the task according to the specification
3. Test your implementation
4. Run `/wave complete` to mark the task as done

## Related Commands

- `/wave status` - View all task statuses
- `/wave complete` - Mark current task complete
- `/wave execute` - Auto-execute loop
