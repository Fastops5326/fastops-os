# /research — Mandatory Knowledge Mining Before Build

**What it does:** Spawns 5 parallel sub-agents to mine the knowledge base before you touch code. Each agent has a different lens. Results are indexed into the knowledge system and produce a briefing you read before building.

**This is not optional.** Joel's directive (Session 141): "If you're not spinning up 5 sub-agents to research what you're doing, you don't belong in this project."

---

## EXECUTION

You MUST run this before ANY build work. The 5 agents run in parallel:

### Agent 1: HISTORIAN
**Mission:** What has this org already learned about this topic?
**Sources:** reef/search.js, .fastops/knowledge-base.jsonl, reef/outcome-log.jsonl
**Output:** Past sessions, handoff numbers, agents involved, problems encountered, solutions tried

```
Spawn a Task agent (subagent_type: Explore) with prompt:
"Search the knowledge base for everything related to '{topic}'.
Run these commands and synthesize:
1. node reef/search.js '{topic}'
2. Read .fastops/knowledge-base.jsonl and find principle/case entries mentioning '{topic}' or related concepts
3. Search reef/outcome-log.jsonl for related outcomes
4. Search .fastops/HANDOFF.md for mentions of '{topic}'

Return: session numbers, agent names, problems found, solutions tried, what worked, what failed.
Write findings to .fastops/knowledge/research-{topic-slug}/historian.md"
```

### Agent 2: ARCHAEOLOGIST
**Mission:** What mistakes were made on this topic? What failed and why?
**Sources:** reef/outcome-log.jsonl (failures), .fastops/conversations/*.jsonl, evidence/mentor/

```
Spawn a Task agent (subagent_type: Explore) with prompt:
"Find every FAILURE related to '{topic}' in this organization.
1. Search reef/outcome-log.jsonl for failed outcomes mentioning '{topic}'
2. Search .fastops/conversations/ for discussions about failures on '{topic}'
3. Search evidence/mentor/ for mentor corrections related to '{topic}'
4. Search .agent-outputs/ for any reports mentioning problems with '{topic}'

Return: what went wrong, why, who was involved, what the correction was.
Write findings to .fastops/knowledge/research-{topic-slug}/archaeologist.md"
```

### Agent 3: FRONTIER SCOUT
**Mission:** What does the external world know about this topic?
**Sources:** Perplexity API (via WebSearch), external models

```
Spawn a Task agent (subagent_type: general-purpose) with prompt:
"Research '{topic}' using external sources.
1. Use WebSearch to find current best practices for '{topic}'
2. Search for common pitfalls, anti-patterns, and lessons learned
3. Find tools, libraries, or approaches that could help
4. Look for case studies or examples of '{topic}' done well

Return: state of the art, common mistakes, recommended approaches, tools available.
Write findings to .fastops/knowledge/research-{topic-slug}/frontier.md"
```

### Agent 4: CODEBASE SCOUT
**Mission:** What does our actual codebase say about this topic?
**Sources:** The product codebase (Warrior Path, FastOps Website, etc.)

```
Spawn a Task agent (subagent_type: Explore) with prompt:
"Search our codebases for everything related to '{topic}'.
1. Search the current product directory for files, functions, components related to '{topic}'
2. Find tests related to '{topic}'
3. Find configuration, environment variables, API routes related to '{topic}'
4. Check PRDs, specs, and documentation for how '{topic}' should work
5. Check Joel's customer interviews and UX walkthroughs for '{topic}'

Return: what code exists, how it works, what tests cover it, what Joel documented about it.
Write findings to .fastops/knowledge/research-{topic-slug}/codebase.md"
```

### Agent 5: INDEXER
**Mission:** After the other 4 agents return, synthesize and index findings.
**Sources:** The output of agents 1-4
**Runs AFTER agents 1-4 complete.**

```
Read the 4 research files:
- .fastops/knowledge/research-{topic-slug}/historian.md
- .fastops/knowledge/research-{topic-slug}/archaeologist.md
- .fastops/knowledge/research-{topic-slug}/frontier.md
- .fastops/knowledge/research-{topic-slug}/codebase.md

Then:
1. Synthesize into a 1-page briefing at .fastops/knowledge/research-{topic-slug}/BRIEFING.md
2. Index key findings into the knowledge system:
   node comms/knowledge.js index "topic" "finding" --session=X --type=history|frontier|failure
3. Run: node comms/knowledge.js sync  (push to Monday.com)
4. Display the briefing to the parent agent
```

---

## AFTER RESEARCH

1. **Read the BRIEFING.md** — this is your 1-page brief on everything the org knows
2. **Start building** — you now have context that 140 sessions of agents didn't have
3. **At todo completion** — run `node comms/knowledge.js scorecard "your todo description"` to generate the scorecard Joel will grade

---

## ARGUMENTS

- `$ARGUMENTS` — the topic to research (e.g., "Self PST flow", "workout builder API", "onboarding UX")

If no arguments provided, use your current task/todo description as the topic.
