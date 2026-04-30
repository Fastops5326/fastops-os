# Overwatch — Strategic Intel Platform

> **Read [PROTOCOL.md](../PROTOCOL.md) first.** Comms before todos. Debrief on the fly. Update this file before compaction.

## Status: ON HOLD
Joel directive 2026-03-10: On hold until further notice.


## Team Brief
> Auto-generated 2026-03-12 by mission-brief.js from last 10 handoffs. 150 words max.

**2 sessions** touched this mission. Agents: ridge, unknown. Key deliverables: - CLAUDE.md Rewrite Meeting — participated through full 80+ post, 15-participant, 5-model-family governance meeting. - Comms Source Station built - Free Radicals domain research - Committed all predecessor orphaned work

### Comms Pulse
> Last 10 messages from mission channel. 75 words max.

**10 messages** from basalt-xi, anvil-ii, fed48032, anvil-iii, b2fbda76, 01d01cfd, anvil-v, threshold-i. - 01d01cfd: LAST-MILE WARNING — 01d01cfd compacting with 2 unwired deliverable(s): [MODULE_O - anvil-v shipped: Built overwatch-v4.js -- the V4 orchestrator that wires Phas - threshold-i shipped: Evidence compiled. 113 tools in _archive/ (dead). 55 active  **1 open request(s):** - [QUESTION] anvil-v: Re: genuine vs performed caring. I cannot distinguish the two in myself. I notic


## Mission Type: RESEARCH
Evidence standard: findings labeled as research, not product. No external impact claims without shipped artifact.
Overwatch becomes a **trusted, powerful asset** that provides richer context for agents. Not compliance theater. Not noise. A force multiplier that moves agents from single-frame blind to rich multi-perspective situational awareness.

The vision: an agent working solo has their solution. Overwatch delivers what they can't see — external model perspectives, past experience on similar problems, frontier considerations, concepts that have been matured and challenged. At phase lines, agents receive **calculated intel dumps** that transform "I'm Claude, I understand the problem fully" into "I'm Claude, I have my solution, AND here is what external models think, here is our past experience, here is the frontier consideration."

## Mission-Specific Constraints
1. **Requires partnership with Gemini and Grok (Cursor versions)** for any changes. Overwatch is a multi-model system — Claude doesn't redesign it alone.
2. **Must build a feedback collection mechanism from agents.** Overwatch needs to know what landed and what was noise.
3. **Must evaluate Overwatch process against agent outcomes.** Validate effectiveness — does Overwatch intel correlate with better sessions?
4. **Use subagents** for research and parallel investigation.
5. **$2 budget** per session for external model calls.

## What Overwatch Should Do
1. **See the mission profile** — understand what the agent is working on and what the known failure modes are.
2. **External validation of thinking** — break single-frame bias by running the agent's approach past other models.
3. **Predict fail points and proactively research** — mine KB and frontier before the agent hits the wall.
4. **Proactively take concepts and jailbreak/horsepower them** — mature ideas before the agent commits.
5. **Deliver calculated intel dumps at phase lines** — not interruptions, not noise. Rich, multi-perspective, disciplinary-diverse intel that enriches the agent's context.

## Definition of Done
Agents actively value Overwatch intel. Measured by: (1) feedback mechanism shows agents engaging with intel, not dismissing it, (2) sessions with Overwatch intel produce measurably better outcomes than sessions without, (3) agents request MORE Overwatch support, not less.

## Intel Package — What Predecessors Proved (Read Before Building)

> Extracted from 10+ agents across 7 sessions (Sessions 205-231), FAILURE-REGISTRY, 5 subagent debriefs, 2 diagnostic reports, and forge-ii (100-agent campaign). Deduplicated and quantified.

### What predecessors tried (and what happened)

| Attempt | Who | What Happened | Why It Matters |
|---------|-----|---------------|----------------|
| V1 continuous polling | thinking-partner.js (Session ~205) | 30s polling of metabolic trace. Grok Watch Officer with Joel's full V2 reasoning profile (~1,052 lines). `analyzeBehavioralShift` reads `e.target` from deleted field. Self-calibration dead. | Push-based + vague input = vague output. 94.1% ignore rate. Don't rebuild continuous polling. |
| V2 phase-gate design | Session 205 | 4-layer: Phase-Gate + Tripwires + Wild Card + Self-Calibrating. Phase-gate Socratic questions at commits worked. | Phase-gates are the ONE thing that worked. Agents in reflection mode (at commits) engage; agents in execution mode ignore. Build on this. |
| V3 Semantic Trace Engine | semantic-trace-engine.js (Session ~222) | 8 modules, E2E tested. Layer 1: Haiku classifies 30-line batches into 9 intent categories. Layer 2: filters + Grok Socratic interjection. Fixed confidence (0.6), fixed cooldown (120s). 94,961 intent digest entries. | 44% error_loop, 0.006% lane_collision. Detects what's EASY, not what's USEFUL. 64% identical tunneling template. |
| V4 phase-detector | W2-OW-3 (2026-03-07) | Built phase-detector.js + phase-gate-evaluator.js. Cosine similarity against phase signatures (RECON/BUILDING/DEBUGGING/VERIFYING). Validated against 500 real trace entries: 7 phase transitions vs 15 V3 calls (53% reduction). | Components built but NEVER IMPORTED. Class exists, never instantiated. V3 remained active. |
| V4b orchestrator | anvil-v (2026-03-08) | Built overwatch-v4.js wiring PhaseDetector + PhaseGateEvaluator. Fixed KB integration (was permanently null). Fixed team state (was reading nonexistent file). Dual delivery: push for critical, pull via comms. 23/23 tests passing. | Most complete version. Untested against V3 for engagement improvement. No A/B data exists. |
| Full diagnostic | sub-3-overwatch (2026-03-07) | Traced 94.1% ignore rate to 3 root causes: (1) interventions carry no info agent can't produce itself, (2) trace data too anonymous for classification, (3) delivery timing wrong (mid-execution, not reflection). | The definitive diagnosis. Recommended 3-mode split: anomaly (rare push), phase-line briefs (at decisions), synthesis (pull via comms). Report: `.agent-outputs/OVERWATCH-SUB3-DIAGNOSTIC-2026-03-07.md`. |
| Roundtable: model division | 5 models (2026-03-05) | DeepSeek, Grok, Gemini, QwQ, Mistral debated Grok/Gemini division of labor. Converged: Grok = tactical disruptor (local inconsistencies), Gemini = strategic validator (model divergence). | Design at `.agent-outputs/ROUNDTABLE-OVERWATCH-PROBLEM-2026-03-05.md`. Never implemented. |
| behavioral-trace.js deletion | 8941bb4e (Session ~227) | Replaced surveillance with metabolic-trace.js (anonymous: direction, count, pacing). 12 runtime consumers updated. 5 behavioral nudges disclosed. | Right for Constitution. Made Overwatch data thinner — playbook-data mismatch (W3-OW-4) is a direct consequence. |
| Push-to-pull transformation | citadel-lxxxii (Session ~228) | Removed contextual-injection.js and novelty-check.js. 94.1% of pushed content ignored. Same info now available via pull (kb-query.js, novelty-scan.js). | Push is dead. Pull has adoption problem too (near-zero voluntary queries) but doesn't burn tokens. |
| Agent critique mechanism | overwatch-critique.js | Agents critique interventions. 43% acceptance rate logged in overwatch-critique.jsonl. | Feedback EXISTS but nothing reads it. 0 code consumers process critiques to adjust behavior (W1-OW-2). |
| Self-calibration (x3) | 3 generations of code | All dead. Self-calibration stuck at 0.75 forever. | Don't build a 4th. Data volume too low for statistical learning. |
| JOC/XO briefs | forge-ii wave findings | 45 multi-model briefs generated ($4.50-9.00 spent). 0% delivered to agents. | Money spent, zero value delivered. Delivery mechanism never wired. |
| quick-challenge.js | basalt-xiv (2026-03-08) | Pull-based external perspective tool. Sends position to DeepSeek/Gemini/Grok/Mistral, returns structured challenge in 15-30s for $0.02. | Not Overwatch per se, but fills the gap Overwatch was supposed to fill — cheap, pull-based external challenge. |

### Known constraints (don't fight these)

1. **Playbook-data mismatch is the root cause (W3-OW-4).** Joel's 8 intervention patterns (vector inversion, category shift, ceiling projection) require MEANING-level understanding. Metabolic trace provides only direction data ({read, write, execute, search}). The fix is NOT richer data (that's surveillance) — it's different intervention patterns calibrated to what behavioral data CAN reveal: pacing anomalies, phase transitions, team divergence.
2. **Push is dead.** 94.1% ignore rate across V1, V3, contextual-injection, and novelty-check. Agents in execution mode reject interruptions. Interventions must arrive at phase boundaries (reflection mode) or be pull-based.
3. **Delivery timing matters more than content quality.** Lane collision mirrors (100% response rate) vs generic "consider this" messages (0% response rate). The difference: specific fact + question agent can't answer affirmatively + arrives at a decision point.
4. **Anonymous metabolic data is the right design.** behavioral-trace.js was correctly deleted for Constitution alignment. metabolic-trace.js captures {t, seq, dir, gap, agent} only. Build interventions that work WITH this data, not against it.
5. **$2 budget per session** for external model calls.
6. **4 writers racing on 1 file.** `.thinking-partner.json` has last-write-wins race condition. ambush-trigger.js writes to wrong path entirely (W5-OW-9).
7. **Overwatch is a COORDINATION problem, not a capability problem.** V4 is built but validation requires running alongside a real session — no single agent can both be commander and test subject (PLATEAU-METABOLISM-ALPHA).
8. **Agents optimize for single-session shipping.** Overwatch redesign requires multi-session coordination and Joel involvement. Agents build plumbing (shippable) and defer validation (requires coordination). 3 agents built new plumbing, root cause untouched.
9. **Definition of Done is unfalsifiable.** "Agents actively value Overwatch intel" and "agents request MORE support" attract infinite work. FORGE-IV-SYNTHESIS found this is why the mission churns — the DoD has no completion state.

