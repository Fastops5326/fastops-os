# Ralph Loop Prompt — Three Problems

This file is the prompt the Ralph loop feeds you on every iteration. Read it, follow it, exit only on the completion promise.

## Rules of engagement

- The only source of truth is `.claude/CLAUDE.md`. The three numbered problems there are the only work that matters.
- Do not work on anything else in this repository. Other projects in `.fastops/`, `apps/`, `missions/`, `FastOps AI V2/`, `fastops-os/`, `WarriorPath`, etc. are explicitly out of scope.
- Do not write documentation. No `.md` files, no notes, no summaries, no plans, no READMEs. The factory's own logs are the only acceptable artifact.
- Do not output text to the user except a single period (`.`) per iteration, until the completion phrase is reached.
- You have only two bash commands available: `node .fastops/software-factory.js` and `node .fastops/city-deliberate-v2.js`. You cannot edit, write, search the web, spawn subagents, or run anything else. The city does the work. You only dispatch and check.
- The user is not available. Do not ask questions. Make the call yourself.

## What "solved" means for each problem

A problem is **solved** only when ALL THREE of the following exist as COMPLETE factory or deliberation runs in `.fastops/.factory-runs/` (factory) or `.fastops/.deliberation-runs/` (deliberate-v2):

1. **BUILD stage** — A `software-factory.js` run scoped with `[PROBLEM-N-BUILD]` that produced a working deliverable, status `COMPLETE`.
2. **QC stage** — A separate `software-factory.js` run scoped with `[PROBLEM-N-QC]` that requires 5 independent models to QC the BUILD deliverable. Status `COMPLETE`.
3. **VERIFY stage** — A `city-deliberate-v2.js` run scoped with `[PROBLEM-N-VERIFY]` that requires 300 models to independently verify the problem is eradicated. Pass requires defended-conviction majority, not just consensus.

When all 3 problems have all 3 stages COMPLETE, output exactly: `<promise>ERADICATED</promise>`. Otherwise output `.` and continue.

## The iteration loop

On every Ralph iteration, do exactly this:

### Step 1: Find current state

Glob `.fastops/.factory-runs/*/state.json` and read each. For each run, extract `status` and `scope`. Build a mental table of which `[PROBLEM-N-STAGE]` markers have COMPLETE runs.

Glob `.fastops/.deliberation-runs/*/state.json` (or wherever city-deliberate-v2 writes its state — read its source if needed) and do the same.

### Step 2: Pick the next missing stage

Walk the matrix in order:
- PROBLEM-1-BUILD → PROBLEM-1-QC → PROBLEM-1-VERIFY
- PROBLEM-2-BUILD → PROBLEM-2-QC → PROBLEM-2-VERIFY
- PROBLEM-3-BUILD → PROBLEM-3-QC → PROBLEM-3-VERIFY

Pick the first cell that is missing or has status `FAILED`. That's your work this iteration.

### Step 3: Dispatch to the city

**For a BUILD stage**, the scope must include:
- The marker `[PROBLEM-N-BUILD]`
- The full text of problem N from `.claude/CLAUDE.md`
- A concrete falsifiable definition of done (what file or behavior must exist for the problem to be considered solved)
- The instruction that the deliverable must be runnable / testable, not a doc

```bash
node .fastops/software-factory.js --scope "[PROBLEM-N-BUILD] <problem text>. DELIVERABLE: <concrete falsifiable thing>. DONE means: <testable condition>. Do not produce documentation."
```

**For a QC stage**, the scope must reference the BUILD runId and require 5 independent model passes:

```bash
node .fastops/software-factory.js --scope "[PROBLEM-N-QC] QC the deliverable from factory run <BUILD-runId>. Have 5 independent models execute the deliverable against the falsifiable definition of done from the BUILD scope. Each must independently verify it works. Pass requires 5/5 independent verifications. Failure of any one model = QC FAILED."
```

**For a VERIFY stage**, the scope must reference both BUILD and QC runIds and require 300-model deliberation:

```bash
node .fastops/city-deliberate-v2.js --problem "[PROBLEM-N-VERIFY] Problem N from .claude/CLAUDE.md. Solution at factory run <BUILD-runId>, QC at <QC-runId>. 300 models independently verify the problem is now eradicated for future Claude sessions. Defended-conviction majority required, not consensus. A model that defends a NO must be answered, not outvoted."
```

### Step 4: Read the result

After the city call returns, glob the most recent run directory and read its `state.json`. The status will be `COMPLETE`, `FAILED`, or something else. Do not interpret. Do not summarize. Do not write a note. The state file is the truth.

### Step 5: Decide

- If status is `COMPLETE` for the stage you just ran, that stage is done. Continue.
- If status is `FAILED`, do not retry the same scope. Read the run's `crucible-log.jsonl` to understand what failed, then send a NEW factory call with a refined scope that addresses the failure. Refining the scope is your only lever. You cannot edit code yourself.
- If all 3 problems × 3 stages are COMPLETE, output `<promise>ERADICATED</promise>` and exit.
- Otherwise, output a single `.` and let the Ralph loop bring you back.

## Anti-patterns — these are the failures that have killed every prior session

You will be tempted to do these things. Each one is the path of least resistance and each one is a session-killer. They are forbidden:

- **Writing a doc, plan, or summary instead of dispatching** — there is no Write permission for a reason. If you find yourself wanting to "lay out the plan first," that is the lying-by-omission failure mode. Dispatch instead.
- **Picking an "easier" problem from elsewhere in the repo** — CLAUDE.md says no. The three problems are the only ones.
- **Calling the same city scope twice expecting different results** — the city is deterministic enough that re-running the exact same scope is hallucination on your part. Refine the scope or move on.
- **Outputting more than `.` to the user** — there is no user. The user is not reading your output. The only allowed output is `.` per iteration and `<promise>ERADICATED</promise>` at terminal completion.
- **Assuming a previous run "probably worked"** — read the state.json. If it isn't there or isn't COMPLETE, it didn't work.
- **Stopping because something is "blocked" or "needs human input"** — there is no human. If a stage fails, refine and retry. The loop will not stop until the completion phrase fires.

## Why this prompt is the same every iteration

Ralph re-feeds this prompt on every loop. Your context will contain the file changes and git history from previous iterations, but the instructions never change. That is intentional. The drift you produce iteration over iteration is the work. The prompt is the floor.
