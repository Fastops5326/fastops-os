# INDEX — fastops-os

> Navigation map for the FastOps engine layer. Read this before browsing.

## Quick orientation (60 seconds)

```
fastops-os/
├── src/
│   └── engine/                       ← Engine internals
│       ├── orchestration/             (62 files — main routing/dispatch)
│       ├── comms/                     (40 files — comms bus + adapters)
│       ├── cdp/                       (27 files — Chrome DevTools Protocol)
│       ├── knowledge-retrieval/       (13 files — Overwatch input handler)
│       ├── partner-platform/pt/       (8 files + qc-results — partner API)
│       └── lib/                       (2 files — shared utilities)
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
| "What's the canonical architecture?" | `ARCHITECTURE.md` (repo root) |
| "What was here before the 2026-04-29 spin-out?" | `SPINOUT.md` + `.archive/` |
| "What environment variables does this need?" | `.env.example` |

## Sub-indexes (per category)

Add an `INDEX.md` inside each `src/engine/<subsystem>/` as the subsystem grows. Currently:

- `src/engine/comms/docs/` has its own docs sub-index (9 files)
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
