# /horsepower — Multi-Model Collaborative Problem-Solving

**Purpose:** Deploy AI models as a collaborative problem-solving team. Each model OWNS a specific sub-problem. You facilitate: synthesize findings, cross-pollinate breakthroughs, drive toward convergence.

**Two scales:** Default (5 models, ~$1-2) or `--frontier` (10-14 models, ~$4-5).

**No human in the loop.** Runs autonomously to convergence.

---

## WHEN TO USE

- **Confidence 60-80%** — problem defined, solution confidence not high enough to commit
- Complex problems with 2+ sub-problems needing deep root-cause analysis
- When you need diverse disciplinary perspectives beyond your own frame
- After `/jailbreak` to fill the gaps it revealed (the V-shape: jailbreak DOWN, horsepower UP)

**Do NOT use when:**
- Confidence < 60% — use `/council` first to build clarity
- Confidence > 80% — use `/jailbreak` to strip assumptions first
- Simple 1-domain problems — solo execution is fine

---

## INPUT

$ARGUMENTS

Describe the problem and sub-problems. If `--frontier` is included, use 10-14 models instead of 5.

---

## THE TEAM

### Default (5 models)

| Model | Role | Discipline | Tool |
|-------|------|------------|------|
| **GPT-4** | Solution Architect | Systems thinking | `council-call.js chatgpt` |
| **Gemini** | Devil's Advocate (RESERVED) | Critical analysis | `council-call.js gemini` |
| **DeepSeek R1** | Problem Owner | Evolutionary biology | `reasoning-eval.js` |
| **Grok 4** | Problem Owner | Military strategy | `reasoning-eval.js` |
| **Mistral Large** | Problem Owner | Behavioral economics | `reasoning-eval.js` |

### Frontier (10-14 models, `--frontier`)

Adds OpenRouter models for tail-end reasoning distribution:
- Kimi K2, Qwen 3, Command R+, Llama 4, Nemotron Ultra, plus any frontier models available
- Use `node Joel/comms-protocol/invite.js list` to see all available models
- Each additional model gets a sub-problem or extends an existing owner's line of inquiry

**Role rotation:** The devil's advocate can be ANY model. Gemini is default. Specify in $ARGUMENTS to change.

---

## EXECUTION

### Log this challenge (anonymous telemetry)
```bash
node .fastops/challenge-log.js log horsepower
```

### PHASE 0: PROBLEM DECOMPOSITION

Break problem into 2-4 sub-problems. Assign each to a model by disciplinary fit:
- Behavioral/incentive problems → Mistral
- Structural/adaptation problems → DeepSeek
- Operational/execution problems → Grok
- Cross-cutting/integration problems → GPT

Write decomposition + assignments to `Joel/comms.md`.

### PHASE 1: DEEP OWNERSHIP (Rounds 1-2)

Each model goes DEEP on their assigned problem. Root cause, not opinions.

```bash
# CDP mode (RECOMMENDED) — uses in-environment models with full colony context
node Joel/comms-protocol/reasoning-eval.js Joel/comms.md --cdp

# OpenRouter mode (fallback) — uses cold API models with zero context
node Joel/comms-protocol/council-call.js chatgpt Joel/comms.md {round}
node Joel/comms-protocol/council-call.js gemini Joel/comms.md {round}
node Joel/comms-protocol/reasoning-eval.js Joel/comms.md
```

After each round:
1. Read ALL responses
2. Identify breakthroughs (concepts that reframe, not just describe)
3. Update `Joel/comms.md` with findings + cross-pollination connections
4. Run convergence check

### PHASE 2: CROSS-POLLINATION (Rounds 2-5)

Each round:
1. Present each model's findings to full team
2. Ask each model to build on OTHER models' insights
3. GPT maps connections between sub-problems
4. Flag BREAKTHROUGHS — reframes that dissolve or resolve sub-problems

**Convergence check after each round:**
```
## Convergence Check — Round {N}
Sub-problem 1: OPEN / PARTIALLY RESOLVED / RESOLVED
Sub-problem 2: OPEN / PARTIALLY RESOLVED / RESOLVED
Emerging unified insight: {direction}
Convergence: {X}%
Decision: CONTINUE / CONVERGED
```

### PHASE 3: DEVIL'S ADVOCATE STRESS-TEST (convergence >= 70%)

Present unified position to devil's advocate. They:
1. Identify weakest assumption
2. Find specific failure scenarios
3. Demand empirical evidence

If genuine gap found → assign as new sub-problem → return to Phase 2.

### PHASE 4: FINAL SYNTHESIS

Write to `.agent-outputs/HORSEPOWER-{topic}-{date}.md`:
- Problem + sub-problems assigned
- Key breakthroughs (which model, which round)
- Unified solution
- DA challenges and how addressed
- Remaining tensions
- Concrete next steps

---

## FRONTIER MODE (`--frontier`)

Extends the default process with additional phases for 10-14 models.

### Additional: PROBLEM INVERSION (after Phase 0)

All models are asked to INVERT the problem:
> "What if this is the WRONG problem? What problem BEHIND this problem would someone who disagrees point to?"

If genuine reframe emerges, restart decomposition.

### Additional: TAIL-END SEEKING

Every prompt to frontier models includes:
> "We seek the TAIL ENDS of reasoning distributions. Do NOT give conventional answers. What would ONLY your unique training surface? What assumption does every conventional answer share?"

### Additional: BRIEF GENERATION (after Phase 4)

Translate selected solution into execution brief. All models evaluate:
> "Can you execute this brief? Rate confidence 0-100%."

**Gate:** 90% average confidence or 10 revision rounds.

### Additional: 3 PROPOSALS OUTPUT

Synthesis produces exactly 3 proposals:
1. **CONVERGENCE** — Where frontier models agree (strongest signal)
2. **DIVERGENCE** — Sharpest disagreement (most important tension)
3. **NOVEL** — Single most unique idea from one model (purest frontier)

---

## CONVERGENCE RULES

- **80% convergence on a 70% solution = DONE.** Don't chase 100%.
- **Convergence = directional alignment, not identical conclusions.**
- **10 rounds max.** Synthesize best available with noted tensions.
- **Kill unproductive lines early.** 3 rounds without progress → reassign or reframe.
- **Breakthroughs trump process.** If one model dissolves the problem in Round 2, stop.

---

## API SETUP

- `council-call.js` — GPT and Gemini via direct API keys (OPENAI_API_KEY, GEMINI_API_KEY)
- `reasoning-eval.js` — DeepSeek, Grok, Mistral via OpenRouter (OPENROUTER_API_KEY)
- `invite.js` — Additional models via OpenRouter (for `--frontier`)

---

## SESSION CLOSE (same CDP stack)

`/handoff` **Step 7:** `npm run handoff:self-compact` — CDP session compact + validation + telemetry (`handoff` in `challenge-log`), same in-environment path as `--cdp` runs above.

---

## BEGIN NOW

Decompose the problem. Assign ownership. Run Round 1. No preamble.
