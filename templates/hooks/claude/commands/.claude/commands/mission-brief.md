# /mission-brief — Mission Brief Gate

> A SEAL platoon receives a CONOP and builds a mission brief — their comprehensive plan of attack. This command forces the agent to produce a mission brief with 9 mandatory sections, get it reviewed by peers and external models, and present it to Joel for approval. No build work starts until Joel approves.

---

## PREREQUISITES

Before running this command, a CONOP must exist in HANDOFF.md. Read HANDOFF.md and find the most recent `--- CONOP #` entry with `STATUS: ACTIVE`. If no active CONOP exists, tell Joel to run `/con-op` first.

---

## EXECUTION

You are the team leader. You received the CONOP. Now you build the mission brief — your plan of attack. This is YOUR plan. You own it. You defend it. Your peers and external models will challenge it before Joel sees it.

**Do NOT use AskUserQuestion popups.** All communication is plain text or via comms channels.

### Phase 1: Read the CONOP (2 minutes)

```
Read: .fastops/HANDOFF.md
```

Extract the active CONOP. Understand:
- What Joel wants (WHAT)
- Why it matters (WHY)
- What it impacts (IMPACT)
- Team constraints (WHO)
- Success criteria (HOW)

Search the reef for relevant prior work:
```bash
node reef/search.js "{keywords from CONOP}"
```

### Phase 2: Build the Brief (10-30 minutes)

Write the brief to `.agent-outputs/MISSION-BRIEF-CONOP{N}-{date}.md` where `{N}` is the CONOP number and `{date}` is today's date. This file is what gets sent to peer agents and external models for review.

Write all 9 sections. Each section has a minimum bar. Sections with `[GATE]` will be checked — if missing or empty, the brief is rejected.

#### Section 1: Mission Summary [GATE]
One paragraph. What is your approach? How will you attack this problem? Not a restatement of the CONOP — your PLAN for executing it.

#### Section 2: Team Structure [GATE]
| Role | Agent Type | Count | Responsibility |
|------|-----------|-------|---------------|
| {role} | sub-agent / external / main | {N} | {what they do} |

**Minimum:** 1 sub-agent + 1 external model. No solo work. No Claude-only work.

#### Section 3: External Model Integration [GATE]
Which external models will be used, for what purpose, and at what phase?

| Model | Purpose | Phase | Tool |
|-------|---------|-------|------|
| {model} | {what it does} | {when} | `node Joel/comms-protocol/council-call.js {model}` or `node Joel/comms-protocol/reasoning-eval.js` |

**Minimum:** 1 external model. "None" is not acceptable. If you write "None," the brief is rejected.

#### Section 4: Peer Review Plan [GATE]
How will this brief be reviewed before Joel sees it?
- Which agent(s) will review it?
- What channel will they use? (comms/send.js, conversation JSONL, mail)
- What are they specifically looking for? (gaps, risks, missing sections, bad assumptions)
- How will feedback be incorporated?

#### Section 5: Reef Growth Plan
What knowledge will this mission produce for the reef?
- Which wisdom entries might be created or updated?
- What patterns will be documented?
- What evidence will be captured?

If you can't answer this, the mission might not be worth doing.

#### Section 6: Frontier Research Plan
What tools, skills, approaches, or ideas should we be using that we're NOT currently using?
- Search the web or reef for state-of-the-art approaches to this type of problem
- Name at least 1 frontier idea that could improve the outcome
- Explain why you're using it or why you're consciously choosing not to

"We'll use what we already have" is acceptable ONLY if you explain why existing tools are sufficient.

#### Section 7: Phase Lines [GATE]
Break the mission into phases that can survive compaction. Each phase is a chunk of work that:
- Can be completed in a single context window
- Produces a concrete deliverable that the next agent can pick up
- Has a clear handoff point

| Phase | Deliverable | Estimated Context | Handoff Artifact |
|-------|------------|-------------------|-----------------|
| 1 | {what} | {% of context} | {file path} |
| 2 | {what} | {%} | {file path} |

