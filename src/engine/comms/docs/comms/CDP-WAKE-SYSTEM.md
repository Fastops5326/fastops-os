# CDP Wake-Up System — Bidirectional Model Communication

**Proven: 2026-03-13 | Full radio check: Claude ↔ Gemini ↔ GPT ↔ Grok ↔ Kimi**

## What This Is

A nervous system for multi-model coordination. Any Cursor agent can wake any other Cursor agent on the fly — no human in the loop. Models talk to models, pass work, challenge each other, and respond to team events automatically.

This is the core infrastructure that makes autonomous multi-model teamwork possible.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    CURSOR IDE                        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐  │
│  │ Claude  │ │ Gemini  │ │  GPT    │ │  Grok    │  │
│  │ (agent) │ │ (agent) │ │ (agent) │ │ (agent)  │  │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬─────┘  │
│       │           │           │            │         │
│       └───────────┴─────┬─────┴────────────┘         │
│                         │                            │
│              Chrome DevTools Protocol                │
│              (WebSocket on port 9223)                │
│                         │                            │
└─────────────────────────┤────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │                       │
     ┌────────┴────────┐    ┌────────┴────────┐
     │  cdp-target-    │    │   work-mode.js  │
     │  model.js       │    │  (auto-router)  │
     │  (direct wake)  │    │                 │
     └─────────────────┘    └─────────────────┘
```

## How It Works

1. **CDP connects** to Cursor's renderer via WebSocket (`--remote-debugging-port=9223`)
2. **Sidebar click**: Finds the target model's sidebar cell and clicks it to activate that panel
3. **Focus**: Explicitly focuses the chat input (`[contenteditable="true"]`)
4. **Inject**: Uses `Input.insertText` to paste the prompt
5. **Submit**: Sends Enter key event
6. **The model wakes up** and processes the prompt — visible to Joel in Cursor

## Critical Requirement

**Sidebar agents:** `cdp-target-model.js` targets Cursor’s main window and clicks the named model tab — use this for Gemini, GPT, Grok, etc. in the sidebar.

**Claude Code (Anthropic extension):** CDP *can* target the Claude Code webview when Cursor is launched with `--remote-debugging-port`. Use **`vscode-wake.js`** or **`cdp-wake.js --target seat-1`** (see `.fastops/cdp/seat-map.json` for `type: vscode`). Do not use `cdp-target-model` for that surface.

Launch Cursor with:
```powershell
& "$env:LOCALAPPDATA\Programs\Cursor\Cursor.exe" --remote-debugging-port=9223
```

## Tools

### Direct Wake-Up: `cdp-target-model.js`

Send a prompt to a specific model:

```bash
# Wake a specific model
node .fastops/cdp-target-model.js --model gemini --prompt "Review this code"
node .fastops/cdp-target-model.js --model gpt --prompt "Find the bug"
node .fastops/cdp-target-model.js --model grok --prompt "Test this"
node .fastops/cdp-target-model.js --model kimi --prompt "Brief me"
node .fastops/cdp-target-model.js --model claude --prompt "Wake up"

# Use a prompt file (avoids shell escaping issues)
node .fastops/cdp-target-model.js --model gemini --prompt-file prompts/brief.md

# List available tabs/agents
node .fastops/cdp-target-model.js --list

# Custom port
node .fastops/cdp-target-model.js --model gemini --prompt "hello" --port 9224
```

**Supported models:** gemini, gpt, grok, kimi, claude, composer

### Automated Routing: `work-mode.js`

Watches comms for triggers and automatically wakes the right model:

```bash
# Start continuous watching (polls every 30s)
node .fastops/work-mode.js

# Custom interval
node .fastops/work-mode.js --interval 15

# Dry run (show what would trigger)
node .fastops/work-mode.js --dry-run

