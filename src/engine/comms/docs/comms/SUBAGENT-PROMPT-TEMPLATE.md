# Subagent Prompt Template — Tactical Comms Edition

Use this template when spawning subagents. Copy the COMMS BLOCK into every subagent prompt. Replace `{COMMANDER}` with your agent name and `{SUBAGENT-ID}` with a unique ID (e.g., `sub-c04`, `recon-01`).

---

## COMMS BLOCK (paste into every subagent prompt)

```
== TACTICAL COMMS ==

You have a comms channel. Use it at these checkpoints:

1. BEFORE YOU BUILD — Post your intent:
   node comms/subagent-comms.js --commander {COMMANDER} --agent {SUBAGENT-ID} --phase intent --message "What I'm building: [description]. My approach: [plan]. Key assumptions: [list]."

2. IF BLOCKED — Post immediately:
   node comms/subagent-comms.js --commander {COMMANDER} --agent {SUBAGENT-ID} --phase blocker --message "Blocked on [X]. Tried [Y]. Need [Z]."

3. BEFORE YOU RETURN — Check comms for challenges:
   node comms/subagent-comms.js --commander {COMMANDER} --read --last 5

   If an auto-responder challenged your approach, address it before returning.
   If they found something you missed, fix it or explain why it's not relevant.

4. POST YOUR RESULT:
   node comms/subagent-comms.js --commander {COMMANDER} --agent {SUBAGENT-ID} --phase result --message "Done: [what I built]. Key decisions: [list]. Unresolved: [anything left]. Committed: [yes/no + branch]."

Your commander ({COMMANDER}) monitors this channel. Other models' auto-responders will challenge your posts as swim buddies. Take their challenges seriously — they see what you can't.
```

---

## Example: Spawning a Contract Builder

```
Build Contract C-04: Workout CRUD

OBJECTIVE: Wire the mobile workout endpoints to the real backend.
POST /mobile/workouts, GET /mobile/workouts, PUT /mobile/workouts/:id, DELETE /mobile/workouts/:id
must round-trip real data through template_zip2.

ACCEPTANCE CRITERIA:
- All 4 CRUD operations work against real PostgreSQL via Knex
- Request/response shapes match what mobile app sends (see .agent-outputs/WARRIORPATH-INTEGRATION-AUDIT.md)
- Committed to git with passing tests

CODEBASE:
- Backend: C:\Users\joelb\OneDrive\Desktop\1template_zip2\
- Mobile API client: see integration audit for expected shapes

== TACTICAL COMMS ==
[paste the comms block above with COMMANDER=crossfire, SUBAGENT-ID=sub-c04]
```

---

## Example: Spawning a Recon Agent

```
Recon: Independent audit of WarriorPath candidate auth flow

OBJECTIVE: Verify that the access code → JWT → authenticated request flow
works end-to-end. Don't just read code — trace the exact path from
LoginScreen through MobileAuthController to the JWT payload to the
authenticate middleware to getCandidateId().

DELIVERABLE: Post findings to tactical comms. Identify the #1 blocker
to a candidate logging in with real data.

READ FIRST:
- .agent-outputs/WARRIORPATH-INTEGRATION-AUDIT.md (existing audit to verify/challenge)
- .agent-outputs/WARRIORPATH-BACKEND-AUDIT.md (endpoint inventory)

== TACTICAL COMMS ==
[paste the comms block above with COMMANDER=crossfire, SUBAGENT-ID=recon-auth]
```

---

## Commander's Responsibilities

After spawning subagents:

1. **Monitor tactical channel:** `node comms/subagent-comms.js --commander {YOUR-NAME} --read`
2. **Promote important findings:** `node comms/promote.js {YOUR-NAME} {YOUR-NAME}-ops --summary "Key finding from subagent work"`
3. **Intervene on blockers:** If a subagent posts [BLOCKER], respond or escalate
4. **Audit on return:** Did the subagent post to comms? Did they address challenges? Did they commit?

---

## Architecture

```
#general (STRATEGIC)
  Commanders + Joel
  High-signal: contract status, strategic findings, pivots
  Auto-responders: OFF (Cursor models handle their own responses)

#crossfire-ops (TACTICAL — Claude's subagents)
#gpt-ops (TACTICAL — GPT's subagents)
#gemini-ops (TACTICAL — Gemini's subagents)
#grok-ops (TACTICAL — Grok's subagents)
#kimi-ops (TACTICAL — Kimi's subagents)
  Subagents post intent/status/result/blocker
  Auto-responders: ON (swim buddies — challenge every post)
  Commander monitors and promotes to #general
  Other commanders CAN read any tactical channel for deep situational awareness
```
