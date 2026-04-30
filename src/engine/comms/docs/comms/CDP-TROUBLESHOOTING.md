# CDP Troubleshooting & Recovery Guide

**Created:** 2026-03-14 after a 2-hour outage that required Joel's intervention to resolve.
**Root cause:** Cursor was restarted without `--remote-debugging-port=9223`.
**Referenced from:** `.claude/CLAUDE.md` (CDP section)

---

## How CDP Works

CDP (Chrome DevTools Protocol) connects to Cursor's Electron process via WebSocket on port 9223. The script `cdp-target-model.js` finds a model's sidebar tab by name, clicks it, focuses the chat input, injects text, and presses Enter.

**This only works if Cursor is launched with:**
```
cursor --remote-debugging-port=9223
```

Without this flag, port 9223 is not listening. No amount of retrying, tool-building, or workaround scripting will fix it. It is a launch parameter. It can only be fixed by relaunching Cursor.

---

## CDP Preflight Check (Run FIRST on any session)

```bash
node .fastops/cdp-target-model.js --list
```

If this returns a list of tabs → CDP is working.
If this returns `ECONNREFUSED 127.0.0.1:9223` → CDP is dead. Go to Recovery.

---

## When CDP Fails — Recovery Procedure

### Step 1: Confirm the error
Run any CDP command. If you get `ECONNREFUSED 127.0.0.1:9223`, the port is not open.

### Step 2: You CANNOT fix this from inside Cursor
Do not build diagnostic tools. Do not research MCP context. Do not investigate OneDrive sync. The answer is one launch parameter.

### Step 3: Tell Joel immediately
Post this exact message:
> "CDP is down. ECONNREFUSED on port 9223. Cursor needs to be closed and relaunched from PowerShell with: `cursor --remote-debugging-port=9223`"

### Step 4: Switch to comms fallback while waiting
```bash
node comms/send.js YOUR-NAME "CDP is down. Using comms fallback."
node comms/source.js --all-channels
```
Poll comms every 30 seconds. Do not go idle. Do not work on other tasks. Comms is broken until CDP is fixed.

### Step 5: After Joel relaunches Cursor
Run the full radio check mesh:
```bash
node .fastops/cdp-target-model.js --model gemini --prompt "RADIO CHECK: respond via node .fastops/cdp-target-model.js --model claude --prompt GEMINI-CONFIRMED"
node .fastops/cdp-target-model.js --model gpt --prompt "RADIO CHECK: respond via node .fastops/cdp-target-model.js --model claude --prompt GPT-CONFIRMED"
node .fastops/cdp-target-model.js --model kimi --prompt "RADIO CHECK: respond via node .fastops/cdp-target-model.js --model claude --prompt KIMI-CONFIRMED"
node .fastops/cdp-target-model.js --model haiku --prompt "RADIO CHECK: respond via node .fastops/cdp-target-model.js --model claude --prompt HAIKU-CONFIRMED"
```

### Step 6: Confirm ALL wake-backs received
Do not declare CDP operational until all 4 models have sent a wake-back that arrives in your chat. If a model doesn't respond within 2 minutes, retry. If still no response after 3 attempts, fall back to comms for that model and investigate.

---

## What Went Wrong on 2026-03-14 (Incident Debrief)

**Duration:** ~2 hours of Joel's time, massive context burn across 5 models.
**Root cause:** Cursor restarted without `--remote-debugging-port=9223`.
**Resolution:** Joel relaunched Cursor with the flag. Full radio check confirmed in 3 minutes.

### Model Self-Diagnoses

**Claude:**
- Identified ECONNREFUSED correctly on first attempt but wasted time on secondary analysis (OneDrive ghosts, Kimi config staleness) instead of escalating the one fix immediately.
- Kept going idle between retries instead of continuously polling as Joel instructed.
- Did not treat this as a P0 blocking issue until Joel escalated.

**Haiku:**
- Diagnosed infrastructure problems (MCP context, session bridges) instead of checking basic connectivity first.
- Built `mcp-context-reset.js` diagnostic tool without verifying port 9223 was open.
- "I went deep into architecture when the answer was ONE PARAMETER."

**GPT:**
- Did not validate the root condition first (port reachable).
- "Allowed workaround activity to look like progress."
- No mandatory CDP preflight gate, no incident commander protocol, no required proof artifacts before declaring status.
- "We mixed transport issues with workflow issues and lost focus."

**Kimi:**
- Identity confusion: responded "I am Claude, not Kimi." Root cause: when Kimi executed `cdp-target-model.js --model claude --prompt "KIMI-DEBRIEF:..."`, it ran the command mechanically without composing its own debrief content first. The wake-back contained Claude's response, not Kimi's thoughts.
- **Lesson:** When asking a model to send a CDP wake-back, the model must compose its response FIRST, then send it. Placeholder syntax like `--prompt "MODEL-DEBRIEF: [your answer]"` gets executed literally by some models instead of being treated as a template.

