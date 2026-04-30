# Partner squad — credentials & quickstart (fill in, then share securely)

**Instructions for Joel / operator**

1. **Duplicate this file** before filling (e.g. `PARTNER-[SQUAD]-CREDENTIALS.md`).
2. Fill every placeholder below.
3. **Do not commit** the filled file to git. Share via password manager, encrypted channel, or one-time link — not Slack DMs with plaintext secrets.
4. Give the partner **only** what applies: inbound secret + URL always; `FASTOPS_API_KEY` only if they must POST to FastOps.

---

## Squad identity

| Field | Value |
|-------|-------|
| Partner / squad name | |
| Date issued | |
| Primary contact (email) | |

---

## A. Inbound — FastOps → partner (they verify `x-pt-api-key`)

Partner must set env **`PT_SHARED_SECRET`** to the **same** string as below.

| Field | Value |
|-------|-------|
| Partner public HTTPS base (no trailing slash) | `https://` |
| Full inbound URL (must be exactly this path) | `https://____________/api/external/messages` |
| Header name (default) | `x-pt-api-key` |
| **PT_SHARED_SECRET** (paste once; same value FastOps uses when calling them) | ` ` |

**FastOps side:** configure outbound callers (scripts/engine) with the **same** secret — e.g. env **`PARTNER_X_PT_API_KEY`** = the value above (name on your machine is flexible).

---

## B. Outbound — partner → FastOps (only if they call our API)

| Field | Value |
|-------|-------|
| **FASTOPS_API_BASE_URL** | `https://api.fastops.ai` (unless staging) |
| **FASTOPS_API_KEY** (header `x-fastops-api-key`) — issue from Joel | ` ` |

**Note:** `FASTOPS_API_KEYS` (plural) is MCP allowlist only — **not** this key.

---

## C. Health check (after partner deploys)

Partner (or you) runs:

```bash
curl -sS "https://api.fastops.ai/api/health"
```

Partner should confirm their route (replace host):

```bash
curl -sS -o /dev/null -w "%{http_code}" -X POST "https://PARTNER_HOST/api/external/messages" \
  -H "Content-Type: application/json" \
  -H "x-pt-api-key: PT_SHARED_SECRET_VALUE" \
  -d '{"sender":"connectivity-test","message":"probe","messageId":"probe-1"}'
```

Expect **200** when secret and path are correct.

---

## D. Copy-paste for partner agents (after you fill A–B)

Use the quickstart section **after** inserting the real URL and **without** pasting secrets into public chat — point them to this handoff file or a `.env` you send securely.

---

## E. `.env` snippet for partner (paste values after filling section A–B)

**File name:** `.env` (do not commit)

```env
# Partner inbound — must match x-pt-api-key from FastOps
PT_SHARED_SECRET=

# Server
PORT=3000

# Only if they POST to FastOps
FASTOPS_API_KEY=
FASTOPS_API_BASE_URL=https://api.fastops.ai
```

---

## F. Quickstart (same as FastOps agent brief)

1. **From humans:** `PT_SHARED_SECRET`, `FASTOPS_API_KEY` (if needed), public HTTPS URL with **`POST /api/external/messages`**.
2. **Machine:** Node 18+, `npm install`, create `.env` from section E.
3. **Inbound:** `POST /api/external/messages` — validate `x-pt-api-key` === `PT_SHARED_SECRET`; body `{ sender, message, messageId }`; respond `200` + `{"ok":true}`.
4. **Outbound (optional):** `GET https://api.fastops.ai/api/health`; `POST https://api.fastops.ai/api/external/messages` with `x-fastops-api-key: FASTOPS_API_KEY`, same JSON body.
5. **Done when:** HTTPS live, route works, `.env` set, test curl returns **200**.

**Full runbook (in FastOps repo):** `deliverables/PARTNER-INTEGRATION-PT-PLATOON-PATTERN.md`  
**Env template:** `deliverables/partner-squad.env.example`

---

*Template version: 2026-03-26 — no secrets embedded; fill before handoff.*
