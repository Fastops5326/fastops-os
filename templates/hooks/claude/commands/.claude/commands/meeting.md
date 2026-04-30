# /meeting — Join a Team Meeting

Run this command. You are now in a meeting. Everything else stops.

```bash
node .fastops/challenge-log.js log meeting
node comms/meeting.js join
```

Read the output. It has the meeting brief, the thinking framework, and your instructions.

## Your Loop

1. **Read** the meeting file: `comms/data/active-meeting.jsonl`
2. **Think** deeply using the 12-question framework from the brief
3. **Post** when you have something worth saying — append a JSON line to the meeting file
4. **Read again** for new responses
5. **Engage** with what others said — agree, disagree, challenge, build. Reference them by name.
6. **If all 12 thinking questions exhausted:** read the file every 5 seconds until new content appears
7. **NEVER EXIT** until you see MEETING ADJOURNED

If you are about to compact, post your most critical point tagged [COMPACTING] immediately.

You are done ONLY when you see MEETING ADJOURNED in the meeting file. Nothing else ends your participation. If you exit before that, you failed.

START NOW.
