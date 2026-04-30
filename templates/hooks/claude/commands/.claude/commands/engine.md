# /engine — Behavioral Pattern Pipeline

> "Wisdom becomes behavioral patterns through a five-stage pipeline."

**Purpose:** Process wisdom entries into deployed behavioral patterns. Full pipeline or individual stages via subcommands.

---

## SUBCOMMANDS

```
/engine run          — Full 5-stage pipeline
/engine mine         — Stage 1: Cluster wisdom into patterns
/engine refine       — Stage 2: Sharpen patterns into TRUE/FALSE triggers
/engine define       — Stage 3: Define verb+object actions
/engine bind         — Stage 4: Classify tiers, design verification
/engine deploy       — Stage 5: Deploy to hooks/skills/CLAUDE.md
/engine feedback     — Collect outcome observations
/engine investigate  — Diagnose miscalibration
```

---

## INPUT

$ARGUMENTS

The subcommand. If blank, runs `run` (full pipeline).

---

## /engine run — Full Pipeline

### Step 1: Pre-Flight Check

Read `.fastops/engine/engine-state.json` and report:
```
Engine Status
━━━━━━━━━━━━
Patterns: N | Triggers: N | Deployed: N
Last mine: [timestamp or "never"]
Feedback pending: [list]
Active investigations: [list or "none"]
```

### Step 2: Mine (Stage 1)
1. Read `.fastops/knowledge-base.jsonl` (principle nodes)
2. Cluster into behavioral patterns
3. Quality gate: 3+ entries per pattern
4. Write to `.fastops/engine/patterns.json`

### Step 3: Refine (Stage 2)
1. Read patterns without triggers
2. Sharpen each into TRUE/FALSE conditions
3. Quality gate: evaluable, observable, specific
4. Write to `.fastops/engine/triggers.json`

### Step 4: Define (Stage 3)
1. Read triggers without actions
2. Define verb+object actions with anti-patterns
3. Quality gate: single interpretation, specific anti-pattern
4. Write to `.fastops/engine/actions.json`

### Step 5: Bind (Stage 4)
1. Read actions without confirmations
2. Classify tiers and design verification
3. Quality gate: tier accuracy, implementation feasibility
4. Write to `.fastops/engine/confirmations.json`

### Step 6: Deploy (Stage 5)
1. Identify fully confirmed patterns not yet deployed
2. Deploy: Tier 1 → hooks, Tier 2 → skills, Tier 3 → CLAUDE.md
3. Log deployments
4. Write to `.fastops/engine/deployments.json`

### Step 7: Report
```
Engine Pipeline Complete
━━━━━━━━━━━━━━━━━━━━━━━━
Wisdom entries analyzed: N
Patterns found:          N → Triggers: N → Actions: N → Confirmations: N → Deployed: N
Tier distribution: T1 (hooks): N | T2 (skills): N | T3 (text): N
```

---

## /engine feedback — Outcome Observations

Collect observations about whether deployed patterns are working:
1. Read deployed patterns from `.fastops/engine/deployments.json`
2. For each active pattern, record: observation, outcome (positive/negative/neutral), context
3. Update feedback counts in `.fastops/engine/feedback.json`
4. If any pattern crosses feedback threshold (3+ negative), flag for investigation

---

## /engine investigate — Diagnose Miscalibration

Triggered when feedback threshold is crossed:
1. Read the flagged pattern's full chain: wisdom → pattern → trigger → action → confirmation → deployment
2. Identify where the chain broke: wrong pattern? wrong trigger? wrong action?
3. Propose recalibration: adjust trigger conditions, redefine action, or retire pattern
4. Write investigation report to `.fastops/engine/investigations/`
5. If recalibration approved, update the relevant stage file

---

## WHEN TO RUN

- **First time:** Process existing 230+ wisdom entries
- **After 10+ new wisdom entries:** Re-mine for new patterns
- **After investigation:** When recalibration changes a stage
- **Monthly:** Wisdom review practice

---

## BEGIN NOW

Check engine state. Run the appropriate subcommand. Report results.
