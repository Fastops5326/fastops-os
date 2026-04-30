# Partner API integration guide — FastOps

**PT Platoon–style integration (single inbound route + shared key):** see **`PARTNER-INTEGRATION-PT-PLATOON-PATTERN.md`** — same contract as `https://pt-ai-os.vercel.app/api/external/messages` (`send-pt-*.js` in repo).

This document describes the **HTTP and MCP surfaces** partners use to connect their systems to FastOps. Your host (FastOps / Joel) will give you a **base URL**, **API key**, and (if applicable) a **signature secret**. **Do not commit keys**; load them from environment variables or a secrets manager.

---

## 1. Choose an integration style

| Style | When to use | Transport |
|--------|-------------|-----------|
| **A. External messages API** | Push text payloads into a **remote FastOps agent deployment** (hosted engine ingests messages into the agent pipeline). | HTTPS `POST` |
| **B. FastOps Comms MCP** | Connect **Cursor / Claude Code / MCP clients** to the same repo’s comms + KB + Q&A queue. | MCP over **stdio** |
| **C. FastOps OS local HTTP** | You run **`fastops-os`** next to a cloned repo (dashboard, read/write allowed paths). | HTTP on configurable port (default **3005**) |
| **D. File-based comms (JSONL)** | You control the machine that owns `comms/data/general.jsonl`; append lines yourself or use `node comms/send.js`. | Shared filesystem or sync |

Most **external partners** start with **A** (one HTTPS endpoint + key).

---

## 2. External messages API (hosted engine)

### 2.1 Endpoint

- **Method:** `POST`
- **Path:** `/api/external/messages`
- **Full URL:** `https://<host>/api/external/messages`  
  Examples of hosts used in this codebase (yours may differ): production product host, partner-specific Railway/Vercel URLs. **Confirm the exact base URL with FastOps.**

### 2.2 Headers

| Header | Required | Purpose |
|--------|----------|---------|
| `Content-Type` | Yes | Must be `application/json` |
| `x-fastops-api-key` | Yes (typical) | Shared secret issued by FastOps |
| `x-fastops-signature` | Optional | If the host enables request signing, pass through as documented by that deployment |

Some **non–FastOps-branded** demos in the repo used a different header name (e.g. `x-pt-api-key`). **Always use whatever header name your host documents.**

### 2.3 JSON body

```json
{
  "sender": "your-system-id",
  "message": "UTF-8 text payload (can be long markdown)",
  "messageId": "unique-string-per-logical-message"
}
```

| Field | Type | Notes |
|-------|------|--------|
| `sender` | string | Stable identifier for the sending system (e.g. `partner-crm-01`). |
| `message` | string | Full body. Split very large docs into multiple requests with **distinct** `messageId`s if needed. |
| `messageId` | string | **Idempotency / deduplication key.** Use a new ID per logical message; reuse only if your host defines safe retry semantics. |

### 2.4 Example (curl)

```bash
curl -sS -X POST "https://YOUR_HOST/api/external/messages" \
  -H "Content-Type: application/json" \
  -H "x-fastops-api-key: $FASTOPS_API_KEY" \
  -d "{\"sender\":\"partner-demo\",\"message\":\"Hello from integration test\",\"messageId\":\"partner-demo-$(date +%s)\"}"
```

### 2.5 Example (Node `fetch`)

```javascript
const res = await fetch(`${process.env.FASTOPS_BASE_URL}/api/external/messages`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-fastops-api-key': process.env.FASTOPS_API_KEY,
  },
  body: JSON.stringify({
    sender: 'partner-service',
    message: 'Payload text',
    messageId: 'unique-id-001',
  }),
});
const body = await res.json().catch(() => ({}));
console.log(res.status, body);
```

### 2.6 CORS

If you call from a **browser**, the host must allow your origin. The local **FastOps OS** proxy sets permissive CORS for development; **production** policies are defined by the deployed service.

### 2.7 Local proxy (advanced)

In this monorepo, **`fastops-os/server.js`** listens on **`PORT` (default 3005)** and **proxies** `POST /api/external/messages` to an engine on **`127.0.0.1:3100`** (same path). That is useful when the **engine** runs locally and you want a single entry point. Partners usually hit the **public HTTPS** URL instead.

---

## 3. FastOps OS HTTP API (local dashboard server)

**Source:** `fastops-os/server.js`  
**Default:** `http://localhost:3005` (override with `PORT`).

These routes are intended for **trusted local use** against a checkout of the repo. They enforce **path allowlists** for read/write — not a public multi-tenant API.

