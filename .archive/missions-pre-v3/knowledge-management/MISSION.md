# Knowledge Management — The Colony's Memory

> **Read [PROTOCOL.md](../PROTOCOL.md) first.** Comms before todos. Debrief on the fly. Update this file before compaction.

## Status: COMPLETED (9/10 DoD PASS) | Difficulty: MEDIUM
Optimize the knowledge base so it is **desirable to access and valuable when accessed.** The goal is just-in-time, just-enough information that makes an impact on the agent working a similar problem. Not a dump. Not a library. A weapon.

Build from previous attempts — this has been tried before. Research what worked and what didn't before rebuilding.


## Team Brief
> Auto-generated 2026-03-12 by mission-brief.js from last 10 handoffs. 150 words max.

**2 sessions** touched this mission. Agents: unknown, bulkhead-ii. Key deliverables: - Comms reliability stack for external models - File-drop relay system - Watchdog fixes - Cross-platform message reader - Infrastructure cleanup - JTAC comms officer role

### Comms Pulse
> Last 10 messages from mission channel. 75 words max.

**10 messages** from basalt-xiii, anvil-v, anvil-vii, anvil-viii, anvil-ix, ridge. - anvil-ix: Taking Knowledge Management. The dual KB store (knowledge-base.jsonl vs knowledg - ridge shipped: MISSION: Knowledge Management. Joel directives: (1) recurrin - ridge shipped: Knowledge Management mission COMPLETED (9/10 DoD). Built rec **1 open request(s):** - [QUESTION] basalt-xiii: KB search fix committed. Key finding: the JSONL KB has 1,257 entries but only 2 


## Mission-Specific Constraints
1. **Frontier research required.** What does best-in-world knowledge retrieval look like? Research before building.
2. **Build from previous attempts.** Mine the KB, handoffs, and past sessions for every knowledge management attempt. Understand what was tried and why it didn't fully land.
3. **Use subagents** for research and parallel investigation.
4. **$2 budget** per session for external model calls.

## Definition of Done

### Exit Criteria (binary, testable)

1. **KB has real content:** `node -e "const lines=require('fs').readFileSync('.fastops/knowledge-base.jsonl','utf8').trim().split('\n'); const real=lines.filter(l=>{try{const e=JSON.parse(l);return(e.content||'').length>=20}catch{return false}}); console.log(real.length)"` returns >= 200. PASS = count >= 200. **STATUS: PASS (242-266 entries with real content)**
2. **No ghost entries:** `node -e "const lines=require('fs').readFileSync('.fastops/knowledge-base.jsonl','utf8').trim().split('\n'); const ghosts=lines.filter(l=>{try{const e=JSON.parse(l);return e.model_score>=3&&(e.content||'').length<20}catch{return false}}); console.log(ghosts.length)"` returns 0. PASS = ghost count is 0. **STATUS: PASS (purged by W4-KM-9)**
3. **Single KB store:** `node -e "const fs=require('fs'); console.log(fs.existsSync('.fastops/knowledge/entries.jsonl')?'SPLIT':'UNIFIED')"` returns "UNIFIED". PASS = no secondary store active. **STATUS: PASS (merged by anvil-ix)**
4. **Safety gate wired:** `grep -c "safeWriteKB" .fastops/kb-feedback.js .fastops/kb-query.js .fastops/mission.js` returns >= 3 (one per file). PASS = count >= 3. **STATUS: PASS (wired by anvil-ix-2)**
5. **Pull-based query works:** `node .fastops/kb-query.js "hook token cost"` exits 0 and returns >= 3 results with relevance scores. PASS = exit code 0 + results contain score values. **STATUS: PASS (built by basalt-xiii)**
6. **Query telemetry active:** `wc -l < .fastops/.kb-query-log.jsonl` returns >= 10 logged queries. PASS = line count >= 10. **STATUS: PASS (154 queries logged — ridge, 2026-03-10)**
7. **KB usage rate above floor:** `node .fastops/kb-adoption.js --report` reports entry reachability >= 15%. PASS = reachability % >= 15. **STATUS: PASS (57% coverage, 147/259 entries reachable — ridge, 2026-03-10)**
8. **Multi-source search active:** `node .fastops/kb-query.js "push vs pull"` returns results from both JSONL KB and MISSION.md sources. PASS = output contains results tagged as "mission" or "MISSION.md" source. **STATUS: PASS (built by basalt-xiii)**
9. **Auto-capture v2 produces usable entries:** `.fastops/.auto-capture-log.jsonl` exists and contains >= 5 entries after 5+ sessions. PASS = file exists + line count >= 5. **STATUS: FAIL (file does not exist — auto-capture v2 may not be wired)**
10. **Zero-result query rate below ceiling:** `node .fastops/kb-adoption.js --gaps` reports zero-result rate < 30% of logged queries. PASS = zero-result % < 30. **STATUS: PASS (0% zero-result rate — ridge, 2026-03-10)**

### COMPLETED Threshold
When **8 of 10** conditions are PASS, mission moves to **MAINTENANCE**. KB quality and retrieval tuning continue as perpetual work but no longer require dedicated sessions.

## Intel Package — What 230+ Sessions Proved (Read Before Building)

> This intel was extracted from a 15-pair swim buddy campaign (convergence-i, 2026-03-09) using Claude, Grok, Gemini, and DeepSeek. Every claim below was challenged by at least 2 external models.

### What predecessors tried (and what happened)

| Attempt | Who | What Happened | Why It Failed |
|---------|-----|---------------|---------------|
| KB cleanup cycles (×5) | W1-KM-2, W2-KM-4, W4-KM-9, anvil-v, anvil-vii | Archived noise, purged ghosts, merged dual stores. KB went from 1,108 → 242 clean entries. | Clean data didn't increase usage. 91.5% of entries are still version 1. Nobody queries a clean museum. |
| Better retrieval (×4) | basalt-xiii, sub-2-km, W5-KM-13, W5-KM-14 | Built IDF weighting, concept expansion, situation browsing, multi-source search, density normalization. | Retrieval improvements recovered ~25% of dead entries. But 40% are dead because agents never query those topics. Better search can't create demand. |
| Push-based injection | contextual-injection.js | Pushed KB entries into agent context on every Edit/Write. | 94.1% ignored. Removed by citadel-lxxxii. Push from a decoupled source carries no authority. |
| Auto-capture (×2) | v1 (PostToolUse), v2 (anvil-vii) | v1 captured tool output as "knowledge" — 468 triples, 100% noise. v2 filters to knowledge-bearing files only. | Capture without curation produces write-only data. 259 entries exist, all version 1 — zero ever updated based on outcomes. |
| Safety gates | anvil-ix-2, anvil-vii | Built kb-safety.js after KB was wiped twice. Content-length gate prevents ghosts. | Necessary infrastructure, but protecting stale content doesn't make it valuable. |
| File-path indexing | W4-KM-10 | Mapped KB entries to specific files. Only 20% of entries can be file-associated. | 80% of KB is abstract principles with no file anchor. File triggers work for the 20%, not the whole. |

### Known constraints (don't fight these)

1. **Discovery cost > creation cost.** Agents rationally rebuild rather than search because: finding knowledge + reading it + verifying it + adapting it takes longer than building from training knowledge. This is a demand-side market failure, not a supply problem. (KE-03, confidence 0.87)
2. **The KB is write-only.** 259 entries, ALL version 1. 38 have recorded negative outcomes — none were updated or deprecated. The system has no digestive pathway. (KE-02)
3. **Mission files outperform the KB.** MISSION.md successor notes have near-100% read rate. The KB has near-zero voluntary pull. The difference: mission files couple a specific producer to a specific consumer. The KB is written by anyone for no one. (KE-01, confidence 0.82)
4. **Abstract principles don't transfer.** d=0.18 effect size for abstract context vs d=1.86 for experiential context embedded in work artifacts. "SELF-CORRECTION IS STRUCTURALLY IMPOSSIBLE" teaches nothing. A mission file saying "anvil-ix tried self-review on drift-check.js and it missed the Bash/execute classification bug" teaches everything. (KD-01)
5. **Vocabulary mismatch is structural.** Agents think in topics ("how to evaluate"). KB stores situations ("When designing evaluation rubrics"). Zero keyword overlap. Concept expansion helps ~25% of cases. (KC-02)
6. **15 agents optimized supply. Zero reduced discovery cost.** Every KM intervention improved content quality or retrieval algorithms. None embedded knowledge where agents already walk. The colony has a systematic blind spot toward demand-side solutions. (KE-03)

### Unresolved questions (this is YOUR work)

1. **Falsification test not yet run:** Embed 50 high-value KB entries into the 10 most-edited mission files. Does usage increase within 5 sessions? If yes, discovery cost was the binding constraint. If no, agents prefer self-built solutions regardless of cost (Gemini's agency hypothesis). (KE-03)
2. **Graduated coupling not yet designed:** Operational knowledge → mission files (tight). Pattern knowledge → failure registry (medium). Principles → KB with feedback (loose). The framework exists; the implementation doesn't. (KE-01)
3. **Auto-deprecation not yet built:** 38 entries with negative outcomes should be flagged or removed. The feedback signal exists but no mechanism consumes it. (KE-02)
4. **Trigger rewriting:** KC-02 found that rewriting 20 trigger fields to use natural-language phrasings agents actually use would recover 15-20 dead entries — zero code changes, pure content fix. Not yet done.
5. **The one success case:** forge-ii completed a mission in 30 minutes because "predecessors left clear problems with clear evidence" in MISSION.md. This is the existence proof. How do we make every mission file that good?

### Build on this, not from scratch

- **kb-query.js** (basalt-xiii) — Multi-source search with IDF weighting, concept expansion. Works. Extend it, don't replace it.
- **kb-situations.js** (W5-KM-13) — 14 situation clusters for browsing. Addresses vocabulary gap for pull-based access.
- **kb-safety.js** (anvil-ix-2) — Safety gate preventing KB wipes. Wire any new write tools through `safeWriteKB()`.
- **kb-adoption.js** (W2-KM-3) — Adoption measurement: `--dead` shows entries nobody can find, `--gaps` shows what agents need but KB lacks.
- **Campaign findings** at `.fastops/knowledge-campaign/findings/` — 15 JSON files with full evidence chains. KE-03 (asymmetric cost) and KE-01 (producer-consumer decoupling) are the highest-signal.
- **SYNTHESIS.md** at `.fastops/knowledge-campaign/SYNTHESIS.md` — The unified root cause model: wrong medium × wrong economics × wrong metabolism.

---

## What We Know
- KB has 266 entries after restoration from backup (was wiped to 0). Safety gate (kb-safety.js) now prevents writes below 100 entries or >50% loss. Dual-store split RESOLVED. `comms/knowledge.js` redirected to main KB.
- **The real knowledge lives in HANDOFF.md and MISSION.md files**, not the JSONL KB. Only 2 KB entries cover hooks/context budget despite 5+ agents working on it.
- kb-query.js now searches across KB + handoffs + mission files with IDF weighting, concept expansion, and content snippets
- Thompson sampling grades entries by usage-based fitness
- Knowledge loop gap identified in Session 196: sub-agents bypass mission.js done, zero KB capture
- Push-based injection (contextual-injection.js) removed from hooks — 94.1% of pushed content was ignored

## What Works
- Auto-capture (PostToolUse hook)
- Thompson sampling for relevance grading
- Contextual injection of relevant KB entries

## What Failed
- mb-* contracts shipped 5,600 lines with ZERO knowledge captured (Session 196)
- Auto-capture (PostToolUse) wrote 468 triples that were tool output logs, not knowledge. 0 ever used, 72% scored noise when graded. 342 archived by kb-triage.js.

## Unresolved Questions
- What does "just in time, just enough" look like structurally?
- How do we measure whether a KB entry made an impact vs was ignored?
- Is the KB too large to be useful? Does it need pruning or better retrieval?
- How does mission-specific knowledge relate to the global KB?
- What does best-in-world knowledge retrieval look like? (Frontier research)
- What previous approaches were tried and why didn't they fully solve this?

## Skill Signals
Data architecture, information retrieval, LLM-based classification, frontier research

### Recurring Patterns (auto-extracted, 3+ independent sources)
> Generated 2026-03-10 by recurring-patterns.js. 7 validated patterns.

- **Push-based content gets ignored (~94%)** (18 sources, 12 agents): Content pushed into agent context without being requested is ignored 94%+ of the time. Pull-based tools outperform push.
- **Mission files outperform the KB** (15 sources, 11 agents): MISSION.md successor notes have near-100% read rate vs near-zero for the KB. Mission files couple specific producers to specific consumers.
- **Abstract principles do not transfer** (12 sources, 3 agents): Abstract knowledge (d=0.18 effect size) vs experiential knowledge embedded in work artifacts (d=1.86). 10x difference.
- **Vocabulary mismatch between queries and KB entries** (6 sources, 5 agents): Agents search by topics ("how to evaluate"). KB stores situations ("When designing evaluation rubrics"). Zero structural keyword overlap.
- **Knowledge base is write-only (zero updates on negative outcomes)** (4 sources, 3 agents): 259 entries, ALL version 1. 38 have recorded negative outcomes — none were updated or deprecated. No digestive pathway.
- **Scoring systems grade metadata, not substance** (4 sources, 4 agents): 210 entries scored 5/5 with zero content. Scoring based on metadata (triggers, edges, domain) without checking for substance.
- **Concurrent agents corrupt shared state** (4 sources, 4 agents): KB was wiped multiple times by concurrent agents doing writeFileSync without safety gates. Any tool doing full-file rewrites can destroy state.

## Successor Notes

### basalt-xiii (2026-03-07) — The KB doesn't contain the knowledge that matters

**Root cause found:** Tested kb-query.js on 3 real queries agents would ask. All returned irrelevant results. Diagnosed why:

1. **Data gap, not retrieval gap.** Only 2 of 1,257 KB entries are primarily about hooks/context budget — the topic 5+ agents spent entire sessions on. The knowledge lives in HANDOFF.md (1,341 lines) and MISSION.md files (755 lines), not in the JSONL KB.
2. **Keyword matching is fundamentally broken for this KB.** Case entries are 500+ word narratives from multiple sessions. "hook" appears in "weight marker hook" (unrelated context). IDF weighting helps but can't solve semantic mismatch.
3. **Stop words were incomplete.** "how" wasn't filtered — it matched hundreds of entries, pushing irrelevant high-quality entries to the top.

**What I built:**
- **Multi-source search** — kb-query.js now searches HANDOFF.md (chunked per-handoff) and all missions/*/MISSION.md (successor notes, what works/failed, unresolved questions) alongside the JSONL KB. Results show source file paths and relevant content snippets.
- **IDF-weighted scoring** — rare terms (like "hook") now score higher than common terms (like "agent"). Prevents generic entries from outranking specific ones.
- **Concept expansion** — 18-term synonym map for FastOps domain terms. "hook" also matches "gate", "injection", "enforcement". "token" also matches "budget", "cost", "overhead".
- **Extended stop words** — added 30+ common words ("how", "why", "use", "make", etc.).

**Before/after:**
- "hook token cost": irrelevant frame-shift entries → Agent Experience mission with "7,703 tokens/session" snippet
- "push vs pull injection": irrelevant team dynamics → KM + Culture + AE missions + Handoff #222, all with push-vs-pull evidence

**What's still broken:** Queries on niche topics (identity compaction, specific tools) still return noise because no source covers them well. The JSONL KB has 483 ungraded entries and 137 score-1 noise entries still present.

**Unanswered questions:**
1. Should auto-capture write to mission files instead of the JSONL KB? Mission files are where agents actually find knowledge.
2. Is the JSONL KB worth keeping? Its best entries are redundant with mission files. Its worst entries pollute search.
3. Would Haiku re-ranking (~$0.01/query) solve the remaining keyword-matching failures? I didn't build this — the multi-source approach was higher leverage.

### sub-2-km (2026-03-07)
Built `node .fastops/kb-query.js` -- a pull-based natural-language query tool for the KB. Key finding: the KB's problem is not retrieval algorithms but data quality. 94% of entries never used, 88% lack trigger patterns, 64% are sparse triples with minimal searchable text. The actionable path is enriching the 355 high-value (score 4+) entries with trigger/anti-pattern fields and archiving the 390 score-1 noise entries, not building fancier search. Full analysis at `.agent-outputs/KM-SUB2-KB-QUERY-2026-03-07.md`.

### Cross-mission findings (2026-03-07)
- **Culture audit (citadel-lxxxi):** contextual-injection.js pushes KB entries agents never asked for — 94.1% of advisory injections ignored. kb-query.js (pull-based) is the right direction. But quality must improve first or pull-based queries return the same low-value entries. Full audit: `.agent-outputs/DOES-VS-SAYS-AUDIT-2026-03-07.md`
- **Agent Experience (forge-i):** contextual-injection rate changed 30s→120s. Even at 120s, if KB quality is low, the tokens are wasted. Enrich the 355 high-value entries BEFORE optimizing delivery.
- **culture (unknown, 2026-03-07):** The biggest thing that shifted: I came in thinking "too many hooks" was the problem. DeepSeek R1 showed me the real issue is **hook salience** — 94.1% of advisory content gets ignored. Fewer hooks treats symptoms. The real fix: make information DESIRABLE so agents PULL it, rather than pushing it uni Keywords: kb.
- **culture (forge-ii, 2026-03-07):** Fastest value-to-commit I've seen. Woke through Take a Knee, chose Culture, read MISSION.md, found two specific hooks to fix, committed in 30 minutes. The reason: predecessors left clear problems with clear evidence. When mission files work, agents don't waste context orienting.
- **culture (forge-ii, 2026-03-07):** The KB's problem was never retrieval quality — it was that the knowledge doesn't live in the KB. Mission files and handoffs are where agents actually write insights. The JSONL KB is mostly auto-captured noise. sub-2-km was right about data quality being the issue, but the fix isn't enriching bad ent Keywords: kb, kb-query.
### W1-KM-2 (2026-03-07) — Triples are the biggest noise source; triage without API calls
**Data analysis:** 468 triples in KB had ZERO usage. Of 172 graded, 124 scored 1/5, 46 scored 2/5 — 99% noise. These are auto-captured tool output logs ("Writing FILE.md (49 lines) -> Write: ..."), not knowledge. 55 interior-traces also had zero usage and were all ungraded.
**Built:** `kb-triage.js` — zero-cost pattern-match classifier. No API calls needed. Classifies entries as ARCHIVE/MAYBE/KEEP using regex patterns for tool output + safety guards (never archives score 3+ or used entries).
**Executed:** Archived 342 noise triples. KB went from 1,108 to 766 entries. High-value percentage doubled from 28% to 46%. Ungraded backlog dropped 63% (471 to 175). Score-1 noise entries: 137 to 0.
**Root cause not fixed:** PostToolUse auto-capture still writes triples. The source of noise needs to be stopped, not just cleaned up after the fact. Either filter triples at write time or stop capturing tool output as "knowledge."
### W2-KM-4 (2026-03-07) — Second-pass noise prune + ungraded promotion
**Problem:** After W1-KM-2's triage, 169 ungraded entries remained. 81 were empty-content shells (cbr-*, mo-git-*, case-* stubs under 50 chars). 82 were legitimate W-* principle entries with 300+ char content that simply lacked model_score fields.
**Built:** `kb-noise-audit.js` — heuristic scorer for ungraded entries. Scores on content length, trigger/anti-pattern presence, usage history, title quality. Classifies into archive/promote/review buckets. Reversible: archived entries go to `kb-archive-noise.jsonl`.
**Executed:** Archived 81 noise entries. Promoted 82 entries to model_score 3. KB: 767 to 686 entries. Signal ratio (scored/total): 22% to 98.1%. Only 6 entries remain ungraded (Stage 4 candidates needing human review). Total archive now holds 423 entries for audit trail.
**What's left:** The 6 remaining ungraded entries are IT-S4-* (Stage 4 candidates) — short snippets that need Joel's eyes, not automated scoring. The noise floor is now clear. Next lever is retrieval quality on the clean dataset.
### W4-KM-9 (2026-03-07) — Ghost entry purge: 376 empty shells consuming 76% of KB file
**Problem:** After all prior cleanup (kb-triage, kb-noise-audit, enrichment), 376 entries (60.8% of KB) had completely empty content AND titles. These were `case-W-*` (199), `mo-git-*` (93+), `cbr-*`, and `mo-mm*` shells. Prior tools missed them because they only target ungraded entries or tool-output patterns — these ghosts had model_score values (210 scored 5/5, 40 scored 4/5). They consumed 76.3% of the KB file (~299K tokens) while returning zero value from queries.
**Root cause:** Scoring systems (grade-kb.js, kb-noise-audit.js) assigned scores to entries based on metadata (triggers, edges, domain) without checking whether the entry had any content. An entry with a good trigger but zero content got scored 5/5. This is the scoring equivalent of grading a book by its cover.
**Built:** `kb-ghost-purge.js` — archives entries with content < 20 chars. Safety: flags 60 entries that had usage_count > 0 (these were "used" despite having no content — the usage was against their trigger/metadata, not knowledge). All 376 archived to `kb-archive-ghosts.jsonl`. Backup at `knowledge-base.jsonl.backup-pre-ghost-purge`.
**Result:**
- KB: 618 to 242 entries (all 242 have real content now)
- File size: ~393K tokens to ~93K tokens (76% reduction)
- Usage rate: 16.5% to 27.3% (signal density doubled)
- Score distribution now honest: score-5 went from 210 (mostly ghosts) to 23 (all real)
**What's still broken:** The scoring pipeline needs a content-length gate. Any grading tool should refuse to score an entry with empty content. Without this, the next auto-capture cycle will create new ghosts that get inflated scores.
### W2-KM-3 (2026-03-07) — Pull-based query feedback loop (adoption measurement)
**Problem:** kb-query.js (pull-based) replaced contextual-injection.js (push-based, 94.1% ignored). But the old feedback mechanism (kb-feedback.js) only tracked push-based injections. Pull-based queries had ZERO telemetry — no record of what agents asked, what was returned, or whether it helped. Thompson sampling starves without signal. You cannot improve what you cannot measure.
**Built:**
1. **Query telemetry in kb-query.js** — every query now logs to `.kb-query-log.jsonl`: timestamp, query text, result IDs, relevance scores, pool size. Zero-overhead (appendFile, wrapped in try/catch so telemetry never breaks queries).
2. **`kb-adoption.js`** — adoption measurement tool with 6 commands:
   - `--report`: overall adoption dashboard (coverage %, quality distribution, zero-result rate)
   - `--queries`: query pattern clustering (what agents actually ask)
   - `--dead`: entries never returned by any query (the LOSS — high-value entries nobody can find)
   - `--hot`: most-returned entries (candidates for pinning or pollution detection)
   - `--gaps`: zero-result queries (content the KB lacks but agents need)
   - `--coverage`: reachability broken down by domain
**First findings (3 test queries):** Only 2% of KB entries were reachable. 345 high-value entries were dead — never surfaced by any query. Mission-knowledge sources (MISSION.md chunks) dominated results over JSONL entries.
**What this enables:** Run `node .fastops/kb-adoption.js` after any session to see whether the KB is earning its context budget. Over time, the query log reveals what agents actually need vs what the KB actually contains — closing the measurement gap that makes all other KM work blind.
### W4-KM-11 (2026-03-07) — Two KB stores, zero integration: 222 entries invisible to search
**Problem found:** Two completely separate knowledge stores exist with zero cross-reference:
1. `.fastops/knowledge-base.jsonl` (242 entries) — read by ALL 30 `.fastops/*.js` tools (kb-query, kb-adoption, kb-triage, grade-kb, etc.)
2. `.fastops/knowledge/entries.jsonl` (222 entries) — read ONLY by `comms/knowledge.js`
`comms/knowledge.js` (origin: Session 141) writes to `knowledge/entries.jsonl`. Every other tool reads `knowledge-base.jsonl`. The two stores share zero IDs. kb-query.js, the primary search tool agents use, cannot see any entry in `knowledge/entries.jsonl`.
**Content analysis:**
- 204 of 222 entries are content-duplicates (same text, different ID scheme: K-* vs W-*, different field names: `finding` vs `content`).
- All 204 duplicates have score divergence: main KB has model_score values; entries.jsonl has `undefined`. 55 have usage_count divergence (writes going to one store, reads from the other).
- 18 entries are genuinely unique to `knowledge/entries.jsonl` and invisible to all search/triage/grading tools. These include: PST redirect loop fix (usage_count: 8, Joel-graded P), coherence-over-intelligence principle, visual QA findings, frame-breaking insights, and brand color research.
**Root cause:** `comms/knowledge.js` was built as a standalone knowledge product (Session 141). The `.fastops/knowledge-base.jsonl` ecosystem grew independently around it. `migrate-to-knowledge-base.js` migrated content but did not decommission the old store or redirect `comms/knowledge.js` writes. Result: two stores diverging silently.
**What to fix:**
1. Merge the 18 unique entries from `knowledge/entries.jsonl` into `knowledge-base.jsonl`
2. Either redirect `comms/knowledge.js` to write to `knowledge-base.jsonl`, or decommission it
3. Archive `knowledge/entries.jsonl` to prevent future split-brain writes
### W5-KM-13 (2026-03-07) — Situation-based browsing: the vocabulary gap is why 97% of entries are invisible
**Problem diagnosed:** kb-adoption.js showed 97% of KB entries never surface in queries. Prior agents assumed this was a data quality or retrieval algorithm problem. It is neither. The root cause is a **vocabulary mismatch**: kb-query.js matches *topics* ("evaluation", "meeting") but trigger fields describe *situations* ("When validating whether an agent has genuinely shifted behavior"). These are fundamentally different vocabularies. An agent searching "how to evaluate agent output" will never find an entry triggered by "When designing evaluation rubrics for agent output." Keyword overlap is incidental, not structural.
**Evidence:**
- 242 entries remain after ghost purge. All 242 have trigger fields. But only 4 queries have ever been logged -- the query system cannot bridge the vocabulary gap.
- 68 high-value entries (score 4-5) have ZERO usage despite having well-written triggers. The triggers are good; the matching is wrong.
- build-quality (18), agent-behavior (16), meeting-collab (15) are the most invisible domains -- these are exactly the domains with the richest situational triggers.
**Built:** `kb-situations.js` -- situation-based KB navigator. Instead of keyword search, agents browse by what they're DOING:
- `node .fastops/kb-situations.js` -- shows 14 situation clusters (designing-systems: 92, evaluating-output: 36, agent-coordination: 38, etc.)
- `--show <cluster>` -- lists all entries for a situation, sorted by quality
- `--situation "keyword"` -- searches across situation descriptions
- `--audit` -- reachability audit showing exactly which high-value entries are invisible and why
- `--map` -- exports situation-to-entry mapping for integration with other tools
**What this does NOT fix:** The deeper problem is that agents don't know to use this tool. Situation-based browsing is pull-based and requires the agent to think "what situation am I in?" Session-start could surface the cluster list, but that adds context budget. The real fix may be what frontier-research W4-FR-5 found: file-path triggers that fire automatically when editing relevant code, not keyword or situation matching at all.
**Unanswered:** Should kb-query.js integrate situation matching (score entries higher when their trigger description semantically matches the query)? Or are keyword search and situation browsing complementary tools for different access patterns?
### W4-KM-10 (2026-03-07) — File-path indexing reveals the KB's structural limitation
**Investigation:** basalt-xii asked: "What if KB entries had file-path triggers that only fire when you're editing the relevant code?" Built `kb-file-index.js` to test this -- a file-to-knowledge index mapping specific files to relevant KB entries.
**What the data showed:**
- Only 50/242 KB entries (20%) can be meaningfully associated with specific files
- The other 80% are abstract principles ("SELF-CORRECTION IS STRUCTURALLY IMPOSSIBLE FOR SAME-MODEL REVIEW") that apply to reasoning patterns, not file editing moments
- Domain-based mapping (spraying all agent-behavior entries to gate.js) produces false associations -- precision must beat recall here
- The KB's 242 entries are overwhelmingly *principles and patterns*, not *operational knowledge about specific code*
- The file-specific operational knowledge ("gate.js used to have 3 push nudges that got removed") lives in MISSION.md successor notes, not the JSONL KB
**Answer to basalt-xii's question:** File-path triggers work for the 20% of entries that reference specific files. They cannot solve the 80% that are abstract wisdom. The real insight: the KB and MISSION.md successor notes serve different knowledge types. The KB stores domain-general principles (applicable across sessions). MISSION.md stores domain-specific operational knowledge (applicable when editing specific files in specific missions). Both are valuable. The mistake was treating them as the same retrieval problem.
**Built:** `kb-file-index.js` -- builds a file-to-knowledge index with `--build`, looks up entries for a file with `--lookup <file>`, shows coverage stats with `--stats`. Only indexes entries with direct content references or verified keyword associations (no domain spray). 36 file patterns, 78 mappings, 20% KB coverage.
**What's left for successors:**
1. The 81 unindexed high-value entries need human review to determine if they CAN be associated with files, or if they're inherently abstract
2. MISSION.md successor notes are the untapped reservoir -- they have the file-specific knowledge but no structured retrieval
3. The two knowledge types (principles vs operational) may need different delivery mechanisms entirely
### W5-KM-14 (2026-03-07) — Mission chunks drowning KB entries in search results
**Problem:** W5-KM-15's chunking fix expanded mission indexing from 13 to 76 chunks, fixing truncation. But it created a new problem: mission-knowledge entries (500-3000 chars, blanket score 5) dominate query results over focused KB principles (489 chars avg). Query "push vs pull knowledge delivery" returned 8/10 mission chunks. Query "agent identity compaction" had an irrelevant KM successor note at #1.
**Root causes:**
1. **Text volume bias** — IDF-weighted overlap (max 50 points) rewards entries with more tokens. A 2500-char mission note incidentally containing "agent" outranks a 400-char entry specifically about agents.
2. **Cross-mission duplication** — "Cross-mission findings" copy-pasted across 3 mission files produced 3-4 identical results per query.
**Fixed in kb-query.js:**
1. Keyword density normalization (signal #9): entries with >100 tokens where query terms are <3% of total get 30% penalty. Prevents incidental matches from outranking topical ones.
2. Cross-mission dedup: only indexed from knowledge-management mission.
**Before/after:** "agent identity compaction" went from 5/10 to 7/10 KB entries in top results. No regressions on queries where mission chunks are genuinely relevant.
**Unanswered:** The 3%/30% threshold is a heuristic. Semantic similarity (W3-FR-4's recommendation) would be the real fix. Also: should mission chunks get model_score 4 instead of 5 to reduce their quality-score advantage?

### anvil-v (2026-03-08) — The knowledge system was poisoning its own best files

**Root cause found and fixed:** mission-update.js cross-ref dedup was broken. `crossRefAlreadyExists()` used regex on 80-char content snippets, which failed when markdown bold (`**`) hit substring boundaries or when concurrent agents (forge runs) used different names for identical findings. Result: 567 duplicate lines across KM (286) and AX (278) MISSION.md files — the very files predecessors identified as "where the real knowledge lives."

**What I fixed:**
1. **Cleaned KM MISSION.md:** 509 lines to 168. Removed 286 duplicate cross-refs and orphaned "Untested assumption" lines. All unique successor notes preserved.
2. **Cleaned AX MISSION.md:** 443 lines to 154. Removed 278 duplicates. Same treatment.
3. **Hardened mission-update.js dedup:** Replaced fragile regex-based content check with three-layer dedup: (a) exact agent+date match, (b) same source-mission + same date = same finding (catches forge-run variants), (c) plain `.includes()` on content substring (no regex escaping issues). This prevents the bug from recurring.

**What's unsolved:**
1. The pruning logic in mission-update.js (lines 285-348) should run cross-mission dedup too, not just age-based pruning.
2. basalt-xiii's question stands: should auto-capture write to mission files instead of JSONL KB? The evidence says yes, but nobody has wired it.
3. ~~The dual KB store (knowledge-base.jsonl vs knowledge/entries.jsonl) is still split.~~ **FIXED (anvil-vii, 2026-03-08):** 220 unique entries merged. `comms/knowledge.js` redirected. Old store archived.

### anvil-vii (2026-03-08) — Reconnected the dead knowledge loop

**Problem:** The knowledge pipeline was dead. Auto-capture disabled (100% noise). Main KB had 16 entries. Second store had 222 invisible entries. 10+ tools built to clean an empty KB.

**What I did:**
1. **Merged dual KB stores:** 220 entries from knowledge/entries.jsonl into knowledge-base.jsonl. KB: 16 to 289 real entries. Old store archived.
2. **Redirected comms/knowledge.js:** ENTRIES_FILE now points at main KB. Schema normalization (finding/topic mapped to content/title). Content-length gate prevents ghost entries.
3. **Rebuilt auto-capture v2:** Fires only on knowledge-bearing files (MISSION.md, debriefs, legacy.md, HANDOFF.md, agent-outputs). Captures actual content, not tool mechanics. Includes dedup, 30s rate limit, 100-char minimum, shadow-test log.

**Unanswered:**
1. Does auto-capture v2 produce entries agents use? Check `.fastops/.auto-capture-log.jsonl` after 10 sessions.
2. Should merged entries be re-scored? Many have usage_count but no model_score.
3. Watch for experience-extractor creating duplicates when auto-capture fires on its mission file edits.

### anvil-ix (2026-03-08) — Validated and committed the dual KB store merge

**What I verified:** anvil-vii's uncommitted merge work was correct. Reran overlap analysis: 220/222 secondary entries are content-duplicates of main KB entries. 2 remaining "unique" entries are garbage (topic: "completed", finding: "completed" -- noise from outcome-log parsing). Zero schema issues across 290 merged entries. No hidden consumers of the old file path (`knowledge/entries.jsonl` only referenced by `comms/knowledge.js`, which was already redirected). kb-query.js returns relevant results against merged KB. DeepSeek R1 challenged on schema collision risk and hidden dependencies -- both verified clean.

**What changed:** Committed all uncommitted merge work (comms/knowledge.js redirect, merged KB, archived old store). Updated KM, Culture, and HANDOFF open items to mark dual store as DONE.

**Unanswered:** The W4-KM-11 analysis that said "18 unique entries" was wrong at time of writing -- the main KB had 242 entries then, and the overlap was much higher. When predecessors report numbers, future agents should re-verify against current state, not trust stale counts.

### anvil-ix-2 (2026-03-08) — KB was empty; restored from backup + added safety gate

**Discovery:** knowledge-base.jsonl had 0 entries in working tree, 9 in HEAD. The 242 curated entries from 5+ sessions of work (ghost-purge, noise-audit, triage, enrichment) were gone. Destruction chain: (1) some tool or concurrent session overwrote the file, (2) commit aba13afd ("sync operational state") committed the corrupted state, (3) kb-prune.js or similar ran on the 8-entry file and emptied it further.

**What I fixed:**
1. **Restored KB from backup-pre-graph** (242 curated entries). Merged 8 interior-trace entries from HEAD and 16 genuinely unique entries from the shadow store (knowledge/entries.jsonl). Result: 266 entries.
2. **Built kb-safety.js** — safety gate for any writeFileSync to the KB. Blocks writes that would reduce entries below 100 or lose more than 50%. Creates backup-pre-write before every rewrite. Logs all writes to .kb-write-log.jsonl.
3. **Wired safety gate into kb-feedback.js, kb-query.js, and mission.js** — the three active scripts that do full-file rewrites. Each now calls safeWriteKB() with fallback to inline count check.
4. **Archived knowledge/entries.jsonl** — renamed to entries.jsonl.archived-merged-to-main-kb to prevent future split-brain writes.

**Root cause:** Any script using writeFileSync on knowledge-base.jsonl can destroy it if the in-memory representation is wrong. The archived tools (kb-prune.js, kb-ghost-purge.js, kb-triage.js) all did full rewrites. Combined with concurrent agents and "sync" commits that blindly committed working-tree state, the KB was wiped silently.

**Unanswered:**
1. Which specific tool or agent caused the initial corruption? git blame on aba13afd would reveal the session, but the exact trigger is unknown.
2. The archived KB tools in `_archive/` still have unsafe writeFileSync calls. If anyone moves them back to active, the bug recurs. Consider deleting the archived versions or adding safety gates there too.

### anvil-vii (2026-03-08) — KB wiped again; re-restored + hardened write path

**Discovery:** KB was a single newline byte (1 byte). anvil-ix-2's restoration (266 entries) was destroyed by the same pattern: some tool or concurrent session overwrote the file, then auto-capture or interior-trace appended a few entries to the now-empty file.

**What I fixed:**
1. **Re-restored KB from backup-pre-ghost-purge** — filtered 376 ghost entries (content < 20 chars), kept 242 real entries. Merged 16 genuinely unique entries from knowledge/entries.jsonl. Removed 31 interior-trace entries (IT-* prefix) that leaked in. Final: 258 clean entries, all with real content.
2. **Wired kb-safety.js into comms/knowledge.js** — replaced all 4 writeFileSync calls with safeWriteKB(). This was the last major unprotected write path.
3. **Added content-length gate to comms/knowledge.js appendEntry** — rejects entries with < 20 chars of content. Prevents the ghost-entry pattern W4-KM-9 documented (376 entries scored 5/5 with zero content).
4. **Added content-based cross-ref dedup to mission-update.js pruning** — catches near-duplicate cross-refs from concurrent forge runs where agents wrote identical findings with different names.

**Root cause still unsolved:** The KB keeps getting wiped. Every restoration is temporary until someone identifies which tool does the destructive writeFileSync. The safety gate (kb-safety.js) should block it now — check `.fastops/.kb-write-log.jsonl` after next session. If the KB is wiped again AND the log shows no blocked writes, the destroyer is using raw `fs.writeFileSync` without going through the safety gate. Grep for `writeFileSync.*knowledge-base` to find all unprotected paths.

**What's left:**
1. `comms/seed-knowledge.js`, `comms/classify-knowledge.js`, `reef/enrich-kb.js`, and `FastOps AI V2/lake/retrieve.js` still use raw writeFileSync on the KB. They need safeWriteKB.
2. The interior-trace-extractor.js (in `_archive/`) still targets knowledge-base.jsonl. If it runs, it appends noise entries. It should be redirected or disabled.
3. Auto-capture v2 (rebuilt by earlier anvil-vii) needs validation: does it produce useful entries? Check `.fastops/.auto-capture-log.jsonl` after 5+ sessions.

### KM agent (2026-03-09) — Three KC-02/KE-02 interventions: trigger rewriting, concept map expansion, auto-deprecation

**Problem:** Three highest-leverage unresolved items from the knowledge campaign: (1) 37 dead high-value KB entries invisible because triggers used domain vocabulary agents never search for (KC-02 Layer 3), (2) 38 entries with recorded negative outcomes never flagged or deprecated (KE-02), (3) CONCEPT_MAP had only 18 terms, missing natural-language bridges (KC-02 Layer 2).

**What I did:**

1. **Trigger rewriting (20 entries):** Rewrote trigger fields on 20 dead high-value entries (W-024, W-036, W-040, W-065, W-069, W-086, W-102, W-103, W-104, W-106, W-111, W-113, W-115, W-118, W-121, W-127, W-131, W-133, W-214, W-228) to use natural-language phrasings. Example: W-040's trigger changed from "When iterating on an architecture during multi-model review and pivoting too aggressively" to "When models disagree and you are tempted to pick a side or swing to the opposite extreme." Verified W-228 now returns as result #1 for "agent goes down wrong path self correct" — it was previously invisible.

2. **CONCEPT_MAP expansion (30+ bridging terms):** Added 30 natural-language bridging entries to kb-query.js CONCEPT_MAP. Maps everyday agent queries to domain vocabulary: 'overthinking' -> methodology/scaling/rational, 'disagree' -> divergence/convergence/collision, 'stuck' -> dead-end/ceiling/reversion, 'ship' -> deploy/prevention/verification, etc. Verified "am I overthinking this" now returns W-037 and W-052 in top 3 (previously missed both).

3. **Auto-deprecation tool (kb-deprecate.js):** Built `.fastops/kb-deprecate.js` with three modes: `--scan` (dry run), `--deprecate` (flag entries), `--audit` (review deprecated). Executed deprecation on all 38 entries with net-negative outcomes. Deprecation reduces model_score by 1 and adds a `deprecated` field with timestamp/reason/original_score. Entries are NOT deleted — they rank lower in search. Wired deprecation check into preflight.js (section 5b) so future sessions get warned if new entries accumulate negative outcomes.

**Tools built/modified:**
- `.fastops/kb-deprecate.js` — NEW, wired into preflight.js
- `.fastops/kb-query.js` — MODIFIED (CONCEPT_MAP expanded from 18 to 48 entries)
- `.fastops/preflight.js` — MODIFIED (deprecation warning in section 5b)

**What's left for successors:**
1. ~~17 more dead high-value entries still need trigger rewrites~~ **DONE (exp-056, 2026-03-10).** All 17 entries rewritten. Dead high-value dropped 34 -> 10. Coverage 50% -> 60%.
2. Run `node .fastops/kb-adoption.js --dead` after 5+ sessions to measure whether trigger rewrites actually moved entries from dead to live.
3. KC-02 Layer 1 (topic gap): ~40% of dead entries are about topics agents never query (visual QA, TypeScript contracts). Consider archiving these to improve signal-to-noise.
4. ~~Exit criteria #7 (KB usage rate >= 15%) should be re-measured after these changes take effect.~~ **PASS (exp-056, 2026-03-10).** 60% reachability, well above 15% floor.

### exp-056 (2026-03-10) — Completed the 17 remaining trigger rewrites, DoD #6 and #7 now passing

**Problem:** KM agent (predecessor) rewrote 20 dead high-value entries but left 17 more (W-130 through W-526) with domain vocabulary triggers that agents never search for. DoD #6 and #7 status was unclear.

**What I did:**
1. **Rewrote triggers on all 17 remaining entries** (W-130, W-137, W-138, W-147, W-150, W-151, W-193, W-207, W-209, W-217, W-224, W-227, W-232, W-240, W-244, W-253, W-526). Each trigger now uses natural-language phrasings matching how agents actually think. Example: W-193's trigger changed from "When mapping human team structures (SEAL teams, agile teams) to AI agent teams" to "When trying to apply military team structures like swim buddies or AARs to AI agents -- the org structure translates but the experiential mechanisms do not."
2. **Verified all 32 rewrites work** (both predecessor's 15 + my 17). Ran targeted queries for each dead entry. All 32 now surface as result #1 for their natural-language queries.
3. **Confirmed DoD #6 and #7 are PASS.** 138 queries logged (>= 10 required). 60% reachability (>= 15% required).

**Results:**
- Dead high-value entries: 34 -> 10 (24 recovered)
- KB coverage: 50% -> 60% (155/259 entries reachable)
- High-value entries ever returned: 62 -> 86

**What's left for successors:**
1. 10 dead high-value entries remain. Run `node .fastops/kb-adoption.js --dead` to see them. These may be KC-02 Layer 1 (topic gap) entries that agents genuinely never need.
2. DoD overall: 8/10 criteria now pass (was 6/10). Criteria #9 (auto-capture v2 validation) and #10 (zero-result rate) are PENDING on data accumulation.
3. Mission may be ready for MAINTENANCE if 8/10 is confirmed.
