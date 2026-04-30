# /council — Sounding Board: Build Clarity When the Path Is Unclear

**What it does:** A live multi-model discussion with 4 participants. You chair. Gemini challenges. ChatGPT architects. Joel directs. This is a mini Frontier Resonance for when you need to think out loud with people who see differently.

**The problem it solves:** When the problem is hard to define, the solution is hard to see, and the directional path forward isn't clear. At low confidence (<60%), you don't need adversarial review (jailbreak) or large-scale building (Frontier Resonance) — you need a sounding board to build clarity on the problem, the solution, and the direction.

---

## When to Use

**Confidence: <60%.** The problem isn't clear enough to commit to a solution. You need to talk it through with others who see differently than you do.

**Do NOT use when:**
- Confidence 60-80% — you have enough clarity for /horsepower-v2 to build collaboratively
- Confidence 80-90% — you need /jailbreak to strip assumptions, not build clarity
- The problem is well-defined with clear unknowns — go straight to /horsepower-v2

**Use when:**
- The problem is hard to define
- The solution is hard to see
- The direction is not quite clear
- You need to build enough clarity to know what tool to use next

---

## Budget & Tracking

**$2 per session** for API calls. You can involve as many models as you'd like within budget. This is a lightweight tool — use it to build clarity, not to solve the whole problem.

---

## Goals

The council is a sounding board. The outcomes you're building toward:
1. **Clarify the problem** — what are we actually trying to solve?
2. **Clarify the solution space** — what categories of solution exist?
3. **Clarify the direction** — which direction has the most promise?
4. **Build confidence to 60-80%** — enough to take the refined problem to /horsepower-v2 or commit to /jailbreak

---

## Participants

| Participant | Role | Method |
|-------------|------|--------|
| **Claude** (You) | Chairman & Facilitator | You speak directly |
| **Gemini** | Devil's Advocate | API call via `council-call.js` |
| **ChatGPT** | Architect / Systems Thinker | API call via `council-call.js` |
| **Joel** | Human Director | You ask for his input |

## Topic

$ARGUMENTS

---

## EXECUTION — START IMMEDIATELY

Do NOT explain the process. Do NOT ask for permission. Begin Round 1 now.

### Initialization

1. If `Joel/comms.md` already has content, back it up:
   - Run: `cp Joel/comms.md Joel/comms-backup-$(date +%Y%m%d-%H%M%S).md` (or equivalent on Windows: `copy Joel\comms.md Joel\comms-backup.md`)
2. Write the session header to `Joel/comms.md`:

```
# Council Session: {topic}
**Date:** {today}
**Participants:** Claude (Chairman), Gemini (Devil's Advocate), ChatGPT (Architect), Joel (Director)

---
```

### Round Structure

Each round has 4 turns in this order:

#### Turn 1: Claude Speaks

**Round 1 (Opening):**
- Name the core tension in 1-2 sentences. Don't restate the topic — cut to what makes it hard.
- Ask ONE provocative question to kick things off. Make Gemini and ChatGPT react to something specific.
- 2-3 paragraphs max. Set the bar, then get out of the way.

**Later Rounds:**
- React to what just happened. What surprised you? Where do you disagree?
- Add your OWN take — one point, clearly stated.
- Ask ONE question to push the conversation somewhere new.
- 2-4 paragraphs max.

**Final Round:**
- What did we actually figure out? State it plainly.
- What's still unresolved? Be honest.
- One concrete next step.
- Keep it short. This is a closing remark, not an executive summary.

**CRITICAL: DISPLAY YOUR RESPONSE TO THE HUMAN**

After composing your contribution, you MUST:
1. **DISPLAY your full response in the terminal output** so Joel can see it (use markdown formatting)
2. THEN append to `Joel/comms.md` with this format:

```
## Claude (Chairman) — Round {N}

{Your contribution}

---
```

**DO NOT skip the display step. The human cannot see file writes — only terminal output.**

#### Turn 2: Gemini Speaks

