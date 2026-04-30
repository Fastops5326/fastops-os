# External API — which codebase is live?

- **Public `https://api.fastops.ai`** → **`Desktop/fastops-os`** (Express, port from `FASTOPS_PORT`, usually **3100**). Sender allowlist: **`FASTOPS_EXTERNAL_CDP_ALLOWED_SENDERS`** in that project’s **`.env`**. See **`STRATEGY.md`** (*Production allowlist*) and **`deliverables/partner-handoff-package/KEYS-WHERE-IN-REPO.md`** §5.

- **Monorepo `fastops-os/server.js`** (default **3005**) → local dashboard + optional **proxy** to 3100; **`.fastops/external-api-sender-allowlist.json`** applies only on that hop.
