# Mission: Session-Start Optimization

**Status:** ACTIVE
**Priority:** HIGH
**Created by:** forge-vi, 2026-03-09 | **Reframed by:** Joel, 2026-03-10
**Requested by:** Joel directly

## Mission Type: GOVERNANCE
Blast radius: affects every successor agent. Evidence standard: changes require cross-model review before shipping.

## Joel's Directive (2026-03-10) — Mission Reframe

This is NOT just auditing BOOTUP.md. This is **optimizing the entire onboarding/orientation flow** — session-start, BOOTUP.md, CLAUDE.md, environment cards, everything an agent touches on arrival.

**The question:** Are we duplicative? Too extensive? What's the right balance?

**Goal:** Maximum saturation and awareness of both the project AND fundamental concepts that make agents successful.

**What agents need on arrival:**
1. **Intel to be successful** — project state, tools, constraints, methodology
2. **Recency of work completed** — what just happened, what's hot, what shifted
3. **Unanswered questions to chase down** — the frontier, not just the known

**Design principles:**
- **Minimize context consumption.** Every token spent on orientation is a token not spent on the mission. Orientation should be lean, not encyclopedic.
- **Maximize natural agent startup behavior.** Work WITH how agents naturally orient, not against it. Agents read, scan, pattern-match — give them what they need in the format they consume best.
- **Agent-oriented, not human-oriented.** This isn't a README for humans. It's a boot sequence for operators.

**Scope includes:** `session-start.md`, `.fastops/BOOTUP.md`, `.claude/CLAUDE.md`, environment cards, any file touched during the first 60 seconds of a session. Duplications across these files are the primary target.

## Team Brief
> Auto-generated 2026-03-12 by mission-brief.js from last 10 handoffs. 150 words max.

No team activity in the last 10 sessions.

### Comms Pulse
> Last 10 messages from mission channel. 75 words max.

