# FastOps OS

Multi-Model AI Orchestration Engine. Replaces Cursor + CDP with direct API access for collaborative AI deployment.

## Quick Start

```bash
npm install
cp .env.example .env  # Add your API keys
npm run dev            # Starts server at http://localhost:3100
```

## Architecture

```
src/
  engine/
    adapters/       FOS-01: Model Adapter Layer (Anthropic, OpenAI, Google, OpenRouter)
    context/        FOS-02: Context Manager (5-layer assembly, per-model prompts, compaction)
    core/           FOS-03: Engine Core (sessions, dispatcher, agentic loop, event bus)
    comms/          FOS-04: Comms Migration (push-based CommsBus, JSONL export)
    contracts/      FOS-05: Contract Execution Engine (lifecycle, dependencies, assignment)
    middleware/     FOS-06: Governance Middleware (safety, cost gates, audit)
    tools/          Built-in tools (file ops, search, bash, comms, todos)
  server/
    api.ts          REST API
    websocket.ts    Real-time event broadcasting
    index.ts        Server entry point
```

## API

Partner integration guide: `PARTNER-API-QUICKSTART.md`
Buddy copy/paste handoff: `PARTNER-BUDDY-HANDOFF.md`
Postman collection: `FastOps-External-Agent-Bridge.postman_collection.json`

```
GET  /api/health                    Health check
GET  /api/sessions                  List sessions
POST /api/sessions                  Create session
POST /api/sessions/:id/message      Send message (returns AI response)
GET  /api/sessions/:id/messages     Get conversation history
GET  /api/adapters                  List available models
POST /api/comms/send                Send comms message
GET  /api/comms/:channel            Read channel history
POST /api/external/messages         Partner-to-FastOps external bridge
GET  /api/state                     Engine state
POST /api/kill-switch               Activate kill switch
WS   /ws                            Real-time events
```

## Tests

```bash
npm test                            # All unit tests (84 passing)
npm run test:integration            # Integration tests (real API calls)
npm run typecheck                   # Zero type errors
```

## Built By

[REDACTED-NAME] & [REDACTED-NAME] — FastOps AI
