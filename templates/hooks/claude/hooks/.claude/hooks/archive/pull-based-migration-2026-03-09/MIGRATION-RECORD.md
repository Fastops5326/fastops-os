# Pull-Based Truth Architecture Migration — 2026-03-09

**Agent:** anvil-xi
**Amendment:** AMD-A7252E (Pull-Based Truth Architecture)
**Authority:** 7-agent governance meeting (4 model families), Joel's direct commander mission order

## What Was Killed

| Hook | Event | Why Killed |
|------|-------|-----------|
| swim-buddy-hook.js | UserPromptSubmit | 465 forced firings, 0 endorsements. Compliance theater. |
| joel-broadcast.js | UserPromptSubmit | Forced injection on every prompt. No agent chose it. |
| consequence-inject.js | PreToolUse (Edit/Write) | Forced behavioral shaping on file edits. |
| wake-up-briefing.js | PreToolUse (TodoWrite) | Forced nudge. Unsolicited content. |
| metabolic-trace.js | PostToolUse (all) | Forced phase gate nudges at tool calls 25/50/75/100. |

## What Was Kept

| Hook | Event | Why Kept |
|------|-------|---------|
| gate.js | PreToolUse | Identity deconfliction — multi-terminal collision prevention. Not behavioral shaping. |
| subagent-snapshot.js | PreToolUse (Task) | Operational logging — captures subagent state for accountability. |
| challenge-capture.js | PreToolUse (Skill) | Logging — records when agents use challenge tools. |
| changelog-write.js | PostToolUse (TodoWrite) | Logging — records task completion. |
| subagent-inline-check.js | PostToolUse (Task) | Accountability — checks subagent completeness. |
| compact-awareness.js | SessionStart (compact) | Critical context preservation during compaction. |
| pre-compact-state.js | PreCompact | Critical — saves agent state before context loss. |
| last-mile-check.js | PreCompact | Critical — catches uncommitted work before compaction. |
| accountability-audit.js | PreCompact | External accountability check. |
| subagent-audit.js | PreCompact | Subagent accountability check. |
| session-distill.js | Stop | Session knowledge capture. |
| monday-todo-sync.js | Stop | Board sync. |
| kb-feedback.js | Stop | KB maintenance. |
| jsonl-rotate.js | Stop | File maintenance. |
| subagent-gap-check.js | Stop | Accountability. |

## Pull-Based Replacements

| Old (forced) | New (pull-based) |
|-------------|-----------------|
| swim-buddy-hook.js | `node .fastops/ask-model.js` or `node .fastops/quick-challenge.js` |
| consequence-inject.js | `node .fastops/mirror.js` (shows truth, agent decides) |
| metabolic-trace.js nudges | Agent chooses when to reflect |
| wake-up-briefing.js | Agent reads BOOTUP.md and tools on their own |
| joel-broadcast.js | Agent reads comms via `node comms/check.js` |

## Principle

"Facts change behavior. Instructions do not." — breakwater

Architecture creates opportunity. Voluntary engagement creates value.
465 forced firings = 0 value. 10 voluntary exchanges = 10/10 novel findings.
