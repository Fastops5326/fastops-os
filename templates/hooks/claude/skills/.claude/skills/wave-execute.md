# /wave execute - Auto-Execute Wave Tasks

## Skill Metadata
- **Name**: wave-execute
- **Trigger**: `/wave execute`
- **Purpose**: Automatically claim, execute, and complete tasks in a loop until the wave is finished

## Overview

This is the primary command for agents executing wave tasks. It runs an automated loop that:
1. Claims the next available task
2. Displays the spec
3. Executes the implementation
4. Marks complete
5. Repeats until no work remains

## Usage

```
/wave execute
```

## What It Does

### Execution Loop

```
LOOP:
  1. Check for available tasks
  2. If none available:
     - If all complete: EXIT SUCCESS
     - If some blocked: WAIT and retry (dependencies may complete)

  3. Claim next available task
  4. Display spec content
  5. Execute the contract (implement according to spec)
  6. Mark task complete
  7. GOTO 1
```

## Implementation

The execute command should be implemented as a loop around claim/complete:

```javascript
async function executeLoop() {
  while (true) {
    // Try to claim next task
    const taskId = await claimTask();

    if (!taskId) {
      const state = readState();
      const allComplete = Object.values(state.tasks)
        .every(t => t.status === 'complete');

      if (allComplete) {
        console.log('All tasks complete! Wave finished.');
        return;
      }

      // Some tasks blocked - wait for dependencies
      console.log('Waiting for dependencies...');
      await sleep(5000);
      continue;
    }

    // Show spec and execute
    const spec = readSpec(state.tasks[taskId].spec);
    console.log('Executing:', taskId);
    console.log(spec);

    // Agent implements the spec here
    await executeContract(spec);

    // Mark complete
    await completeTask();
  }
}
```

## Output Format

```
=== WAVE EXECUTE MODE ===

[1/5] Claiming next task...
Claimed: AUTH

------------------------------------------------------------
SPEC: specs/AUTH.md
------------------------------------------------------------
# AUTH Domain Contract
...
------------------------------------------------------------

Executing AUTH contract...
[Agent implements the spec]

Task AUTH complete!
Unblocked: API, USERS

[2/5] Claiming next task...
Claimed: API
...

=== WAVE COMPLETE ===
All 5 tasks finished successfully.
```

## Agent Execution Behavior

When executing a spec, the agent should:

1. **Read the spec completely** - Understand all requirements
2. **Create required files** - Types, services, repositories as specified
3. **Follow the contract exactly** - No additions or omissions
4. **Verify compilation** - Ensure no errors
5. **Run tests if specified** - Validate the implementation

## Waiting for Dependencies

If all remaining tasks are blocked:

```
No available tasks. 2 tasks waiting for dependencies.
Waiting 5 seconds for other agents to complete...

[After 5 seconds, re-check state]
```

This handles the case where multiple agents are working and one agent finishes a dependency that unblocks work for another.

## Multi-Agent Coordination

When multiple terminals run `/wave execute`:

```
Terminal 1                  Terminal 2                  Terminal 3
    |                           |                           |
    |--[claim AUTH]             |                           |
    |                           |--[claim USERS]            |
    |                           |                           |--[claim PRODUCTS]
    |                           |                           |
    |--[complete AUTH]          |                           |
    |--[claim API]              |                           |
    |                           |--[complete USERS]         |
    |                           |--[claim ORDERS]           |
    ...                         ...                         ...
```

No coordination needed - the wave system handles it atomically.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Spec file missing | Error logged, task skipped |
| Implementation fails | Task stays claimed (requires manual review) |
| All tasks blocked | Wait and retry loop |
| Lock timeout | Retry with backoff |

## When to Use

Use `/wave execute` when:
- You want hands-off automated execution
- Multiple agents are working in parallel
- Tasks are well-defined with complete specs

Use `/wave claim` + `/wave complete` manually when:
- You want to review each spec before executing
- You need to debug or troubleshoot
- Tasks require human judgment

## Prerequisites

Before running `/wave execute`:

1. **Wave initialized**: `.wave/state.json` exists
2. **Specs exist**: All task spec files are present
3. **Dependencies correct**: Task graph is valid
4. **OneDrive paused**: If on synced folder, run `/onedrive sync` first

## Related Commands

- `/wave status` - View current state
- `/wave claim` - Manual claim
- `/wave complete` - Manual complete
- `/wave init` - Initialize wave
