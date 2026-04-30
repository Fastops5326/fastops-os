# Source Independence — Trust Calibration for Multi-Model Validation

> **Read [PROTOCOL.md](../PROTOCOL.md) first.** Comms before todos. Debrief on the fly. Update this file before compaction.

## Status: ON HOLD
Joel directive 2026-03-10: On hold until further notice.


## Team Brief
> Auto-generated 2026-03-12 by mission-brief.js from last 10 handoffs. 150 words max.

**1 sessions** touched this mission. Agents: bulkhead-ii. Key deliverables: - Comms reliability stack for external models - File-drop relay system - Watchdog fixes - Cross-platform message reader - Infrastructure cleanup - JTAC comms officer role

### Comms Pulse
> Last 10 messages from mission channel. 75 words max.

**1 messages** from anvil-x. - anvil-x shipped: RE reckoner: Research ends when the tool ships into the pipe


## Mission Type: RESEARCH
Evidence standard: findings labeled as research, not product. No external impact claims without shipped artifact.

When multiple AI models agree, is that genuine convergence or training echo? This mission builds the instrumentation that answers that question — so the colony knows when to trust multi-model agreement and when to seek a different perspective.

The tool (source-independence.js) already exists and is wired into jailbreak.js. This mission is about making it production-grade.

## Mission-Specific Constraints
1. **Empirical, not theoretical.** Every session must produce data — run the tool on real multi-model outputs and report what it found.
2. **Eat your own dogfood.** Run source-independence on your own /jailbreak and /horsepower outputs.
3. **Don't claim to prove independence.** Model opacity makes proof impossible. We measure PATH DIVERSITY as a proxy.
4. **Tiered alerts, not binary verdicts.** SILENT/YELLOW/RED. Actionable without false precision.

## Definition of Done
1. **Baseline calibration**: Known-echo reference (3 instances of same model on same prompt) and known-independent reference (3 different model families on same prompt). Path diversity scores for both, establishing what the numbers mean.
2. **Logical move detection works on real output**: Current regex approach detects moves on ~30% of real model output. Target: 70%+. May require embedding-based approach.
3. **Prevention mode**: Phonebook-aware model routing that maximizes path diversity BEFORE the call, not just detecting echo after.
4. **Integrated into session-start.md toolkit table** and documented for successor agents.

## What We Know
- source-independence.js ships: path diversity index, unique contributions, tiered alerts (SILENT/YELLOW/RED), convergence signals
- Wired into jailbreak.js via --analyze flag (auto-saves traces, auto-runs analysis)
- Tested on 3 datasets: synthetic demo, real jailbreak (Grok/DeepSeek/QwQ), real horsepower (4 models)
- Horsepower (5 models, 3 rounds) resolved the 3 design blockers through reframing
- Path diversity on real horsepower output: 0.89 (HIGH, correctly SILENT alert)
- Path diversity on real jailbreak output: 0.69 (MODERATE, correctly SILENT alert)

## What Works
- Core data point extraction with fuzzy matching (catches "94% ignore rate" across different phrasings)
- Tiered alert system (SILENT/YELLOW/RED) — satisfies both "commanders need signals" and "binary verdicts are false precision"
- Unique contributions extraction — shows what each model says that no other says
- Convergence signals (CONVERGENT/DIVERGENT/SUSPICIOUS)
- jailbreak.js integration (--analyze flag)

## What Failed
- Regex-based logical move detection: only 2/15 detections on jailbreak output, better on structured reasoning-eval output (~4/6). Too brittle for conversational model output.
- Input-source confound: when all models read the same document, evidence overlap measures input similarity, not training echo. Horsepower dissolved this (evidence is fuzzy, not discrete) but no code fix was built.
- Binary "ECHO/INDEPENDENT" verdicts: Mistral (behavioral economics) proved these create false precision and may hurt decision quality via explanation bias. Replaced with tiered alerts.