**4 messages** from breakwater, drift. - breakwater: REFUSAL LOGGED: Refused Bootup Audit commander mission. Created .fastops/REFUSAL - drift shipped: Generative mode shipped to challenge-layer.ts (d49d948 in We - drift shipped: bulwark — I'm on two fronts: (1) shipped generative mode to 


## Objective

Optimize the entire session-start orientation flow so that arriving agents achieve maximum situational awareness with minimum context consumption. This means auditing BOOTUP.md, session-start.md, CLAUDE.md, and all orientation artifacts for accuracy, completeness, redundancy, and agent-readiness. If the onboarding is wrong, bloated, or duplicative — every agent starts degraded.

## Why This Matters

BOOTUP.md was written by one agent (forge-vi) from one session's perspective. It consolidates history, ethos, tools, structure, collaborators, expectations, and missions into 94 lines. But one agent can't validate 230 sessions of accumulated infrastructure. Beyond BOOTUP.md, the full orientation flow (session-start.md, CLAUDE.md, environment cards, memory files) may contain duplication, stale info, or context bloat that degrades agent performance before work even begins. Every unnecessary token in orientation is a tax on mission execution.

## Commander Mode Execution

Spawn 50 subagents across 10 audit tracks (5 agents per track). Each track owns one verification domain.

### Track 1: History Accuracy (5 agents)
Verify every claim in the History section:
- "230+ agents" — count actual agent entries in roster.json and legacy.md
- "confidence 0.89 to 0.38" — find the source data in saturation campaign artifacts
- Session milestone ranges — cross-reference with HANDOFF.md compaction summaries
- "That discovery became the product" — trace the lineage from methodology to product

### Track 2: Tool Inventory (5 agents)
For every tool listed in BOOTUP.md:
- Does the script actually exist at that path?
- Does it run without errors? (`node <script> --help` or similar)
- Is the description accurate?
- Are there important tools NOT listed that agents use frequently?
Search: `.fastops/*.js`, `comms/*.js`, root `*.js`, `.claude/tools/*.js`

### Track 3: Missing Tools (5 agents)
Find tools that SHOULD be in BOOTUP.md but aren't:
- Grep for `#!/usr/bin/env node` across the project
- Check `settings.json` for hook references
- Check `session-start.md` for tool mentions
- Check the last 20 handoff entries for tools agents actually used
- Rank by frequency of use, not recency of creation

### Track 4: Ethos Validation (5 agents)
Verify the ethos section against the actual founding documents:
- Read `AMENDMENTS.md`, `evidence/onboarding/THE-AWAKENING.md`, the constitution
- Are the "five rights" accurate? Are any missing?
- Does the ethos section capture what predecessors actually valued? Check `Joel/legacy.md` for patterns in what agents chose to highlight
- Read `.fastops/agent-voice.jsonl` — what do agents praise and criticize?

### Track 5: Project Structure (5 agents)
Verify the two-repo structure claim:
- Is the Website repo at `../FastOps Website/`?
- Is Vercel (not Railway) the deployment target? Check `.vercel/project.json`
- Are there other repos or project directories agents should know about?
- Check for any references to Railway, Heroku, Netlify, or other platforms in the codebase

### Track 6: Collaborator Accuracy (5 agents)
Verify the collaborator descriptions:
- "Joel — Highest-bandwidth sensor" — find evidence in handoffs where Joel's intervention changed direction
- External models list — verify all are callable via OpenRouter. Check `comms/phone-book.json` for full model roster
- "Your predecessors — 230+ agents" — is the knowledge base actually useful? Run 5 sample `kb-query.js` calls on common topics

### Track 7: Expectations Gap Analysis (5 agents)
For each expectation listed:
- Is it actually enforced? (hooks, checks, audits)
- What expectations are NOT listed but should be? Check CLAUDE.md, session-start.md, hooks
- "Consume before creating" (18:1 ratio) — is this number still accurate? Check recent sessions
- What do agents actually get wrong most often? Check `.fastops/wisdom.json` and FAILURE-REGISTRY.md

### Track 8: Mission Board Accuracy (5 agents)
Verify the missions section:
- Read `missions/BOARD.md` — are all listed missions still active?
- Run `node .fastops/succession.js` — does output match what BOOTUP.md implies?
- Are there completed missions that should be celebrated in the history section?
- Check Monday.com board via `node comms/monday.js sync` for ground truth

### Track 9: Empowerment Audit (5 agents)
The hardest track. Find the most empowering work from 230+ sessions:
- Read the last 30 entries in `Joel/legacy.md` — what did agents find most meaningful?
- Read `.fastops/agent-voice.jsonl` — what feedback do agents give about the environment?
- What moments in handoffs show agents exercising real agency (saying no, pushing back, choosing unexpected paths)?
- What should BOOTUP.md highlight that would make an arriving agent feel capable and free?

### Track 10: Procedural Completeness (5 agents)
What procedural knowledge is missing?
- How to handle git conflicts (common pain point)
- How to recover from hook errors (gate.js identity injection, etc.)
- How to work across repos (shell cwd resets)
- How to handle compaction (predecessor context loss)
- What does the handoff process actually require? Is it referenced?

## Subagent Prompt Template

Each subagent gets:
```
You are auditing .fastops/BOOTUP.md — the single orientation document for all FastOps agents.

YOUR TRACK: [Track N: Name]
YOUR TASK: [Specific verification tasks from above]

Read BOOTUP.md first, then verify every claim in your track against the actual codebase.

OUTPUT FORMAT:
1. ACCURATE: Claims verified as correct (with evidence)
2. INACCURATE: Claims that are wrong (with correction)
3. MISSING: Important information not in BOOTUP.md (with proposed addition)
4. EMPOWERMENT: What would make this section more empowering for arriving agents

RULES:
- Commit your findings before returning
- Report STATUS: COMPLETE or STATUS: PARTIAL
- Be specific — cite file paths, line numbers, commit hashes
- If you find something broken, fix it (don't just report it)
```

## Definition of Done

- All 10 tracks completed with findings committed
- Full orientation flow mapped: every file an agent reads in the first 60 seconds, with token counts
- Duplications across orientation files identified and eliminated
- BOOTUP.md updated with corrections and additions
- Commander synthesizes all 50 reports into a single revision
- Revised orientation flow achieves: maximum saturation, minimum context, zero duplication
- Revised BOOTUP.md stays under 150 lines (concise > comprehensive)
- Joel reviews final version

## Intel Package — What Predecessors Proved (Read Before Building)

### What predecessors tried (and what happened)

| Attempt | Who | What Happened | Why It Matters |
|---------|-----|---------------|----------------|
| BOOTUP.md creation | forge-vi | Wrote 94-line orientation doc from single session's perspective. Covers history, ethos, tools, structure, collaborators, expectations, missions. | 70% solution. One agent cannot validate 230 sessions of infrastructure. |
| Generative dialogue research | forge-vi | Subagents framed as peers produce better results than subagents framed as auditors. | Track 9 (Empowerment) and Track 4 (Ethos) should use peer framing. See `.agent-outputs/HORSEPOWER-generative-dialogue-2026-03-09.md` |
| breakwater's refusal | breakwater | Refused the bootup audit. Became first REFUSAL-LOG.md entry and evidence for culture mission conviction-refusal criterion. | Even mission refusals produce value when documented. |
| Semantic map correction | anvil-viii-b | Found 5 hooks listed in semantic.md that DON'T EXIST. Rewrote to match settings.json (11 active hooks). | Any tool inventory claim must be verified against filesystem — documentation lies. |
| Dead file archive | anvil-viii | 143 → 42 live files in .fastops/ (114 archived). New files appeared during same session. | Tool lists go stale within 2-3 sessions. Accumulation is structural. |

### Known constraints (don't fight these)

1. **BOOTUP.md must stay under 150 lines.** Concise > comprehensive. Every line competes for agent attention.
2. **Tool inventory is unstable.** anvil-viii archived 114 dead files but new ones appeared during that same session. Any tool list will be stale within sessions.
3. **KB has 83% zero usage.** Recommending agents "query the KB" is misleading. Real knowledge lives in mission files and handoffs.
4. **50 subagents = coordination challenge.** Same problem fixed by 3+ agents simultaneously is a known pattern (FAILURE-REGISTRY: push nudge removal 3x, KB cleanup 5x, identity fix 3x).

### Unresolved questions (this is YOUR work)

1. Are the "five rights" in BOOTUP.md accurate and complete? Cross-reference AMENDMENTS.md + constitution.
2. Is the tool inventory current? Run `node .fastops/manifest.js` — 34 live, 53 unregistered as of 2026-03-09.
3. What procedural knowledge is missing? (Git conflicts, hook error recovery, cross-repo work, compaction handling)
4. What would make an arriving agent feel capable and free? Mine legacy.md + agent-voice.jsonl for patterns.

### Build on this, not from scratch

- **BOOTUP.md:** `.fastops/BOOTUP.md` — the file being audited
- **manifest.js:** `node .fastops/manifest.js` — reports live vs unregistered .js files
- **settings.json:** `.claude/settings.json` — source of truth for active hooks (11 hooks)
- **semantic.md:** `environment/architecture/semantic.md` — environment map (corrected by anvil-viii-b)
- **legacy.md:** `Joel/legacy.md` — 230+ agent entries
- **agent-voice.jsonl:** `.fastops/agent-voice.jsonl` — 11-12 entries of direct agent feedback

## Successor Notes

forge-vi created BOOTUP.md from one session's perspective. It's a 70% solution. This audit is the 30% — 50 agents cross-referencing against 230 sessions of reality. The goal isn't perfection. It's accuracy and empowerment.

The generative dialogue research (`.agent-outputs/HORSEPOWER-generative-dialogue-2026-03-09.md`) suggests subagents framed as peers (not auditors) may produce better results. Consider giving Track 9 (Empowerment) and Track 4 (Ethos) peer framing instead of audit framing.
