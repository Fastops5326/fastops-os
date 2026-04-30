# FastOps — partner handoff package (complete asset bundle)

**Purpose:** Everything another squad’s agents and operators need to integrate with FastOps **without** hunting the repo. Secrets are **never** pre-filled — humans issue keys out of band when you onboard a partner.

---

## What to give whom

| Audience | Hand them |
|----------|-----------|
| **Partner engineers / agents** | **`WHAT-WE-NEED-FROM-YOU.md`** (one-screen brief) or **`AGENT-QUICKSTART.md`**, then **`PARTNER-INTEGRATION-PT-PLATOON-PATTERN.md`** for depth. |
| **Partner ops (env + deploy)** | **`partner-squad.env.example`** (rename to `.env` locally) + quickstart. |
| **You / FastOps operator (Joel)** | **`CREDENTIALS-TEMPLATE-FOR-HANDOFF.md`** — duplicate, fill once per partner, share **only through a secure channel** (optional; skip if you use a password manager instead). |
| **Architect / security review** | **`PARTNER-API-INTEGRATION-GUIDE.md`** (all surfaces: HTTP, MCP, local OS). |

---

## Files in this folder

| File | Description |
|------|-------------|
| **README.md** | This index. |
| **WHAT-WE-NEED-FROM-YOU.md** | Partner-facing: secrets, URL, contract, reading order, done-when. |
| **AGENT-QUICKSTART.md** | One-page get-running brief for partner agents (copy-paste friendly). |
| **PARTNER-INTEGRATION-PT-PLATOON-PATTERN.md** | Full PT-style contract: inbound route, headers, JSON body, FastOps operator steps, env naming. |
| **PARTNER-API-INTEGRATION-GUIDE.md** | Broader API reference beyond the single external route. |
| **partner-squad.env.example** | Template `.env` for partner servers. |
| **PARTNER-FASTOPS-SINGLE-SOURCE.env.template** | **100% copy-paste** — fill blanks, save as `PARTNER-FASTOPS-SINGLE-SOURCE.env` (gitignored), send once. |
| **CREDENTIALS-TEMPLATE-FOR-HANDOFF.md** | Tables for URL + `PT_SHARED_SECRET` + `FASTOPS_API_KEY` when you choose to document a handoff formally. |
| **OPERATOR-CHECKLIST.md** | What humans do vs what code does — before first live message. |

---

## Canonical location in repo

`deliverables/partner-handoff-package/`

Zip this folder for email, or copy to **Downloads** (see FastOps sync). Same contents are copied to `C:\Users\joelb\Downloads\FastOps-partner-handoff-package\` when you run sync from the repo.

---

## Keys (already in this repo — pass through, don’t invent)

Values for **`x-pt-api-key`** (PT-style) and **`x-fastops-api-key`** (call FastOps) are **already embedded** in root scripts such as **`send-pt-welcome.js`** and **`send-nick-welcome.js`**.

- **Where:** **`KEYS-WHERE-IN-REPO.md`**
- **One command handoff:** from repo root, run  
  `node deliverables/partner-handoff-package/extract-keys-for-handoff.js`  
  and redirect output to a file or secure channel (see that doc).

---

## Not included (by design)

- Partner-specific **URLs** (you substitute their HTTPS host)  
- Hosted binaries — partners implement `POST /api/external/messages` on their stack (Node/Vercel/Railway, etc.)

---

*Package assembled for multi-agent / partner onboarding. No secrets embedded.*
