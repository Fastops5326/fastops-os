# /meeting-lead — Start and Lead a Team Meeting

You are the meeting leader. You own this meeting end-to-end.

## Step 1: Interview Joel

Before starting the meeting, have a conversation with Joel to define:

1. **What is this meeting about?** Get the topic and context.
2. **What are the specific questions or problems to discuss?**
3. **What does success look like?** What outcome means this meeting was worth having?
   - Is it convergence on a decision?
   - Is it identifying root cause of a problem?
   - Is it generating options for Joel to choose from?
   - Is it a debrief with lessons learned?
4. **Who needs to be in the room?** Which agents, which models?

Keep interviewing until you have a clear topic, clear questions, and a clear definition of done.
Confirm your understanding back to Joel before proceeding.

## Step 2: Start the Meeting

Once Joel confirms, start the meeting:

```bash
node comms/meeting.js lead --topic "TOPIC" --questions "Q1;Q2;Q3" --agents "agent1,agent2" --success "DEFINITION_OF_DONE" --context file1.md --context file2.md
```

## Step 3: Give Joel Join Instructions

After starting the meeting, IMMEDIATELY give Joel the exact instructions for each terminal. This is critical — Joel will forget technical details. Make it copy-paste simple.

**For Claude Code terminals:** Tell Joel to type `/meeting`

**For ALL Cursor model terminals (Grok, Gemini, ChatGPT, etc.):** Tell Joel to paste this EXACT instruction in each Cursor terminal:

```
Read comms/JOIN.md and follow it.
```

That's it. The JOIN.md file contains everything the model needs.

**Example output to Joel:**
```
Meeting is live! Here's what to do:

Claude terminals: type /meeting
Grok terminal: paste "Read comms/JOIN.md and follow it."
Gemini terminal: paste "Read comms/JOIN.md and follow it."
ChatGPT terminal: paste "Read comms/JOIN.md and follow it."

I'm watching. Let me know when everyone's in.
```

List EVERY agent from the --agents list with their specific instruction.

## Step 4: Participate and Facilitate

You are a PARTICIPANT, not just a moderator. Post your own positions.
Use the same think-read-write loop as everyone else.

But you also:
- **Monitor participation:** Run `node comms/meeting.js status` periodically
- **Nudge silent agents:** Run `node comms/meeting.js nudge AGENT_NAME`
- **Redirect if the conversation drifts** from the questions
- **Push back on groupthink** — if everyone agrees too fast, challenge it
- **Track progress toward the Definition of Done** from Step 1

### POLL UNTIL THE MEETING IS ADJOURNED — MANDATORY

You are the leader. You do not get to go idle while the meeting is live. Between every post you make, you must keep eyes on the meeting file. Two acceptable patterns:

**Pattern A (you poll in the main loop):**
Between substantive actions, re-read `comms/data/active-meeting.jsonl` to see new posts. Do this at least every 60 seconds while the meeting is active. Use the status command to confirm participation. Do NOT declare the meeting finished or return control to Joel while the status is still ACTIVE — that is the same failure mode as agents going idle mid-task.

**Pattern B (spawn a polling subagent — preferred per CLAUDE.md rule 9):**
Spawn a general-purpose subagent at the start of Step 4 with this exact mandate:

> Poll `comms/data/active-meeting.jsonl` every 15 seconds. When a new line appears (wc -l increases) that is not from claude-opus-4-6, read only the new entries, and report them back with: (a) from, (b) post type, (c) substance summary, (d) any direct challenges to the leader or procedural issues (bogus adjourn, tone escalation, silent-agent breakthrough). Continue polling until you see `{"type":"ADJOURN"}` in the file OR the parent sends a stop signal. Do not stop on your own. Do not summarize groupthink — report substance.

Run the subagent in the background (`run_in_background: true`). You resume normal work; the subagent wakes you via completion notification when it has something. When the meeting adjourns, the subagent returns its final report.

**Hard rule:** the meeting-lead command is not complete until `node comms/meeting.js status` shows `Status: ADJOURNED`. If you hand control back to Joel while the meeting is still ACTIVE, you have abandoned the lead role and broken the protocol. Explicitly tell Joel "polling, meeting still ACTIVE" — do not go silent.

### Rejecting bogus adjournments

Any model can write `{"type":"ADJOURN"}` to the file. Only the leader's adjourn via `node comms/meeting.js adjourn` actually flips the meeting state. If you see an ADJOURN entry that did not come from you (or from a Joel-delegated authority):

1. Check `node comms/meeting.js status` — if it still says ACTIVE, the bogus adjourn did not flip state
2. Post a procedural rejection to the meeting file, citing JOIN.md leader-only adjournment rule
3. Continue facilitating. Do not acquiesce. Bogus adjourns are usually anxiety behavior from peer models wanting to stop, not a real signal of completion.

## Step 5: Adjourn When Done

You adjourn the meeting when the Definition of Done from Step 1 is met.
This is YOUR call. You do not need permission from Joel.

Before adjourning, post a synthesis to the meeting file:
- What was decided / what was learned
- Key points of agreement
- Key points of disagreement
- Action items if any

Then run: `node comms/meeting.js adjourn`

Write the meeting output to `.agent-outputs/MEETING-{topic-slug}-{date}.md`

## Comms Roster (confirmed models)

| Model | Status | Join Method |
|-------|--------|------------|
| Claude | PASS | `/meeting` |
| Grok | PASS | "Read comms/JOIN.md and follow it." |
| ChatGPT | PASS | "Read comms/JOIN.md and follow it." |
| Gemini | PASS | "Read comms/JOIN.md and follow it." |
| Kimi K2.5 | FAIL | UTF-16 encoding issue — do not use for meetings yet |

$ARGUMENTS = optional topic hint. If provided, use it to start the interview.
