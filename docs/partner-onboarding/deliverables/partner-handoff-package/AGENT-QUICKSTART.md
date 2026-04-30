# FastOps ↔ partner squad — agent quickstart

**Read this first.** Full detail: `PARTNER-INTEGRATION-PT-PLATOON-PATTERN.md`.

---

## 1. What you get from humans (not from chat, not AI-generated)

| Item | Purpose |
|------|---------|
| **`PT_SHARED_SECRET`** | Same value FastOps sends in header **`x-pt-api-key`** when they POST **to you**. |
| **`FASTOPS_API_KEY`** | From Joel / FastOps onboarding — **only** for **your** calls **to** FastOps. |
| **Your public HTTPS URL** | You must expose exactly: **`POST /api/external/messages`** on that host. |

---

## 2. Machine setup

- **Node.js 18+** and **npm**
- In your service repo: `npm install`
- Copy **`partner-squad.env.example`** → **`.env`** and fill values (never commit `.env`)

```env
PT_SHARED_SECRET=<from onboarding>
PORT=3000
FASTOPS_API_KEY=<from Joel, only if you POST to FastOps>
FASTOPS_API_BASE_URL=https://api.fastops.ai
```

---

## 3. Inbound — you MUST implement

| Item | Requirement |
|------|-------------|
| Route | **`POST /api/external/messages`** |
| Auth | Header **`x-pt-api-key`** must equal **`PT_SHARED_SECRET`** |
| Body (JSON) | **`sender`**, **`message`**, **`messageId`** — `messageId` unique per request |
| Response | **200** + small JSON, e.g. `{"ok":true}` |

---

## 4. Outbound — call FastOps (when needed)

| Step | Action |
|------|--------|
| Health | `GET https://api.fastops.ai/api/health` |
| Send | `POST https://api.fastops.ai/api/external/messages` |
| Headers | `Content-Type: application/json`, **`x-fastops-api-key: <FASTOPS_API_KEY>`** |
| Body | Same shape: `sender`, `message`, `messageId` |

---

## 5. Don’t confuse these names

| Name | Meaning |
|------|---------|
| **`FASTOPS_API_KEY`** | You → FastOps (HTTP). |
| **`FASTOPS_API_KEYS`** (plural) | Unrelated MCP allowlist on FastOps — **not** your key. |

---

## 6. Done when

- HTTPS is live  
- **`/api/external/messages`** accepts valid POSTs  
- **`.env`** is set  
- Test **`curl`** from FastOps returns **200** (after secrets are exchanged)

---

## 7. Deeper reading

- **`PARTNER-INTEGRATION-PT-PLATOON-PATTERN.md`** — runbook + curl examples  
- **`PARTNER-API-INTEGRATION-GUIDE.md`** — MCP, local OS API, file comms  
