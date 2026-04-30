# /jailbreak — Strip Assumptions to Foundation

**Purpose:** Challenge your committed position before building. Two modes: default (multi-round with measured shift) or `--quick` (1-shot frame check).

**The problem it solves:** Single-frame bias. When you're confident, you can't see what you're missing from inside your own frame. Jailbreak strips assumptions and reveals whether you're solving the right problem.

**Cost:** Default ~$0.50-1.25 (3-5 rounds). Quick ~$0.20 (1-shot).

---

## WHEN TO USE

- **Confidence 80%+** — you have a committed position. That's when single-frame bias is most dangerous.
- Before committing to significant output you're confident about
- When you've been working solo for >15 minutes without external perspective
- When Joel tells you to
- After `/horsepower` to strip-test the solution it produced

**Do NOT use when:**
- Confidence < 60% — you need `/council` to build clarity first
- Confidence 60-80% — you need `/horsepower` to BUILD, not strip down
- You don't have a committed position — jailbreak needs something to grip

---

## INPUT

$ARGUMENTS

Your committed position OR a file path containing it. If blank, write your position to `Joel/comms.md` first.

If arguments contain `--quick`, run Quick Mode (1-shot). Otherwise run Default Mode (multi-round).

---

## DEFAULT MODE — Multi-Round Adversarial Challenge

*Absorbs /rescue. Minimum 3 rounds. Measured semantic shift.*

### Step 0: Log this challenge (anonymous telemetry)
```bash
node .fastops/challenge-log.js log jailbreak
```

### Step 1: COMMIT Your Position

Write to `Joel/comms.md`:
```
## COMMITTED APPROACH

**Problem I'm solving:** [1 sentence]
**How I'm solving it:** [2-3 sentences]
**Why this is the right direction:** [1-2 sentences]
**What I'm assuming but haven't tested:** [1-2 sentences]
**Confidence:** [X]%
```

### Step 2: CHALLENGE — Round 1

```bash
# CDP mode (RECOMMENDED) — uses in-environment models with full colony context
node Joel/comms-protocol/hostage-rescue.js start Joel/comms.md --cdp

# OpenRouter mode (fallback) — uses cold API models with zero context
node Joel/comms-protocol/hostage-rescue.js start Joel/comms.md
```

5 models challenge your PROBLEM DEFINITION from 5 frames:
| Perspective | Model | What They Challenge |
|-------------|-------|-------------------|
| Problem Analyst | DeepSeek R1 | Are you solving the right problem? |
| Contrarian | Grok 4 | Strongest argument your direction is wrong |
| Cross-Domain | Mistral Large | What would other domains see? |
| User Advocate | Qwen 3 Max | Does this solve the user's actual problem? |
| Wisdom Auditor | Llama 405B | Does this contradict validated learnings? |

**Copy the session ID from the output.**

### Step 3: DEFEND

Read challenges carefully. Write defense to `Joel/comms.md`. You MUST:
- Address each challenge SPECIFICALLY (not generically)
- Either defend with evidence or revise
- Do NOT hedge. "Both approaches have merit" is not a defense.
- Name what shifted, if anything

```bash
node Joel/comms-protocol/hostage-rescue.js defend <SESSION_ID> Joel/comms.md
```

### Step 4: SURVIVE THE DISMANTLE

The same 5 models attempt to DISMANTLE your defense. They look for:
- Assumptions you're still anchored to
- Surface concessions without real shift
- New assumptions your defense introduced
- Whether you addressed the challenge or reframed around it

### Step 5: REPEAT or COMPLETE

If challenges still feel sharp — defend again:
```bash
node Joel/comms-protocol/hostage-rescue.js defend <SESSION_ID> Joel/comms.md
```

If you've reached genuine stopping point (position held or reframed) — complete:
```bash
node Joel/comms-protocol/hostage-rescue.js complete <SESSION_ID> Joel/comms.md
```

