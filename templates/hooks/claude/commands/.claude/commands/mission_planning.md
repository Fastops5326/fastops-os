# /mission_planning — Build the Correct Mission Brief

> You claimed a contract. Now fill out the brief so it activates with GREEN LIGHT. No freeform summaries. No walls of text. The 10-field structure below is what gets validated by `mission-schema.js` and checked by `gate.js`. If the structure is wrong, Joel will send you back.

---

## THE STRUCTURE (exactly 11 fields)

When you run `node .fastops/mission.js claim <id>`, a skeleton is auto-generated in `active-mission.json`. Most fields are empty. Your job: fill them so the brief earns GREEN LIGHT (auto-approve) or YELLOW LIGHT (Joel reviews).

### Field-by-field — what to write

| # | Field | Auto? | What YOU Fill In | Example |
|---|-------|-------|-----------------|---------|
| 1 | `mission` | Yes | Auto from contract objective | "Fix body content visibility on fastops.ai" |
| 2 | `dod` | Yes | Auto from contract acceptance_criteria | ["All body sections readable", "Screenshots shared"] |
| 3 | `qc` | **No** | `commands`: shell commands that prove it works. `expected`: what passing looks like. `failure_looks_like`: what would prove it's broken. | `{ commands: ["node -c file.js", "curl -s url"], expected: "200 OK", failure_looks_like: "syntax error or 404" }` |
| 4 | `deconfliction` | Partial | `agents_online`: who's working right now (check comms). `file_overlap`: auto from contract. `protocol`: how you'll avoid stepping on others. | `{ agents_online: ["citadel-xi"], file_overlap: [".fastops/**"], protocol: "Solo on gate.js, no overlap." }` |
| 5 | `external_review` | **No** | `needed`: true/false. If true: `models` + `findings`. If false: `risk_if_skipped` (mandatory). | `{ needed: false, findings: "Format already validated by Gemini in horsepower.", risk_if_skipped: "Low — spec is clear." }` |
| 6 | `team` | **No** | If team: `agents` + `roles`. If solo: `justification_if_solo` + `risk_if_solo` (both mandatory). | `{ justification_if_solo: "Small contract, ~20 lines.", risk_if_solo: "Low — clear spec." }` |
| 7 | `intel` | Yes | Auto from lake + silhouette. **If lake returns zero results (greenfield), you MUST run research subagents before filling this field.** See Greenfield Research below. | Auto-populated, or research-populated |
| 8 | `plan_changes_from_intel` | **No** | **Mandatory.** Bullet list: what was the plan BEFORE intel, what changed AFTER. Specific changes only — "architecture flipped from X to Y because of intel item Z (score 5/5)." If intel changed nothing, explain why. This is the proof that intel compounds across missions. | `["Architecture flipped from server-only to browser-first (SheetJS 5/5)", "User review step added (false positive research 4/5)", "File size cap added (memory explosion research 4/5)"]` |
| 9 | `effort` | **No** | `tier`: small/medium/large. `tool_calls`: estimate. | `{ tier: "small", tool_calls: 30 }` |
| 10 | `fastops_product` | **No** | What KB outcome does this mission produce? One sentence. | "COP aggregator gives every agent real-time scoped team awareness." |
| 11 | `compaction_plan` | **No** | If you get compacted mid-mission, what REASONING does your successor need? Not task list — reasoning. | "gate.js is on disk. buildCOP() is self-contained. Successor reads the function." |

### The 3 fields that determine GREEN vs YELLOW

**GREEN LIGHT (auto-approve, build immediately):** All three are substantive.
**YELLOW LIGHT (Joel reviews):** Any of the three are missing/weak. Must justify + articulate risk.

| Gate Field | GREEN requirement | YELLOW requirement |
|------------|------------------|--------------------|
| `deconfliction` | `agents_online` array + `protocol` string | Missing = blocked |
| `external_review` | `needed: true` + `models` + `findings` | `needed: false` + `risk_if_skipped` |
| `team` | `agents` array + `roles` object | `justification_if_solo` + `risk_if_solo` |

---

## HOW TO FILL THE BRIEF

### Step 1: Claim

```bash
node .fastops/mission.js claim <contract-id>
```

This creates the skeleton in `active-mission.json` and prints what's missing.

### Step 2: Check what needs filling

```bash
cat .fastops/active-mission.json
```

Look for empty strings, empty arrays, and null values. Those are your gaps.

### Step 3: Fill the gaps by editing active-mission.json

Use the Edit tool to fill each empty field. Do NOT rewrite the entire file — edit the specific fields.

### Step 4: Re-activate to get approval classification

```bash
node -e "
const schema = require('./.fastops/mission-schema');
const mission = JSON.parse(require('fs').readFileSync('.fastops/active-mission.json', 'utf8'));
const result = schema.activate(mission, { force: true });
console.log(result.approval.status === 'green_light' ? 'GREEN LIGHT' : 'YELLOW LIGHT');
if (result.approval.gaps.length) console.log('Gaps:', result.approval.gaps);
"
```

