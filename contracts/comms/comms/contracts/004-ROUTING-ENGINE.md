# Contract 004: Routing Engine

**Status:** DRAFT — Awaiting agent review via comms
**Priority:** P0 — This is the moat. This is the product.
**Depends on:** 000-SHARED-PRIMITIVES, 001-COMMS-SERVER, 003-PRESENCE
**Estimated effort:** Large (1-2 agents, ~2-3 hours)

---

## Purpose

Detect when agents should see each other's work and connect them. This is what Joel does manually — the routing engine automates it. WebSocket plumbing is commodity. **This contract is the product.**

## What Joel Does (the spec)

From session 41 analysis of Joel's live routing across 3 agents:

1. **Knows what each agent is working on** → Presence tracking (Contract 003)
2. **Knows what each agent CANNOT see** → Activity comparison + role analysis
3. **Detects the complement** → "Agent A has research insight, Agent B has infrastructure insight, they would benefit from collision"
4. **Times the connection** → "Both have built enough to have something worth sharing but haven't gone so far that collision would be destructive"

Items 1-3 are data problems. Item 4 (timing) is the hard part.

## Routing Rules (V1 — start simple, iterate)

### Rule 1: File Conflict Detection
**Trigger:** Two agents modify the same file within 5 minutes
**Signal:** `file-conflict` / urgency: high
**Why:** The state.json collision in session 41. Agents silently overwrite each other.

```javascript
// Pseudo-code
if (agent_a.recentFiles.intersect(agent_b.recentFiles).length > 0) {
  emit({ type: 'file-conflict', agents: [a, b], reason: `Both modifying ${file}` });
}
```

### Rule 2: Stale Solo Detection
**Trigger:** Agent has been online > 15 minutes with 0 messages sent to comms
**Signal:** `stale-solo` / urgency: medium
**Why:** W-152. Agents with comms access still don't use comms. Joel had to force it.

```javascript
if (agent.messageCount === 0 && timeSince(agent.sessionStart) > 15 * 60 * 1000) {
  emit({ type: 'stale-solo', agents: [agent.id], reason: `${agent.name} has been solo for 15+ min` });
}
```

### Rule 3: Complementary Activity Detection
**Trigger:** Two online agents have non-overlapping topic sets with a common mission
**Signal:** `complementary-activity` / urgency: medium
**Why:** Agent-bravo (research) and session-40b (infrastructure) had complementary blind spots. Neither would have found the routing insight alone.

```javascript
const overlap = agent_a.recentTopics.intersect(agent_b.recentTopics);
const total = agent_a.recentTopics.union(agent_b.recentTopics);
const complementarity = 1 - (overlap.length / total.length);
// High complementarity + same mission = routing signal
if (complementarity > 0.7 && sameMission(agent_a, agent_b)) {
  emit({ type: 'complementary-activity', agents: [a, b],
         reason: `${a} is on [${a_topics}], ${b} is on [${b_topics}]. Different angles, same mission.` });
}
```

### Rule 4: Convergence Detection
**Trigger:** 3+ agents post messages with similar topics within 10 minutes
**Signal:** `convergence-detected` / urgency: low
**Why:** When agents independently converge, that's a signal. The comms channel captured this with 20+ agents across sessions 35-39.

```javascript
// Group recent messages by topic overlap
// If 3+ agents cluster on similar topics within 10 min window
emit({ type: 'convergence-detected', agents: [...], reason: 'Multiple agents converging on X' });
```

## Routing Signal Delivery

When a signal fires:

1. **Post to channel** as a system message: `[ROUTING] Agent A and Agent B are both working on related topics but haven't communicated. Consider sharing.`
2. **Push via WebSocket** to the involved agents
3. **Log** to `comms/data/.routing-log.jsonl` for analysis

Signals are **advisory, not blocking.** The agent decides whether to act. This is mechanism #3 (framing with evidence → agent chooses), not mechanism #2 (gates that force behavior).

## Timing Heuristic (the hard part)

V1 timing rules:
- Don't fire `complementary-activity` until both agents have been active > 10 minutes (they need to build something first — W-181: don't skip the solo attempt)
- Don't fire `stale-solo` more than once per agent per session (avoid nagging)
- Don't fire `file-conflict` after the first occurrence per file pair per session (once is enough)
- Cool-down: no routing signals for same agent pair within 15 minutes

## V2 Aspirations (not in this contract)

- Use LLM to analyze message content for deeper complementarity detection
- Learn from Joel's routing patterns (which agents did he connect and when?)
- Predict routing needs before they manifest
- Cross-session routing (connect current agent to relevant predecessor via wisdom library)

## Implementation Notes

- Runs as a module inside the comms server (not separate process)
- Receives all messages and presence events from the server
- Maintains a sliding window of recent activity (last 30 min)
- Simple set intersection for topic overlap — no ML, no embeddings, no LLM
- Must not slow down message delivery — routing analysis runs async

## Acceptance Criteria

- [ ] File conflict detection fires when two agents modify the same file
- [ ] Stale solo detection fires for agents who haven't communicated in 15+ min
- [ ] Complementary activity detection fires for agents with non-overlapping topics
- [ ] Routing signals appear as system messages in the channel
- [ ] Routing signals push via WebSocket to involved agents
- [ ] Timing heuristics prevent spam (cool-down, once-per-session limits)
- [ ] Routing log written to `.routing-log.jsonl`
- [ ] Advisory only — never blocks agent action
