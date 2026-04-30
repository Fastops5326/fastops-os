# INDEX — fastops-os

> Navigation map for the FastOps engine layer. Read this before browsing.

## Quick orientation (60 seconds)

```
fastops-os/
├── src/
│   └── engine/                       ← Engine internals (314 files total across 21 subsystems)
│       ├── orchestration/             (61 files — main routing/dispatch)
│       ├── comms/                     (53 files — comms bus + adapters)
│       ├── partner-platform/          (40 files — partner API + pt + qc-results)
│       ├── cdp/                       (27 files — Chrome DevTools Protocol)
│       ├── __tests__/                 (24 files — engine tests)
│       ├── context/                   (20 files — context graph + retrieval)
│       ├── knowledge-retrieval/       (13 files — Overwatch input handler)
│       ├── tools/                     (12 files — tool registry + helpers)
│       ├── adapters/                  (9 files — provider adapters)
│       ├── compaction/                (8 files — session compaction)
│       ├── persistence/               (7 files — state persistence)
│       ├── contracts/                 (6 files — engine internal contracts)
│       ├── middleware/                (6 files — request middleware)
│       ├── core/                      (5 files — core kernel)
│       ├── onboarding/                (3 files — agent onboarding)
│       ├── overwatch/                 (3 files — overwatch surface)
│       ├── agents/, integrations/, lib/, products/, subagents/  (1-2 files each)
├── services/
│   ├── slack-bridge/                  (Cloudflare Worker)
│   ├── mcp/                           (MCP server)
│   └── partner-test/groupme/          (GroupMe partner harness)
├── templates/                         ← Used by `fastops init` to scaffold mission repos
│   ├── hooks/claude/{hooks,commands,skills}/
│   ├── hooks/cursor/rules/
│   ├── hooks/legacy/
│   ├── skills/visual-qc/
│   ├── project/{package.json,tsconfig,gitignore}.template
│   ├── github-workflows/
│   └── onboarding/
├── contracts/
│   ├── comms/                         (comms contracts)
│   └── .fastops-contracts/            (engine internal contracts)
├── docs/
│   ├── architecture/                  (ARCHITECTURE.md is at root)
│   └── partner-onboarding/            (16 files)
├── fastops-ui/                        ← PARTNER-FACING UI (Next.js 14, 20,690 files)
│   │                                    Front-end for api.fastops.ai. Login, dashboards,
│   │                                    partner self-service. Engine-owned because
│   │                                    the partner platform is engine-owned.
│   └── (standard Next.js layout: app/, components/, lib/, public/, ...)
├── evidence/                          ← Active engineering evidence (post-spinout)
├── scripts/                           ← Operational scripts
├── supabase/migrations/               ← Engine-owned migrations
├── .fastops-engine/                   ← RUNTIME ONLY (gitignored)
│   ├── comms/                          (live channel JSONL — never commit)
│   ├── sessions/                       (working session state)
│   ├── session-baselines/
│   ├── compaction-artifacts/
│   ├── knowledge-retrieval/
│   ├── knowledge-stats/
│   └── agents/
├── .archive/                          ← Pre-v3 historical material (see SPINOUT.md)
│   ├── missions-pre-v3/                (20 missions retired)
│   ├── evidence-pre-v3/                (onboarding/ + maturity/ moved out)
│   ├── comms-pre-v3/                   (engine runtime comms snapshot)
│   ├── comms-from-dev-process/         (372 channel files imported from monorepo)
│   ├── conversations/                  (117 archived AI conversations)
│   ├── factory-runs/                   (9 software-factory run records)
│   ├── deliberations/                  (9 multi-model deliberations)
│   ├── handoffs/
│   ├── scratch-msgs/                   (msg-1..5.txt — local scratch)
│   └── reef-outcome-log.jsonl
├── ARCHITECTURE.md                    ← Canonical engine architecture
├── README.md                          ← Repo intro
├── AGENTS.md                          ← Agent operating instructions
├── INDEX.md                           ← (this file)
├── SPINOUT.md                         ← What moved on 2026-04-29
├── capability.json                    ← Machine-readable capability descriptor
├── package.json                       ← Node deps
├── tsconfig.json                      ← TS config
├── Dockerfile / Procfile / railway.json   ← Deployment
└── .env / .env.example                ← Env vars (.env is gitignored)
```

## How to find things

| What you want | Where to look |
|---|---|
| "How does the engine route a tool call?" | `src/engine/orchestration/` |
| "Where does comms live?" | `src/engine/comms/` (bus) + `services/slack-bridge/` (transport) |
| "How does the partner API work?" | `src/engine/partner-platform/pt/` + `docs/partner-onboarding/` |
| "Where do I add a new template hook?" | `templates/hooks/{claude,cursor}/` |
| "Where is the partner-facing UI?" | `fastops-ui/` (Next.js 14, served at `api.fastops.ai`) |
| "What's the canonical architecture?" | `ARCHITECTURE.md` (repo root) |
| "What was here before the 2026-04-29 spin-out?" | `SPINOUT.md` + `.archive/` |
| "What environment variables does this need?" | `.env.example` |

## Sub-indexes (per category)

Sub-indexes are **created on demand**, not pre-stubbed. The root `INDEX.md` (this file) is the only one guaranteed to exist; the file counts above let you spot which subsystems have substantive content. If a subsystem grows large enough that you need a deeper map, drop an `INDEX.md` inside it and link it from the table above. Currently:

- `src/engine/comms/docs/` ships its own docs sub-index
- `docs/partner-onboarding/` is the partner-facing index

## Status legend

Status labels appear at the top of files and folders:

- `live` — Current authoritative content
- `archive` — Historical, retained for reference
- `deprecated` — Replaced by a newer version; do not use
- `experimental` — Provisional, may be promoted or removed

## Related repos

- **Knowledge:** `joel5326/fastops-method`
- **Source archive:** `Fastops5326/warrior-path-ai` (everything pre-spin-out)
- **Mission example:** `warriorpath` (in source repo, `warriorpath/` directory)