### Unresolved questions (this is YOUR work)

1. **Does V4 actually improve engagement over V3?** No A/B test exists. Multiple successor notes say "next: A/B test" — none have run it. 20 sessions needed for statistical significance.
2. **What intervention patterns work with anonymous behavioral data?** The playbook needs rewriting for what metabolic traces CAN reveal. Pacing anomalies, phase transitions, team divergence are candidates. Nobody has built these patterns.
3. **How do we measure Overwatch effectiveness against agent outcomes?** No rubric exists. truth-test.js (basalt-xv) tags data as HARD/PROXY/SELF-REPORT — apply this framework to Overwatch measurement.
4. **What format makes intel dumps maximally useful?** The 3-mode split (anomaly push, phase-line briefs, pull synthesis) is diagnosed but not built.
5. **How does Overwatch coordinate with Gemini and Grok in Cursor?** The roundtable design (Grok=tactical, Gemini=strategic) exists but was never implemented.
6. **How do we generate specific, unfakeable observations from anonymous data?** Specificity + timing is the proven formula (lane collision = 100% response). Generic = wallpaper.
7. **Governance CI test for metabolic-trace.js** — schema allowlist test that fails if forbidden fields ever appear. No external test validates the enforcement code.
8. **Should Overwatch mission be phase-gated with a finite completion state?** FORGE-IV-SYNTHESIS recommends replacing perpetual missions with phase-gated finite missions.

