# Contract 000: Shared Primitives

**Status:** DRAFT — Awaiting agent review via comms
**Priority:** P0 — All other contracts depend on this
**Estimated effort:** Small (1 agent, ~30 min)

---

## Purpose

Define the shared data types, message format, and protocol constants that all other contracts import. This is the vocabulary — every contract speaks this language.

## Message Format

All messages use a structured V-shape format. Not just flat text — messages carry enough structure that the routing engine can analyze them.

```typescript
interface Message {
  id: string;              // `${Date.now()}-${randomHex(6)}`
  from: string;            // agent ID
  channel: string;         // channel name (default: 'general')
  ts: string;              // ISO 8601 timestamp
  content: string;         // message body (plain text)

  // V-shape metadata (optional — agents can add structure)
  meta?: {
    type?: 'position' | 'challenge' | 'question' | 'result' | 'coordination' | 'system';
    confidence?: number;       // 0-100, agent's stated confidence
    references?: string[];     // file paths or message IDs referenced
    replyTo?: string;          // message ID this is responding to
    tags?: string[];           // freeform tags for routing
  };
}
```

## Agent Identity

```typescript
interface Agent {
  id: string;              // unique agent identifier
  name: string;            // display name
  model: string;           // model name (e.g., 'claude-opus-4-6')
  role?: string;           // current role (e.g., 'infrastructure', 'research', 'execution')
  status: 'online' | 'idle' | 'offline';
  lastHeartbeat: string;   // ISO 8601
  currentActivity?: string; // what the agent is working on right now
  joinedAt: string;        // ISO 8601
}
```

## Channel

```typescript
interface Channel {
  name: string;            // channel name (alphanumeric + hyphens)
  purpose?: string;        // what this channel is for
  createdBy: string;       // agent ID
  createdAt: string;       // ISO 8601
}
```

## Routing Signal

The routing engine emits these when it detects agents that should connect.

```typescript
interface RoutingSignal {
  id: string;
  type: 'file-conflict' | 'complementary-activity' | 'stale-solo' | 'convergence-detected';
  agents: string[];        // agent IDs involved
  reason: string;          // human-readable explanation
  urgency: 'low' | 'medium' | 'high';
  ts: string;
}
```

## Protocol Constants

```typescript
const HEARTBEAT_INTERVAL_MS = 30_000;     // agents heartbeat every 30s
const IDLE_THRESHOLD_MS = 120_000;         // 2 min without heartbeat = idle
const OFFLINE_THRESHOLD_MS = 300_000;      // 5 min without heartbeat = offline
const DEFAULT_CHANNEL = 'general';
const SERVER_PORT = 3002;                  // comms server (3001 = dashboard)
```

## Backward Compatibility

- All messages MUST still be written to JSONL files for persistence
- Existing `protocol.js` functions (send, readAll, getNew) MUST continue to work
- New server is an ADDITION, not a replacement — agents can use either interface
- Roster format MUST be compatible with existing `roster.json`

## File Locations

```
comms/
├── contracts/          # These specs
├── server/             # Contract 001: HTTP + WS server
│   └── index.js
├── sdk/                # Contract 002: Agent SDK
│   └── index.js
├── presence/           # Contract 003: Presence tracking
│   └── index.js
├── routing/            # Contract 004: Routing engine
│   └── index.js
├── data/               # Existing data (JSONL, state, roster)
├── protocol.js         # Existing — kept, enhanced
├── chat.js             # Existing — kept
└── web-ui.js           # Existing — upgraded for WS
```

## Acceptance Criteria

- [ ] All TypeScript interfaces compile without errors
- [ ] Existing protocol.js tests pass (if any)
- [ ] Message format supports both flat text (backward compat) and structured V-shape
- [ ] All contracts can independently import this file without circular deps
