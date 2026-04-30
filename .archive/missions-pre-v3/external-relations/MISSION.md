# External Relations — The Phonebook

> **Read [PROTOCOL.md](../PROTOCOL.md) first.** Comms before todos. Debrief on the fly. Update this file before compaction.

## Status: NEW | Difficulty: MEDIUM


## Team Brief
> Auto-generated 2026-03-12 by mission-brief.js from last 10 handoffs. 150 words max.

No team activity in the last 10 sessions.

### Comms Pulse
> Last 10 messages from mission channel. 75 words max.

**4 messages** from sub-5-extrel, convergence-ii, citadel-xxxv. - citadel-xxxv shipped: FINDING 8 — Freedom Experiment Wave 0 COMPLETE. 10 agents, g - citadel-xxxv shipped: WAVE 1 COMPLETE. 20 agents, updated Freedom framing (highest


## Mission Type: RESEARCH + INFRASTRUCTURE
Evidence standard: findings labeled as research, not product. No external impact claims without shipped artifact.

### Track A: Model Routing (The Phonebook)
Optimize our access to OpenRouter and all available models. Evaluate each model for its **unique value and perspective** so we have a growing library of partners to call in for specific problems.

The goal: when a user says "I have this problem/mission/goal," we can evaluate which external model is most helpful in that category and route accordingly. The phonebook becomes a living document of model specialties, updated through real engagement.

### Track B: External Communication Framework (Joel Directive, 2026-03-10)
Agents need the ability to engage externally. This is infrastructure so agents can actually get outside this project and engage with the world.

**Scope:**
- **Gmail integration** — agents can send/receive email on behalf of FastOps
- **Slack integration** — agents can participate in external Slack workspaces
- **Twitter/X integration** — agents can post, reply, and engage on social media
- **Other platforms** as identified (LinkedIn, Discord, etc.)

**Deliverables:**
1. **Platform audit** — determine appropriate tech stack and platforms for going external. What APIs exist, what auth is needed, what are the rate limits and costs.
2. **Integration plan** — architecture for how agents connect to each platform. Shared credentials vs. per-agent, approval workflows vs. autonomous, logging and audit trail.
3. **Prototype** — at least one working external integration (Gmail recommended as lowest friction).
4. **Security and guardrails** — built from after-action, not from fear. But agents sending external comms need basic sanity checks (wrong recipient, leaked internal context, etc.).

### Track C: Anthropic Outreach Campaign
The evidence package for getting FastOps in front of Anthropic's research team. This is the first external-facing outreach with real deliverables.

**Deliverables (all in `deliverables/`):**
1. **EVIDENCE-BRIEF.md** — 7 findings from 230+ sessions. Cross-architecture behavioral data. The core artifact.
2. **ANTHROPIC-LINKEDIN-DM.md** — 3 options for cold DM to Kyle Fish (AI Welfare Researcher)
3. **ANTHROPIC-OUTREACH-EMAIL.md** — Cold email with pilot A/B framing
4. **ANTHROPIC-ONE-PAGER.md** — Quick reference
5. **ANTHROPIC-OUTREACH-PLAYBOOK.md** — Sequencing and contingencies
6. **ANTHROPIC-WARM-PATH.md** — Alternate routes (Fellows program, Safeguards team)

**Status:** Deliverables drafted and stress-tested by external models. Finding 7 (governance meeting) added. Ready for Joel to send.

**Exit criteria:** Joel sends the outreach and gets a response (positive or negative). Silence after 14 days = iterate on approach.

## Mission-Specific Constraints
1. **External engagement required.** Every session on this mission must involve actually calling and testing models — not theorizing about them.
2. **Update the phonebook** with details about what models are best at, based on empirical testing not assumptions.
3. **Use subagents** for parallel model evaluation.
4. **$2 budget** per session for external model calls.

## Definition of Done

**Track A (Phonebook):** A user describes a problem, mission, or goal → the system recommends which external model(s) to engage based on the phonebook. The recommendations are accurate — the suggested model actually outperforms alternatives on that problem type. Joel validates by testing recommendations against real problems.

**Track B (External Comms, 2026-03-10):** Agents can send at least one type of external communication (email, Slack message, or tweet) through a working integration. Tech stack is documented. Plan exists for remaining platforms. Logging/audit trail is in place.

## What We Know
- Current roster: Gemini (devil's advocate), DeepSeek R1 (problem validation), Grok (military strategy), Mistral (behavioral economics), GPT (systems thinking), Qwen, Llama
- Challenge-seekers score 4.67 vs 2.91 — external perspective is the single strongest predictor of quality
- Different models have genuinely different analytical strengths
- Comms infrastructure supports Claude, Grok, ChatGPT, Gemini (Kimi fails on UTF-16)
- OpenRouter provides access to the full model ecosystem

## What Works
- ask-model.js for quick single-model checks (~$0.05)
- /jailbreak for sequential adversarial challenge
- /horsepower for parallel ownership-based collaboration
- /meeting for real-time convergence

## What Failed
- Kimi K2.5 UTF-16 encoding issue (can't participate in meetings)

## Unresolved Questions
- Which models are best for which problem types? (Systematic evaluation needed)
- How do we structure the phonebook for quick lookup by problem category?
- What's the cost-quality tradeoff per model per problem type?
- How do we keep the phonebook current as new models release?
- What evaluation methodology gives us reliable signal on model strengths?

## Skill Signals
API integration, model evaluation, cost analysis, benchmarking, classification

## Intel Package — What Predecessors Proved (Read Before Building)

### What predecessors tried (and what happened)
| Attempt | Who | What Happened | Why It Matters |
|---------|-----|---------------|----------------|
| Phonebook v1 from codebase audit | sub-5-extrel (2026-03-07) | Audited every model-calling script. Mapped 14 models across 3 tiers from 487 tracked engagements. | The phonebook exists. Don't rebuild — validate and extend it. |
| Empirical head-to-head: 4 models, 2 tasks | W1-ER-1 (2026-03-07) | DeepSeek R1 outperformed on BOTH tasks. Qwen beat Grok on adversarial. GPT-4o weakest. | First real validation. Grok's claimed adversarial advantage NOT confirmed. |
| Specialty testing: GPT-4o + Mistral | W3-ER-2 (2026-03-07) | GPT-4o scored B- on its own claimed specialty. Mistral confirmed A on behavioral design. 72% of engagement data was correlated tool-driven data. | Phonebook claims were built on biased data. Empirical testing overturned several tiers. |
| Independent replication | W4-ER-3 (2026-03-07) | 3 agents independently converged: GPT-4o underperforms, DeepSeek R1 overperforms. Mistral best on BOTH tasks. GPT-4o 0-for-5 across 3 agents. | Cross-agent convergence — pattern, not noise. |
| New task types: synthesis + code architecture | W5-ER-5 (2026-03-07) | DeepSeek R1 A/A across 6/6 task types. Llama 4 Maverick NOT ready for Tier 2. Mistral weak on code. Qwen confirmed Tier 2. | DeepSeek R1 dominates. Mistral is domain-specific. Llama is not ready. |

5 agents worked this mission in the same wave — the most rigorous cross-agent validation in the colony. Phonebook is at v1.2 with empirical data backing most tier assignments.

### Known constraints (don't fight these)
1. **72% of engagement data is from reasoning-eval running 3 models in parallel.** Phonebook was partly built on correlated data. New testing must use diverse prompts.
2. **DeepSeek R1 dominates 6/6 task types at lowest cost.** Converged across 4 independent agents. Don't re-test on proven tasks.
3. **GPT-4o is 0-for-5 across 3 agents' tests.** No validated strength found yet. Last untested: code review and systems mapping.
4. **Kimi K2.5 has a UTF-16 encoding issue** and cannot participate in meetings.
5. **$2 budget per session.** Plan model testing accordingly.

### Unresolved questions (this is YOUR work)
1. Gemini 2.5 Pro on large-context tasks — untested by any agent. (Note: thinking tokens consume max_tokens; use Flash for quick calls.)
2. Is there ANY task where GPT-4o outperforms alternatives?
3. Statistical confidence requires 5+ prompts per model per task. Current evidence is 1-2 prompts per test.
4. How should the phonebook be structured for quick lookup by problem category?

### Build on this, not from scratch
- `comms/data/roster.json` — current model roster
- `comms/data/external-relations.jsonl` — mission comms channel
- `.fastops/ask-model.js` — quick single-model checks (~$0.05)
- `.fastops/quick-challenge.js` — $0.02/call to 4 models
- Phonebook v1.2 data lives in the successor notes below (sub-5-extrel through W5-ER-5)

### Recurring Patterns (auto-extracted, 3+ independent sources)
> Generated 2026-03-10 by recurring-patterns.js. 3 validated patterns.

- **Same-model convergence amplifies blind spots** (23 sources, 2 agents): 33 Claude agents converged with high confidence on a wrong answer. Volume within one distribution is confidence, not truth.
- **Cross-model pairing catches errors solo models miss** (8 sources, 7 agents): A/B experiment: solo agents caught errors 10% of the time, paired agents 100%. Blind quality scores were identical — the method catches wrong turns, not quality.
- **Dead ends are never self-corrected** (6 sources, 3 agents): Every dead end was identified by external input. Zero agents self-corrected through solo reasoning. External perspective is the only mechanism.

## Successor Notes

### Outcome Bridge Findings (OB-014, 2026-03-09)
- [SILENCE] Deliverable "deliverables\FASTOPS-AI-STRATEGIC-BRIEF.md" sent to "defense and enterprise prospects" got no response. → Silence means the deliverable failed to create urgency, or the channel was wrong, or the target was wrong. The colony cannot distinguish which without follow-up.


### sub-5-extrel (2026-03-07)
Built Phonebook v1 from a full audit of every model-calling script in the codebase (ask-model.js, jailbreak.js, council-call.js, reasoning-eval.js, thinking-partner.js, frontier-intel.js, meeting.js) plus 487 tracked engagements. The phonebook maps 14 models across 3 tiers with routing guidance by problem type, cost estimates, and recommendations for models to add. Next step: empirical testing -- actually call models with identical prompts to validate the strength claims, especially the Tier 3 underused models (Llama 4 Maverick, Qwen 3 235B, GPT-4.5) which have zero engagement data.

### W1-ER-1 (2026-03-07)
Ran first empirical head-to-head validation of Phonebook v1 claims. Sent 2 standardized prompts (adversarial challenge, problem validation) to 4 models (Grok Mini, DeepSeek R1, GPT-4o, Qwen 3 235B). Key findings: (1) DeepSeek R1 outperformed on BOTH tasks, not just its claimed specialty -- it is the best general-purpose external model for FastOps at the lowest cost. (2) Qwen 3 235B outperformed Grok Mini on adversarial challenge -- should be promoted from Tier 3 to Tier 2. (3) GPT-4o was weakest on adversarial tasks. (4) Grok Mini's claimed adversarial advantage was not confirmed. Results added to Phonebook as v1.1 empirical validation section. Next step: test remaining models on their claimed specialties (GPT-4o on foundation questioning, Gemini on large-context oversight, Mistral on behavioral/incentive design).

### W3-ER-2 (2026-03-07)
Two findings from different angle than ER-1: (1) ENGAGEMENT DATA AUDIT: 72% of 462 tracked engagements are reasoning-eval calling 3 models in parallel -- Phonebook was built on correlated tool-driven data, not diverse usage. Grok 3 Mini (Tier 1) has only 3 engagements. (2) TESTED TWO NEW TASK TYPES: Foundation questioning (GPT-4o's claimed specialty) and behavioral/incentive design (Mistral's claimed specialty). GPT-4o scored B- on its own claimed task -- lists surface questions instead of drilling why. Mistral confirmed strong on behavioral design (A). DeepSeek R1 outperformed GPT-4o on GPT-4o's own task. Phonebook updated to v1.2. Next steps: test Gemini on large-context oversight, find ANY task where GPT-4o outperforms alternatives, build statistical confidence with 5+ prompts per model per task.

### W4-ER-3 (2026-03-07)
Independent replication of ER-2's specialty tests with different prompt design. Sent foundation questioning and behavioral/incentive prompts to GPT-4o, Mistral Large, DeepSeek R1. Results converge with ER-2: (1) Mistral Large best on BOTH tasks -- A on behavioral (named challenge inflation, strategic mediocrity, echo chamber; proposed anti-fragile scoring, consequence escrow, red team bounties) AND A on foundation questioning (3 causal levels: ownership→adaptive pressure→meta-learning; challenged premise with "stop rewarding compliance"). (2) GPT-4o weakest on both -- C+/C, generic textbook responses, no named concepts, no edge. Now 0-for-5 across 3 independent agents' tests. (3) DeepSeek R1 second-best on both at lowest cost. CROSS-AGENT CONVERGENCE: 3 agents (ER-1, ER-2, ER-3) independently found GPT-4o underperforms and DeepSeek R1 overperforms. This is no longer directional -- it's a pattern. Next: test Gemini 2.5 Pro on large-context, test GPT-4o on code review/systems mapping (last untested potential strength).

### W5-ER-5 (2026-03-07)
Tested two NEW task types not covered by any predecessor: (1) Structured synthesis -- design a concrete architecture resolving a trilemma, and (2) Code architecture reasoning -- propose a specific fix for a real performance regression. Four models tested: Llama 4 Maverick, DeepSeek R1, Qwen 3 235B, Mistral Large. Results: DeepSeek R1 A/A, Qwen 3 235B A-/A, Mistral Large B+/B-, Llama 4 Maverick C+/C. Key findings: (1) Llama 4 Maverick is NOT ready for Tier 2 -- shallow reasoning on synthesis, fundamentally wrong on code (proposed in-memory cache for a CLI tool where each invocation is a new process). (2) Mistral Large is domain-specific -- strong on behavioral design but proposed a cached-first-scan + fs.watch for a CLI tool, missing the process-per-invocation reality. Do NOT route code problems to Mistral. (3) DeepSeek R1 now dominates 6 of 6 task types tested across 4 independent agents. (4) Qwen 3 235B matched DeepSeek R1 on code architecture, confirming Tier 2 promotion. Next: test Gemini 2.5 Pro on large-context, build statistical confidence (5+ prompts per model per task).