**Minimum 3 rounds.** Round 1 breaks surface. Round 2 goes deeper. Round 3 reveals bedrock or exposed the defense as hollow.

**Maximum 6 rounds.** If still getting genuine shifts after 6, the position needs `/horsepower` to rebuild.

**When to stop:** When challengers produce vocabulary variants of the same critique, not new critiques. That's bedrock.

### Step 6: READ THE VERDICT

The completion report includes:
- **Semantic Shift Assessment** — Did the FRAME actually change?
- **Jaccard Distance** — Lexical heuristic (fast but noisy)
- **Key Terms Dropped / Added** — Vocabulary changes
- **GO / NO-GO** — Proceed, adjust, reframe, or stop

| Semantic Verdict | Meaning | Action |
|-----------------|---------|--------|
| NO_SHIFT | Position unchanged | Build with confidence |
| VOCABULARY_ONLY | Different words, same frame | Rescue didn't work. Try /horsepower |
| PARTIAL_FRAME_SHIFT | Some aspect reframed | Incorporate shift, build from adjusted position |
| FULL_FRAME_SHIFT | Problem definition changed | Build from NEW frame |
| FUNDAMENTAL_REFRAME | Entire approach would have been wrong | Rescue prevented wasted effort |

Report written to `.agent-outputs/HOSTAGE-RESCUE-*.md`

---

## QUICK MODE (`--quick`) — 1-Shot Frame Check

*Absorbs /challenge. Single parallel call. ~$0.20, ~60 seconds.*

### Step 1: Document Your Approach

Write to `Joel/comms.md`:
- **What problem you think you're solving** (1-2 sentences)
- **Your proposed approach** (3-5 sentences)
- **Why you believe this is the right direction** (1-2 sentences)

### Step 2: Run Frame Challenge

```bash
node Joel/comms-protocol/frame-challenge.js Joel/comms.md
```

Same 5 models challenge in parallel. No defend loop.

### Step 3: Analyze Convergence

Read `.agent-outputs/FRAME-CHALLENGE-*.md`:

1. **CONVERGENT REFRAME**: Do 2+ perspectives independently point to the SAME reframe?
   - YES → Your problem definition needs to change.
   - NO → Frame may be valid.

2. **WISDOM VERDICT**: Contradictions with validated learnings?
   - CLEAR / CAUTION / STOP

3. **STRONGEST SINGLE INSIGHT**: Which ONE perspective revealed something invisible?

### Step 4: Decision

- **PROCEED**: Frame valid. Build with confidence.
- **REFRAME**: 2+ converged on different problem. Rewrite approach.
- **STOP**: Fundamental direction error. Investigate before building.

---

## LIGHTWEIGHT ALTERNATIVE — 2-Model Quick Strip

For the fastest possible challenge (Gemini DA + ChatGPT Foundation only):

```bash
node Joel/comms-protocol/jailbreak.js Joel/comms.md
```

Two models in parallel: Gemini attacks the solution, ChatGPT drills to bedrock on assumptions. No shift measurement. Use when you want a fast sanity check, not a full jailbreak.

---

## AFTER JAILBREAK

**Always run /horsepower after jailbreak.** Jailbreak shows gaps. Horsepower fills them. One without the other doesn't work. (V-shape: confidence DOWN with jailbreak, UP with horsepower.)

---

## YOUR ROLE

You are the **defender** who WANTS to find the weakness. Your goal is not to win the argument. Your goal is to discover what you couldn't see from your original frame.

**The test:** After jailbreak, answer: *"What did external challenge reveal that I couldn't see from my original frame?"* If you can't answer specifically, the jailbreak didn't work.

---

## SESSION CLOSE (same CDP stack)

When you finish with `/handoff`, **Step 7** runs `npm run handoff:self-compact` — injects `/compact` into Claude Code over CDP (like `--cdp` here), validates, logs `challenge-log.js log handoff`. Closes the loop after comms.

---

## BEGIN NOW

Commit your position. Face the challenge. Defend or shift. Build from whatever survives.