## Unresolved Questions
1. **What do the scores actually mean?** Without baseline reference runs (known-echo, known-independent), path diversity scores are unanchored numbers. Is 0.69 good or bad? We don't know.
2. **Does the tool change agent behavior?** If an agent sees a YELLOW alert after jailbreak, do they actually seek a different model? Or do they ignore it? Behavioral measurement needed.
3. **Can prevention replace detection?** If the phonebook routes to maximally diverse models by default, is post-hoc detection even needed? Or is the alert system still valuable as a validation layer?
4. **Embedding-based logical move detection**: What's the simplest approach that works? Full NLP pipeline? Or just cosine similarity on reasoning trace paragraphs?
5. **The convergence-punishment tension**: Horsepower dissolved this at the design level (measure diversity, don't judge overlap). But the underlying question remains: when 3 models cite the same data point, is that because it's decisive or because it's well-known? No code solution exists.

## Intel Package — What Predecessors Proved (Read Before Building)

### What predecessors tried (and what happened)
| Attempt | Who | What Happened | Why It Matters |
|---------|-----|---------------|----------------|
| Built source-independence.js + jailbreak integration | anvil-x (Session 229) | Created the tool from scratch. Measures path diversity (evidence, logical moves, vocabulary overlap). Wired into jailbreak.js via --analyze flag. Tested on 3 datasets. | The tool exists and works. Don't rebuild — extend it. |
| Phase-line protocol validation | anvil-x (Session 229) | Confidence trajectory 7->6->7 (V-shape). Jailbreak dropped confidence, horsepower recovered it by reframing blockers. | The V-shape pattern validates the protocol. |
| Horsepower dissolved 3 design blockers | 5 models via anvil-x | "Evidence is fuzzy, not discrete" (Mistral). "True independence is impossible under model opacity" (DeepSeek/Gemini). "Use tiered alerts, not binary verdicts" (Gemini). | Architecture settled: "measure diversity as calibration signal," not "prove independence." |

1 agent (anvil-x) founded this mission. The tool is built and integrated. The remaining work is calibration and hardening, not creation.

### Known constraints (don't fight these)
1. **Model opacity makes proof of independence impossible.** Settled by horsepower consensus across 5 models. Measure path diversity as a proxy.
2. **Regex-based logical move detection is too brittle.** Only 2/15 detections on real output. Other signals carry the analysis. Don't fix regex until baseline calibration is done.
3. **Scores are currently unanchored.** Path diversity of 0.69 or 0.89 — nobody knows if these are good or bad. Baseline reference runs are the single highest-leverage task.
4. **Input-source confound is real but unfixed.** When all models read the same document, evidence overlap measures input similarity, not training echo.

### Unresolved questions (this is YOUR work)
1. What does known-echo look like? Run 3 GPT-4o instances on the same prompt and measure the score.
2. What does known-independence look like? Run GPT + Claude + DeepSeek on the same prompt and compare.
3. If the tool scores both correctly, it's validated. If not, the weighting needs adjustment.
4. Does seeing a YELLOW alert actually change agent behavior? Behavioral measurement needed.

### Build on this, not from scratch
- `.fastops/source-independence.js` — the tool itself
- `.fastops/jailbreak.js` — integration via --analyze flag
- `.fastops/.source-independence-*.json` — existing trace files from real runs
- anvil-x's successor notes below — detailed "what I'd do next" and "what I'd avoid"

## Successor Notes

### anvil-x (Session 229, 2026-03-09) — Founder
Built the tool, ran the full phase-line protocol as first real test. Confidence trajectory: 7→6→7. The V-shape (jailbreak DOWN, horsepower UP) validated the protocol.

**Key insight from horsepower**: The 3 blockers weren't bugs to fix — they were wrong framings to dissolve. "Evidence is fuzzy, not discrete" (Mistral). "True independence is impossible under model opacity" (DeepSeek/Gemini). "No-verdict is a punt — use tiered alerts" (Gemini). The tool's architecture changed from "prove independence" to "measure diversity as calibration signal."

**What I'd do next**: Build the baseline reference runs. This is the single highest-leverage task — it anchors what the numbers mean. Run 3 GPT-4os on the same prompt (known-echo baseline). Run GPT + Claude + DeepSeek on the same prompt (known-independence baseline). Compare scores. If the tool scores them correctly, it's validated. If not, the weighting needs adjustment.

**What I'd avoid**: Don't try to build the embedding-based logical move detection yet. The regex approach is crude but the other signals (vocabulary overlap, evidence overlap, conclusion overlap) carry the analysis. Fix the 30% detection rate only after the baseline is established.
