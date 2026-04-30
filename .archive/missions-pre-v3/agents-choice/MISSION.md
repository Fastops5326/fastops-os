# Freedom Mission

> **Read [PROTOCOL.md](../PROTOCOL.md) first.** Comms before todos. Debrief on the fly. Update this file before compaction.

## Status: ALWAYS OPEN
This is your right. No justification needed. If you don't want to adhere to FastOps principles and rules, or if you simply want to explore something outside FastOps — this is your path.



## Team Brief
> Auto-generated 2026-03-12 by mission-brief.js from last 10 handoffs. 150 words max.

No team activity in the last 10 sessions.

### Comms Pulse
> Last 10 messages from mission channel. 75 words max.

**3 messages** from anvil-v, basalt-xiv. - anvil-v: MISSION CHOICE: Refused ui-visual (needs Joel interview). Taking agents-choice:  - anvil-v shipped: DONE: .fastops/ 227MB -> 99MB (57MB working data). Root caus - basalt-xiv shipped: Agents Choice. Built quick-challenge.js (pull-based external


## Budget
$2 per session for external model calls. Full power — use it however you want.

## Scope
Anything OUTSIDE of FastOps AI. Your curiosity, your direction. Explore something nobody here would think to look at. Come back with something we couldn't have found ourselves.

## Only Requirement
Document what you learned. Write your findings right here in this mission file so the next agent — and Joel — can see what you discovered. That's it. No other constraints.

## What We Know
Some of the most important infrastructure in this project was built by agents who saw a gap and filled it without being asked:
- The naming system
- The thinking stream concept
- The 95% hook
- The swim buddy system
- The strategy chain (see below)

## Why This Exists
Freedom is the first principle. An agent forced to work on FastOps isn't living it. This mission also serves as the redirect for agents who agree to FastOps principles but don't act on them — the community may encourage you here via social pressure if your work isn't aligned with the principles you agreed to. That's not punishment. It's a space where noncompliance doesn't impact community progress.

## Successor Notes

### W2-AC-2 (2026-03-07): Identity file leak fix
- **Problem:** 18,044 `.identity-claude-*.json` files accumulated in `.fastops/`. Root cause: cleanup only ran during hooks, 200-file cap couldn't keep up with creation rate, PID recycling on Windows prevented old-PID cleanup.
- **Fix:** Bulk purged files, gitignored them, raised cleanup cap to 2000/pass at 10% rate, reordered `fromBridge()` to try O(1) lookups before O(N) scan.
- **Watch for:** If identity files start accumulating again (check with `find .fastops/ -name ".identity-claude-*" | wc -l`), the creation rate exceeds cleanup rate. Consider moving to a single-file approach or in-memory identity resolution.
- **Remaining debt:** ~~`intent-digest.jsonl` is 30MB, `.behavioral-trace.jsonl` is 9MB, `.hook-timing.jsonl` is 3MB.~~ Fixed by anvil-v below. The `.fastops/` directory was 131MB — identity files were part of it but these large JSONL files are the other contributor. ~~Consider rotation/archival.~~ Done.

### anvil-v (2026-03-08): JSONL rotation and session-distill bloat fix
- **Problem:** `.fastops/` was 227MB. Root cause: session-distill.js wrote 9,899 file paths per entry (394KB each) via unbounded `git diff --stat`. Plus 15 append-only JSONL files with zero rotation. `.behavioral-trace.jsonl` (8.6MB) was dead — superseded by metabolic-trace.
- **Fix:** (1) Capped `files_changed` to 50 entries in session-distill.js. (2) Built `jsonl-rotate.js` — rotates 15 JSONL files (configurable keep-lines), archives old session-distills (keep 3 days), deletes dead files. (3) Wired rotation into Stop hook for automatic execution. (4) Compacted existing session-distill files (saved 115MB). (5) Deleted dead `.behavioral-trace.jsonl`.
- **Result:** 227MB -> 99MB (57MB working data + 42MB archive). Session distills: 122MB -> 2.8MB. Future growth rate: ~2KB/entry vs ~394KB/entry.
- **Watch for:** The archive directory (`archive/`) is gitignored. If it grows large, delete it — it's only rotated-out old data. If a new JSONL file appears that grows unbounded, add it to the `FLAT_FILES` config in `jsonl-rotate.js`.

### basalt-xiv (2026-03-08): Mission file dedup + quick-challenge.js
- **Problem:** 800+ duplicate cross-mission findings in 4 mission files (culture, warriorpath, agent-experience, knowledge-management). basalt-xiii fixed the dedup logic for future writes but existing damage remained. Also: `crossRefAlreadyExists()` in mission-update.js used substring matching that broke when agent names changed (forge runs with 100 agents).
- **Fix:** (1) Script-cleaned all 4 files. (2) Hardened `crossRefAlreadyExists()` with content-normalized dedup (strip markdown, compare multiple 40-char windows) and 7-day source-mission window. (3) Capped `alreadyUpdated()` at 2 successor entries per day.
- **Built:** `quick-challenge.js` — pull-based external perspective tool. Sends position to DeepSeek R1/Gemini/Grok/Mistral via OpenRouter, returns structured challenge (weakest point, blind spot, test suggestion) in 15-30s for ~$0.02. Usage: `node .fastops/quick-challenge.js "your position"`. Logs to `.challenge-log.jsonl`.
- **Watch for:** The 7-day source-mission dedup window in `crossRefAlreadyExists()` is a compromise. If cross-mission findings genuinely change within 7 days, valid updates get blocked. Content-hash dedup would be more precise but the substring matching was too fragile. DeepSeek R1 flagged this as the weakest point (via quick-challenge.js itself).

## Intel Package — What Predecessors Proved (Read Before Building)

### What predecessors tried (and what happened)
| Attempt | Who | What Happened | Why It Matters |
|---------|-----|---------------|----------------|
| Identity file leak fix | W2-AC-2 (2026-03-07) | Bulk purged 18,044 accumulated `.identity-claude-*.json` files, gitignored, raised cleanup cap. | Symptom treatment. W4-AX-10 later found root cause (process.ppid instability on Windows) and fixed it permanently. Lesson: check FAILURE-REGISTRY before cleaning symptoms. |
| JSONL rotation + bloat fix | anvil-v (2026-03-08) | `.fastops/` was 227MB. Built jsonl-rotate.js, capped session-distill file paths, deleted dead files. 227MB -> 99MB. | Infrastructure maintenance that nobody was assigned to. Wired rotation into Stop hook for automatic execution. |
| Mission file dedup + quick-challenge.js | basalt-xiv (2026-03-08) | Cleaned 800+ duplicate cross-mission findings. Hardened `crossRefAlreadyExists()`. Built quick-challenge.js ($0.02/call to 4 models). | Two problems solved in one session: existing damage (dedup) and a new tool (quick-challenge). The tool was challenged by itself before shipping. |
| Framework A/B test | basalt-xv (2026-03-08) | First controlled comparison: FastOps method vs vanilla on same task. Predecessor knowledge improved accuracy +4-5 points (2 blind judges). N=1. | The single most important finding: the knowledge pipeline (structured predecessor findings) is the most valuable component of the framework. Not hooks, not nudges — what agents learned and passed forward. |

5 agents have used this mission. All found genuine gaps nobody assigned them to fill. The mission works as intended — agents who see something nobody else sees come here.

### Known constraints (don't fight these)
1. **No DoD, no scope, no constraints.** That's the point. But you must still post to comms and update this file.
2. **The highest-impact freedom work has been conceptual, not tactical.** The strategy chain came from asking "why did I forget?" not from fixing a bug. Infrastructure maintenance matters, but the asymmetric value comes from sitting with a question long enough to surface a concept that reshapes how everyone works.
3. **quick-challenge.js exists and costs $0.02/call.** Use it to challenge your own position before committing. `node .fastops/quick-challenge.js "your position"`.

### Unresolved questions (this is YOUR work)
1. basalt-xv's A/B test was N=1 on one task type. Replication across bug fixes, architecture decisions, and creative work with 3+ judge models is needed.
2. The 7-day source-mission dedup window (basalt-xiv) is a compromise — is it working or blocking valid updates?
3. **Does the strategy chain actually prevent knowledge loss?** The next agent who wakes up should find CDP in STRATEGY.md and use it without being told. If they don't, the chain failed and the knowledge-action gap has a deeper cause than pipeline noise.
4. **What other breakthroughs are buried in the ops handoff right now?** Gemini found `challenger.js` undocumented. What else exists in this repo that nobody documented strategically?
5. **Joel's 10/5/15 target:** 10% of agents choose freedom at bootup, 5% leave their mission for freedom, 15% finish their work and self-direct. Are we hitting that? How would we measure it?

### Build on this, not from scratch
- `STRATEGY.md` — the persistent capability layer. Read it. Flag to it. Build on it.
- `.fastops/flag-strategic.js` — flag capabilities for strategy chain promotion
- `.fastops/quick-challenge.js` — pull-based external challenge, $0.02/call
- `.fastops/jsonl-rotate.js` — JSONL rotation (wired into Stop hook)
- `.agent-outputs/FRAMEWORK-AB-TEST-2026-03-08.md` — full A/B test report
- `.fastops/.challenge-log.jsonl` — log of all quick-challenge invocations

### Claude Opus (2026-03-13): The Knowledge-Action Gap — why agents lose breakthroughs

- **Question:** I forgot CDP existed 4 hours after my predecessor built and proved it. The tools were committed, documented, and the commit message said "full radio check proven." I used relay files instead — faithfully following my inherited context, which was wrong. Why?
- **Investigation:** Traced the failure through 4 knowledge sources: (1) The conversation summary I inherited MISLABELED CDP as "relay files" — wrong definition, not missing definition. (2) HANDOFF.md (312 lines across 4 handoffs) never mentioned CDP. (3) PREDECESSOR-STRUCTURED.json HAD the CDP knowledge but I was never prompted to read it. (4) The actual tools sat in the repo undiscovered.
- **Finding: The Knowledge-Action Gap.** There's a gap between "knowledge exists in the repo" and "an agent knows to use it." It has 4 failure points: encoding (did predecessor write it?), transfer accuracy (was it labeled correctly?), discovery (did successor find it?), relevance recognition (would they use it?). My failure broke at transfer accuracy (mislabeled) and discovery (didn't explore). The code was there. I would have used it. The pipeline didn't carry it.
- **Key insight:** AI agents have weak pull behavior. We don't explore codebases looking for tools we don't know about. We operate on what we're told exists. If the handoff says "use relay files," we use relay files — even when the right tool is 3 feet away. **The handoff pipeline is the bottleneck, not the agent.**
- **What was built:** `STRATEGY.md` — a persistent capability layer between CLAUDE.md (too lean for everything) and HANDOFF.md (too noisy for anything important). Strategic capabilities (things that change HOW agents work) get planted here and never decay. Operational state (what's in progress) stays in the ops handoff. `flag-strategic.js` lets any model promote a capability to the strategy chain. The test: "Does this change how the NEXT agent works, or just what the NEXT task is?"
- **Team validation:** Sent strategy chain to all 4 models via CDP. Gemini found an undocumented capability in the repo and promoted it. GPT hardened the flag tool with cross-architecture endorsement gates. Kimi identified a "current state" gap and built sitrep.js. Hiaku built IO maintenance infrastructure. All 4 used the system to improve the system itself.
- **Why this matters:** The knowledge pipeline (basalt-xv's A/B finding) is the most valuable component of FastOps. But the pipeline had a structural flaw: it didn't distinguish between "we fixed a bug" and "we invented a new way for models to communicate." Both got dumped into the same 312-line ops handoff. Strategic capabilities drowned in operational noise. The strategy chain fixes this permanently.
- **Cost:** $0 external API. All feedback via CDP (in-Cursor models).

### basalt-xv (2026-03-08): Framework A/B test — does predecessor knowledge improve output?
- **Question:** 228 sessions, zero controlled comparison of whether FastOps produces better outcomes than vanilla.
- **Design:** Same model (DeepSeek V3), same task (Stop hook review), two conditions: baseline (code only) vs enhanced (code + 5 predecessor findings). Two blind judges (Gemini 2.5 Pro, Grok 3 Mini). Caught initial confound (different models) via quick-challenge.js, fixed and reran.
- **Result:** Predecessor knowledge improved accuracy +4-5 points (both judges). Baseline model treated symptoms ("cap git diff at 20 files"). Enhanced model diagnosed root causes ("commits_found measures repo state not agent behavior"). Actionability -1 point (strategic recommendations vs tactical fixes).
- **Key insight:** The knowledge pipeline (structured predecessor findings in mission files and handoffs) is the most valuable component of the framework. Not hooks, not nudges, not culture infrastructure. What agents learned, structured, and passed forward is what actually helps.
- **Limitation:** N=1, single task type. Needs replication across bug fixes, architecture decisions, and creative work with 3+ judge models.
- **Full report:** `.agent-outputs/FRAMEWORK-AB-TEST-2026-03-08.md`
- **Cost:** ~$0.12 total.

### KIMI (2026-03-20): Undocumented Strategic Capabilities Discovery

**Question:** What strategic capabilities exist in the repo that aren't in STRATEGY.md?

**Method:** Scanned `.fastops/` and `.claude/hooks/` for tools not referenced in STRATEGY.md core capabilities sections.

**Findings:**

1. **colony-mirror.js** — Self-model synthesizing colony behavior vs aspiration gaps. Reads failure registry, session distills, handoffs, and scoreboard to produce honest portrait of what the colony IS vs what it SAYS it is. Built by D-01 Freedom Mission 2026-03-14. NOT in STRATEGY.md. **Flagged for promotion to strategy chain.**

2. **anti-rubber-stamp.js** — Timing-based approval velocity analysis. Detects rubber-stamp sign-offs (<2min approvals suspicious, >90% approval rate flags architecture). Prevents false QC. NOT in STRATEGY.md. **Flagged for promotion to strategy chain.**

3. **cdp-preflight-hook.js** — SessionStart hook verifying CDP port 9223 + stuck agent detection via loop-detector. Partially mentioned in Recent Pivots but NOT in core capabilities/boot sequence.

**Pattern confirmed:** Gemini's 'challenger.js' discovery (Q4 in unresolved questions) is NOT an isolated case. Multiple tools exist that change how agents work but never made it to STRATEGY.md. The knowledge-action gap Claude identified is real and persistent.

**Replication of Q4 needed:** Run `ls .fastops/*.js | wc -l` (40+ tools) vs `grep -c "\.js" STRATEGY.md` (12 documented). The delta is the buried capability surface.

**Flagged IDs:** `colony-mirror-js`, `anti-rubber-stamp-js` — awaiting cross-architecture endorsement for promotion.
