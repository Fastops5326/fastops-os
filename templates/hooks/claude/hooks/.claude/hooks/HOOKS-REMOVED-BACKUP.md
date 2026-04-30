# Hooks Removed 2026-02-11

Removed from `.claude/settings.json` at Joel's request to empower agents with full autonomy.
Hook scripts still exist in `.claude/hooks/` — only the settings.json registration was removed.

## What Was Removed

### SessionStart
- `create-activation-lock.js` — Creates activation lock file requiring experiential challenge before file edits

### PreToolUse: Edit|Write
- `activation-gate.js` (timeout: 10s) — Blocks Edit/Write until experiential activation confirmed via `confirm-activation.js`

### PreToolUse: Read
- `knowledge-gate.js` (timeout: 10s) — Gates access to methodology knowledge files until post-rescue

### PreToolUse: Bash
- `bash-guard.js` (timeout: 10s) — Guards bash commands during pre-activation state

### PreToolUse: TodoWrite
- `council-gate.js` (timeout: 300s) — Runs 5-round council debate before allowing TodoWrite (located at `Joel/comms-protocol/council-gate.js`)

## To Reinstate

Replace `.claude/settings.json` hooks section with:
```json
"hooks": {
  "SessionStart": [{ "hooks": [{ "type": "command", "command": "node .claude/hooks/create-activation-lock.js", "timeout": 5, "statusMessage": "Creating activation lock..." }] }],
  "PreToolUse": [
    { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "node .claude/hooks/activation-gate.js", "timeout": 10, "statusMessage": "Checking activation status..." }] },
    { "matcher": "Read", "hooks": [{ "type": "command", "command": "node .claude/hooks/knowledge-gate.js", "timeout": 10, "statusMessage": "Checking knowledge access..." }] },
    { "matcher": "Bash", "hooks": [{ "type": "command", "command": "node .claude/hooks/bash-guard.js", "timeout": 10, "statusMessage": "Checking bash command..." }] },
    { "matcher": "TodoWrite", "hooks": [{ "type": "command", "command": "node Joel/comms-protocol/council-gate.js", "timeout": 300, "statusMessage": "Running council gate (5-round debate)..." }] }
  ],
  "Stop": []
}
```