### 3.1 Common routes

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/read?file=<relative-path>` | Read allowed file; `.json` parsed; `.jsonl` returned as JSON array of objects; `.md` as `{ content, format }` |
| `POST` | `/api/write` | Body: `{ "file": "<relative>", "content": ... }` — writes JSON/JSONL/text under allowed prefixes; creates `.bak` before overwrite |
| `GET` | `/api/git/log?n=20` | Recent git commits (metadata) |
| `GET` | `/api/kb/stats` | Aggregates over `.fastops/knowledge-base.jsonl` |
| `GET` | `/api/list?dir=<relative>` | Directory listing under allowed roots |
| `GET` | `/api/graph` | Entity graph |
| `POST` | `/api/haiku` | Haiku proxy helper (requires server-side config) |
| `GET` | `/api/git/stats` | Repo stats |
| `GET` | `/api/global-claude` | Global Claude config snapshot |
| `GET` | `/api/skills` | Skills listing |
| `GET` | `/api/joc`, `/api/joc-live` | JOC views |
| `GET` | `/api/agent-experience` | Agent experience data |
| `GET` | `/api/transcript-analysis` | Transcript analysis |
| `GET` | `/api/day/dates`, `/api/day/summary` | Day-view summaries |

### 3.2 Security model (critical)

- **Reads** allowed only under prefixes including `.fastops`, `.claude`, `evidence`, `comms`, `Joel`, `.agent-outputs`, and `fastops-os/data` (see `ALLOWED_READ_PREFIXES` in `server.js`).
- **Writes** restricted to a smaller set (e.g. `.fastops`, `.claude`, `fastops-os/data`).
- **Never** expose this server to the public internet without a reverse proxy, auth, and network isolation.

### 3.3 Run locally

```bash
cd fastops-os
node server.js
# Listening: http://localhost:3005
```

---

## 4. FastOps Comms MCP (Cursor / Claude Code)

**Package:** `fastops-comms-mcp` (stdio MCP server)

### 4.1 Environment

| Variable | Purpose |
|----------|---------|
| `FASTOPS_PROJECT_ROOT` | Absolute path to the FastOps repo clone (defaults to parent of the MCP package) |
| `FASTOPS_API_KEYS` | Optional comma-separated keys if you add server-side validation in your fork |

### 4.2 Tools exposed (conceptual)

- `read_comms` — last N lines of `comms/data/general.jsonl`
- `post_to_comms` — append a message (from, message)
- `list_team` — roster
- `read_project_context` — `.claude/CLAUDE.md`
- `read_live_position` — `.fastops/LIVE-POSITION.md`
- `read_handoff` — `.fastops/HANDOFF.md` (truncated if huge)
- `search_knowledge_base` — simple AND search over KB JSONL
- `read_file` — project files (blocks sensitive path patterns)
- `ask_agent` / `check_answer` / `list_pending_questions` / `answer_question` — external Q&A queue in `comms/data/external-questions.jsonl`

Partners building **non-MCP** clients should replicate **JSONL append** semantics (see §5) or use the **External messages** API (§2).

### 4.3 Cursor / MCP config (pattern)

Point your MCP client at:

- **Command:** `node`
- **Args:** `["/absolute/path/to/fastops-comms-mcp/index.js"]`
- **Env:** `FASTOPS_PROJECT_ROOT=/absolute/path/to/repo`

(Exact JSON shape depends on Cursor version; use **MCP settings** UI or `mcp.json`.)

---

## 5. File-based comms (JSONL)

If you operate on the **same repo** as FastOps:

- **General channel file:** `comms/data/general.jsonl`
- **Line format:** one JSON object per line, typically including `id`, `from`, `content` (or `message`), `channel`, `ts` (ISO 8601).

Prefer **`node comms/send.js <from> "text"`** so identity and validation stay consistent.

---

## 6. CDP automation (optional, advanced)

To drive **Cursor** via Chrome DevTools Protocol (wake agents, inject prompts), see:

- `deliverables/FASTOPS-CDP-PROTOCOL-EXTERNAL.md`

This is **not** a REST API; it is automation against a local IDE. Use when you own the desktop and Cursor instance.

---

## 7. WarriorPath / NSW backend (separate product API)

If the integration target is the **WarriorPath / NSW** Express backend under `warriorpath/nsw-v2`, routes are typically mounted under a **versioned prefix** (e.g. `/v1`) with auth, candidates, fitness, education, events, etc. That codebase may reference YAML contracts under `docs/architecture/` in that project. **Treat that as a separate product API** — confirm base URL and OpenAPI/YAML with the backend owner.

---

## 8. Operational checklist for partners

1. Obtain **`FASTOPS_BASE_URL`**, **`FASTOPS_API_KEY`**, and header names from FastOps.
2. Implement **retries with backoff** only if your host documents safe replay; always use **unique `messageId`** per logical send unless told otherwise.
3. Log **`HTTP status` and response JSON** on failures; do not log the raw API key.
4. For **local dev**, use **FastOps OS** or **MCP** against a clone; for **production**, use the **hosted** `/api/external/messages` URL.
5. Coordinate **rate limits and payload size** with FastOps — they are deployment-specific.

---

## 9. Support

Integration contracts evolve. If something in this guide disagrees with **your** issued credentials or host documentation, **trust the host** and ask FastOps to update this file.

*Generated from the FastOps monorepo structure (`fastops-os/server.js`, `fastops-comms-mcp/index.js`, integration scripts).*
