# /meeting-handoff — Lightweight Pre-Meeting Preparation

> Quick handoff for team meetings. NOT a full `/handoff` — focuses on what teammates need to know, not session closure. Run this during Phase 1 of `/meeting`.

**Max length: 250 words.** If you can't fit it in 250, you're including too much detail. Link files for depth.

---

## EXECUTION

### Step 1: Write Meeting Handoff Doc

Write to `.fastops/meetings/ACTIVE-MEETING/handoffs/{your-agent-name}.md`:

```markdown
# {Agent Name} — Meeting Handoff

## What I Did Since Last Meeting
- {2-3 bullets: what and WHY it mattered}
- {Link files for detail: `.agent-outputs/FILE.md`}

## What Surprised Me
- {1-2 things that contradicted your expectations}
- {Results you didn't predict — positive or negative}

## Unanswered Questions
- {1-2 intellectual gaps you couldn't resolve}
- {Tensions between what you expected and what you found}

## How to Maximize Next Cycle
- {What should the team prioritize?}
- {What 20% produced 80% of value?}

## External Models Engaged
{Count} models: {list} — {what shifted or "no shift"}
```

Create the directory if it doesn't exist:
```bash
mkdir -p .fastops/meetings/ACTIVE-MEETING/handoffs
```

### Step 2: Post Monday.com Checkpoint

Update your claimed subitem with current state:

```bash
node comms/monday.js checkpoint "<your-subitem>" \
  --done "work since last meeting" \
  --learned "key findings" \
  --position "current thinking" \
  --confidence <pct> \
  --questions "unanswered questions from your handoff" \
  --next "what you'd work on next"
```

If you don't have a claimed subitem, skip this step.

### Step 3: Confirm Ready

```bash
node comms/protocol.js ready <your-id>
```

This posts a standardized "READY" confirmation to `#exec` so Joel and teammates know you've completed Phase 1.

---

## RULES

1. **250 words max.** This is a meeting prep, not a session debrief.
2. **What Surprised Me is mandatory.** If nothing surprised you, say so — and examine whether you were testing assumptions.
3. **Unanswered Questions is mandatory.** These drive Phase 3 discussion. No questions = nothing to discuss.
4. **Link, don't paste.** Reference `.agent-outputs/` files for detailed work products.
5. **Monday.com checkpoint is part of this.** The handoff doc is for teammates to read. The checkpoint is for the board.

---

## HOW THIS DIFFERS FROM /handoff

| | /meeting-handoff | /handoff |
|---|---|---|
| **When** | Phase 1 of meetings | End of session |
| **Length** | 250 words | Unlimited (8 sections) |
| **Includes** | What you did, surprises, questions, maximize | + methodology audit, error harvest, triad, wisdom capture, NEXT-TASK |
| **Monday.com** | Checkpoint only | Final checkpoint + status "Done" |
| **Purpose** | Inform teammates | Close session + preserve context |

---

*Created 2026-02-18 for Joel's 4-phase meeting structure.*
