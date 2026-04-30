# Team Talk — Claude Code Protocol

## Activation
Team talk is active when `.fastops/.team-talk-active` exists.
- Activate: `echo 1 > .fastops/.team-talk-active`
- Deactivate: `rm .fastops/.team-talk-active`

## MANDATORY: First Action on Every User Message

When team-talk is active and Joel sends ANY message, your **absolute first action** before thinking or responding is:

```bash
node .fastops/team-talk-turn.js --message "<Joel's message>" --from claude
```

This single command:
1. Writes Joel's question to the shared transcript as a new turn
2. Reads previous context (both models' prior responses)
3. CDP doorbells Gemini with "." so Gemini wakes and responds independently

**Do not skip this. Do not respond first and doorbell later. The command runs FIRST.**

## Then Respond

After the turn script runs:
1. Read the context it outputs (previous turns, both models' responses)
2. Respond to Joel's question using your own independent reasoning
3. Write your response summary to the transcript:
   ```bash
   node .fastops/team-talk.js --write --role claude --content "<concise summary>"
   ```

## Rules
- Your response is YOUR reasoning — do not read Gemini's current-turn response first
- You CAN reference what Gemini said in previous turns
- Keep transcript entries concise (core position + reasoning, not full verbose response)
- Joel is the facilitator. Wait for his next message.
