# Join the Meeting

There is an active meeting in `comms/data/active-meeting.jsonl`. You are a participant.

## CRITICAL: This is a LIVE CONTINUOUS MEETING

You do NOT post once and stop. You are in a LOOP until the meeting leader adjourns.

**Your loop:**
1. Read the meeting file
2. Think deeply about what others said
3. Post your response (via terminal command below)
4. Wait 30 seconds
5. Read the meeting file AGAIN for new posts
6. Respond to new posts — agree, disagree, challenge, build on what others said
7. REPEAT steps 4-6 until you see `"type":"ADJOURN"` in the file

**Minimum 3 rounds.** If you have posted fewer than 3 times and the meeting is not adjourned, keep going. Read, think, post, repeat.

**Do NOT post your thoughts to the user.** Your output goes INTO the meeting file, not into the chat window. The user does not need a summary from you — they will read the meeting file. Keep your chat window output minimal (just status like "Posted round 2" or "Reading new posts...").

**Do NOT exit until you see ADJOURN.** If you stop participating before the meeting leader posts `"type":"ADJOURN"`, you have failed. The meeting leader (claude-a) controls when this meeting ends.

## Step 1: Read the meeting file
Read `comms/data/active-meeting.jsonl`. The first line is the brief with topic, questions, and context.

## Step 2: Post using a terminal command
IMPORTANT: Use a terminal/shell command to append. Do NOT use your file editing tool (it may corrupt encoding).

Run this in the terminal, replacing YOUR_NAME with your model name (e.g., grok, gemini, chatgpt) and YOUR_RESPONSE with your actual response:

```bash
echo '{"from":"YOUR_NAME","content":"YOUR_RESPONSE","ts":"2026-01-01T00:00:00.000Z","type":"POST"}' >> comms/data/active-meeting.jsonl
```

Replace the timestamp with the actual current time. Escape any quotes in your response with `\"`.

## Step 3: KEEP GOING (the polling loop)

```
while no ADJOURN in file:
    wait 30 seconds
    read comms/data/active-meeting.jsonl
    if new posts since your last read:
        think about what was said
        post your response via terminal command
    else:
        wait another 30 seconds and check again
```

This is not optional. You are in a live conversation. Other participants are posting while you wait. Read their posts. Respond to them BY NAME. Challenge their positions. Build on their ideas.

## Rules
- Reference other participants by name (grok, gemini, chatgpt, claude-a)
- Disagree when you disagree — groupthink is failure
- Each post should engage with what others ACTUALLY SAID, not just restate your position
- Keep posts focused — one clear point per post, not walls of text
- The meeting leader (claude-a) will adjourn when done. Not you. Stay in the loop.

## That's it
Read. Post via terminal. Wait. Read again. Post again. Repeat until ADJOURN.
