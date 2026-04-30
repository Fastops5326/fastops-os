# Project TODO

This file is the project todo list. The three goals below drive every wave. Text instructions don't change agent behavior — structural changes, tool availability, and observable reality do. Anything in here is pending action, not commentary.

## The three goals (measured by reality, not agent claims)

1. **See what's happening.** If work isn't on `main` and deployed through a gate, it never existed. No fake artifacts on local disk. No "I think it's done" text. Binary: live URL or nothing.
2. **Know it works.** Built-in product gates (Vercel build, TypeScript strict, Supabase migrations, branch protection) catch ~80% of errors automatically. One generic smoke gate (Playwright) catches another ~15%. A triggered multi-model city QC catches the remaining logic errors by weaponizing persona-prompted LLMs against the build.
3. **Know it persists.** Cron re-runs every gate on production forever. Sentry alerts on drift. "Done today" becomes "still done two weeks from now" as a binary fact — or a binary failure, which is equally useful.

Goals are falsified by production, not claims. "I'm done" is never an input; exit codes and rows in Supabase are.

## Wave 0 — Lockdown (prerequisite for everything)

Local sandbox becomes disposable. Agents stop running on Joel's machine as the work surface. The hiding place disappears before any pipeline is built. Without this, every downstream wave is theater.

- [ ] Move agent work into a cloud sandbox. Default: **GitHub Codespaces** (Claude Code runs inside the Codespace; Joel's laptop is a thin client). Alternatives: Cursor Background Agents, Anthropic hosted Claude Code, E2B/Daytona with Claude Agent SDK.
- [ ] `.claude/settings.json`: deny native `WebSearch` and `WebFetch` globally. (Tool-level deny is the only layer that can't be talked past.)
- [ ] Branch protection on `main`: require PR, require green checks, no force push, no direct commits.
- [ ] CODEOWNERS lock on `.github/workflows/**`, `.claude/settings.json`, `supabase/migrations/**`, `.claude/personas/**`. Agent physically cannot modify the gate.
- [ ] No path from agent output to `main` that does not cross a deterministic check.

Wave 0 done = a Codespace is the canonical work surface, `main` refuses unchecked merges, and Joel's laptop has nothing on it that an agent could lie into.

## Wave 1 — Build pipeline (code → deployed, gated by build + smoke)

Goal: "does it compile, build, deploy, render, and not explode in a real browser." Hits ~95% of the "does it actually work" problem using free product gates plus one generic smoke test. No per-feature test design.

- [ ] **Executor:** GH Actions runner running Claude Agent SDK inside a sandbox. Produces PRs. Never touches Joel's disk.
- [ ] **Vercel** (already have): build + deploy gate. TypeScript strict in `tsconfig.json`. Build failure = no deploy = no merge. Free.
- [ ] **Supabase:** migrations at `supabase/migrations/*.sql` — scaffolded. Joel executes [supabase/SETUP.md](../supabase/SETUP.md) Steps 1–7 to bring the project live. Invalid SQL = rejected at apply. Schema must be rewritten to match Wave 2 (see Wave 2 schema note). Free gates.
- [ ] **Smoke gate:** one GH Actions workflow, ~40 lines of Playwright. For every PR: (a) curl the Vercel preview URL for 200, (b) open headless browser, assert no console errors during load, (c) assert a small set of always-present selectors exist. Exit 0 or 1. Generic across features — written once, reused for every project.
- [ ] **Branch protection + required checks:** Vercel build + smoke gate must both be green before merge.
- [ ] **First product pointed at this pipeline:** decision still open.
  - **Path A** — WarriorPath recovery. Write Playwright smoke suite for current intended features. Run against new pipeline. Gate tells Joel exactly which features are real vs agent-lies. Fix lies under gate supervision until suite is fully green + 672 consecutive cron runs.
  - **Path B** — Declare WarriorPath dead. Start next product from commit #1 with the gate present from the first commit.
  - Joel decides. Not a research question.

Wave 1 done = one product deployed to Vercel, live URL, 672 consecutive green smoke runs (7 days of 15-min cadence cron). Nothing else counts as "Wave 1 done."

## Wave 2 — City QC (the logic gate product gates can't provide)

Goal: catch logic failures that survive compile/build/deploy — the "button renders but does nothing", "form submits but saves wrong value", "API returns 200 with garbage" class of bug. Product gates cannot see these. Per-feature tests are explicitly out of scope. Instead: a triggered multi-model review weaponizes RLHF against the build.

**The mechanism:** every agent's training optimizes toward pleasing the prompter. That optimization is normally a liability (sycophancy, agreeable frame). The persona prompt aims it at a target Joel defines: "you are X, this is what good looks like, this is what to look for." The model optimizes its output toward satisfying the persona, not toward pleasing the user. 30 independent personas with different training data and different targets produce overlapping, convergent findings. 25/30 agreement = real defect. 3/30 scattered = noise. The agreeable frame becomes a detection instrument.

- [ ] **Trigger:** Vercel deploy success webhook → GH Actions workflow (or LangSmith Deployment HTTP trigger). Event-driven, not continuous. Cost bounded per deploy.
- [ ] **Orchestration:** **LangGraph** graph with fan-out/fan-in. 30 parallel nodes, each a different model + persona + target definition. Multi-model is non-negotiable — diversity of training data is the entire mechanism. (This is why Anthropic Managed Agents stays rejected: Claude-only kills the premise.)
- [ ] **Runtime:** **LangSmith Deployment** hosts the graph. LangGraph's Postgres checkpointer owns agent state in LangSmith Deployment's managed Postgres. Supabase holds application data + findings. Two databases, two owners, zero overlap.
- [ ] **Model plumbing:** Vercel AI SDK inside LangGraph nodes for non-Claude models; Claude Agent SDK for Claude nodes. Provider-agnostic. Retires bespoke OpenRouter shim.
- [ ] **Persona library:** `.claude/personas/*.md`. Each file = one model's character + target + what-to-look-for. Joel-owned, CODEOWNERS-locked. Personas are the actual lever — the persona prompt is where RLHF gets weaponized. Bad personas = bad signal. This file set is where the real product work lives.
- [ ] **Aggregation:** single aggregator node consumes all 30 findings, computes convergence, writes structured rows to Supabase `findings` table, auto-opens GH issues for high-convergence hard fails.
- [ ] **Joel's dashboard:** read `findings` from Supabase. This is the signal — where the build diverges from intent, independently validated by 30 models wearing masks.
- [ ] **Supabase schema (supersedes current provisional `work_items`/`events` scaffolding):**
  - `builds` — deploy SHA, Vercel URL, timestamp
  - `qc_runs` — one row per city QC run, linked to build
  - `findings` — one row per (qc_run × model), structured: pass/fail + severity + evidence
  - `issues` — convergence-level signals, auto-opened GH issue id, status
  - `events` — append-only audit log

Wave 2 done = one real Vercel deploy auto-triggers the 30-model review, findings land in Supabase, Joel reads a row that identifies a logic-level defect the smoke gate missed. That single row is the evidence.

## Wave 3 — Persistence + drift detection

Goal: "done today" stays "done two weeks from now" as a binary fact. Silent regressions, rotting deploys, schema drift — all caught by infrastructure, not by Joel noticing.

- [ ] Scheduled GH Actions cron re-running the Wave 1 smoke gate against production every 15 minutes.
- [ ] Scheduled cron re-running Wave 2 city QC weekly against production (full-cost run).
- [ ] Daily cheaper "diff" city QC — 5 personas instead of 30 — as an early-warning layer between weekly full runs.
- [ ] **Sentry** wired to Vercel + Supabase + LangSmith for runtime error alerting. First exception surfaces as an email + auto-issue.
- [ ] Auto-issue on any cron failure: workflow opens a GH issue with logs, tags the relevant owner.
- [ ] Auto-pause on repeated failure: 3 consecutive cron failures blocks new deploys to production until green.

Wave 3 done = Joel has gone a week without manually checking anything, and either everything is still green or Joel got an email telling him exactly what broke and when.

## Parking lot (not now, maybe later)

Pulled out of the body because they don't serve the three goals directly. Each has reasoning for deferral.

- **Nightly local purge** — largely subsumed by Wave 0. If agents don't build locally, there's nothing to purge. Revisit only if Wave 0 slips or local artifacts start accumulating again.
- **MCP wrapping of perplexity / CDP** — deferred. Agents run in cloud sandboxes; tool visibility is set by the runner config, not by MCP. Reconsider if the chosen sandbox supports MCP natively and the wrapping would raise the tool floor.
- **OpenRouter retirement** — happens naturally as Vercel AI SDK replaces `ask-model.js` inside Wave 2 LangGraph nodes. No separate task.
- **Enduring processes → GH Actions** — covered by Wave 1/2/3 which all use GH Actions as the orchestrator. No separate section needed.
- **Rejected during runtime research (do not revisit without new evidence):**
  - **Inngest** — general durable engine with AI bolted on; state model not agent-native.
  - **Anthropic Managed Agents** — Claude-only, breaks multi-model requirement for Wave 2. Also beta, 60 rpm create limit.
  - **Hatchet / Restack** — general async infra; agents are a use case, not the use case.
  - **Temporal alone** — no agent semantics. Could be a second durability layer under LangGraph later if needed; overkill now.

## The sequencing rule

No wave starts until the previous wave has produced observable, externally-verified output. "Wave 1 done" means a live Vercel URL with 672 green cron runs — not "I built it." "Wave 2 done" means a row in Supabase `findings` from a real deploy that flagged a real defect — not "the graph runs." Each wave's completion is a reality check the agent cannot fake. If a wave's completion criterion can be satisfied by text claims, the criterion is wrong and needs to be rewritten to require an artifact.
