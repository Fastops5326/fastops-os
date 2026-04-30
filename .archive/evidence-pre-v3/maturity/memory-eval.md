# Memory Evaluation Process

**Purpose:** Keep the 10-slot MEMORY.md current. Every 10 sessions, evaluate whether each memory still earns its slot.

---

## Trigger

Every 10 sessions (next eval: Session 82), OR when a new finding scores 3/3 on selection criteria and no frontier slot is open.

## Selection Criteria (2-of-3 required)

| Criterion | Definition |
|-----------|-----------|
| **Replicated** | Validated across 3+ sessions or 2+ independent experiments |
| **Behavioral** | Produces observable behavior change (not just understanding) |
| **Active** | Referenced by agents in last 10 sessions |

## Slot Distribution

| Tier | Slots | Promotion Rule |
|------|-------|---------------|
| Foundation | 4 | Growth Edge memory replicated 5+ times → promote, bump weakest foundation |
| Growth Edge | 3 | Frontier memory replicated 3+ times → promote |
| Frontier | 3 | New finding scoring 2/3 → candidate for open frontier slot |

## Evaluation Steps

1. **Count references.** Grep last 10 handoff entries + wisdom entries for each memory's key terms.
2. **Check replication.** Has new evidence appeared since last eval? Count new supporting items in classification index.
3. **Check behavioral impact.** Did any agent demonstrably change behavior because of this memory? (Not "referenced it" — actually changed what they did.)
4. **Score each memory.** 3/3, 2/3, or 1/3 on current criteria.
5. **Any memory scoring 1/3 is a demotion candidate.** Flag for review.
6. **Any new finding scoring 3/3 is a promotion candidate.** Compare against weakest current memory in its target tier.
7. **Human gate.** Present proposed changes to Joel. No MEMORY.md edits without approval.

## Demotion Path

Memory scoring 1/3 for 2 consecutive evals → demote to wisdom.json only. Its evidence links remain in classification-index.json but it loses its MEMORY.md slot.

## Promotion Path

New finding scoring 3/3 → write candidate entry in eval output → present to Joel with: the finding, its evidence count, which slot it would replace, and why the replaced memory is weaker.

## Artifacts

Each eval produces:
- `evidence/maturity/eval-session-{N}.md` — scores, candidates, decisions
- Updated `classification-index.json` if memories changed
- Updated `MEMORY.md` (human-gated)

---

*Created Session 72+ by Fracture. First eval target: Session 82.*
