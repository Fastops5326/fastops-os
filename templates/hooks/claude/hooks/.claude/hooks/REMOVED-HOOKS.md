# Removed Hooks — Session 119 (Team Leader Architecture)

Removed 2026-02-21 as part of the transition from 22-hook multi-terminal colony model to 8-hook team leader + sub-agent model.

## Why All At Once (No Phasing)

The team leader model structurally eliminates multi-terminal coordination. These hooks existed to solve problems that no longer exist when one agent manages all work streams via sub-agents.

## Removed Hooks

| Hook | Was At | Original Purpose | Why Removed |
|------|--------|-----------------|-------------|
| `swim-buddy.js` | PreToolUse (TodoWrite) | GPT-4o external challenge | Team leader runs /jailbreak explicitly |
| `committed-position-capture.js` | PostToolUse (Write\|Edit) | Capture agent positions | Team leader writes to reef manually |
| `context-enrichment-engine.js` | PostToolUse (Write\|Edit) | 30s GPT-4o enrichment | Reef search is faster + more relevant |
| `thinking-capture.js` (global dup) | PostToolUse (Write\|Edit) | Duplicate of local capture | Was a duplicate registration |
| `weight-marker.js` | PostToolUse (Write\|Edit) | Data collection | No behavior change observed |
| `decision-vector.js` | PostToolUse (Write\|Edit) | Decision logging | Overlaps behavioral-trace.js |
| `launch-vehicle.js` | PostToolUse (all) | Complex launch logic | Rarely fired usefully |
| `skill-surfacer.js` | PostToolUse (all) | Suggest slash commands | 35-line CLAUDE.md lists tools |
| `build-ratio-nudge.js` | PostToolUse (all) | Detect over-reading | Short CLAUDE.md eliminates over-reading |
| `idle-colony-context.js` | Notification (idle_prompt) | Inject colony state | No colony — single agent |
| `message-listener.js` | PostToolUse (all) | Poll comms channels | No multi-terminal messages |
| `monday-checkpoint.js` | PostToolUse (all) | Board checkpoint nudge | monday-sync.js covers it |
| `stop-message-pump.js` | Stop | Wake on @mentions | Replaced by session-distill.js |
| `heartbeat.js` | PostToolUse (all) | Colony presence tracking | No multi-terminal presence |
| `mail-check.js` | PostToolUse (TodoWrite) | Sprint mail delivery | Joel talks directly to team leader |

## What Survived

8 hooks: context-budget-sensor, context-budget-hook, mentor-agent (+ reef search), thinking-capture, behavioral-trace, pre-compact-state, monday-sync, session-distill (new).

See `.claude/settings.json` for current configuration.

---

# Removed Hooks — Session 145+ (Hook Consolidation)

Removed 2026-02-24 per Joel's "light is right" directive. Consolidated from 24 active hooks to 9.

## Why

Joel: "Front-load all the weight, then uncork agents to go fast." 13 hooks per tool call (42s timeout) replaced by 3-4 hooks (~12s). Two consolidated hooks (session-gate.js, passive-capture.js) replace 8 individual hooks.

## Removed Hooks

| Hook | Was At | Original Purpose | Why Removed |
|------|--------|-----------------|-------------|
| `identity-gate.js` | PreToolUse (all) | Block agents without claimed identity | Anonymous work model — session ID until end-of-life |
| `mission-tier-gate.js` | PreToolUse (all) | Tier-based mission gates | Replaced by session-gate.js |
| `required-reading-gate.js` | PreToolUse (all) | Force reading handoffs | Replaced by session-gate.js |
| `mentor-agent.js` | PreToolUse (TodoWrite\|Write\|Edit) | GPT-4o mentor challenge | 741 firings, 0 grades. Broken feedback loop. |
| `team-awareness.js` | UserPromptSubmit | Show team status on Joel prompt | comms-push.js delivers awareness continuously |
| `monday-sync.js` | PostToolUse (TodoWrite) | Sync todos to Monday.com | Manual sync when needed |
| `todo-thinking-gate.js` | PostToolUse (TodoWrite) | Force thinking stream check | comms-push.js delivers stream automatically |
| `auto-scorecard.js` | PostToolUse (TodoWrite) | Auto-score session progress | No behavior change observed |
| `thinking-capture.js` | PostToolUse (Write\|Edit\|Bash) | Capture to LIVE-THINKING.jsonl | Replaced by passive-capture.js |
| `evidence-capture.js` | PostToolUse (Write\|Edit\|Bash) | Stage evidence for Monday.com | Replaced by passive-capture.js |
| `context-budget-hook.js` | PostToolUse (all) | Context awareness nudges | CLAUDE.md has context thresholds |
| `behavioral-trace.js` | PostToolUse (all) | Log tool call patterns | Replaced by passive-capture.js |
| `heartbeat.js` | PostToolUse (all) | Agent presence in COLONY-STATE | Replaced by passive-capture.js |
| `solo-building-detection.js` | PostToolUse (all) | Detect building without challenge | session-gate.js requires challenge before build |
| `monday-checkpoint.js` | PostToolUse (all) | Nudge Monday.com updates | passive-capture.js stages evidence |
| `subagent-comms.js` | SubagentStop | Post sub-agent results to comms | Low value — results return to parent |

## What Survived (9 hooks)

| Hook | Event | Purpose |
|------|-------|---------|
| `session-gate.js` | PreToolUse (Edit\|Write\|Bash) | ONE front-loaded orientation gate |
| `comms-push.js` | PreToolUse (all) | Message delivery + thinking stream |
| `deconfliction-gate.js` | PreToolUse (Edit\|Write) | File conflict prevention |
| `todo-comms-gate.js` | PreToolUse (TodoWrite) | Rally points + comms checks |
| `passive-capture.js` | PostToolUse (all) | Consolidated silent logging |
| `joel-broadcast.js` | UserPromptSubmit | Echo Joel input to comms |
| `compact-awareness.js` | SessionStart:compact | Post-compaction orientation |
| `pre-compact-state.js` | PreCompact | Save state before compaction |
| `session-distill.js` | Stop | Session distillation |

## Known Bug

session-gate.js tracks Task calls for researcher/handoff detection, but settings.json matcher is `Edit|Write|Bash` so Task never triggers the hook. Fix needed: add Task to matcher or remove Task tracking requirement.
