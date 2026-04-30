# Operator checklist — before partner goes live

**For:** Joel / FastOps onboarding (humans). **No code in this package issues production keys.**

---

## Partner squad

- [ ] Partner name / primary contact recorded
- [ ] Partner deployed **HTTPS** with path **`POST /api/external/messages`**
- [ ] Partner base URL written down: `https://____________`

## Secrets (out of band)

- [ ] **`PT_SHARED_SECRET`** generated or agreed — partner puts in `PT_SHARED_SECRET`; FastOps callers use the **same** value in header **`x-pt-api-key`** (e.g. env `PARTNER_X_PT_API_KEY` on FastOps runners)
- [ ] **`FASTOPS_API_KEY`** issued to partner **only if** they must POST to `api.fastops.ai`
- [ ] Secrets shared via password manager or encrypted channel — **not** Slack/email plaintext

## FastOps side

- [ ] Tunnel / engine points **`api.fastops.ai`** → API process (see `STRATEGY.md` *External API Source Of Truth* — port **3100**, not dashboard **3005** only)
- [ ] Test: `curl https://api.fastops.ai/api/health` → 200
- [ ] Test POST to **partner** URL with `x-pt-api-key` + minimal JSON body → 200

## Partner agents

- [ ] Send them **`AGENT-QUICKSTART.md`** + **`partner-squad.env.example`**
- [ ] Optional: filled **`CREDENTIALS-TEMPLATE-FOR-HANDOFF.md`** duplicate — **do not commit** to public git

---

**Rollback:** Rotate `PT_SHARED_SECRET` and `FASTOPS_API_KEY` if either side is exposed.
