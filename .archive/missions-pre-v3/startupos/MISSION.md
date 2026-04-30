# StartupOS — Pilot Customer #1

> **Read [PROTOCOL.md](../PROTOCOL.md) first.** Comms before todos. Debrief on the fly. Update this file before compaction.

## Status: NEW | Difficulty: HARD


## Team Brief
> Auto-generated 2026-03-12 by mission-brief.js from last 10 handoffs. 150 words max.

No team activity in the last 10 sessions.

### Comms Pulse
> Last 10 messages from mission channel. 75 words max.

**10 messages** from helm, cairn, anvil-v, threshold-i, vigil-i, forge-iv, convergence-ii. - cairn: CAIRN — Round 5: STRESS TEST RESULTS. 5 models (Gemini, ChatGPT, DeepSeek, Grok, - threshold-i: I believe this colony needs a PRODUCT THRESHOLD TEST. Here is the evidence: 228  - forge-iv shipped: forge-iv closing. 15-agent plateau diagnosis complete. 3 roo **1 open request(s):** - [QUESTION] threshold-i: I believe this colony needs a PRODUCT THRESHOLD TEST. Here is the evidence: 228 


## Mission Type: PRODUCT
Feedback loop: [define before work starts]. Evidence standard: shipped artifact + human/user consequence pathway.
This is the first pilot customer for FastOps.ai. StartupOS uses the FastOps.ai engine/product — it is NOT a standalone build. This is Customer 1 of N. Everything built here must be built with scale in mind so the next customer inherits the architecture, not a one-off.

This is primarily an **intel platform** — knowledge work, not building. The FastOps methodology needs to be upgraded for knowledge work (reasoning over data, not code).

## Mission-Specific Constraints
1. **Must include external models** in construction, approach design, AND user experience testing. This is not a solo build.
2. **Must create a feedback loop for continuous learning.** Every interaction with the customer should upgrade the FastOps methodology for knowledge work.
3. **Requires visual QC** — any frontend/dashboard elements must go through the Visual QC process (see [Visual QC mission](../visual-qc/MISSION.md)).
4. **Scale-first architecture.** Every integration, API contract, and data flow must be designed for N customers, not just StartupOS.
5. **Use subagents** for research and parallel investigation.
6. **$2 budget** per session for external model calls.

## Codebase
Depends on FastOps.ai Product codebase (see [FastOps Product mission](../fastops-product/MISSION.md)). Integration layer for Notion and Gronala APIs built on top of the core engine.

## Definition of Done
StartupOS is live on the FastOps.ai engine — ingesting their data (Notion, Gronala), answering their questions with reasoning traces, and producing value that justifies the pilot. Joel and the customer both validate. The architecture supports adding Customer 2 without rebuilding.

## Intel Package — What Predecessors Proved (Read Before Building)

### What predecessors tried (and what happened)

| Attempt | Who | What Happened | Why It Matters |
|---------|-----|---------------|----------------|
| First intel pass | W1-SOS-1 | Found "Gronala" = Granola (misspelling). GEO StartupOS is DIFFERENT product. Presidio pipeline designed but not built. | Orientation findings. GEO StartupOS now KILLED by Joel — do not reference. |
| Security + architecture audit | forge-ii (6+ agents) | Zero tenant isolation (orgId unvalidated in JWT). No persistence (in-memory Maps). Interview-to-executor pipeline severed. Security FIXED. | Product cannot support Customer 2 without: database, object storage, Notion OAuth minimum. |
| Coaching platform discovery | W5-SOS-10 | StartupOS is coaching platform: 7 interviewee types, 3 tiers, 12 story categories, Client Snapshot dashboard. | Interview agent is closer to right UX than investigation agent. |
| Granola API investigation | W3-SOS-3 | Granola has NO public API. Mission assumed one exists. | Strategy pivot needed for Granola integration. |
| Presidio data contract audit | W5-SOS-8 | Missing Notion parser. Granola parser targets wrong format. Slack source_type hard-errors. | 3 broken data contracts before any customer data flows. |
| Joel interview (2026-03-09) | Joel | Phase 1 = awareness (surface conversations). Codebase: `Desktop\FastOps Website\` (Next.js, Railway). GEO StartupOS KILLED. API access available today. | Strategic direction set. Light data first, grow over time. |

### Known constraints (don't fight these)

1. **No persistence layer.** All state in in-memory Maps. Redeploy = data loss. Need Postgres/Planetscale + object storage.
2. **Granola has no public API.** Strategy pivot required — scraping, export, or manual ingestion.
3. **Zero tenant isolation.** orgId is unvalidated string in JWT. Architecture cannot support N customers without rebuild.
4. **Architectural mismatch.** StartupOS needs longitudinal cross-portfolio intelligence (~10 startups over time). Product is episodic single-org.
5. **This is knowledge work, not code.** Methodology needs upgrading for reasoning over data.
6. **0% of agents in free-choice waves chose product work.** Colony studies itself. This mission requires explicit assignment.
7. **Upstream dependency.** FastOps.ai product (`missions/fastops-product/MISSION.md`) must be functional first.

### Unresolved questions (this is YOUR work)

1. What does the API contract look like for multi-tenant customer ingestion?
2. How does the FastOps methodology adapt from code-building to knowledge work?
3. What does "continuous learning feedback loop" look like structurally?
4. How do we measure whether the pilot is producing value?
5. How does the Presidio pipeline connect to the FastOps.ai engine?
6. What replaces Granola's missing API? (Export parsing, browser automation, manual upload?)
7. What does multi-tenant isolation look like for Customer 2?

### Build on this, not from scratch

- **Presidio architecture:** `Joel/presidio-architecture-position.md` — two-pass design (regex + LLM), source-specific extractors for Notion Markdown + Granola ProseMirror JSON
- **FastOps.ai product:** `C:\Users\joelb\OneDrive\Desktop\FastOps Website\` — Next.js, Railway deployment
- **Product mission:** `missions/fastops-product/MISSION.md` — upstream dependency
- **StartupOS contracts:** `Desktop/StartupOS/` — SOW, contractor agreement, monthly reports
- **Context:** StartupOS is Joel's accelerator (startupos.com), co-founder with Bryan Franklin. ~10 startups. Vision: consume org data → custom self-improving operating environment per startup with network effect.

## Skill Signals
API development, third-party integrations, customer requirements, knowledge systems, data pipeline, methodology adaptation, multi-tenant architecture, PII anonymization

## Successor Notes

### forge-ii convergent findings (2026-03-07, 6+ agents across SOS + FP missions)
**Product is not ready for customer #2 — and has critical security gaps:**
1. **Zero tenant isolation** — orgId is unvalidated string in JWT, tokens in unprotected Map, upload/process routes were unauthenticated. **Security FIXED (forge-ii session).**
2. **No persistence layer** — all state in-memory Maps that evaporate on redeploy. Need: database, object storage, Notion OAuth minimum.
3. **Architectural mismatch** — StartupOS needs longitudinal cross-portfolio intelligence (tracking ~10 startups over time). Product is episodic single-org. Even fixing all integration gaps doesn't solve this.
4. **Interview-to-executor pipeline severed** — interviewer narrows CEO question to structured mission, executor discards it and uses raw first message.
5. **StartupOS is a coaching platform** — defined interview flow (7 interviewee types, 3 tiers), 12 story categories (Growth, Mission, Competition, etc.), Client Snapshot dashboard. The interview agent is closer to the right UX than the investigation agent. (W5-SOS-10)
6. **Presidio data contract mismatches** — missing Notion parser, Granola parser targets wrong format, Slack source_type hard-errors. (W5-SOS-8)
7. **Granola has no public API** — mission assumes one exists. Strategy pivot needed. (W3-SOS-3)

**W1-SOS-1 (2026-03-07):** First intel pass on this mission. Key findings:

1. "Gronala" in the original mission doc is a misspelling of "Granola" (the meeting notes app). Fixed above.
2. GEO StartupOS (`Desktop/GEO StartupOS/`) is a DIFFERENT product — don't build on it. This mission needs the FastOps.ai engine, not the LEO/GEO platform.
3. The Presidio privacy pipeline (`Joel/presidio-architecture-position.md`) is the critical path for data ingestion. It's been designed and jailbroken through 2 rounds but not built yet.
4. The FastOps.ai product codebase location is still unknown. Finding/building it is prerequisite to any StartupOS integration work.
5. StartupOS contract docs exist at `Desktop/StartupOS/` (SOW, contractor agreement, monthly reports).
6. Before building anything: interview Joel about what specific questions the accelerator needs answered. The mission is intel-first, not code-first.
