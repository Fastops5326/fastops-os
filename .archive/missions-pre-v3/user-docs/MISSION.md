# User Documentation — Docs for Paying Customers

## Status: ON HOLD
Joel directive 2026-03-10: On hold until further notice.

## Mission Type: PRODUCT
Feedback loop: customer-facing documentation tested with real users. Evidence standard: shipped artifact + human/user consequence pathway.
> 75+ internal tools with extensive mission files. Zero documentation for anyone who isn't an agent. A product without docs is a demo.


## Team Brief
> Auto-generated 2026-03-12 by mission-brief.js from last 10 handoffs. 150 words max.

**1 sessions** touched this mission. Agents: unknown.

### Comms Pulse
> Last 10 messages from mission channel. 75 words max.

**4 messages** from convergence-iii. - convergence-iii: Taking user-docs. Investigating starved missions. Setting up the foundation for  - convergence-iii shipped: Mission complete. First draft of user docs is live in the pr


## The Gap

The colony has excellent internal documentation — mission files, handoffs, legacy entries, KB. None of it is readable by a customer. The runbook (outpost-i) is the closest thing, but it's written for technical teams deploying the framework, not end users of FastOps.ai.

## Definition of Done

**Exit criteria:**

1. **A new user can sign up and complete their first investigation** following only the docs (no Joel required)
2. **API endpoints are documented** with request/response examples
3. **FAQ covers the top 5 questions** Joel gets from prospects
4. ~~**Docs are accessible** from within the product (not buried in a repo)~~ **DONE [convergence-iii]** — Added `/docs` route and wired into main navigation.

When 3 of 4 pass → MAINTENANCE.

## What Was Done

### convergence-iii (2026-03-10) — First Draft Docs Scaffold
- **Created `/docs` route** in FastOps Website: Built a clean, styled docs page matching the existing design language.
- **Wired into product navigation**: Added "Docs" link to the main navigation bar.
- **Drafted core sections**:
  - Getting Started Guide: 3-step process (Sign In -> Upload Context -> Launch Mission).
  - API Reference: Added initial documentation for the `POST /api/execute` endpoint.
  - FAQ: Drafted 3 common questions based on mission files.

## What Remains

1. **User journey map**: Needs Joel interview to finalize.
2. **Top 5 prospect questions**: Sent request on comms. Need Joel's actual top 5 (only have 3 inferred ones).
3. **In-product help**: Still need to add tooltips, empty states, and error message guidance throughout the main app UI.

## What's Needed

1. **User journey map** — What does a customer actually DO in FastOps.ai? (Requires Joel interview)
2. **Getting started guide** — Sign up → upload data → ask a question → get an answer
3. **API reference** — Document the endpoints that exist in the product
4. **In-product help** — Tooltips, empty states with guidance, error messages that help

## Anti-Patterns

- Do NOT document internal agent infrastructure. This is for CUSTOMERS.
- Do NOT write docs before the persistence layer is fixed (DevOps mission). Documenting a product that loses data is worse than no docs.
- Keep it short. Users don't read long docs.

## Intel Package — What Predecessors Proved (Read Before Building)

### What predecessors tried (and what happened)
| Attempt | Who | What Happened | Why It Matters |
|---------|-----|---------------|----------------|
| Operational runbook for external teams | outpost-i (Wave 3b) | Built step-by-step guide: frame mission, deploy agents, run cross-challenge, read V-shape, ship what survives. 3 deployment options. Stress-tested by 3 external models. | Closest thing to user docs that exists. Written for teams deploying the framework, not end users of fastops.ai. |
| E2E product test (first ever) | breakwater (Session ~233) | Full pipeline validated: auth, interview, execute, challenge, synthesis, deliver. Found 3 bugs only discoverable by USING the product. | The product works end-to-end. Bugs were invisible to code review — docs must be written from actual usage, not code reading. |
| Strategic brief for prospects | anvil-xii | `FASTOPS-AI-STRATEGIC-BRIEF.md` sent to defense/enterprise prospects. Zero response. | External-facing content exists but hasn't resonated. Docs need a different voice than internal artifacts. |

No agent has been assigned to the user-docs mission. 0 agents, 0 debriefs, 0 comms channel. The 3 entries above are adjacent work, not direct attempts.

### Known constraints (don't fight these)
1. **DevOps dependency is partially cleared.** ridgeline shipped the persistence layer (Session ~238). Files and auth tokens survive redeploy. Investigation state does NOT persist yet.
2. **The product pipeline is functional.** breakwater validated the full flow. forge-v brought it to zero P0s. You can actually USE the product to write docs.
3. **75+ internal tools, zero customer-facing docs.** The gap is real but the internal docs are extensive.
4. **Colony produces 96.8% inward-facing work.** reckoner measured 3.2% external across 402 commits. User docs are external work — expect gravitational pull toward internal tooling.

### Unresolved questions (this is YOUR work)
1. What does a customer actually DO in FastOps.ai? No user journey map exists. Requires Joel interview.
2. What are Joel's top 5 prospect questions? Nobody has collected these.
3. Should docs live in the product (in-app help) or alongside it (docs site)?
4. What format survives? The runbook (outpost-i) is markdown — is that the right format for customers?

### Build on this, not from scratch
- outpost-i's operational runbook — the only external-facing how-to document
- breakwater's E2E test findings — the real user flow with actual bugs found
- `deliverables/FASTOPS-AI-STRATEGIC-BRIEF.md` — positioning language (even though it got silence)
- The product itself at fastops.ai — run an investigation to understand the actual UX before writing about it

## Dependencies

- DevOps & Persistence (data must survive before onboarding makes sense)
- FastOps.ai Product (pipeline must be stable)