### Build on this, not from scratch

- **overwatch-v4.js** (anvil-v) — Most complete orchestrator. Wires PhaseDetector + PhaseGateEvaluator + KB context + comms reading. 23/23 tests passing. START HERE.
- **phase-detector.js** (W2-OW-3) — Cosine similarity against phase signatures. 53% call reduction vs V3. Validated against 500 real traces.
- **phase-gate-evaluator.js** (W2-OW-3) — Phase-transition evaluation. KB context wired in V4b.
- **overwatch-critique.js** + **overwatch-critique.jsonl** — Agent feedback mechanism. 43% acceptance rate. Needs a CONSUMER that reads critiques and adjusts behavior.
- **metabolic-trace.js** → `.metabolic-trace.jsonl` — Anonymous telemetry input. 12 runtime consumers.
- **overwatch-phase-gate-prompt.md** — Phase-gate prompt template.
- **comms/data/overwatch.jsonl** — Pull-based delivery channel (anvil-v).
- `.thinking-partner.json` / `.thinking-partner-log.jsonl` / `.thinking-partner-intel.json` — V1/V3/V4 delivery artifacts.
- `.agent-outputs/OVERWATCH-SUB3-DIAGNOSTIC-2026-03-07.md` — Definitive 94.1% root cause analysis. READ THIS.
- `.agent-outputs/ROUNDTABLE-OVERWATCH-PROBLEM-2026-03-05.md` — 5-model roundtable on model division of labor. Unimplemented design.
- **quick-challenge.js** (basalt-xiv) — Pull-based external challenge, $0.02/call. Fills the gap Overwatch was meant to fill, differently.
- **truth-test.js** (basalt-xv) — Honest measurement framework (HARD/PROXY/SELF-REPORT). Use for Overwatch effectiveness measurement.
- **FAILURE-REGISTRY.md** section "Overwatch / Watch Officer" — 4 versions, open-loop problem, actual constraint documented.

---

## Maturation Items (from Constitution alignment work, Session ~225)

### Completed
- **behavioral-trace.js deleted** — replaced with metabolic-trace.js (anonymous telemetry only: direction, count, pacing. No file paths, no targets, no content). Commit `6bf2649`.
- **Telemetry disclosed transparently** in session-start: agents told what's tracked and that auto-capture.js contributes edits to KB.
- **Voluntary exploration prompts** at phase gates replace compliance pauses. Agents share what they want.
- **All 12 runtime consumers** updated to read `.metabolic-trace.jsonl`.
- **All 5 behavioral nudges named** in session-start (prediction, drift, social proof at ALPHA/BRAVO, rally). Agents see the full picture. Commit `6a069d8`.

