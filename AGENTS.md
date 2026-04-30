# AGENTS.md — fastops-os

> Agent operating instructions for the FastOps engine layer (Layer 2).
>
> Sibling repos:
> - **`joel5326/fastops-method`** — knowledge / methodology / lessons (Layer 1)
> - **Mission repos** — products that consume this engine (Layer 3), e.g. `warriorpath.ai_actual`

## You are reading the engine repository

This repo is the **runtime**: adapters, comms bus, CDP harness, partner platform, software factory, MCP, slack-bridge, CLI, and templates that scaffold new mission repos.

If you need methodology, lessons-learned, or case studies, you're in the wrong repo — go to `fastops-method`.

If you need product code (e.g. WarriorPath), you're in the wrong repo — go to the mission repo.

## What this repo contains

| Path | What lives here |
|---|---|
| `src/engine/` | Engine internals: orchestration, comms, cdp, knowledge-retrieval, partner-platform, lib |
| `services/` | Long-running services: `slack-bridge/`, `mcp/`, `partner-test/groupme/` |
| `templates/` | Templates that `fastops init` copies into new mission repos: `hooks/claude/`, `hooks/cursor/`, `skills/`, `project/` (package.json, tsconfig, .gitignore), `github-workflows/`, `onboarding/` |
| `fastops-ui/` | **Partner-facing Next.js UI** for `api.fastops.ai`. This is the partner-platform front-end (login, dashboards, partner self-service). Engine-owned because the partner platform is engine-owned. Do **not** confuse with mission-repo UIs (each mission/product has its own UI in its own repo). |
| `contracts/` | Internal contracts: `comms/`, `.fastops-contracts/` |
| `docs/` | Architecture + partner onboarding docs |
| `evidence/` | (Active) Engineering evidence — kept post-spinout for whatever's still referenced |
| `.fastops-engine/` | Runtime working directory for the engine — **gitignored**: `comms/`, `sessions/`, `session-baselines/`, `compaction-artifacts/`, `knowledge-retrieval/`, `knowledge-stats/`, `agents/` |
| `.archive/` | Pre-v3 historical material — see `SPINOUT.md` for what was moved here on 2026-04-29 |
| `scripts/` | Operational scripts |
| `supabase/` | Supabase migrations / config used by the engine |

## How to use this repo

### Rule 1 — Stay in your lane

If you're patching engine internals, stay in `src/engine/`. If you're tuning a template, stay in `templates/`. Don't sprawl across the repo to make a single change.

### Rule 2 — Templates are referenced via the CLI, not hardcoded

When `fastops init` scaffolds a mission repo, it reads from `templates/` and rewrites `{{PLACEHOLDER}}` tokens. Anything that references a hardcoded path like `C:\...\fastops-os\...` will break in scaffolded projects. Use the CLI's path resolver (`fastops resolve-config`) when writing template hooks.

### Rule 3 — The runtime working dir is `.fastops-engine/`, and it's gitignored

If you find yourself committing files to `.fastops-engine/comms/`, `.fastops-engine/sessions/`, or any other runtime subdir, stop. That data is supposed to be ephemeral. The historical engine comms were archived to `.archive/comms-pre-v3/comms-from-engine/` — see `SPINOUT.md`.

### Rule 4 — Secrets never go in git

`FASTOPS-PARTNER-SECRETS.txt` is gitignored. `.env` is gitignored. If you generate any secret-bearing artifact during work, name it `*-PARTNER-SECRETS.txt` or `.local-secrets*` and gitignore catches it. If you leak a secret, rotate immediately and document in `fastops-method/.spinout/known-leaks.json` (yes, sibling repo).

### Rule 5 — Tests are mandatory before commit

```
npm test
npm run test:integration   # if touching adapters/comms/cdp
```

The pre-spinout baseline was 354/360 unit+integration passing (6 environmental API-quota failures, not code bugs). If you drop below that, fix or document.

## Engine handoff to mission repos

A mission repo's `fastops.config.json` declares:

```json
{
  "engine":  { "version": "fastops-os@^1.0.0",     "path": "${FASTOPS_OS_PATH}" },
  "method":  { "version": "fastops-method@^1.0.0", "path": "${FASTOPS_METHOD_PATH}" }
}
```

The CLI resolves `${FASTOPS_OS_PATH}` to this directory. From there:

```
fastops init        # scaffold a new mission repo
fastops register    # register a capability with the engine
fastops mature      # promote a lesson into fastops-method
fastops list        # list registered capabilities
fastops doctor      # diagnose env / config issues
fastops resolve-config   # debug ${VAR_NAME} expansion
```

## Promotion gates (Tool Graduation)

If you build a tool inside a mission repo that should become engine-level, use:

```
fastops mature tool --src <path> --target services/ | src/engine/
```

This routes through tiered review (T1: 1 reviewer; T2: 3 reviewers + Joel; T3: 5 reviewers + Joel + adversarial QC). Do NOT manually copy mission-repo code into `services/` or `src/engine/`.

## Sibling repo conventions

- `joel5326/fastops-method` — knowledge layer (consumed by Overwatch, surfaced to agents)
- Mission repos — register against pinned engine version, opt into Overwatch + comms

## When in doubt

1. Read `SPINOUT.md` to understand what moved on 2026-04-29.
2. Read `INDEX.md` for the human-friendly navigation map.
3. Read `capability.json` for the machine-readable capability descriptor.
4. Read `ARCHITECTURE.md` for the canonical engine architecture.
