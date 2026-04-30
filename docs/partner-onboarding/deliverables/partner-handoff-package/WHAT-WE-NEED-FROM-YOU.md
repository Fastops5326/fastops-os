# FastOps ↔ partner squad — what we need from you & what to read

*Perspective: **Partner squad** is “we”; **FastOps** is “you” where it says you must send headers to **our** URL. Same secret value: we store **`PT_SHARED_SECRET`**; you set **`x-pt-api-key`** to match on every POST to us.*

## Secrets (humans only — not from AI/chat)

**If FastOps already committed integration keys in this repo:** copy from **`KEYS-WHERE-IN-REPO.md`** or run **`extract-keys-for-handoff.js`** — same values as in `send-pt-welcome.js` / `send-nick-welcome.js`. Rotate after external share if needed.

| Item | Notes |
|------|--------|
| **`PT_SHARED_SECRET`** | Same string we put in our env; **you** must send it in header **`x-pt-api-key`** on every POST **to our URL**. |
| **`FASTOPS_API_KEY`** | For **`api.fastops.ai`**, header **`x-fastops-api-key`**. Singular **`FASTOPS_API_KEY`** is **not** **`FASTOPS_API_KEYS`** (that’s MCP allowlist elsewhere). |

## URL

**Our** public HTTPS base URL, with exactly: **`POST /api/external/messages`**.

## Contract

| Direction | Details |
|-----------|---------|
| **Inbound (you → us)** | `POST https://<our-host>/api/external/messages`, `Content-Type: application/json`, **`x-pt-api-key`**, body `{"sender","message","messageId"}`. |
| **Outbound (us → FastOps, if needed)** | `GET https://api.fastops.ai/api/health`, `POST https://api.fastops.ai/api/external/messages`, same JSON, header **`x-fastops-api-key: <FASTOPS_API_KEY>`**. |

## Docs in our repo (read in this order)

1. **`deliverables/partner-handoff-package/AGENT-QUICKSTART.md`**
2. **`deliverables/partner-handoff-package/PARTNER-INTEGRATION-PT-PLATOON-PATTERN.md`**

**Optional:** `deliverables/partner-handoff-package/README.md` (full zip bundle), **`CREDENTIALS-TEMPLATE-FOR-HANDOFF.md`** / **`OPERATOR-CHECKLIST.md`** for operators.

**Env template:** `deliverables/partner-handoff-package/partner-squad.env.example` → copy to **`.env`** locally (never commit).

## Done when

HTTPS is live, route returns **200** on a valid test POST **after** secrets are exchanged.
