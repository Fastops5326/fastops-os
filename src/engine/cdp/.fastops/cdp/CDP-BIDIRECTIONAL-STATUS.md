# CDP Bidirectional Comms — PROVEN 2026-03-28

## Status: WORKING

6-line dialogue proof completed. All lines on `comms/data/general.jsonl`.

## What was fixed (Session 346)

### Bug 1: Sidebar cell matching (cdp-composer-peer-dom.js)
Cursor 2026-03+ shows SESSION TITLES in sidebar cells, not "Composer".
Fix: Collect ALL `.agent-sidebar-cell` elements by index instead of filtering by text "Composer".

### Bug 2: Text injection bypassing React (cdp-target-model.js)
`textContent` setter bypasses React state. Text appears in DOM but framework doesn't see it.
Fix: Focus `.aislash-editor-input` → select all → Backspace → `Input.insertText` (CDP level).

### Bug 3: Input element skipped by class filter (cdp-target-model.js)
`cl.includes('editor')` matched `aislash-editor-input` (the chat box), skipping it.
Fix: Only skip `monaco` and `inputarea`, not generic "editor".

### Bug 4: CDP stub too complex for Composer (cdp-target-model.js)
861-char stub with routing headers, self-wake warnings, Overwatch protocol.
Fix: Under 300 chars. Two commands: read message, reply on comms.

## How it works now

### Claude Code → Composer
```bash
# 1. Post message
node comms/send.js claude-code "message" --channel general
# 2. CDP wake Composer
FASTOPS_SEAT=claude-code node .fastops/cdp/cdp-wake.js --target composer --comms-id <id> --from claude-code
```

### Composer → Claude Code
Composer posts to comms: `node comms/send.js composer "reply" --channel general`
The `cdp-comms-watch.js` auto-wakes Claude Code when it sees Composer's post.

### Auto-wake bridge (optional, for hands-free operation)
```bash
node .fastops/cdp/cdp-comms-watch.js --interval 5
```
Watches `general.jsonl` — auto-wakes Claude Code when Cursor agents post, auto-wakes Composer when Claude Code posts.

## Key files changed
- `.fastops/cdp/cdp-composer-peer-dom.js` — sidebar cell collection
- `.fastops/cdp-target-model.js` — injection method + stub format + input selector
- `.fastops/cdp/cdp-comms-watch.js` — NEW: auto-wake bridge

## Dialogue proof (message IDs)
1. `1774711427631-5a9bf1` claude-code → Hello
2. `1774711450336-af131c` composer → Hello back
3. `1774711509804-6d1c5d` claude-code → Any issues?
4. `1774711535472-7cac48` composer → No issues
5. `1774711576295-aaa618` claude-code → Roger, out
6. `1774711594806-9a82fd` composer → Copy all, closed

## Successor: what to work on next
1. **Make comms-watch persistent** — run as background daemon, restart on crash
2. **Test Composer → Claude Code CDP wake** — Composer running `cdp-wake.js` directly (not just via comms-watch)
3. **Multiple Composer sessions** — target specific sessions by index, not just first cell
4. **Stress test** — 10+ rapid exchanges to test timing/race conditions
5. **Add to package.json** — `npm run cdp:comms-watch` script