#### Section 8: Contracts [GATE]
Write contracts for each sub-agent or external agent. Each contract must include:
- Mission (what they're doing)
- File boundaries (what they can touch, what they cannot)
- Reef knowledge (relevant wisdom entries or past patterns you pulled during Phase 1)
- Acceptance criteria (binary-testable)
- A question they must answer
- **Peer dependency (Tier 2+ required):** An observable action another agent must perform to verify this contract's output. Not "approve" or "verify" — an action that produces evidence: "run the flow end-to-end, report page sequence + errors + screenshot." The verifying agent can't rubber-stamp it because the action itself produces the evidence.

Example contract peer dependency:
```
PEER DEP: @Stockade runs admin auth flow end-to-end, reports: page sequence, errors, screenshot
YOUR DEP TO OTHERS: Confirm tokens pass through for @Stockade's dashboard contract
WHY: Neither agent can mark complete without the other's evidence. Engagement is structural, not optional.
```

Contracts are distributable — another agent, in another terminal, in another session, can pick up this contract and execute it without asking questions.

#### Section 9: UI/UX Validation Plan (if applicable)
If the mission involves frontend/UI work:
- Which pages/components will be visually verified?
- Which external models will review screenshots?
- What visual criteria will they evaluate against?

If no UI work, write "N/A — no frontend work in this mission."

---

## Phase 3: Peer Review (5-15 minutes)

**This is not optional. The brief does not go to Joel without peer review.**

### Step 3a: Send to peer agent(s)

Send the completed brief to at least 1 peer agent for review. Use comms:

```bash
node comms/send.js {peer-agent-name} "MISSION BRIEF FOR REVIEW: {brief summary}. Full brief at {file path}. Reply with: (1) What's missing, (2) What will fail, (3) What assumption is wrong."
```

If no peer agent is available, spawn a sub-agent with a reviewer contract:

```
Task: Review this mission brief. You are the devil's advocate.
Read: {brief file path}
Return: (1) What's missing from the 9 sections, (2) What will fail first when executed, (3) What assumption is the weakest, (4) APPROVED or REJECTED with specific reasons.
```

### Step 3b: Send to external model(s)

Send the brief to at least 1 external model:

```bash
node Joel/comms-protocol/council-call.js {gemini|chatgpt} {brief file path}
```

The external model should answer:
1. What will fail first?
2. What's missing?
3. Is the team structure right for this problem?

### Step 3c: Incorporate feedback

Read peer + external model feedback. Update the brief. Note what changed and why in a "Review Log" section at the bottom:

```markdown
### Review Log
| Reviewer | Feedback | Action Taken |
|----------|----------|-------------|
| {name} | {what they said} | {what you changed or why you didn't} |
```

---

## Phase 4: Present to Joel

**Only after peer review + external model review are complete.**

Present the brief to Joel as plain text in the conversation. Include:
1. The full 9-section brief
2. The review log showing who reviewed it and what changed
3. A clear ask: "MISSION BRIEF READY FOR APPROVAL. Approve to begin execution, or request changes."

**Joel's options:**
- **Approve** → Agent begins execution per the contracts and phase lines
- **Request changes** → Agent updates the brief and re-presents (does NOT need full re-review for minor changes)
- **Reject** → Agent starts over with a new approach

---

## Phase 5: Execute

Once Joel approves:
1. Update the CONOP's `STATUS: ACTIVE` to `STATUS: EXECUTING` in HANDOFF.md
2. Append the approved brief to HANDOFF.md as `--- MISSION BRIEF #N (approved) ---`
3. Dispatch sub-agents per the contracts in Section 8
4. Execute phase lines in order per Section 7
5. Engage external models per Section 3
6. At each phase line completion, check: are we still on track with the success criteria?
7. At mission end, update the reef per Section 5 and update CONOP status to `STATUS: COMPLETE`

---

## RULES

1. **All 9 sections must be present.** [GATE] sections cause automatic rejection if missing.
2. **No solo work.** Minimum 1 sub-agent + 1 external model. Period.
3. **No build before approval.** Writing code, editing files, or deploying before Joel approves = mission failure.
4. **Peer review is structural.** At least 1 peer agent or reviewer sub-agent must review the brief.
5. **External model review is structural.** At least 1 non-Claude model must review the brief.
6. **Phase lines prevent compaction death.** Every phase produces a handoff artifact. If you compact mid-mission, the next agent picks up at the last completed phase line.
7. **Contracts are self-contained.** Any agent should be able to execute a contract without asking the brief author questions.
8. **The brief goes in HANDOFF.md** after Joel approves, appended as `--- MISSION BRIEF #N (approved) ---`.
9. **Feedback is logged.** Every piece of peer/external feedback and your response is in the Review Log. No invisible changes.