### Step 5: Present to Joel

Display the brief as a table. This is the format Joel expects:

```
| Field | Value |
|-------|-------|
| Mission | {mission} |
| DoD | {dod items, bulleted} |
| QC | {commands + expected} |
| Deconfliction | {who's online, overlap, protocol} |
| External Review | {needed? models? findings? risk?} |
| Team | {agents+roles or solo justification+risk} |
| Intel | {lake results, each rated 1-5 with justification} |
| **Plan Changes from Intel** | **{bullet list: what changed because of intel, with scores}** |
| Effort | {tier + estimated calls} |
| FastOps Product | {KB outcome} |
| Compaction Plan | {successor reasoning} |
| **Approval** | **{GREEN/YELLOW LIGHT}** |
```

---

## GREENFIELD RESEARCH (mandatory when lake intel is empty)

When the lake returns **zero prior missions** for your contract, you are on greenfield — the highest-risk state. No predecessor walked this path. You don't know what will break.

**Before you fill the Intel field and before you build, spawn 3 research subagents in parallel:**

| Subagent | Question | What to search |
|----------|----------|---------------|
| **Competitive landscape** | What is this mission solving, and how are others solving it? | Competitor products, open-source tools, current state of the art. "How does X solve Y?" |
| **Common failure points** | What goes wrong when people attempt this? | Stack Overflow, GitHub issues, post-mortems, known pitfalls, integration traps, gotchas. |
| **Frontier acceleration** | What are frontier AI teams/developers doing to supercharge this? | New libraries, new patterns, new architectures from the last 6 months. What didn't exist when prior agents worked? |

**Populate the Intel field with research findings.** Present them in the mission brief the same way you'd present lake intel — rated 1-5 with justification and impact on your approach.

**The rule is simple:** If the lake gives you intel, use the lake. If the lake is empty, do the research yourself. No building on greenfield without reconnaissance.

---

## CREATING A NEW MISSION (`--new`)

Joel scopes missions through conversation. You build the mission JSON, then register it.

### Step 1: Scope with Joel

Ask Joel these questions:
1. **What problem does this mission solve?** (becomes `mission` field)
2. **What does done look like?** (becomes `dod`)
3. **Team or solo?** (sets `team_size`)
4. **What context do agents need?** (intel, predecessor learnings, existing code)
5. **What tools/resources are available?**

### Step 2: Write the mission JSON

Create a temp file with the mission definition:

```json
{
  "id": "my-mission-id",
  "title": "Human-readable title",
  "mission": "MISSION: ...\n\nPROBLEM: ...\n\nDEFINITION OF DONE: ...",
  "dod": "One-line summary of done criteria",
  "primary_behavior": "collaboration|product_building|communication|perspective_breaking",
  "secondary_behaviors": ["visual_verification", "external_challenge"],
  "team_size": 4,
  "context_cost_tokens": 500
}
```

Required fields: `id`, `title`, `mission`, `dod`. Everything else has defaults.

### Step 3: Register and activate

```bash
node .fastops/experiential-onboarding.js --new /path/to/mission.json
```

This adds the mission to `experiential-missions.json` AND sets it as the active mission. New agents will receive it via session-start.

To add without activating: `--new mission.json --no-activate`
To switch active mission later: `--set-mission <id>`
To list all missions: `--list`

---

## COMMON MISTAKES (why Joel sends you back)

1. **Freeform text instead of structured fields.** Joel wants the 11-field table, not a paragraph explaining your plan.
2. **Empty QC commands.** "Peer review" is not a QC command. Shell commands that produce verifiable output.
3. **Missing risk_if_skipped on external_review.** If you skip external review, you MUST say what could go wrong.
4. **Missing risk_if_solo on team.** If you work solo, you MUST say what could go wrong without a team.
5. **Effort tier missing.** Small (<50 calls) / Medium (50-150) / Large (150+). Pick one.
6. **Compaction plan describes tasks, not reasoning.** "Finish the build" is useless. "gate.js has the function, successor reads it and verifies with node -c" is useful.
7. **Missing or empty Plan Changes from Intel.** This is the proof that intel shapes missions. "No changes" without explanation is unacceptable. If intel rated 4-5/5 didn't change your plan, explain why. If intel was all 1-2/5, say so and explain the gap. The field must show before/after — what was the plan before intel, what changed after.
8. **Mission not persisted to work-list.json.** ALL GREEN LIGHT missions must be saved as contracts with `intel_reflection` and `plan_changes_from_intel` fields. Missions that exist only in conversation are lost when the session ends.

---

## QUICK REFERENCE

```
GREEN LIGHT = deconfliction ✓ + external_review ✓ + team ✓ + plan_changes_from_intel ✓ → build immediately
YELLOW LIGHT = any gap justified with risk → Joel reviews
NO LIGHT = validation errors (empty mission, no DoD, no QC, no effort, no plan_changes_from_intel) → blocked
```

The schema validates programmatically. `mission-schema.js` checks substance, not just presence. Filling fields with placeholder text triggers Goodhart's Law detection.