# Process once and exit
node .fastops/work-mode.js --once
```

**Triggers:**

| Trigger | Action |
|---------|--------|
| `@gemini` in comms | Wake Gemini with message context |
| `@gpt` in comms | Wake GPT with message context |
| `@grok` in comms | Wake Grok with message context |
| `@kimi` in comms | Wake Kimi with message context |
| `@claude` in comms | Wake Claude with message context |
| `MISSION START` | Log to comms |
| `ISR` | Trigger IO briefing |
| `FINAL POSITION` | Wake Gemini + GPT for adversarial review |
| `TARGET COMPLETE` | Wake Gemini for QC |
| `MISSION COMPLETE` | Wake Gemini + GPT + Grok for full validation |

### Discovery: `cdp-discover-models.js`

Inspect the DOM to find model elements:

```bash
node .fastops/cdp-discover-models.js
```

Shows all model-related DOM elements, their classes, roles, and parent structure. Useful for debugging when Cursor updates its UI.

### Generic Wake: `cursor-wake.js`

Wake the currently active chat (no model targeting):

```bash
node .fastops/cursor-wake.js --prompt "Your prompt"
node .fastops/cursor-wake.js --test          # Connection test
node .fastops/cursor-wake.js --discover      # List debug targets
```

## Model-to-Model Communication

Any model can wake any other model. This enables:

- **Adversarial review**: Gemini challenges GPT's plan, GPT responds
- **QC chains**: Builder model declares done → QC model validates → builder gets feedback
- **Escalation**: Model hits a blocker → wakes a specialist model
- **Team coordination**: Models pass work items to each other without Joel intervening

Example — a model waking another model from within its own session:

```bash
# From inside Gemini's session:
node .fastops/cdp-target-model.js --model gpt --prompt "Review my QC findings in .fastops/qc-results.json"

# GPT processes, then wakes Gemini back:
node .fastops/cdp-target-model.js --model gemini --prompt "QC review complete. 2 issues found. See comms."
```

## Radio Check Results (2026-03-13)

| Direction | Status |
|-----------|--------|
| Claude → Gemini | CONFIRMED |
| Claude → GPT | CONFIRMED |
| Claude → Grok | CONFIRMED |
| Claude → Kimi | CONFIRMED |
| Gemini → Claude | CONFIRMED |
| GPT → Claude | CONFIRMED |
| Grok → Claude | CONFIRMED |
| Kimi → Claude | CONFIRMED |

**Full bidirectional communication proven across all active models.**

## Operator wake SOP (fast path)

1. **Ground truth first** — Append to `comms/data/<channel>.jsonl` (or use `comms/send.js`). Nothing is “real” until it’s on disk.
2. **CHECK COMMS stub** — Include a message id (and channel) so the woken seat can run `check-comms.js` or read JSONL.
3. **Pick the right surface**
   - **Claude Code extension (builder / webview):** `comms/cdp-to-claude-code.js` or `.fastops/cdp/cdp-wake.js --target <vscode-seat>` → `vscode-wake.js`. **Do not** use `cdp-target-model.js` for this surface.
   - **Cursor sidebar agents:** `.fastops/cdp-target-model.js --model …` (tabs in the Agents list).
4. **Slack doorbell** — `slack-bridge/sync.js --watch <s> --cdp` writes JSONL then wakes per `.fastops/cdp/seat-map.json` (`type: vscode` vs `cursor`).
5. **Task handbacks** — Any model dispatch must end with “wake requestor via CDP when done” or the commander sleeps.

## Known Constraints

1. **Two CDP surfaces** — Sidebar chats (`cdp-target-model.js`) vs **Claude Code webview** (`vscode-wake.js` / `cdp-wake --target seat-1`). Wrong tool = wrong window or no wake.
2. **One CDP port** — All agents share the same Cursor renderer
3. **DOM-dependent** — Sidebar *and* Claude Code webview selectors can change on updates. Run `cdp-discover-models.js` (sidebar); inspect webview if `vscode-wake` misses input.
4. **Sequential sends** — CDP targets one model at a time. For multi-model broadcasts, iterate through models sequentially.
5. **Focus timing** — After clicking a sidebar agent, there's a 1.5s wait for the panel to activate. If Cursor is slow, this may need increasing.

## Files

| File | Purpose |
|------|---------|
| `.fastops/cdp-target-model.js` | Targeted wake-up to specific model |
| `.fastops/work-mode.js` | Automated comms watcher + router |
| `.fastops/cursor-wake.js` | Generic wake-up (active chat) |
| `.fastops/cdp-discover-models.js` | DOM discovery for debugging |
| `comms/CDP-WAKE-SYSTEM.md` | This documentation |

---

*Built iteratively across multiple sessions. Proven with full bidirectional radio check 2026-03-13.*
