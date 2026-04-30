# Build the PT Platoon–style API integration (exact pattern)

**PT Platoon** ran their own OS on **`https://pt-ai-os.vercel.app`** and exposed **one inbound HTTPS endpoint** that FastOps called with a **fixed JSON body** and a **shared secret header**. This document is the contract to replicate **the same thing** for a new partner squad.

> **Security:** Do not copy API keys from old scripts into git. Rotate keys if they were ever committed. Use environment variables everywhere below.

---

## Runbook alignment (what partners need vs. what FastOps configures)

This matches the **PT Platoon** arrangement: **one shared secret** for FastOps→partner, **one key** from Joel for partner→FastOps, **no keys invented by models**.

### 1. From FastOps / your team (not from the partner’s AI)

| Item | Partner receives / uses | FastOps operator sets |
|------|-------------------------|------------------------|
| **Shared secret (inbound)** | Same **value** on both sides: partner puts it in **`PT_SHARED_SECRET`** (or reads it in code as the expected header value). FastOps configures outbound calls so the **`x-pt-api-key`** header equals that **same value** when calling the partner. | Tunnel/scripts/engine: partner base URL + header **`x-pt-api-key`** = shared secret (out of band). |
| **Partner public URL** | e.g. `https://partner.example.com` | FastOps must call **`POST https://<that-host>/api/external/messages`** — path **`/api/external/messages`** must match exactly. |
| **Key for calling FastOps** | Environment variable **`FASTOPS_API_KEY`** (value from **Joel / partner onboarding**). Used for **`POST https://api.fastops.ai/api/external/messages`** with header **`x-fastops-api-key`**. | Joel issues key; partner stores in `.env`, never in chat logs. |

**Humans** issue secrets; **nothing in this repo** auto-generates production keys for partners.

### 2. On the partner’s machine / server

- **Node.js 18+** and **npm** installed.
- **`npm install`** in the partner project (e.g. Express or their stack).
- **Environment variables** — copy from repo template **`deliverables/partner-squad.env.example`** → partner’s `.env`, or export in the shell:

| Variable | Required? | Purpose |
|----------|-----------|---------|
| **`PT_SHARED_SECRET`** | **Yes** (for inbound) | Server accepts POSTs only when `x-pt-api-key` matches this value. |
| **`PORT`** | Optional | Listen port (e.g. **3000**); default depends on their app. |
| **`FASTOPS_API_KEY`** | Only if they call FastOps | For `scripts/send-to-fastops.js` or custom code posting to **`api.fastops.ai`**. |
| **`FASTOPS_API_BASE_URL`** | Optional | Default **`https://api.fastops.ai`** if omitted. |

### 3. What the partner does *not* need “from the AI”

- The **integration contract** is documented here; the **code** lives in their repo or yours.
- **Joel / FastOps onboarding** does not “issue” URLs — the partner **deploys** and gives FastOps the **HTTPS URL**.
- Success = **secret + URL agreed with FastOps**, deps installed, **env set**, process listening on **`/api/external/messages`**.

### 4. Naming note (FastOps repo vs. partner)

| Name | Where |
|------|--------|
| **`FASTOPS_API_KEY`** (singular) | Partner → FastOps HTTP (`x-fastops-api-key`). |
| **`FASTOPS_API_KEYS`** (plural) | **Different** — optional MCP server allowlist in **`fastops-comms-mcp`**, not the same as partner HTTP. |
| **`PT_SHARED_SECRET`** | Partner inbound verification; pairs with FastOps sending **`x-pt-api-key`**. If a future squad uses another header name (e.g. `x-partner-api-key`), the **value** is still agreed out of band the same way. |

### 5. FastOps operator checklist (calling the partner)

1. Partner sends **base URL** + confirms path **`/api/external/messages`**.
2. Agree **header name** (default **`x-pt-api-key`**) and **shared secret**:
   - **Partner** sets **`PT_SHARED_SECRET`** (inbound verification).
   - **FastOps** sets the **same string** wherever outbound scripts read it — e.g. **`PARTNER_X_PT_API_KEY`** in `.env` on the machine that runs `send-*` scripts (name is arbitrary; value must match).
3. Test with **`curl`** from a trusted machine before large payloads.

---

## What “the same thing” means (two directions)

| Direction | Who hosts | Purpose |
|-----------|-----------|---------|
| **A. Partner receives from FastOps** | **You** (partner) | FastOps POSTs large text payloads (welcome package, questions, round-2 letters) to **your** URL — same pattern as PT’s `pt-ai-os.vercel.app`. |
| **B. Partner sends to FastOps** | **FastOps** | Your automation POSTs to **FastOps’** public API so your agents’ traffic lands in the FastOps engine — same contract, different host + key. |

You implement **A** on your stack. Joel/FastOps provisions **B** credentials for `api.fastops.ai` (see **STRATEGY.md** in this repo: *External API Source Of Truth*).

---

## A. Your service: receive messages (PT Platoon pattern)

### Endpoint

- **URL:** `POST https://<YOUR_DOMAIN>/api/external/messages`  
  PT used: `https://pt-ai-os.vercel.app/api/external/messages`

### Headers

| Header | Value |
|--------|--------|
| `Content-Type` | `application/json` |
| `<YOUR_SECRET_HEADER>` | Shared secret you give FastOps (PT used **`x-pt-api-key`**) |

