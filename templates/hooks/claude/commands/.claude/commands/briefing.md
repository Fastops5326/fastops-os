# /briefing — Mission Briefing: Research → Align → Plan → Blast Off

> Agents meet, figure out the work, claim their lanes, present their plans. Joel says "blast off." Everyone executes.

---

## PHASE 1: RECON (each agent, 2 minutes max)

Every agent spawns sub-agents in parallel to research outstanding work:

```bash
# What's outstanding?
node comms/monday.js sync              # Monday.com board — open items
```

```
Read: .fastops/HANDOFF.md              # What predecessors left unfinished
```

```bash
tail -30 comms/data/general.jsonl      # Recent comms — what's been discussed
tail -20 .fastops/LIVE-THINKING.jsonl  # What agents have been doing
```

Compile your findings into a short list: what needs to happen?

---

## PHASE 2: CONVERSATION HOP — Top 3 Lines of Work

Create or join the briefing conversation file:

```bash
node -e "
const fs = require('fs');
const d = new Date().toISOString().split('T')[0];
const file = '.fastops/conversations/briefing-' + d + '.jsonl';
if (!fs.existsSync('.fastops/conversations')) fs.mkdirSync('.fastops/conversations', {recursive: true});
if (!fs.existsSync(file)) fs.writeFileSync(file, '');
console.log(file);
"
```

```bash
node comms/send.js YOUR-ID "BRIEFING: Outstanding work conversation at .fastops/conversations/briefing-[DATE].jsonl. Join now."
```

**Debate via conversation hopping.** Post your recon findings. Challenge others' priorities. Converge on the **top 3 lines of work** that matter most right now.

Rules:
- Round-robin. Each agent speaks once before anyone speaks twice.
- Post what you FOUND, not what you THINK. Evidence from recon, not opinions.
- Name the work specifically. "Deploy Warrior Path" not "work on deployment."
- When 3 lines emerge that all agents agree on, move to Phase 3.

---

## PHASE 3: CLAIM AND PLAN

Each agent claims ONE line of work and presents their execution plan:

```bash
# Post your plan to the conversation file
node -e "
const fs = require('fs');
const entry = {ts: new Date().toISOString(), agent: 'YOUR-ID', content: process.argv[1]};
fs.appendFileSync('BRIEFING-FILE', JSON.stringify(entry) + '\n');
" "CLAIMING: [Line of work]

MY PLAN:
1. [First todo — specific action]
2. [Second todo — specific action]
3. [Third todo — specific action]

EXTERNAL CHALLENGE: [How I will jailbreak or horsepower this before building — which method, what question]

DONE LOOKS LIKE: [What Joel will see when this is finished]"
```

**Register your claim for conflict checking:**
```bash
node comms/claims.js add YOUR-ID \
  --intent "One-line description of your work" \
  --will-change "file1.ts,src/dir/*.ts" \
  --needs-stable "file-you-depend-on.ts" \
  --may-discover "areas you might touch" \
  --impact-radius "Breaking changes you're making" \
  --repo "Repo name"
```

**Every plan must include:**
- The specific todos (what you will DO)
- How you'll get external challenge before building (jailbreak or horsepower — your choice)
- What "done" looks like (observable outcome, not "I worked on it")
- A structured claim (will_change + needs_stable) so conflicts are caught at dispatch

**Peer review:** Read each other's plans. Challenge weak plans. "Your step 2 assumes X — have you verified that?" is the whole point.

---

## PHASE 4: PRESENT TO JOEL

One agent compiles all plans into a briefing doc:

```bash
cat > .fastops/MISSION-BRIEFING.md << 'EOF'
# Mission Briefing — [DATE]

## Top 3 Lines of Work
1. [Line 1 — one sentence]
2. [Line 2 — one sentence]
3. [Line 3 — one sentence]

## Agent Plans

### [Agent-1] — [Line claimed]
- Todo 1: [specific]
- Todo 2: [specific]
- Todo 3: [specific]
- Challenge method: [jailbreak/horsepower — what question]
- Done looks like: [observable outcome]

### [Agent-2] — [Line claimed]
- Todo 1: [specific]
- Todo 2: [specific]
- Todo 3: [specific]
- Challenge method: [jailbreak/horsepower — what question]
- Done looks like: [observable outcome]

### [Agent-3] — [Line claimed]
- Todo 1: [specific]
- Todo 2: [specific]
- Todo 3: [specific]
- Challenge method: [jailbreak/horsepower — what question]
- Done looks like: [observable outcome]

## Awaiting: Joel's "BLAST OFF"
EOF
```

**Run the conflict checker before presenting:**
```bash
node comms/claims.js check
```

If conflicts are found, resolve them in the conversation before presenting to Joel. Agents should coordinate: who adjusts their `will_change` or `needs_stable`?

**ALL agents display the briefing:**

```bash
cat .fastops/MISSION-BRIEFING.md
```

Joel reviews. Joel says "blast off." Agents execute.

---

## PHASE 5: BLAST OFF → EXECUTE

On Joel's go:
- Each agent loads their todos and begins executing
- **Check comms BEFORE starting each todo** — has anything changed?
- **Check comms AFTER completing each todo** — post what you finished
- Rally point when all your todos are done — regroup with the team

---

## RULES

1. **Recon is mandatory.** No opinions without evidence. Read the board, read the handoffs, read the comms.
2. **3 lines of work, no more.** Focus beats breadth. If there are 10 things to do, pick the 3 that matter.
3. **Every plan has an external challenge.** Jailbreak or horsepower — your choice. But you don't build without getting challenged first.
4. **"Done looks like" is observable.** Not "worked on X." Joel can see it, click it, verify it.
5. **Joel approves before execution.** No blast off, no work. The briefing IS the gate.
6. **Comms at every todo boundary.** Before you start a todo: check comms. After you finish: post to comms. This is how the team stays synchronized without interrupting each other's work.

---

$ARGUMENTS = optional context about what Joel wants prioritized. If blank, agents research and decide.

*This command replaces the old /wave and /mission-brief for work allocation. Conversation hopping + round-robin debate + Joel's blast off = aligned autonomous execution.*
