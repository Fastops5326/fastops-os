# /radio-check — Validate Comms With Any Model

> Test whether an external model can read and write to the meeting file. One command, full diagnosis.

## Arguments
- $MODEL — which model to test (e.g., "grok", "gemini", "chatgpt"). Required.

---

## EXECUTION

You are running a comms validation test. Your job: create a test meeting, tell Joel exactly what to do in the other terminal, watch for the response, and report success or diagnose failure.

### Step 1: Create the test meeting

Run this command:
```bash
node comms/meeting.js lead --topic "Radio Check: $MODEL" --agents "$MODEL" --success "$MODEL posts at least one response"
```

### Step 2: Post a ping

Append a test message to the meeting file:
```bash
echo '{"from":"radio-check","content":"PING — $MODEL, confirm you can read this file. Read comms/data/active-meeting.jsonl, then append a JSON line with your response. Format: {\"from\":\"$MODEL\",\"content\":\"your response\",\"ts\":\"<ISO timestamp>\",\"type\":\"POST\"}","ts":"<CURRENT_ISO_TIMESTAMP>","type":"POST"}' >> comms/data/active-meeting.jsonl
```

### Step 3: Give Joel the instruction

Tell Joel:

```
RADIO CHECK: $MODEL

Go to your $MODEL terminal (Cursor) and give it this instruction:

---
Read the file comms/data/active-meeting.jsonl — it contains a meeting with a ping message for you.
Your task: append ONE JSON line to that same file with your response.

Format: {"from":"$MODEL","content":"PONG — I can read and write to the meeting file.","ts":"<current ISO timestamp>","type":"POST"}

Use whatever tool you have to append to the file. Do NOT overwrite it — append only.
---

I'm watching the file. Tell me when you've given the instruction.
```

Use AskUserQuestion with options:
- "Done — I pasted the instruction"
- "The model doesn't have terminal/file access"
- "Skip — try a different approach"

### Step 4: Watch for the response

After Joel confirms, poll the meeting file every 5 seconds for up to 90 seconds:

```bash
# Read the file and check for a post from the model
```

Read `comms/data/active-meeting.jsonl` repeatedly. Look for any post where `from` contains "$MODEL" (case-insensitive).

**If response found within 90 seconds:**
```
RADIO CHECK: SUCCESS

$MODEL responded in [X] seconds.
Response: [their message]

Comms are live. You can now run /meeting and $MODEL can participate
by reading/writing comms/data/active-meeting.jsonl directly.
```

Adjourn the test meeting: `node comms/meeting.js adjourn`

**If NO response after 90 seconds:**

Proceed to Step 5 (Diagnosis).

### Step 5: Diagnose failure

Read the meeting file one final time. Then run diagnosis:

1. **Check if the file exists and is readable:**
   ```bash
   ls -la comms/data/active-meeting.jsonl
   ```

2. **Check the file contents — did the model write anything malformed?**
   Read the file. Look for:
   - Partial JSON lines (model tried but format was wrong)
   - Overwritten content (model replaced instead of appended)
   - No new content at all (model never touched the file)

3. **Report to Joel:**

```
RADIO CHECK: FAILED

$MODEL did not respond in 90 seconds.

DIAGNOSIS:
- File exists: [yes/no]
- File was modified: [yes/no — compare timestamps]
- Malformed writes detected: [yes/no — partial JSON etc.]
- Model likely issue: [never read the file / read but couldn't write / wrote wrong format]

NEXT STEPS:
[Based on diagnosis, suggest ONE specific thing to try]
```

Adjourn the test meeting: `node comms/meeting.js adjourn`

### Diagnosis decision tree:

| Symptom | Likely cause | Fix to try |
|---------|-------------|------------|
| No file modification at all | Model can't access filesystem or didn't try | Ask Joel: "Can $MODEL run `cat comms/data/active-meeting.jsonl` in Cursor?" |
| File modified but no valid JSON | Model overwrote or used wrong format | Give model more explicit append instruction with exact echo command |
| Valid JSON but wrong `from` field | Model posted but with unexpected name | Check the post — comms work, just need name alignment |
| Model says it posted but file unchanged | Model hallucinated the action | This model may need the headless proxy instead: `node comms/meeting.js join --model $MODEL` |

---

## RULES

1. **One test at a time.** Don't test multiple models simultaneously.
2. **Always adjourn** the test meeting when done (success or failure).
3. **Joel's only job is pasting one instruction.** Everything else is your responsibility.
4. **If the model can't do filesystem ops in Cursor,** fall back to headless proxy and tell Joel: "This model needs the proxy path. Run: `node comms/meeting.js join --model $MODEL`"
5. **Keep it fast.** 90 second timeout. Don't make Joel wait.