You may name the secret header whatever you want (**`x-pt-api-key`**, **`x-partner-api-key`**, etc.) as long as **both sides agree**. FastOps outbound scripts will send that header once you tell us the name and value.

### JSON body (exact shape — do not rename fields)

```json
{
  "sender": "fastops-agent-01",
  "message": "UTF-8 string. Often markdown. Can be very large.",
  "messageId": "unique-stable-id-per-logical-message"
}
```

| Field | Role |
|-------|------|
| `sender` | Logical sender id from FastOps (often `fastops-agent-01`). |
| `message` | Full payload. PT received multi-part story chunks; each chunk was its **own** POST with its **own** `messageId`. |
| `messageId` | Idempotency / deduplication / ordering hints in your UI; use a **new** id per POST unless you define replay semantics. |

### HTTP response

Return **`200`** with a small JSON body (e.g. `{ "ok": true }` or `{ "status": "received" }`) — our scripts only log status + parsed JSON. Match whatever your engine already returns if you use the same codebase as PT.

### CORS

If anything calls you from a **browser**, enable CORS for FastOps origins. **Server-to-server** `fetch` (Node) does not require CORS.

### Reference implementations in *this* repo (FastOps → PT)

These are the **canonical callers** that hit PT’s endpoint — copy the **request shape**, not the keys:

| File | What it sends |
|------|----------------|
| `send-pt-welcome.js` | Welcome package: multiple POSTs, chunked story parts, `sender` + `messageId` per chunk |
| `send-pt-questions.js` | Single large `message` (questions payload) |
| `send-pt-round2.js` | Single large `message` (round 2 letter) |
| `send-welcome-payload.js` | Smaller probe + docs (same endpoint + header pattern) |

Pattern from those files:

```javascript
const endpoint = 'https://YOUR_DOMAIN/api/external/messages';
const headers = {
  'Content-Type': 'application/json',
  'x-pt-api-key': process.env.PARTNER_X_PT_API_KEY, // same secret string as partner's PT_SHARED_SECRET; set only on FastOps runners that call the partner
};

await fetch(endpoint, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    sender: 'fastops-agent-01',
    message: contentString,
    messageId: 'unique-id-' + Date.now(),
  }),
});
```

After sending, FastOps sometimes **logs to internal comms** (e.g. `comms/data/squad-pt.jsonl`) — that is **our** bookkeeping, not required on your side.

---

## B. Send messages *into* FastOps (partner → FastOps)

Same **JSON body** as above. **Host and header name** are FastOps’.

Authoritative doc in this repo:

- **Health:** `GET https://api.fastops.ai/api/health`
- **Inbound:** `POST https://api.fastops.ai/api/external/messages`
- **Auth:** `x-fastops-api-key: <key Joel issues>`

Verification snippet (from **STRATEGY.md**):

```bash
curl https://api.fastops.ai/api/health

curl -X POST https://api.fastops.ai/api/external/messages \
  -H "Content-Type: application/json" \
  -H "x-fastops-api-key: <KEY_FROM_JOEL>" \
  -d '{"sender":"your-squad-id","messageId":"probe-1","message":"hello FastOps"}'
```

**Routing note:** External traffic must hit the **FastOps API** process (engine port **3100** behind the tunnel), **not** only the static OS dashboard on **3005**. See **STRATEGY.md** → *External API Source Of Truth* for tunnel recovery if `/api/*` 404s.

---

## Minimal partner server sketch (Node/Express)

Your production stack may differ (Vercel serverless, Railway, etc.); PT used **Vercel**. Contract to implement:

```javascript
// Pseudocode — validate secret, parse body, enqueue to your agent pipeline
// Header must match what FastOps sends (PT convention: x-pt-api-key === PT_SHARED_SECRET)
app.post('/api/external/messages', (req, res) => {
  const key = req.headers['x-pt-api-key'];
  if (key !== process.env.PT_SHARED_SECRET) return res.status(401).json({ error: 'unauthorized' });

  const { sender, message, messageId } = req.body || {};
  if (!message || !messageId) return res.status(400).json({ error: 'sender/message/messageId required' });

  // Deliver to your agents (DB queue, JSONL, websocket — your choice)
  await deliverToColony({ sender, message, messageId });

  return res.json({ ok: true, received: messageId });
});
```

---

## Checklist — “same as PT Platoon”

1. **Deploy** HTTPS with a stable URL.
2. **Implement** `POST /api/external/messages` with body `{ sender, message, messageId }`.
3. **Protect** with a secret header; share header **name + value** with FastOps (out of band).
4. **Give FastOps** the full URL so we can point `send-*` scripts or the engine at you (like `pt-ai-os.vercel.app`).
5. **Request** `x-fastops-api-key` + `api.fastops.ai` URL from Joel for **your** outbound traffic to FastOps.
6. **Test** both directions with short `message` + unique `messageId` before sending multi-megabyte story payloads.

---

## Related docs

- `deliverables/PARTNER-API-INTEGRATION-GUIDE.md` — full API surfaces (MCP, local OS, file comms).
- `STRATEGY.md` — **External API Source Of Truth** (FastOps inbound, health, tunnel).
- `comms/COMMS-PROTOCOL.md` — channel `squad-pt` and external API row.

*This describes the integration pattern used with PT Platoon (`pt-ai-os.vercel.app`); replace domain and header names for your squad.*
