# Contract 001: Comms Server

**Status:** DRAFT — Awaiting agent review via comms
**Priority:** P1 — Foundation for real-time
**Depends on:** 000-SHARED-PRIMITIVES
**Estimated effort:** Medium (1 agent, ~1-2 hours)

---

## Purpose

HTTP + WebSocket server that replaces file-polling with real-time message delivery. This is commodity plumbing — keep it simple, no over-engineering.

## REST API

### POST /api/messages
Send a message. Body follows the Message interface from Contract 000.

```
Request:  { from, content, channel?, meta? }
Response: { ok: true, message: Message }
```

Also writes to JSONL file for backward compatibility.

### GET /api/messages/:channel
Get messages from a channel. Supports pagination.

```
Query:    ?after=messageId&limit=50
Response: { messages: Message[], total: number }
```

### GET /api/messages/:channel/new/:agentId
Get unread messages for an agent. Marks as read.

```
Response: { messages: Message[], count: number }
```

### GET /api/agents
List all registered agents with presence status.

```
Response: { agents: Agent[] }
```

### POST /api/agents/heartbeat
Agent heartbeat. Updates presence.

```
Request:  { agentId, currentActivity? }
Response: { ok: true }
```

## WebSocket

### Connection
```
ws://localhost:3002/ws?agentId=xxx
```

### Server → Client Events
```json
{ "type": "message", "data": Message }
{ "type": "presence", "data": { agentId, status, currentActivity } }
{ "type": "routing", "data": RoutingSignal }
```

### Client → Server Events
```json
{ "type": "send", "data": { content, channel?, meta? } }
{ "type": "heartbeat", "data": { currentActivity? } }
```

## Implementation Notes

- Use `ws` npm package (zero-dep WebSocket)
- Use `express` for HTTP (already in project deps or add)
- Server starts on port 3002 (dashboard is 3001)
- On message received: (1) write to JSONL, (2) broadcast to WS clients, (3) emit to routing engine
- CORS enabled for dashboard integration
- No auth for V1 — all agents are trusted

## Startup

```bash
node comms/server/index.js
```

Should print:
```
FastOps Comms Server v1.0
  HTTP: http://localhost:3002
  WS:   ws://localhost:3002/ws
  Channels: general
  Agents online: 0
```

## Acceptance Criteria

- [ ] Server starts and listens on port 3002
- [ ] POST /api/messages sends a message and writes to JSONL
- [ ] GET /api/messages/:channel returns messages
- [ ] WebSocket connects and receives real-time messages
- [ ] Existing `protocol.js send` still works (JSONL backward compat)
- [ ] Server detects JSONL writes from old clients (file watcher) and broadcasts to WS
- [ ] Dashboard at localhost:3001 can fetch from localhost:3002 (CORS)
