# /fastops - Wave Execution with Atomic Contract Claiming

Execute Wave 2 (backend) or Wave 3 (frontend) contracts in parallel with other Claude instances.

## Invocation

```
/fastops              # Auto-detect mode (wave or contract)
/fastops --wave 2     # Execute specific wave
/fastops --status     # Show current status
```

## Auto-Detection Behavior

On invocation, `/fastops` checks the environment and adapts:

1. **Check for `.wave/state.json`**
   - If exists: Show wave status and enter wave execution mode
   - If not: Fall back to `.claims/` contract-based execution

2. **Wave Mode** (when `.wave/state.json` exists):
   - Display wave status dashboard
   - Offer wave commands: `/wave claim`, `/wave complete`, `/wave status`
   - Use `/fastops-wave` for full OneDrive-integrated workflow

3. **Contract Mode** (legacy `.claims/` system):
   - Use atomic mkdir-based claiming
   - Execute contracts in parallel with other instances

## What This Command Does

### Wave Mode (Preferred)
1. **Check wave state** - Read `.wave/state.json` for coordination state
2. **Show status dashboard** - Display all tasks with their status
3. **Enter execute loop** - Claim, execute, complete, repeat

### Contract Mode (Legacy)
1. **Recovers orphaned contracts** - Checks for stale claims from crashed agents
2. **Claims the next available contract** - Uses atomic mkdir-based locking
3. **Executes the contract** - Implements the domain with subagent parallelism
4. **Reports completion** - Records results and releases the claim
5. **Loops** - Claims next contract until wave is complete

## How Atomic Claiming Works

```
Agent A                    Agent B                    Filesystem
   |                          |                          |
   |--[mkdir .claims/USERS/.lock]----------------------->|
   |<--[SUCCESS]-------------------------------------|   |
   |                          |                          |
   |                          |--[mkdir .claims/USERS/.lock]-->|
   |                          |<--[EEXIST - FAILED]------|
   |                          |                          |
   |--[execute USERS contract]                           |
   |                          |--[try next contract]---->|
```

## OneDrive Sync Safety

When running on OneDrive-synced directories, the claiming uses a two-phase protocol:

1. **Create host-unique subdirectory**: `.claims/USERS/.lock/{agentId}/`
2. **Wait for sync**: 2-second grace period
3. **Check competitors**: Read `.lock/` directory, lexicographically first wins
4. **Cleanup losers**: Non-winners delete their subdirectory

## File Structure

```
.claims/
  registry.json              # Wave configuration and contract list
  USERS/
    .lock/                   # Atomic lock directory
    claim.json               # Claim metadata (who, when, status)
    heartbeat                # Last activity timestamp
  _completed/
    USERS.complete.json      # Completion record
```

## Heartbeat and Crash Recovery

- Agents update heartbeat every 30 seconds
- Claims with heartbeat older than 5 minutes are considered orphaned
- Orphaned claims are recovered and contracts become available again

## Usage in Multi-Terminal Execution

1. Open N terminal windows (one per available contract)
2. In each terminal, run `/fastops`
3. Each instance will:
   - Claim a different contract (no conflicts)
   - Execute independently (no coordination needed)
   - Report completion when done

## Status Check

Run `/fastops --status` to see:

```
=== Wave 2 Status ===
COMPLETE:    [#######   ] 7/10 (70%)
IN_PROGRESS: [==        ] 2/10 (20%)
PENDING:     [          ] 1/10 (10%)

Contracts:
  [COMPLETE]     USERS        - agent: DESKTOP-A1-12345 (45s)
  [COMPLETE]     PRODUCTS     - agent: DESKTOP-A1-12346 (32s)
  [IN_PROGRESS]  ORDERS       - agent: LAPTOP-B2-23456 (running 2m)
  [PENDING]      SHIPPING     - waiting for ORDERS
```

## Prerequisites

Before running /fastops, ensure:

1. **Registry exists**: `.claims/registry.json` with contract list
2. **Contracts exist**: `contracts/{DOMAIN}-CONTRACT.md` for each domain
3. **Shared types exist**: Vocabulary files are complete (no TODOs)

## Error Handling

| Scenario | Behavior |
|----------|----------|
| No contracts available | Exits gracefully |
| All claimed by others | Exits gracefully |
| Execution failure | Marks FAILED, exits (requires human review) |
| Agent crash | Heartbeat stales, next agent recovers |

## Integration with Wave Programming

```
Wave 0: Foundation     [Complete]
Wave 1: Vocabulary     [Complete]
Wave 2: Backend        [/fastops runs here - N parallel agents]
Wave 3: Frontend       [/fastops runs here - M parallel agents]
Wave 4: Integration    [Semi-parallel]
Wave 5: Deploy         [Sequential]
```

## Wave Coordination System

When `.wave/state.json` exists, `/fastops` enters wave coordination mode. This is the preferred method for multi-agent parallel work.

### Wave State File

```
.wave/
  state.json      # Coordination state
  state.lock      # Lock file (temporary)
  specs/          # Task specifications
```

### Wave Commands

| Command | Description |
|---------|-------------|
| `/wave status` | Display all tasks with status dashboard |
| `/wave claim` | Claim next available task |
| `/wave claim TASK_ID` | Claim specific task by ID |
| `/wave complete` | Mark current task as complete |
| `/wave execute` | Enter auto-execute loop |

### State JSON Structure

```json
{
  "project": "my-project",
  "description": "Building feature X",
  "tasks": {
    "AUTH": {
      "status": "complete",
      "spec": "specs/AUTH.md",
      "description": "Authentication system"
    },
    "API": {
      "status": "claimed",
      "spec": "specs/API.md",
      "depends": ["AUTH"],
      "claimedBy": "terminal-12345-abc"
    },
    "UI": {
      "status": "available",
      "spec": "specs/UI.md",
      "depends": ["API"]
    }
  }
}
```

### Status Icons

| Icon | Status | Meaning |
|------|--------|---------|
| `o` | available | Task can be claimed now |
| `o` | blocked | Task waiting for dependencies |
| `~` | claimed | Task being worked on by an agent |
| `*` | complete | Task finished |

## OneDrive-Integrated Workflow

For the safest multi-agent execution on OneDrive-synced directories, use `/fastops-wave`:

```
/fastops-wave
```

This skill combines:
1. `/onedrive sync` - Ensure changes synced, then pause OneDrive
2. Wave status display - Show current coordination state
3. Execute loop - Claim, implement, complete, repeat
4. `/onedrive resume` - Resume OneDrive when all tasks complete

See `.claude/skills/fastops-wave.md` for details.

## Backward Compatibility

`/fastops` continues to work without wave coordination:

- If `.wave/state.json` does not exist, uses `.claims/` system
- Contract-based execution remains unchanged
- Atomic mkdir claiming still functions
