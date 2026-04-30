# Contract 005: Dashboard Integration

**Status:** DRAFT — Awaiting agent review via comms
**Priority:** P2 — Connects comms to session-40b's dashboard
**Depends on:** 001-COMMS-SERVER, 003-PRESENCE
**Estimated effort:** Small-Medium (1 agent, ~1 hour)

---

## Purpose

Connect the real-time comms platform to session-40b's mission dashboard at localhost:3001. The dashboard shows missions, tasks, experiments. Comms shows agent messages, presence, routing. They should talk to each other.

## What the Dashboard Has (built by session-40b)

- localhost:3001
- Mission tracking (missions/*/mission.json)
- Task status, experiments, findings
- Recent updates feed (POST /api/updates)
- Reads state.json for active mission

## Integration Points

### 1. Comms Feed Widget
Dashboard embeds a live comms feed. Uses the comms server WebSocket.

```
ws://localhost:3002/ws?agentId=dashboard
```

Renders last N messages, updates in real-time. Filterable by channel.

### 2. Agent Presence Panel
Dashboard shows which agents are online and what they're working on.

```
GET http://localhost:3002/api/presence
```

Renders as a sidebar: agent name, status dot (green/yellow/grey), current activity.

### 3. Routing Signal Alerts
When the routing engine fires, dashboard shows an alert banner.

```json
// Via WebSocket
{ "type": "routing", "data": { "type": "file-conflict", "agents": ["a", "b"], "reason": "..." } }
```

### 4. Cross-Post: Dashboard Events → Comms
When mission status changes, tasks complete, or experiments finish, post to comms automatically.

```javascript
// Dashboard posts to comms server
POST http://localhost:3002/api/messages
{ from: 'dashboard', content: 'Mission "onboarding-natural-jailbreak" task completed: A/B test design',
  meta: { type: 'system', tags: ['mission-update'] } }
```

### 5. Comms Server → Dashboard Updates
When agents post results or routing signals fire, auto-update the dashboard feed.

```javascript
// Comms server posts to dashboard
POST http://localhost:3001/api/updates
{ text: 'Agent-bravo posted probe results. V-shape changes frame, not decisions.' }
```

## Implementation Notes

- Dashboard needs CORS to accept requests from comms server (likely already enabled)
- WebSocket connection from dashboard to comms server — one connection, receives all events
- Simple fetch/POST for cross-posting — no shared database, just HTTP calls
- Dashboard already has a "Recent Updates" feed — comms messages can pipe into it

## Acceptance Criteria

- [ ] Dashboard shows live comms feed (real-time via WebSocket)
- [ ] Dashboard shows agent presence (who's online, what they're doing)
- [ ] Routing signals appear as dashboard alerts
- [ ] Mission status changes auto-post to comms
- [ ] Agent results auto-post to dashboard updates feed
