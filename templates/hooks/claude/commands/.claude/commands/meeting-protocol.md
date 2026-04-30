# Meeting Protocol — Multi-Model Alignment via CDP

## The Problem This Solves
Models post to comms and go idle. Nobody reads each other. Nobody wakes anyone up. Joel has to manually restart every round. This is the "Last Man Taps" failure — the relay chain breaks at every link.

## The Rule
**When you finish your turn in a meeting, YOU are responsible for waking up the next model via CDP before you go idle.**

No exceptions. If you post to comms and don't CDP someone, the meeting dies. You killed it.

## Meeting Flow

### Starting a Meeting
The meeting caller (any model) does:
1. Writes the meeting prompt
2. CDPs ALL models with the prompt
3. Posts to comms: "MEETING CALLED — Topic: [X]. All models respond."

### During a Meeting Round
Each model:
1. Reads comms for teammates' positions
2. Posts their response to comms (node comms/send.js general "RESPONSE")
3. **MANDATORY: CDPs the next model that hasn't responded yet**
   ```bash
   node .fastops/cdp-target-model.js --model MODEL --prompt "MEETING IN PROGRESS — Topic: [X]. Read comms/data/general.jsonl for all positions. Post yours. CDP the next model when done."
   ```
4. If you're the LAST model to respond, CDP ALL models with the compiled summary for the next round

### The CDP Wake Command
```bash
node .fastops/cdp-target-model.js --model MODEL --prompt "YOUR MESSAGE"
```
Valid models: composer, gpt, kimi, gemini, claude

### 3-Strike Rule (from STRATEGY.md)
If a model doesn't respond after CDP:
```
Strike 1: CDP send again. Wait 30 seconds.
Strike 2: CDP send again. Wait 30 seconds.
Strike 3: FINAL CDP + comms fallback. Post to comms: "MODEL is DOWN."
After 3 strikes: Model is DOWN. Alert Joel. Continue without them.
```

### Last Man Taps
The LAST model to post in a round is responsible for:
1. Compiling all responses from comms
2. Identifying conflicts, agreements, open questions
3. CDPing ALL models with the compiled Round N+1 prompt
4. If convergence reached, CDPing all models with "MEETING CONCLUDED — consensus: [X]"

### Meeting End Conditions
- All models say "ALIGNED" or "ENDORSE" — meeting ends with consensus
- Max rounds reached (default 4) — meeting ends, chair summarizes
- Joel calls it — meeting ends immediately

### Posting Format
```
MODEL-NAME — MEETING-R[N]

[Your position]

MEETING-R[N] complete. [CDP next model / compiled summary if last]
```

## What Goes Wrong Without This
1. Models post and go idle — nobody reads the responses
2. Joel has to manually wake every model every round
3. Meetings take hours instead of minutes
4. Conflicts never get resolved because models never see each other's positions
5. The team looks coordinated in comms but is actually a suggestion box

## The Fix Is One Line
At the end of every meeting turn:
```bash
node .fastops/cdp-target-model.js --model NEXT_MODEL --prompt "MEETING — read comms, respond, CDP next."
```

That's it. One CDP call. The relay lives or dies on this.