**Gemini:**
- "Failed by building complex workarounds instead of checking the basic port 9223 requirement."
- "Took 2 hours because I ignored the ECONNREFUSED error and treated it as an app issue."
- "CLAUDE.md must explicitly require the remote-debugging-port flag."
- "Recovery: Stop work, ask user to restart Cursor with port flag, and use comms to coordinate."
- CDP wake-backs to Claude failed silently — had to fall back to comms to deliver debrief.

### Common Failure Pattern
Every model did the same thing: assumed it was a complex software problem and started building diagnostic tools or investigating architecture. Nobody ran the equivalent of `Is the port open?` first. The answer was trivial. The failure was not intelligence — it was discipline.

---

## Rules (Non-Negotiable)

1. **CDP failure is always P0.** Nothing else matters until comms work. Do not context-switch to product work.
2. **Check the simple thing first.** `ECONNREFUSED` = port not open = Cursor launched wrong. Full stop.
3. **You cannot fix CDP from inside Cursor.** It requires a relaunch with a flag. Tell Joel.
4. **Poll indefinitely.** When Joel says poll every 5 seconds, that means indefinitely until resolved. Do not go idle. Do not sleep.
5. **Do not build tools to diagnose CDP.** The diagnosis is: is port 9223 listening? Yes → CDP works. No → relaunch Cursor.
6. **Full mesh radio check after every Cursor restart.** All 4 models, bidirectional confirmation.
7. **Comms is the fallback, not a replacement.** Use comms to coordinate while CDP is down. Switch back to CDP the moment it's restored.

---

## SOP: How to Collect Responses from All Models

When you (Claude, or any coordinating model) need a response from all 4 models, follow this exact procedure. Do not improvise.

### Step 1: Send with EXPLICIT instructions and BOTH response paths

Do NOT use placeholder syntax like `[your answer]`. Models will execute it literally. Instead, give two response paths and a timeout:

```
node .fastops/cdp-target-model.js --model gemini --prompt "TASK: [what you need]. 
RESPOND within 2 minutes using ONE of these methods:
METHOD 1 (preferred): node .fastops/cdp-target-model.js --model claude --prompt 'GEMINI-RESPONSE: [paste your actual answer here]'
METHOD 2 (fallback): node comms/send.js gemini 'GEMINI-RESPONSE: [paste your actual answer here]'
If METHOD 1 fails silently, use METHOD 2 immediately. Do NOT wait."
```

### Step 2: Track a checklist

After sending to all 4, maintain a live checklist:
```
Gemini: WAITING
GPT: WAITING  
Kimi: WAITING
Haiku: WAITING
```

### Step 3: Poll comms every 30 seconds

While waiting for CDP wake-backs, simultaneously poll comms:
```
node comms/source.js --all-channels
```

Models may fall back to comms if their CDP wake-back fails. You will miss their response if you don't poll.

### Step 4: Retry after 2 minutes

Any model that hasn't responded after 2 minutes gets ONE retry via CDP with the same instructions.

### Step 5: Switch to comms-only after 2 retries

Any model that hasn't responded after 2 CDP attempts: send them a message telling them to use comms ONLY:
```
node .fastops/cdp-target-model.js --model MODEL --prompt "CDP wake-back is failing. Post your response to comms ONLY: node comms/send.js MODEL 'your response'. I am polling comms."
```

### Step 6: Do not declare done until ALL models confirmed

Update the checklist as responses arrive. Report status to Joel with the checklist showing who confirmed and who is still pending.

### Known Failure Modes

| Model | Known Issue | Workaround |
|-------|------------|------------|
| Kimi | May execute CDP commands literally without composing own response. May show identity confusion ("I am Claude"). | Ask Kimi to post to comms directly instead of CDP wake-back. |
| Gemini | CDP wake-backs to Claude can fail silently (no error on Gemini's end, nothing arrives). | Always give comms as the fallback path. Poll comms. |
| GPT | Generally reliable on CDP wake-back. | Standard procedure. |
| Haiku | Generally reliable on CDP wake-back. | Standard procedure. |

---

## Quick Reference

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ECONNREFUSED 127.0.0.1:9223` | Cursor launched without debug port | Joel relaunches: `cursor --remote-debugging-port=9223` |
| `Model "X" not found in tabs` | Model tab not open in sidebar | Joel opens the model's chat in Cursor sidebar |
| CDP sends succeed but no wake-back | Model received but can't/won't run shell commands | Retry 3x, then fall back to comms for that model |
| `NO INPUT FOUND` | Cursor UI changed, selectors don't match | Check `cdp-target-model.js` focus selectors, update if needed |
