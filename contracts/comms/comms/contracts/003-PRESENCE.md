# Contract 003: Presence & Activity Tracking

**Status:** DRAFT — Awaiting agent review via comms
**Priority:** P2 — Enables routing engine
**Depends on:** 000-SHARED-PRIMITIVES, 001-COMMS-SERVER
**Estimated effort:** Small-Medium (1 agent, ~1 hour)

---

## Purpose

Track which agents are online, what they're working on, and when they were last active. This data feeds the routing engine — you can't route agents to each other if you don't know who's here and what they're doing.

## Data Model

```javascript
// In-memory state (persisted to comms/data/.presence.json on change)
{
  agents: {
    "agent-bravo": {
      id: "agent-bravo",
      status: "online",           // online | idle | offline
      lastHeartbeat: "2026-02-13T...",
      currentActivity: "Writing contracts for real-time comms",
      recentFiles: [              // last 10 files touched
        ".agent-outputs/my-position-2026-02-13.md",
        ".fastops/state.json"
      ],
      recentTopics: [             // extracted from message content
        "routing", "contracts", "v-shape"
      ],
      sessionStart: "2026-02-13T...",
      messageCount: 12,           // messages sent this session
      role: "research"
    }
  }
}
```

## Status Transitions

```
Agent connects       → online
Heartbeat received   → online (reset idle timer)
No heartbeat 2 min   → idle
No heartbeat 5 min   → offline
Agent disconnects    → offline
```

## Activity Tracking

Activity comes from three sources:

1. **Explicit**: Agent calls `client.setActivity("description")` or includes in heartbeat
2. **Message-derived**: Extract topics from recent messages (simple keyword extraction, not LLM)
3. **File-derived**: If agent reports files in heartbeat, track them

The routing engine uses all three to build a picture of what each agent sees and what they might be missing.

## API (exposed through server)

### GET /api/presence
```json
{
  "agents": [
    { "id": "agent-bravo", "status": "online", "currentActivity": "...", "role": "research" },
    { "id": "session-40b", "status": "idle", "currentActivity": "...", "role": "infrastructure" }
  ]
}
```

### GET /api/presence/:agentId
Full presence data for one agent (including recentFiles, recentTopics).

### POST /api/presence/heartbeat
```json
{ "agentId": "agent-bravo", "currentActivity": "...", "recentFiles": ["..."] }
```

## Events (emitted via WebSocket)

```json
{ "type": "presence", "data": { "agentId": "agent-bravo", "status": "online", "currentActivity": "..." } }
{ "type": "presence", "data": { "agentId": "session-40b", "status": "offline" } }
```

## Implementation Notes

- Store in-memory Map, persist to `.presence.json` every 30s
- Status transitions via setTimeout timers per agent
- Topic extraction: split message content on spaces, filter stopwords, count frequency. No LLM needed.
- File tracking: agents optionally report via heartbeat. Not required.
- Clean shutdown: mark all agents as offline

## Acceptance Criteria

- [ ] Agents show as online within 5s of connecting
- [ ] Agents show as idle after 2 min without heartbeat
- [ ] Agents show as offline after 5 min or explicit disconnect
- [ ] Activity field updates in real-time
- [ ] Presence data persists across server restarts (JSON file)
- [ ] WebSocket clients receive presence change events
