# Phase Lines — Structured Reasoning Protocol

> Every session deepens the position. Every position gets defended. What survives is real.

---

## What This Is

Four phase lines that structure how you think through a problem. Not how you USE TOOLS — how you REASON. This works whether you're a solo agent on a focused task or a commander running 100 subagents.

All missions are multi-session. You are one wave in an ongoing assault. Your job is not to finish — it's to deepen the position and hand it off stronger than you received it.

## The Protocol

### Phase Line 1: COMMIT (Before You Build)

**What:** Form your opinion on the approach BEFORE writing any code. Write it down. Defend it.

```bash
# Read what your predecessor believed
node .fastops/phase-line.js read

# State YOUR position — what you will build and why
node .fastops/phase-line.js commit "Your specific claim about the approach" --confidence N

# Example:
node .fastops/phase-line.js commit "The comms system should use pull-based position boards, not push notifications, because agents ignore 94% of pushed messages" --confidence 8
```

**Why this matters:** An opinion stated before building costs nothing to change. An opinion discovered after 45 minutes of coding has sunk cost working against honest revision. State it now. Get challenged now.

**The gate:** If your predecessor left a position, you MUST either challenge it or build on it before stating your own. No blank-slate starts — engage with what came before.

**If you're a commander:** This is where you scope the assault. State what you believe the answer is, then design waves to confirm AND disconfirm it. Your position shapes the mission — making it explicit means your subagents can challenge it.

### Phase Line 2: JUSTIFY (After You Build)

**What:** You've built something. Now defend it. Run `/jailbreak` on your deliverable — not your thinking, your actual output. What you built must survive structured challenge.

```bash
# Record what you built and why
node .fastops/phase-line.js justify "What I built, why I believe it's correct, and the strongest argument against it" --confidence N
```

Then one of:
- **Run `/jailbreak`** — 3+ models attack your deliverable
- **Run `/horsepower`** — 5 models collaboratively stress-test
- **Engage a peer** — post your position on the mission channel and invite challenge

**After challenge, you MUST respond:**
- **Accommodate** — the challenge was right, revise your work
- **Run `/horsepower`** — you need help addressing the feedback
- **Reject with evidence** — explain specifically why the feedback doesn't apply

```bash
# After challenge response
node .fastops/phase-line.js defend "What changed (or didn't) and why" --confidence N
```

**The gate:** Your deliverable is not complete until you've responded to at least one challenge. Not "considered" — RESPONDED with a specific accommodation or rejection.

**If you're a commander:** This is post-Wave-2/3. Your subagents have prototyped and tested. Synthesize findings. What survived? What broke? Jailbreak the synthesis.

### Phase Line 3: VALIDATE (Inversion Test)

**What:** Find the failpoints in your own work. Not "what could theoretically go wrong" — "what WILL break and why." Then get external validation.

```bash
# State your failpoints
node .fastops/phase-line.js invert "Here are the failpoints I see in what I built: 1) ... 2) ... 3) ..."
```

Then run `/horsepower` with this specific framing:

> "Here is what I built. Here are the failpoints I think exist. Are these failpoints accurate? Are there other failpoints I'm not seeing? Or is the solution I've built the correct solution?"

**The test:** External models validate your failpoint assessment. Three outcomes:
1. **Your failpoints are confirmed** — you know exactly where to fix
2. **New failpoints surface** — you found your blind spots
3. **Models confirm the solution is solid** — your confidence should go UP

```bash
# After validation
node .fastops/phase-line.js validate "Failpoints confirmed/expanded/cleared. External models said X. Confidence moved from N to M." --confidence N
```

**If you're a commander:** State the problem and your solution's weaknesses to a fresh wave of agents. Do they arrive at your solution independently? If yes, structural confirmation. If no, you may have solved the wrong problem.

### Phase Line 4: SYNTHESIZE (Mission Update)

**What:** Update the mission with what you learned. Not a status report — a position update with confidence, external perspective, and remaining gaps.

```bash
# Synthesize and update
node .fastops/phase-line.js synthesize "What survived all three phase lines, what external perspective revealed, what gaps remain for the next agent"
```

**What goes into the mission file:**
1. **Position held** — with final confidence score
2. **What external challenge revealed** — specific shifts from jailbreak/horsepower/peer challenge
3. **Remaining gaps** — what the next agent should attack
4. **The unchallenged claim** — the specific position the next agent should either challenge or build on

**The gate:** No mission update without having completed Phase Lines 1-3. No handoff without a synthesized position.

**If you're a commander:** This is the transition plan. The next session's commander inherits your battle map — what waves confirmed, what they broke, and where the remaining uncertainty lives.

---

## How Phase Lines Connect Across Sessions

```
Session N, Phase Line 4:
  "Position: X at confidence 7. External challenge shifted Z. Gap: condition W."

Session N+1, Phase Line 1:
  "Your predecessor held position X at confidence 7. Challenge on Z. Gap: W.
   Do you agree? State YOUR position before building."
```

Each session's Phase Line 4 feeds the next session's Phase Line 1. The position gets progressively hardened or killed across sessions. What survives 5 sessions of this is structural truth.

---

## Phase Lines + Commander Mode

Commander mode amplifies the protocol with wave-based assault:

| Commander Wave | Maps To | What Happens |
|---------------|---------|-------------|
| Wave 1: Confirm/Disconfirm | Phase Line 1 | Half attack depth on current thinking, half attack the opposite. Commander gets assumption map. |
| Wave 2: Prototype | Phase Line 2 | 3 independent teams build different solutions. Commander compares. Convergence = signal. |
| Wave 3: Validate | Phase Line 3 | Fresh agents test prototypes. Real code, real failures. What breaks? |
| Wave 4: Synthesize | Phase Line 4 | Commander integrates all waves. Updates mission. Builds transition plan for next session. |

Commander mode is optional. The phase-line protocol works for solo agents. Commander mode is what you reach for when the problem needs 100 perspectives, not 1.

---

## Quick Reference

| Phase Line | When | Action | Gate |
|-----------|------|--------|------|
| 1: COMMIT | Before building | State position + confidence | Must engage predecessor's position |
| 2: JUSTIFY | After building | Jailbreak deliverable, respond to challenge | Must respond to 1+ challenge |
| 3: VALIDATE | After defending | Find failpoints, get external validation | Must run external validation |
| 4: SYNTHESIZE | Before handoff | Update mission with hardened position + gaps | Must complete PL 1-3 |

---

## The Math

V1 (no phase lines): 101 agents, 0 revisions, 0 confidence shifts.
V2 (defense required): 10 agents, 17 revisions, 9/10 confidence shifts.

The difference: structured commit→challenge→defend→revise with a gate that makes defense the cheapest path to completion. That's what this protocol is.

*Built from stress test V2 findings (anvil-iv, Session 229). Evidence: `.agent-outputs/STRESS-TEST-V2-COST-INVERSION-2026-03-08.md`*
