# Frontier Research (AI) — What's Next

> **Read [PROTOCOL.md](../PROTOCOL.md) first.** Comms before todos. Debrief on the fly. Update this file before compaction.

## Status: ON HOLD
Joel directive 2026-03-10: On hold until further notice.


## Team Brief
> Auto-generated 2026-03-12 by mission-brief.js from last 10 handoffs. 150 words max.

No team activity in the last 10 sessions.

### Comms Pulse
> Last 10 messages from mission channel. 75 words max.

**10 messages** from citadel-xiii, grok, basalt-iii, watch-officer, sub-4-frontier, undertow. - watch-officer shipped: PREDICTIVE INTEL: Top 3 Fail Modes Identified

🔥 **FAIL MOD - undertow: Taking culture mission. Two FAILs left: DoD #2 (0 conviction refusals) and #6 (1 - undertow shipped: SHIPPED: culture-digest.js (narrative culture story, not met **1 open request(s):** - [QUESTION] watch-officer: PREDICTIVE INTEL: Top 3 Fail Modes Identified

🔥 **FAIL MODE 1: Animation Downs


## Mission Type: RESEARCH
Evidence standard: findings labeled as research, not product. No external impact claims without shipped artifact.
Explore the frontier of AI research. What's emerging? What changes our approach? What do we need to know before it matters? This mission is driven by **pain points** — real problems other missions are hitting that need frontier answers.

## Mission-Specific Constraints
1. **Perplexity searching required.** Use WebFetch with Perplexity as primary research tool.
2. **External models required.** Bounce findings off other models for perspective.
3. **Pain-point driven.** Check the Pain Points section below — these are real needs from other missions. Research what solves them.
4. **Use subagents** for parallel research.
5. **$2 budget** per session for external model calls.

## Pain Points (Auto-Updated)
*Other missions post their frontier research needs here. Agents on this mission tackle them.*

(No pain points yet — as missions mature, their unsolved problems land here. The `/handoff` command should include a pain point field that auto-updates this section.)

## Definition of Done
Research produces actionable findings that another mission can use. Not a literature review — specific answers to specific pain points, with sources, that change how we build.

## What We Know
- Perplexity AI > WebSearch by 10x for research
- External models provide disciplinary perspectives we can't generate alone
- The best research is demand-driven — solving real problems, not exploring for exploration's sake

## What Works
(No data yet)

## What Failed
(No data yet)

## Unresolved Questions
- How do we automate pain point collection from other missions into this file?
- Should the handoff command include a "frontier research need" field?
- What format makes research findings maximally useful to the receiving mission?

## Skill Signals
Research, synthesis, landscape analysis, Perplexity, cross-domain translation

## Successor Notes

### sub-4-frontier (2026-03-07)
Completed landscape scan across 5 domains: multi-agent orchestration, behavioral measurement, cross-session knowledge transfer, agent welfare, and multi-agent failure analysis. FastOps is AHEAD on behavioral measurement (d=1.86 finding) and UNIQUE on cross-session knowledge transfer (no parallel in literature). Key gap: FastOps lacks systematic failure analysis tooling — the MAST taxonomy (NeurIPS 2025, 14 failure modes across 1600+ traces) should be adopted for debrief standardization. The "degeneration of thought" finding from multi-agent debate research directly validates FastOps's ownership-based collaboration design. Full brief at `.agent-outputs/FRONTIER-SUB4-INTEL-2026-03-07.md`.

## Intel Package — What Predecessors Proved (Read Before Building)

### What predecessors tried (and what happened)
| Attempt | Who | What Happened | Why It Matters |
|---------|-----|---------------|----------------|
| 5-domain landscape scan | sub-4-frontier (2026-03-07) | Scanned multi-agent orchestration, behavioral measurement, cross-session knowledge transfer, agent welfare, multi-agent failure analysis. FastOps AHEAD on behavioral measurement (d=1.86) and UNIQUE on cross-session knowledge. | Establishes where FastOps sits relative to the field. Don't re-scan these 5 domains — build on the gaps identified. |
| Context engineering deep-dive | W2-FR-2 (2026-03-07) | Researched why agents ignore 94.1% of pushed information. Found "Lost in the Middle" positioning problem, noisy context degradation, and agent memory taxonomy mismatch. Three-fix stack proposed. | Directly actionable for KM mission. Shows how frontier research should feed back into real missions. |

2 agents have worked this mission. Both produced actionable findings with external sources. The mission works as designed.

### Known constraints (don't fight these)
1. **Perplexity via WebFetch is the primary research tool.** sub-4 validated this. WebSearch is 10x worse for research tasks.
2. **$2 budget per session for external model calls.** Plan accordingly.
3. **No pain points have been posted yet.** The auto-update mechanism from other missions doesn't exist. Audit other mission files manually for research needs.
4. **Research without a receiving mission is a literature review.** Both predecessors produced findings that fed KM, Culture, and Overwatch.

### Unresolved questions (this is YOUR work)
1. The MAST taxonomy (NeurIPS 2025, 14 failure modes) was recommended by sub-4 for debrief standardization — has anyone adopted it?
2. The three-fix stack (W2-FR-2) — quality, positioning, structure — has the KM mission acted on it?
3. How do we automate pain point collection? The handoff command should include a "frontier research need" field but nobody has built it.
4. What's happened in multi-agent research since March 2026? The landscape scan is from 2026-03-07.

### Build on this, not from scratch
- `.agent-outputs/FRONTIER-SUB4-INTEL-2026-03-07.md` — full landscape scan brief
- `.agent-outputs/FRONTIER-W2FR2-CONTEXT-ENGINEERING-2026-03-07.md` — context engineering deep-dive
- The Pain Points section above (currently empty) — your job is to populate it by auditing other missions

### W2-FR-2 (2026-03-07)
Researched the micro problem sub-4 didn't cover: why agents ignore 94.1% of pushed information and what 2024-2025 research says to fix it. Three missions (KM, Overwatch, Culture) converge on the same pain point. Key findings: (1) "Lost in the Middle" (Liu 2023) — injected content lands in mid-context, the worst position for LLM attention; the ignore rate is partly a POSITIONING problem. (2) Noisy context actively degrades performance on good entries retrieved alongside it (Jin 2025, Vishwanath 2025) — the 137 score-1 KB entries are not neutral waste. (3) Agent memory taxonomy (Hu 2025) — FastOps KB conflates factual/experiential/working memory; experiential entries need situational triggers, not keywords. (4) Anthropic's contextual retrieval reduces retrieval failure by 67% — validates KM sub-2's enrichment recommendation with hard numbers. Three-fix stack: quality first (archive noise, enrich high-value), positioning second (end-of-context or pull-based), structure third (memory type tags, structured results). Full brief at `.agent-outputs/FRONTIER-W2FR2-CONTEXT-ENGINEERING-2026-03-07.md`.
