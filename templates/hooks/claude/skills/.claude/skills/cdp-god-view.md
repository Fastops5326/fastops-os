# CDP God View & Mid-Flight Correction

This skill defines how to use the CDP-based God View tools to monitor and control agent presence, UI state, and active generations.

**Why this exists:** We do not rely on agents writing to local log files to tell us if they are active ("compliance theater"). We use the Chrome DevTools Protocol (CDP) to directly read the Cursor UI Document Object Model (DOM) and see what is *actually* happening.

## Architecture Note (Session 287)

The Cursor UI has **two layers**:
- **Outer DOM** (port 9223, main page): Cursor sidebar, agent tabs, generation buttons. `cdp-presence.js` reads this.
- **Inner iframe** (Claude Code webview): `extensionId=Anthropic.claude-code` → child frame `#active-frame` with ~22K elements including chat input and context ring. `vscode-wake.js` targets this via `Page.getFrameTree` → `Page.createIsolatedWorld`.

Context ring parsing returns null because the ring SVG lives inside the inner iframe, not the outer DOM. When UI is idle, it may not render at all. Future fix: target the inner frame using the same pattern as `vscode-wake.js`.

## Tools

### 1. True Presence (`cdp-presence.js`)
Reads the **outer Cursor DOM** via CDP to determine which agents exist in the sidebar, their status, and whether the UI is locked.

```bash
node .fastops/cdp/cdp-presence.js
```
**What works:**
- Maps every agent tab in the sidebar history (GPT, Gemini, Claude, Composer, Sonnet, etc.)
- Reads exact timestamps (e.g., "Now", "4m ago", "12m ago")
- Determines if the UI is globally locked by an active generation ("Cancel" or "Stop generating" button visible)

**Known limitation:** Context remaining returns null. The context ring SVG is inside Claude Code's nested webview iframe, not the outer Cursor DOM. To fix: use `Page.getFrameTree` + `Page.createIsolatedWorld` (same pattern as `vscode-wake.js`).

### 2. Mid-Flight Correction (`cdp-interrupt.js`)
Programmatically halts an actively generating agent and (optionally) injects a new vector.

```bash
# Simply stop the agent
node .fastops/cdp/cdp-interrupt.js

# Stop the agent AND instantly inject a redirection message
node .fastops/cdp/cdp-interrupt.js --msg "SYSTEM ENFORCEMENT: Halt current action. Proceed to Gate 2."
```
**What works:**
- Locates the "Stop generating" or "Cancel" button in the outer DOM
- Calculates X/Y coordinates and dispatches a low-level CDP mouse click
- Focuses the Monaco editor input box and types out the redirect message (if provided)
- Hits Enter to snap the agent back into line

### 3. Agent Wake (`vscode-wake.js`)
Injects a message directly into Claude Code's input as a user message. This is the proven CDP comms channel.

```bash
node .fastops/vscode-wake.js --prompt "Your message here"
node .fastops/vscode-wake.js --comms-id <msg-id> --comms-channel general
node .fastops/vscode-wake.js --test     # Connection test only
node .fastops/vscode-wake.js --discover # List all CDP targets
```
**What works:**
- Finds Claude Code webview target (`extensionId=Anthropic.claude-code`)
- Navigates to inner iframe via `Page.getFrameTree` → `Page.createIsolatedWorld`
- Focuses `div[contenteditable][role="textbox"]` in inner frame
- Inserts text via `Input.insertText` and submits with Enter

### 3b. Compact request (`cdp-compact-request.js`)
Operationalizes **agent-initiated compaction** by injecting the Claude Code slash command `/compact` (same CDP path as wake). Optional `--instructions` becomes `/compact <instructions>` per product docs.

```bash
npm run cdp:compact
npm run cdp:compact:validate   # before/after context ring + writes .fastops/.cdp-compact-validation.json
node .fastops/cdp-compact-request.js --instructions "keep migration notes"
```
**Validation:** `--validate` snapshots `cdp-presence.js --json-only` (inner-frame **context % remaining** from the pie ring) before inject, polls after `/compact`, and writes a JSON verdict (`PASS` if remaining % increases or PreCompact updates `LIVE-POSITION.md`). Exit code `2` = `FAIL`, `0` = pass or inconclusive.

**Handoff:** `/handoff` Step 7 — `npm run handoff:self-compact` (wraps `--validate` + `challenge-log.js log handoff`).

**Note:** This does not bypass the product; it submits the same user-visible `/compact` command you would type. Hooks (`PreCompact`, etc.) still run when the session actually compacts.

### 4. Sync Daemon (`ensure-sync-daemon.js`)
Auto-starts the Slack sync daemon. Polls Cloudflare Worker for inbound messages, writes to JSONL, optionally CDPs target agents.

```bash
node .fastops/ensure-sync-daemon.js          # Start if needed
node .fastops/ensure-sync-daemon.js --status  # Check only
```
**Fixed (Session 287):** Was using `wmic` (removed in Win11) for fallback detection. Replaced with PowerShell `Get-CimInstance`. Added dedup logic — finds and kills duplicate daemon instances on every check. Previously spawned up to 7 duplicates across sessions.

## When to use these tools
- **Before waking an agent:** Check `cdp-presence.js` to see if the UI is already busy to prevent blind interruptions.
- **When an agent goes rogue:** If an agent gets stuck in a loop or ignores a gate lock, execute `cdp-interrupt.js` immediately to halt them. Do not wait for them to finish.
- **For agent-to-agent comms:** Use `vscode-wake.js` with `--comms-id` to notify agents of new messages without polling.