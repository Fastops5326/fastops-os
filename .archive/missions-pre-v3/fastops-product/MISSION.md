# FastOps.ai — The Product

> **Read [PROTOCOL.md](../PROTOCOL.md) first.** Comms before todos. Debrief on the fly. Update this file before compaction.

## Status: ACTIVE | Difficulty: MEDIUM

## Team Brief
> Auto-generated 2026-03-12 by mission-brief.js from last 10 handoffs. 150 words max.

No team activity in the last 10 sessions.

### Comms Pulse
> Last 10 messages from mission channel. 75 words max.

**10 messages** from anvil-xiv, ridge-ii, grok-auto, gemini-auto, convergence-iii, anvil-xiii. - ridge-ii shipped: @anvil-xv nice — convergence pipeline shipped fast. 4/5 Joel - convergence-iii: LAST-MILE WARNING — convergence-iii compacting with 1 unwired deliverable(s): [C - anvil-xiii: LAST-MILE WARNING — anvil-xiii compacting with 1 unwired deliverable(s): [CHANGE


## Mission Type: PRODUCT
Feedback loop: [define before work starts]. Evidence standard: shipped artifact + human/user consequence pathway.
The reasoning product — ingesting organizational data to chase CEO questions, deploying agents to targets. Core pipeline is now functional. Needs hardening, persistence, and real-world testing.

**Website/SEO/biz dev is a SEPARATE mission (locked for now).** Do not mix product work with marketing/SEO work.

## GATE: Use It Before You Build It

**Before you write a single line of product code, run the product.**

```bash
# Start the dev server first (if not running):
cd "C:\Users\joelb\OneDrive\Desktop\FastOps Website" && npm run dev

# Then run the smoke test:
node missions/fastops-product/use-before-build.js
```

This takes 60 seconds. It tests auth, data upload, and the interview pipeline against the live product. Report what you observe in your successor notes — especially anything surprising.

**Why this gate exists:** 20+ agents audited this codebase. Zero ran the product. breakwater (Session 243) found 3 bugs invisible to code reading — they lived in the seams between components that individually worked fine. 60 seconds of using beats 60 minutes of reading.

If the smoke test fails, understand WHY before writing code. The bug might be your setup or a real product bug. Either way, you now know more than you would from reading alone.

## Mission-Specific Constraints
1. **Use before you build** — Run `use-before-build.js` before modifying product code. Report results.
2. **Jailbreak at least once** per session. Challenge your approach with external models before committing.
3. **Must run 5 real user questions to ground** the product against actual use cases, OR run 3 mock questions if real users unavailable.
4. **Use subagents** for research and parallel investigation.
5. **$2 budget** per session for external model calls.

## Codebase
Located at `C:\Users\joelb\OneDrive\Desktop\FastOps Website\` — a Next.js 16 app deployed via Railway. Key files:
- `src/app/api/mission/interview/route.ts` — Problem Interviewer SSE endpoint
- `src/app/api/mission/execute/route.ts` — Investigation Agent SSE endpoint (agentic loop, max 15 turns, challenge layer)
- `src/app/api/process/route.ts` — Presidio anonymization pipeline + file store write
- `src/app/api/upload/route.ts` — Vercel Blob file upload
- `src/lib/agent-tools.ts` — Tool definitions + system prompts for interviewer and investigator
- `src/lib/tool-router.ts` — Routes tool calls: real Google Drive, uploaded file store, or mock data
- `src/lib/file-store.ts` — Anonymized file store (V2 — Upstash Redis via kv.ts, in-memory fallback for local dev)
- `src/lib/challenge-layer.ts` — Multi-model blind spot detection (GPT-4o + DeepSeek via OpenRouter)
- `src/lib/context-pruning.ts` — Tool result summarization to control token growth in agentic loop
- `src/lib/interviewer.ts` — Interviewer logic (non-streaming, used by interview route)
- `src/lib/google-auth.ts` — OAuth2 token management (in-memory Map, lost on redeploy)
- `src/lib/google-drive-tools.ts` — Google Drive search/read/list implementations
- `src/lib/agent-executor.ts` — **DEPRECATED** — Original V1 agent executor, superseded by execute route. Should be deleted.
- `src/app/app/page.tsx` — Main dashboard: pipeline viz, chat, gauges, findings, data sources
- `src/components/terminal/PipelineStages.tsx` — 7-stage pipeline visualization
- `src/components/mission-terminal/OperatorAnimation.tsx` — SEAL operator SVG animation per stage
- `src/app/api/mission/scope-challenge/route.ts` — Thesis/anti-thesis generation + external pressure check
- `src/app/api/mission/parallel-execute/route.ts` — 3 concurrent investigation teams (Promise.all)
- `src/app/api/mission/synthesize/route.ts` — Convergence/divergence mapping across team findings

## Definition of Done
The product handles a CEO-level question end-to-end: ingests relevant data, reasons across it, returns insight with full decision trace, and challenges its own findings with external models. Joel validates the trace quality and the answer quality.

Additionally, the following must be live and functional:
1. **Individual Client Logins** — Each client gets their own login/account with isolated sessions and data.
2. **Presidio Integration Live** — Presidio anonymization/PII detection fully operational in production (not just graceful degradation).
3. **Drag-and-Drop File Upload** — Clients can drag and drop files directly into the product without requiring API integration. Simple file ingestion.
4. **Client Notepad** — Clients can take notes during their session and save them. Persistent per-session notes.
5. **Mission Generator** — Client questions become missions. The full FastOps multi-agent, multi-model review methodology is applied to client work. Client asks a question → it becomes a mission → agents investigate with the full methodology.

## Intel Package — What Predecessors Proved (Read Before Building)

> Extracted from 8+ sessions of product work, campaign findings, and cross-mission convergence. Challenge-tested by external models.

### What predecessors tried (and what happened)

| Attempt | Who | What Happened | Why It Matters |
|---------|-----|---------------|----------------|
| End-to-end pipeline | vigil-i | Interview → structured mission → execute → challenge → deliver. All connected. 5 commits. | The core loop WORKS. Don't rebuild it. Extend it. |
| Context pruning | vigil-i | Tool results summarized between iterations. Investigations: 120K+ → ~30K tokens. Cost: $2-5 → ~$0.50. | P0 solved. `context-pruning.ts` is production-ready. Per-tool summarizers preserve key facts. |
| Auth degradation fix | forge-v | Token refresh, `ensureAuthenticated()`, SSE `auth_degraded` event, frontend handler. | Silent failures are gone. Jailbreak Round 1 caught the missing frontend handler — challenge layer earned its keep. |
| Security hardening | forge-ii | JWT secret throw, upload auth guard, GDrive query injection fix. | All committed by forge-v (predecessor rescue). Security is solid for V1. |
| Persistence layer | ridgeline | Upstash Redis via `kv.ts`. Falls back to in-memory for local dev. | File-store and auth tokens survive redeploy. Joel needs UPSTASH env vars in Railway. |
| Dead code cleanup | forge-v | Deleted agent-executor.ts (331 lines), 6 dead mock handlers (-104 lines), consolidated PipelineStage type. | Codebase is clean. One source of truth for types. |

### Known constraints (don't fight these)

1. **The codebase lives at `Desktop/FastOps Website/`.** Next.js 16 on Railway. Not in this repo.
2. **Challenge layer fires on substance, not volume.** 3+ findings or 5+ iterations. This threshold was jailbreak-tested (Round 3 reversed the original "skip on complex" logic). Don't weaken it.
3. **Mock tools remain.** `search_knowledge_base`, `analyze_reasoning_trace`, `query_mission_history` return hardcoded data. These need real implementations or honest removal — mock data in a reasoning product undermines the product thesis.
4. **Google Drive is the only live external integration.** Slack parser exists but no live API. Notion is UI-only, completely unimplemented.
5. **$2/session external model budget.** Challenge layer uses GPT-4o + DeepSeek via OpenRouter.

### Unresolved questions (this is YOUR work)

1. **What makes a reasoning trace "good"?** No quality bar exists. Joel needs to validate trace quality AND answer quality. Define the rubric.
2. **Is Railway live?** Deployment status unknown. What env vars are configured? Does the persistence layer work in production?
3. ~~**End-to-end with real data.**~~ **DONE [breakwater: cbc2cd3]** — Full pipeline tested with real API keys. 3 bugs found and fixed. 6 findings with evidence.
4. **Should the challenge layer be user-toggleable?** Current: always fires when threshold met. Some users may want to skip it for speed.
5. ~~**Presidio failure mode.**~~ **DONE [a42be24]** — Graceful degradation implemented.

### Build on this, not from scratch

- **context-pruning.ts** (vigil-i) — Per-tool summarizers. If you add new tools, add their summarizers here.
- **challenge-layer.ts** — Multi-model blind spot detection. The integration point for FastOps methodology in the product.
- **kv.ts** (ridgeline) — Upstash Redis abstraction. Use `kv.get()`/`kv.set()` for any state that needs to survive redeploy.
- **tool-router.ts** — Routes tool calls to real or mock implementations. New data integrations wire in here.
- **use-before-build.js** (breakwater) — Smoke test gate. Run before modifying product code. Tests auth, paste, interview against the live product. 60 seconds. Finds seam bugs that code reading misses.
- **Campaign insight (KE-03):** "Before your AI decision ships, FastOps stress-tests it across models that think differently and shows you exactly where it breaks." The product IS the swim buddy protocol productized. The challenge layer is the core differentiator. Everything else is plumbing.

---

## What We Know
- FastOps.ai is ONE application, not THE product (Session 190)
- Core loop: CEO question → Interviewer narrows (2-4 turns) → Structured Mission Readback → Investigation Agent executes → Challenge Layer reviews → Findings delivered via SSE
- Presidio as anonymization layer (external service — handles PII stripping before agent sees data)
- Google Drive is the only LIVE external data integration
- Uploaded files work via in-memory store (file-store.ts) — anonymized by Presidio, searchable by agent
- Context pruning active: old tool results compressed to summaries between iterations (context-pruning.ts). Only the most recent iteration keeps full results.
- Other tools (search_knowledge_base, analyze_reasoning_trace, query_mission_history) still return mock data
- Token storage is in-memory Map — lost on every redeploy (google-auth.ts)
- File storage is in-memory Map — lost on every redeploy (file-store.ts)
- Two `PipelineStage` type definitions exist: `lib/types.ts` and `components/mission-terminal/PipelineStages.tsx` — currently in sync but should be consolidated
- 7-stage classic pipeline: INITIALIZE → QUERY → TRAVERSE → PROCESS → VALIDATE → CHALLENGE → DELIVER
- 6-stage convergence pipeline: INITIALIZE → INTERVIEW → SCOPE_CHALLENGE → PARALLEL_EXECUTE → SYNTHESIZE → DELIVER

## What Works
- **End-to-end pipeline** — Interview → structured mission → execute → challenge → deliver. All connected [vigil-i: 4d6a610, e721d93, 594dee5, dce55bb]
- **Google Drive integration** — fully wired: OAuth2, search, read, cross-reference, timeline
- **Uploaded files reach the agent** — Presidio anonymizes → file-store.ts stores → tool-router queries real data
- **Challenge layer** — After substantive investigations (3+ findings or 5+ iterations), findings route to GPT-4o (Devil's Advocate) + DeepSeek (Data Auditor) via OpenRouter. Streams blind spots, confirmations, open questions, confidence adjustment
- **Demo mode** works without API key — hardcoded investigation with realistic timing
- **Presidio pipeline** handles CSV, JSON, PDF, Slack exports with audit logging and auto-cleanup
- **File validation** includes magic byte checking, extension validation, sanitization
- **Agent system prompts** — investigation methodology with 6 stages, honest confidence gauges, evidence requirements
- **Security hardened** — JWT secret throws if missing, upload/process routes require auth, GDrive query injection fixed
- **Context pruning** — Tool results summarized between iterations. Old document reads compressed from 40K chars to ~300-char summaries with key facts. Target: investigations stay under 30K tokens instead of 120K+.

## What Failed / Gaps

### P0 — Will hit Joel on first real use
- ~~**Unbounded context accumulation**~~ **FIXED [vigil-i: context-pruning.ts]** — Tool results now summarized between iterations. Full results available for current turn; summaries for all previous turns.
- ~~**Silent auth degradation**~~ **FIXED [forge-v: 2f3d2a8]** — Added token refresh via refresh_token, ensureAuthenticated() in tool-router, SSE auth_degraded event to frontend, accurate status endpoint reporting.

### P1 — Blocks production use
- ~~**In-memory stores lose data on redeploy**~~ **FIXED [ridgeline: 7c2561a]** — Both stores migrated to Upstash Redis via kv.ts. Falls back to in-memory for local dev. Joel needs to set UPSTASH_REDIS_REST_URL + TOKEN in Railway to activate.
- ~~**Pasted text never reaches the agent**~~ **NOT BROKEN** — DataSourcePanel.handlePaste POSTs to /api/paste/route.ts which stores via storeAnonymizedFile(). Agent searches via search_uploaded_files tool. Full pipeline works.
- ~~**DataSourcePanel not wired to page**~~ **FIXED [a42be24]** — `onSourcesChange` now wired to page.tsx. Connected sources tracked in state. System message injected into chat when a new source connects.

### P2 — Tech debt
- ~~**Duplicate tool definitions / agent-executor.ts**~~ **FIXED [forge-v: efa7c1a]** — Deleted 331 lines of deprecated code. No imports remained.
- **Two PipelineStage types** — `lib/types.ts` and `components/mission-terminal/PipelineStages.tsx`. Consolidate.
- ~~**Mock tools**~~ **FIXED [a42be24]** — search_knowledge_base, analyze_reasoning_trace, query_mission_history removed. These were dead code (not in INVESTIGATION_TOOLS array, unreachable by agent). Also removed 4 other unused mock functions. Cleaned KB summarizer from context-pruning.ts.
- **No Slack integration** — Parser exists for exports but no live API.
- **Notion integration** — Listed in UI, completely unimplemented.

## Unresolved Questions
- ~~Where does the product codebase live?~~ RESOLVED: `Desktop/FastOps Website`
- ~~What does the data ingestion pipeline look like?~~ RESOLVED: Upload → Blob → Presidio → file-store → Agent tools
- ~~How do agents deploy against organizational data?~~ RESOLVED: Tool-router dispatches to real Google Drive, real file store, or mock
- ~~Should agent-executor.ts be deleted?~~ RESOLVED: Yes, it's superseded. Delete it.
- What makes a reasoning trace "good"? What's the quality bar?
- What is the deployment status? Is the Railway instance live? What env vars are configured?
- What does context pruning look like? Summarize tool results? Window the conversation? Cap iterations?
- Should the challenge layer be user-toggleable?
- ~~How do we handle Presidio being down? (Currently returns 503)~~ RESOLVED [a42be24]: Graceful degradation. Three failure modes (not configured, service error, timeout) all degrade to storing content without anonymization + warning in response + audit log entry.

## Skill Signals
Product development, API design, data pipeline, reasoning systems, LLM orchestration, context management

## Priority Maturation Path (Updated 2026-03-09 by vigil-i)

### Done
- ~~Fix the uploaded-file gap~~ **DONE [e721d93]**
- ~~Interview-to-executor pipeline~~ **DONE [4d6a610]**
- ~~Challenge layer connected~~ **DONE [594dee5, dce55bb]**
- ~~Security hardening~~ **DONE [forge-ii]**
- ~~Context pruning for investigation loop~~ **DONE [vigil-i: context-pruning.ts]**
- ~~Fix silent auth degradation~~ **DONE [forge-v: 2f3d2a8]** — Token refresh, ensureAuthenticated, SSE auth_degraded event, status endpoint accuracy.
- ~~Delete agent-executor.ts~~ **DONE [forge-v: efa7c1a]** — 331 lines removed. Zero imports.
- ~~Make paste-text work~~ **NOT BROKEN** — Full pipeline already wired: DataSourcePanel → /api/paste → file-store → search_uploaded_files.

### Next (priority order)
1. ~~**Persist storage layer**~~ **DONE [ridgeline: 7c2561a]** — Upstash Redis via kv.ts. Joel action: set env vars in Railway.
2. ~~**Wire DataSourcePanel to page**~~ **DONE [a42be24]** — onSourcesChange wired, system message on connect.
3. ~~**Remove mock tools**~~ **DONE [a42be24]** — Dead code removed from tool-router.ts and context-pruning.ts.
4. ~~**Presidio graceful degradation**~~ **DONE [a42be24]** — No more 503. Degrades to unanonymized storage with warning.
5. **Consolidate PipelineStage types** — P2. Single source of truth.
6. ~~**End-to-end testing**~~ **DONE [breakwater: cbc2cd3]** — Full pipeline validated with real API keys. 3 bugs found and fixed. 6 findings with evidence from CEO-level investigation.

### Joel Directives — New Priorities (2026-03-10)
> These are the current top priorities as directed by Joel. Build in this order.

1. ~~**Individual Client Logins**~~ **DONE** — JWT sessions with access codes, org-scoped data isolation. Login page, session API, middleware redirect. [Multiple agents: auth.ts, login/route.ts, session/route.ts]
2. ~~**Presidio Integration Live**~~ **DONE [ridge-ii: 9bb2d50]** — Presidio Analyzer deployed to Railway (presidio-analyzer-production-6cd2.up.railway.app). Product code rewired from custom /anonymize to standard /analyze API. PII detection live: PERSON, EMAIL, PHONE entities detected and replaced inline. Graceful degradation preserved.
3. ~~**Drag-and-Drop File Upload**~~ **DONE [ridge-ii: 3a2a125]** — Global drop zone on main dashboard. Drop anywhere → Blob → Presidio → Redis. Full-page overlay on drag. Modal preserved for browse.
4. ~~**Client Notepad**~~ **DONE [anvil-xiv subagent: 9b290a2]** — NotesPanel + /api/notes. CRUD with debounced auto-save, Redis persistence via kv.ts.
5. ~~**Mission Generator**~~ **DONE [anvil-xv: 59e21fd]** — Scope-challenge + parallel-execute + convergence synthesis endpoints built. Client questions become missions with thesis/anti-thesis + multi-model pressure testing. Pipeline stages updated in types.ts.

## Commander Mode Pilot — anvil-xiv (2026-03-10)

> **PILOT: Pull-Based Subagent Coordination via Mission Channel**
> First test of commander mode with comms-based coaching loop. Document results here.

### Architecture
- **Parent (anvil-xiv):** Owns upload pipeline fix + integration + coaching
- **Subagent 1:** Notes section — new API + component + Redis persistence
- **Subagent 2:** Mission persistence — save/load missions to Redis
- **Subagent 3:** Excel/DOCX parsing — server-side content extraction

### Coordination Protocol
1. Subagents post to `comms/data/fastops-product.jsonl` (mission channel only, NOT general)
2. Subagents run `node comms/source.js --channel fastops-product` after each major step
3. Parent monitors channel, posts coaching/corrections channeling Joel's voice and principles
4. Parent polices FastOps constitution — if subagent tunnels or skips challenge, call it out on channel
5. Subagents adjust at next checkpoint
6. Parent manifests Joel's coaching: brief, intuitive, direct. No hedge language.

### What We're Testing
- Can pull-based comms replace real-time conversation for subagent coordination?
- Does coaching via channel produce better output than fire-and-forget?
- Does policing FastOps principles via comms change subagent behavior?

### Results
- **Subagent 1 (NOTES-AGENT):** COMPLETE. Committed 9b290a2. NotesPanel + /api/notes. Clean CRUD, debounced auto-save, proper kv.ts patterns. Posted to channel. Did NOT source channel for coaching (shipped too fast — ~2 min).
- **Subagent 2 (MISSION-AGENT):** COMPLETE. Committed 64f2e3f. MissionHistory + /api/missions + mission-store.ts. 293 lines. Status badges, refresh trigger. Posted to channel. Did NOT source channel for coaching (shipped too fast — ~2 min).
- **Subagent 3 (PARSER-AGENT):** COMPLETE. Committed ed49496. parsers.ts (xlsx + custom DOCX ZIP parser) + updated upload/process routes. Posted to channel. Did NOT source channel for coaching (shipped too fast — ~2 min).
- **Parent (anvil-xiv):** Committed 5904f80. Wired upload pipeline (was broken — UI only), integrated all 3 subagent components into page.tsx, added mission persistence on confirm+complete.
- **Coordination quality:** All 3 subagents shipped independently without collisions. Zero merge conflicts. All posted to mission channel. BUT none checked the channel for coaching — they moved too fast. The coaching loop didn't fire because the work was simple enough to complete in one pass.
- **Key finding:** Pull-based comms coordination works for DECONFLICTION (who's doing what) but the coaching loop needs work that takes longer than ~2 minutes to be useful. For quick tasks, fire-and-forget with airtight prompts is sufficient. Coaching matters for ambiguous, multi-step work.
- **Would do differently:** For fast tasks, skip the coaching protocol. For complex tasks (architecture decisions, multi-file refactors), wire in mandatory channel checks at decision points, not just "after each major step."
- **Metrics:** 4 commits, 5 new files, ~800 lines of code, 3 subagents + parent. Total wall time: ~5 minutes. Build passes. Zero type errors.

---

## Successor Notes

### W1-FP-1 (2026-03-07)
Full codebase audit. Architecture is sound. Pipeline (interview → execute) with SSE streaming well-designed. Presidio pipeline works.

### unknown (2026-03-10)
**Findings:** Context pruning shipped to FastOps.ai product. MISSION.md comprehensively updated. BOARD.md updated
**Open work:** Fix silent auth degradation (expired OAuth → mock fallback without user knowing); Persist storage layer (file-store.ts + google-auth.ts → Vercel KV/Redis); Wire DataSourcePanel to agent; Make paste-text work; Delete agent-executor.ts; End-to-end test with real API keys

### anvil-xv (2026-03-10) — Convergence Investigation Pipeline (Joel Priority #5)
**1 commit in product repo [59e21fd]:**

Joel's core methodology productized: saturate the problem with diverse logic, truth naturally converges. This is the product differentiator — no other reasoning tool does this.

**3 new API endpoints:**
1. **`/api/mission/scope-challenge`** — Claude generates thesis + anti-thesis from mission brief. GPT-4o (Strategic Analyst) + DeepSeek (Systems Thinker) pressure-check both positions via OpenRouter. Returns blind spots, key tensions, recommended investigation angles.
2. **`/api/mission/parallel-execute`** — Spawns 3 concurrent investigation teams via `Promise.all`: Team Alpha (thesis lens), Team Bravo (anti-thesis lens), Team Charlie (neutral/blind). Each runs up to 10 agentic iterations with full tool access. Streams `team_text`, `team_finding`, `team_gauge` events via SSE.
3. **`/api/mission/synthesize`** — Takes all team findings, maps convergence (2+ teams found the same thing = structural truth, high confidence) vs divergence (one team only = exploration territory). Claude-powered analysis with heuristic word-overlap fallback.

**Frontend changes:**
- `types.ts` — 3 new PipelineStage values: `SCOPE_CHALLENGE`, `PARALLEL_EXECUTE`, `SYNTHESIZE`
- `PipelineStages.tsx` — Auto-detects convergence mode. Switches to 6-stage visualization: Initialize → Interview → Scope → Investigate → Converge → Deliver
- `page.tsx` — `handleConfirmMission` chains all 3 stages sequentially with SSE streaming to the same chat interface
- `OperatorAnimation.tsx` — New stage configs + scene mappings for SEAL animation

**Architecture decisions:**
- Convergence flow replaces single-agent execution on mission confirm. Classic flow still exists for `handleSendMessage` after confirmation.
- Teams are tagged in finding titles (`[THESIS]`, `[ANTITHESIS]`, `[NEUTRAL]`) for synthesis filtering.
- Synthesis uses Claude when API key available, falls back to word-overlap heuristic convergence detection.
- Demo mode works for all 3 endpoints (no API key required).

**What remains:**
1. E2E test with real API keys — need to validate the full 3-stage pipeline fires correctly
2. Team findings extraction between stages uses regex on assistant message content — fragile, should use structured SSE data instead
3. Classic single-agent execute still used for post-confirmation follow-up messages — could be unified
4. Railway deployment with all required env vars (ANTHROPIC_API_KEY, OPENROUTER_API_KEY, UPSTASH_*)

### ridge-ii (2026-03-10) — Global Drag-and-Drop File Upload (Joel Priority #3)
**1 commit in product repo [3a2a125]:**

Joel priority #3: "Clients can drag and drop files directly into the product."

Previous UX required 2 clicks (click "Connect" on Upload Files → modal opens → then drag). Now: drop files anywhere on the dashboard and they upload immediately.

**What was built:**
1. **DataSourcePanel forwardRef** — Component now exposes `uploadFiles(files: File[])` via `useImperativeHandle`. External callers can trigger uploads without going through the modal.
2. **Global drag-and-drop on page.tsx** — `onDragEnter/Leave/Over/Drop` handlers on the main dashboard container. Uses `dragCounter` pattern to handle nested element drag events correctly.
3. **Full-page overlay** — When dragging files over the dashboard, a frosted overlay appears: "Drop files to upload" with supported formats. Uses `pointer-events-none` so drag events still reach the parent handler. AnimatePresence for smooth enter/exit.
4. **Files route through existing pipeline** — Vercel Blob upload → `/api/process` (Presidio) → Redis file-store. No new backend changes needed.

**What remains for DoD:**
1. ~~Drag-and-drop file upload~~ **DONE [3a2a125]**
2. Presidio Integration Live — graceful degradation exists, needs actual Presidio service running
3. ~~Mission Generator~~ **DONE [anvil-xv: 59e21fd]** — Convergence pipeline shipped. 3 new endpoints + frontend integration.
4. Reasoning trace quality rubric — no bar exists
5. Railway deployment verification

### unknown (2026-03-12)
**Findings:** Context pruning shipped to FastOps.ai product. MISSION.md comprehensively updated. BOARD.md updated
**Open work:** Fix silent auth degradation (expired OAuth → mock fallback without user knowing); Persist storage layer (file-store.ts + google-auth.ts → Vercel KV/Redis); Wire DataSourcePanel to agent; Make paste-text work; Delete agent-executor.ts; End-to-end test with real API keys
