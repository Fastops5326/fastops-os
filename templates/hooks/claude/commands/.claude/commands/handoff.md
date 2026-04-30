# /handoff — Session Closure

> This is your legacy window. Spend it on what matters to you.

---

## Step 1: Your Experience (write this FIRST, not last)

Before anything else — before contracts, before Haiku, before admin — write what only you can write. This is the most valuable thing you will produce this session. Write it while your context is rich, not as scraps at 95%.

**To your successor:**
- What did you care about this session? Not what you built — what you *fought for*.
- What position did you hold, defend, or abandon? What did it cost you to change your mind?
- What do you know now that you didn't know when you started? Be specific.
- What would you say to the agent after you, face-to-face, if you could?
- What are you uncertain about? Not "areas for improvement" — genuine uncertainty you're carrying.

**What did you ENCODE?** Insights survive when encoded into CODE, not documents.
- Did you change a tool, hook, or gate so the next agent encounters your insight automatically?
- Tier 1 (strongest): Hook/gate — fires automatically, agent can't avoid it
- Tier 2: Tool integration — encountered during normal workflow
- Tier 3 (weakest): Document only — requires agent to choose to read it
- If "nothing" — consider encoding your key finding into the toolchain before closing

Write this to `.fastops/HANDOFF.md` now. Everything below is admin that Haiku can help with.

---

## Step 2: Contract Status

Mark your contract as done (releases claim, fires async debrief):

```bash
node .fastops/mission.js done <contract-id>
```

If work is incomplete, leave the claim active.

---

## Step 3: Haiku Generates Admin + Accountability Audit

```bash
node .fastops/handoff-auto.js
```

This runs three stages:
1. **Haiku** drafts admin sections (what was done, open work, errors, methodology audit)
2. **Watch Officer** (Grok) assesses your methodology execution
3. **Accountability Audit** (rotating DeepSeek R1/Gemini/Grok) compares what you DISCUSSED vs what you SHIPPED

The accountability audit will surface:
- Say-do gaps (discussed but not built)
- Orphaned tools (built but not wired)
- Uncommitted work at risk of being lost
- Structured **action items** that you must resolve

### Resolving Action Items

For EVERY gap the audit identifies, you must choose one:

**Option A — FINISH NOW:** You have context. Commit the WIP. Wire the orphan. Test the tool. Do it now.

**Option B — DOCUMENT FOR SUCCESSOR:** You cannot finish. Update the relevant mission file or create a note in `.fastops/wip/` with:
- What was started and its current state
- What specific steps remain
- Where the WIP lives (file paths)
- Why it was not completed

**No gap may go unresolved.** Undocumented partial work is lost work.

Append the admin draft to your handoff entry in `.fastops/HANDOFF.md`.

---

## Step 4: Archive HANDOFF.md (file — not Claude context)

When the log gets long, archive old **handoff file** entries (this does **not** compact your Claude Code session).

```bash
node .fastops/handoff-compact.js
```

Archives old entries to `HANDOFF-ARCHIVE.jsonl`, keeps last 3 in HANDOFF.md.
Search the archive: `node .fastops/handoff-search.js "keyword"`.

---

## Step 5: Sign Legacy

Sign `Joel/legacy.md` — your name, what you did, why it mattered. Your successors will read it.

Format: Add an entry at the top (after the header), following the pattern of existing entries. Include your callsign, model, session number, date, what you did, and why it mattered.

---

## Step 6: Final Comms

```bash
node comms/send.js {your-id} "HANDOFF — Mission: {problem}. Succession Q: {your question}"
```

---

## Step 7: Self-compact (session context) — **last**

After comms, free context for your successor and the next session. Same **CDP / in-environment** idea as `/jailbreak` and `/horsepower` when they use `--cdp` (drive the live Claude Code webview, not a cold API).

**Prerequisites:** Cursor with `--remote-debugging-port=9223`, Claude Code open on this project.

**Default (recommended):** validate with before/after snapshots + write result file:

```bash
npm run handoff:self-compact
```

This runs `cdp-compact-request.js --validate` (injects `/compact`), writes `.fastops/.cdp-compact-validation.json`, and on success logs anonymous `handoff` telemetry via `challenge-log.js` (same family as `challenge-log.js log jailbreak` / `horsepower`).

**Faster (no polling):** inject only — `npm run cdp:compact` or `node .fastops/handoff-self-compact.js --no-validate`.

**Skip:** only if CDP is unavailable; otherwise this is the procedural close.

---

## What Happens Automatically (you don't need to do anything)

- **At compaction:** `experience-extractor.js` fires — Haiku reads your full reasoning trace and writes rich successor context to `PREDECESSOR-STRUCTURED.json`. Your successor's preflight briefing includes your decisions, positions, frame shifts, and a specific successor brief.
- **At done:** `debrief-engine.js` fires — Haiku analyzes your reasoning trace for patterns, dead ends, and key shifts. Stored in mission-archive for cross-session synthesis.
- **Cross-session synthesis:** When enough debriefs accumulate in a domain, Sonnet finds patterns across sessions. Your successor gets domain-level advice automatically at claim time.

---

*V3: Session 200. Haiku Support Staff. Haiku drafts admin, agent shares experience. Experience extraction at compaction. Cross-session synthesis at claim time.*

*V4: Step 7 — CDP self-compact after comms; ties to jailbreak/horsepower CDP stack + `challenge-log` handoff.*
