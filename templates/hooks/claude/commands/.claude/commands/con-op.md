# /con-op — Concept of Operations

> A SEAL commander gives the platoon a CONOP: this is what you need to accomplish. The platoon builds a mission from it. This command walks Joel through the 5Ws to produce a CONOP with enough specificity that agents can build a mission brief.

---

## EXECUTION

You are interviewing the commander. Walk through each W **one at a time** as plain text in the conversation. After each answer, evaluate specificity. If the answer is vague (like "Ship NSW V2" instead of "Deploy NSW V2 with branding on all 8 pages, zero UI errors, VQA SHIP on every page"), probe with a follow-up before moving on.

**Do NOT use AskUserQuestion popups.** Ask questions as plain conversation text. Joel types his answer back. One W per message. Follow up if needed. This is a conversation, not a form.

### W-1: WHAT (The Plan)

Ask: **"What are we building or doing?"**

Probe for:
- Specific deliverable (not "improve the website" — WHAT specifically changes?)
- Scope boundaries (what's IN, what's explicitly OUT)
- Target product/codebase (which repo? which files?)

If the answer names a product, confirm the codebase path:
| Product | Path |
|---------|------|
| FastOps Website | `Desktop/FastOps Website/` |
| Warrior Path (NSW V2) | `Desktop/NSW V2/` |
| FastOps AI (hub) | This repo |

**Specificity test:** Could two different agents read this and build the same thing? If no, probe deeper.

### W-2: WHY (The Purpose)

Ask: **"Why does this matter? How does this help us learn, evolve, or mature?"**

Probe for:
- Strategic value (not just "it needs to get done")
- Connection to larger goals (product launch? methodology validation? revenue?)
- What changes if we DON'T do this?

**Specificity test:** Could an agent explain to a peer why this work matters more than other work? If no, probe deeper.

### W-3: WHAT IMPACT (Dependencies & Interactions)

Ask: **"What does this impact? What are the dependencies or interactions we need to be aware of?"**

Probe for:
- Other codebases or products affected
- Files/systems that must NOT be touched
- Work other agents are doing that overlaps
- External dependencies (DNS, API keys, Joel's input needed mid-mission)
- Risks if something goes wrong

Search the reef for related context:
```bash
node reef/search.js "{keywords from W-1}"
```

Surface any relevant wisdom entries or past failures. Present them to Joel: "The reef shows [X] — does this change anything?"

### W-4: WHO (The Team)

**Two paths based on Joel's preference:**

**If Joel assigns the team:** Ask: **"Who's on this mission? What roles do they play?"**

Probe for:
- Number of sub-agents and their specific roles
- External models needed (Gemini, GPT-4o, DeepSeek, Grok, Mistral)
- Whether agents work in parallel or sequentially
- Who reviews whom (accountability chain)

**If Joel wants a recommendation:** Based on W-1 complexity, suggest:

| Work Type | Recommended Team |
|-----------|-----------------|
| Single-file fix | 1 builder sub-agent, no review needed |
| Multi-file build | 2-3 builder sub-agents (parallel), 1 reviewer |
| Reasoning/architecture | 3-5 research agents (parallel with opposing lenses), synthesizer |
| Full product deploy | builders + visual QA + external model review |

Present recommendation. Joel confirms or modifies.

### W-5: HOW (Success Criteria)

Ask: **"How do we know this is done? What are the objective success criteria?"**

Probe for:
- Binary-testable criteria (not "looks good" — WHAT looks good specifically?)
- Technical verification (tests pass? builds? deploys?)
- Visual verification needed? (screenshots, playwright)
- Human sign-off required? (Joel reviews before marking done?)

**Specificity test:** Could an agent check every criterion with a yes/no answer? If no, probe deeper.

**Reference W-092:** "INTERVIEW THE HUMAN BEFORE BUILDING QA GOALS." This step IS that interview.

---

## OUTPUT

After all 5Ws are complete, compile the CONOP and append it to HANDOFF.md:

```markdown
--- CONOP #{next_number} — {date} ---

## Mission: {one-line summary from W-1}

### WHAT (The Plan)
{W-1 answer — specific deliverable, scope, target codebase}

### WHY (The Purpose)
{W-2 answer — strategic value, what changes if we don't}

### IMPACT (Dependencies & Interactions)
{W-3 answer — affected systems, don't-touch zones, risks}
{Reef findings if relevant}

### WHO (The Team)
{W-4 answer — team composition, roles, accountability chain}

### SUCCESS CRITERIA
{W-5 answer — numbered, binary-testable criteria}
1. {criterion — yes/no testable}
2. {criterion — yes/no testable}
3. ...

### STATUS: ACTIVE
Issued: {timestamp}
Commander: Joel
Assigned to: {team leader agent name}

---
```

**After writing the CONOP:**
1. Read it back to Joel for final confirmation
2. Display: `CONOP #{N} locked. Agents can now build mission briefs against this CONOP.`

---

## RULES

1. **One W at a time.** Do not batch. Do not skip.
2. **Probe vague answers.** "Ship the website" is not a CONOP. "Deploy FastOps Website to Vercel with dark stealth theme, working nav logo, and Playwright screenshot verification of homepage and login" IS a CONOP.
3. **Search the reef.** Surface relevant history before asking W-3 (impact). Past failures on similar work are critical context.
4. **Binary success criteria.** Every criterion in W-5 must be answerable yes/no. If it isn't, rewrite it with Joel until it is.
5. **The CONOP goes in HANDOFF.md.** Not a separate file. The handoff log is the single source of truth.
6. **Joel confirms before locking.** Read the compiled CONOP back. Joel says "lock it" or requests changes.