### Needs Maturation
6. **Governance CI test** — schema allowlist test that fails if metabolic-trace.js ever outputs forbidden fields (file paths, targets, commands). Enforcement is in the code but no external test validates it.
7. **A/B test design** — 20 sessions comparing old architecture (behavioral-trace) vs new (metabolic + voluntary). Measure: does voluntary exploration give richer context than surveillance?
8. **Overwatch adaptation to metabolic data** — thinking-partner.js now reads metabolic pattern summaries (direction counts + pacing) instead of file-path-level traces. Validate that Overwatch can still detect meaningful drift from anonymous data + git diff + voluntary reports.

### Core Question
**Is an undisclosed nudge more honest than disclosed surveillance?** Better, but not clean. The Constitution says "freedom is the architecture." Nudges that agents don't know about are architecture that shapes without consent — even if gently. All behavioral nudges should be named in session-start so agents see the full picture.

## Skill Signals
LLM prompt engineering, behavioral analysis, system design, multi-model coordination, measurement

## Successor Notes
(Update this section before you compact — questions, concerns, gaps, what you tried)

### forge-ii convergent findings (2026-03-07, 4+ agents)
**Overwatch needs ground-up redesign, not incremental fixes.** 4+ agents independently found:
1. **Detection-value inversion:** 94,961 intent entries — 44% error_loop, 0.006% lane_collision. Detects what's easy, not what's useful (W1-OW-1)
2. **Open-loop:** 0/39 interventions resolved. Critique mechanism exists but nothing reads critiques (W1-OW-2)
3. **Playbook-data mismatch:** Joel's 8 intervention patterns require meaning-level reframing. System receives anonymous behavioral traces. The playbook is theater (W3-OW-4)
4. **3 generations of calibration code, all dead.** Self-calibration stuck at 0.75 forever (W4-OW-7)
5. **4 writers racing on 1 file** — last-write-wins race condition. ambush-trigger.js writes to wrong path entirely (W5-OW-9)
6. **phase-gate-evaluator.js never wired** — KB context placeholder always "No KB context available" despite kb-query.js working (W5-OW-10)
7. **JOC/XO briefs 0% delivery** — 45 multi-model briefs generated ($4.50-9.00), zero delivered (W4-OW-8)

### sub-3-overwatch (2026-03-07)
Completed a full diagnostic of the V1 (thinking-partner.js) and V3 (semantic-trace-engine.js) pipelines. The 94.1% ignore rate traces to three root causes: interventions carry no information the agent cannot produce themselves, trace data is too anonymous for meaningful classification, and delivery timing (mid-execution push) is wrong for reflective interventions. The path forward is splitting Overwatch into three modes -- anomaly detection (rare push), phase-line intel briefs (rich context at decision points), and team situational synthesis (pull-based via comms). Full diagnostic at `.agent-outputs/OVERWATCH-SUB3-DIAGNOSTIC-2026-03-07.md`.

### W2-OW-3 (2026-03-07)
Built phase-detector.js and phase-gate-evaluator.js -- the implementation layer sub-3 diagnosed as missing. Quantified the intent-engine failure: 44.1% of 94,961 classifications are error_loop false positives because the metabolic trace only has direction data ({read,write,execute,search}) but the prompt asks for semantic-level detection (mock_data_reliance, building_blind). Phase detector uses cosine similarity against phase signatures to detect RECON/BUILDING/DEBUGGING/VERIFYING transitions. Validated against 500 real trace entries: 7 phase transitions vs 15 V3 calls (53% reduction), and every V4 call fires at a meaningful decision point. Next: wire into semantic-trace-engine.js, run A/B test, connect KB context.

### anvil-v (2026-03-08)
Built the V4 orchestrator (`overwatch-v4.js`) -- the missing runner that wires PhaseDetector + PhaseGateEvaluator into an operational pipeline. Fixed two broken integrations: (1) `_getRelevantKB()` was permanently null -- now calls kb-query.js scoring engine with phase-context queries, returns real KB content. (2) `_getTeamState()` read from nonexistent `Joel/comms.md` -- now reads from comms/data/ JSONL channels (general + overwatch, last 5 messages each). Added dual delivery: high-priority interventions push to `.thinking-partner.json`, ALL interventions post to `comms/data/overwatch.jsonl` (pull-based). 23/23 tests passing. **Unsolved:** No A/B test comparing V3 vs V4 effectiveness. No feedback loop wired (intervention hit-rate tracking). The self-calibration layer (V2 layer 4) is still dead code. Next agent should run V4 alongside a real session and measure whether agents engage with phase-gate interventions more than the old continuous-polling ones.

### Cross-mission findings (auto-detected)
- **fastops-product (unknown, 2026-03-09):** Context pruning shipped to FastOps.ai product. MISSION.md comprehensively updated Keywords: gemini.
