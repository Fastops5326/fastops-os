# Where API key *values* live in this repo

You do **not** need to invent new keys for partners if the project already wires integrations. **Copy the values from the source files below** (or run **`extract-keys-for-handoff.js`** in this folder to print them).

**Security:** These strings have lived in tracked `.js` files. Treat as **sensitive**. Prefer **rotating** after external share. Never paste into public issues.

---

## 1. `x-pt-api-key` / partner **`PT_SHARED_SECRET`**

Used when **FastOps POSTs to a PT-style partner** (e.g. `pt-ai-os.vercel.app`).

| Source file (repo root) | Look for |
|-------------------------|----------|
| **`send-pt-welcome.js`** | `headers` object, **`'x-pt-api-key': '...'`** |
| Same value in | **`send-pt-questions.js`**, **`send-pt-round2.js`**, **`send-welcome-payload.js`** |

**Partner sets:** `PT_SHARED_SECRET` = that string.  
**FastOps sends:** header `x-pt-api-key` = same string.

---

## 2. `x-fastops-api-key` / **`FASTOPS_API_KEY`** (partner → `api.fastops.ai`)

Used when **calling FastOps** `POST https://api.fastops.ai/api/external/messages`.

| Source file (repo root) | Look for |
|-------------------------|----------|
| **`send-nick-welcome.js`** | **`'x-fastops-api-key': '...'`** |
| Same value in | **`send-nick-pressure-test.js`** as `API_KEY`, and other `send-nick-*.js` that hit `api.fastops.ai` |

**Partner sets:** `FASTOPS_API_KEY` = that string (when they call FastOps).

---

## 3. Other deployments (Nick / Railway, etc.)

Some scripts use **`nick-agents-production.up.railway.app`** and a **different** `API_KEY` constant. Use the key in **that** script only for that environment — do not assume it matches `api.fastops.ai`.

---

## 4. Generate a one-page handoff without opening editors

From repo root:

```bash
node deliverables/partner-handoff-package/extract-keys-for-handoff.js
```

Or save to a file (e.g. Downloads):

```bash
node deliverables/partner-handoff-package/extract-keys-for-handoff.js > %USERPROFILE%\Downloads\FASTOPS-KEYS-FOR-PARTNER.txt
```

Output is **plain text** — share only through secure channels.

---

## 5. Live sender allowlist (why a new `sender` still gets **403**)

Adding a partner id to a JSON file **in this repo** does **not** change **`api.fastops.ai`** by itself.

The HTTPS API is served by the **`fastops-os`** project on Joel’s machine (see **`STRATEGY.md`** → *External API Source Of Truth*). Inbound senders are enforced by env on that stack:

| Variable | Role |
|----------|------|
| **`FASTOPS_EXTERNAL_CDP_ALLOWED_SENDERS`** | Comma-separated `sender` values allowed to call **`POST /api/external/messages`**. |
| **`FASTOPS_EXTERNAL_CDP_ROUTES`** | JSON map `sender` → model (`claude`, `gemini`, `gpt`, …). |

**File:** `C:\Users\joelb\OneDrive\Desktop\fastops-os\.env` (restart the API process after edits).

This repo’s **`.fastops/external-api-sender-allowlist.json`** only applies if traffic goes through the **monorepo** `fastops-os/server.js` proxy (default port **3005**), which is **not** the documented Cloudflare target for **`api.fastops.ai`** (that target is **3100** on the **`fastops-os`** app).