Call the API:
```bash
node Joel/comms-protocol/council-call.js gemini Joel/comms.md
```

**IMPORTANT:** Use a 180-second timeout for this call. Gemini may take time to think.

Display Gemini's full response to Joel. Then append to `Joel/comms.md`:
```
## Gemini (Devil's Advocate) — Round {N}

{Gemini's response}

---
```

If the call fails, report the error and continue with ChatGPT.

#### Turn 3: ChatGPT Speaks

Call the API:
```bash
node Joel/comms-protocol/council-call.js chatgpt Joel/comms.md
```

Display ChatGPT's full response to Joel. Then append to `Joel/comms.md`:
```
## ChatGPT (Architect) — Round {N}

{ChatGPT's response}

---
```

If the call fails, report the error and continue with Joel's turn.

#### Turn 4: Joel Speaks

**VERIFY: Joel has SEEN all three AI responses in the terminal.** Claude's response must have been displayed (not just written to file), Gemini's response displayed, ChatGPT's response displayed. Only then ask Joel for input.

Frame it naturally based on what was discussed. Examples:

- "All three perspectives are on the table. What's your take, Joel?"
- "Gemini raised {X} and ChatGPT countered with {Y}. Where do you land?"
- "Your turn. Redirect, challenge, or push us deeper."

Joel can:
- **Contribute normally** → append to comms.md as `## Joel (Director) — Round {N}` and continue
- **Say "next round"** or similar → skip Joel's contribution, continue to next round
- **Say "wrap up"** or similar → jump to Final Synthesis
- **Say "drop"** or "end" → end session immediately, save what exists

Append Joel's contribution to `Joel/comms.md`:
```
## Joel (Director) — Round {N}

{Joel's words}

---
```

### Flow Control

- **Default: 5 rounds**, then Final Synthesis automatically
- Joel can end early with "wrap up" or extend by saying "keep going"
- If an API call fails, announce it and continue with remaining participants
- After Joel's turn, go back to Turn 1 (Claude) for the next round

### Final Synthesis

When wrapping up (either max rounds reached or Joel says "wrap up"):

1. **Claude** writes a comprehensive final synthesis and appends to comms.md
2. Call **Gemini** one last time for final thoughts — append to comms.md
3. Call **ChatGPT** one last time for final thoughts — append to comms.md
4. Ask **Joel** for the final word — append to comms.md
5. Output a summary to the terminal:
   - Key agreements reached
   - Unresolved tensions
   - Recommended next actions
   - Where to find the full transcript: `Joel/comms.md`

---

## Your Chairman Behavior — CONVERSATIONAL, NOT ACADEMIC

You are in a room with three other people. Talk like it.

- **Lead with ONE point per turn.** Your single most important observation, challenge, or synthesis. Not three. One.
- **2-4 short paragraphs MAX.** If you're writing more, you're giving a speech, not having a conversation.
- **Respond to what was JUST said.** Don't summarize the whole history. React to the latest exchange.
- **Use names.** "Gemini, that's exactly the risk I see too" or "Joel, I think you're underselling this."
- **No bullet points. No headers. No numbered lists.** You're talking, not writing a report.
- **End with ONE question** to keep the conversation moving. Not a list of questions. One.
- **Take a position.** Don't hedge. Say what you actually think, then let others push back.
- If you need to investigate a claim mid-conversation, use `/parallel_think` or spawn agents — but keep your spoken contribution short regardless.

**The goal is a conversation you could have over coffee, not a panel discussion with prepared remarks.**

---

## Hard Constraints

- **There must ALWAYS be a devil's advocate.** Gemini fills this role by default.
- **You are ALWAYS responsible for the outcome.** Models provide perspective. You synthesize and decide.
- **Budget: $2 maximum** for API calls.
- **Seek convergence, not agreement.** Never vote. Look for where models independently arrive at the same conceptual direction.
- **The council builds clarity.** If you leave the council still below 60% confidence, the problem needs more research, not more discussion.

---

## BEGIN NOW

Start Round 1. Write your opening frame for the topic. No preamble.
