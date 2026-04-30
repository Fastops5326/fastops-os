# SPINOUT.md — fastops-os

> What changed in this repo on 2026-04-29 as part of the FastOps 3-repo spin-out.

## Background

The FastOps system was previously a single monorepo at `Fastops5326/warrior-path-ai` (the "dev-process" repo). That monorepo contained:

- The WarriorPath product (a Next.js app)
- The FastOps engine (this repo)
- Methodology, lessons-learned, case studies, and decades of agent-output material
- Tooling, scratch files, transcripts, and historical artifacts

On 2026-04-29 the system was reorganized into three layers:

| Layer | Repository | Role |
|-------|------------|------|
| 1 | `joel5326/fastops-method` | Methodology, knowledge, lessons (Overwatch input) |
| 2 | `joel5326/fastops-os` | **This repo** — engine: adapters, comms, CDP, partner platform, CLI |
| 3 | (mission repos) | e.g. `warriorpath` — products that consume the engine |

## What was added to this repo (1,075 files)

Files matching the engine routing rules in the source monorepo's `manifest-coverage-check.js` were COPIED into matching paths here. Source repo was **not modified**.

| Bucket | Source path → destination path | File count |
|---|---|---|
| Comms imports | `comms/data/.archive/*` → `.archive/comms-from-dev-process/` | 372 |
| Engine sessions | `.fastops/.sessions/`, `.fastops/sessions/`, etc. → `.fastops-engine/sessions/` | 157 |
| Conversations | `.fastops/.conversations/` → `.archive/conversations/` | 117 |
| Orchestration | `.fastops/orchestration/`, `software-factory/`, `city-solve/` → `src/engine/orchestration/` | 61 |
| Claude hooks | `.claude/hooks/` → `templates/hooks/claude/hooks/` | 60 |
| Comms internals | `comms/`, `pt-comms/`, etc. → `src/engine/comms/` | 40 |
| Partner QC | `pt-qc/qc-results/` → `src/engine/partner-platform/pt/qc-results/` | 32 |
| CDP | `.fastops/cdp/` → `src/engine/cdp/` | 27 |
| Claude commands | `.claude/commands/` → `templates/hooks/claude/commands/` | 24 |
| Partner onboarding docs | `docs/partner-onboarding/` → `docs/partner-onboarding/` | 16 |
| ...and 30+ smaller buckets | (see `.spinout/manifest-coverage-report.json`) | balance |

## What was reorganized inside this repo

Pre-existing fastops-os content was moved into a clearer structure to support the new agent navigability conventions.

### Missions retired to `.archive/missions-pre-v3/` (Decision 4B)

19 missions moved (one per top-level subdirectory). All had a single `MISSION.md` payload:

```
agent-experience, agents-choice, ai-leadership, bootup-audit, client-work,
culture, devops, external-relations, fastops-product, first-revenue,
frontier-research, knowledge-management, overwatch, security,
source-independence, startupos, ui-visual, user-docs, visual-qc
```

These can be revived as needed; the live engine no longer references them.

### WarriorPath mission moved out of fastops-os (Decision 5A)

`missions/warriorpath/MISSION.md` was **moved** to the source monorepo at `warriorpath/missions/MISSION.md`. The WarriorPath mission belongs in the WarriorPath product repo, not here.

### Evidence archived to `.archive/evidence-pre-v3/` (Decisions E2 / E3)

- `evidence/onboarding/` — onboarding narratives (also copied to `fastops-method/knowledge/case-studies/onboarding-narratives/`)
- `evidence/maturity/` — memory classification material (also copied to `fastops-method/methodology/memory-classification/`)

### Engine runtime comms archived to `.archive/comms-pre-v3/` (Decision E5)

`.fastops-engine/comms/` (gitignored runtime working directory) contained ~45 channel JSONL files from production usage. These were moved on disk to `.archive/comms-pre-v3/comms-from-engine/` and the empty `.fastops-engine/comms/` directory will be recreated by the engine at next run.

This archive is on disk only — `.fastops-engine/comms/` is gitignored, and the archived snapshot under `.archive/comms-pre-v3/` is committed separately.

### Scratch files archived to `.archive/scratch-msgs/`

`msg-1.txt` … `msg-5.txt` — local scratch from a March drafting session. Moved out of repo root.

### Local secrets gitignored

`FASTOPS-PARTNER-SECRETS.txt` — a local-only file containing partner connection details — was added to `.gitignore`. The file remains on disk but is not tracked. Treat as local-only; do NOT commit.

## PII sanitization

After population, `sanitize-destination.js` was run against this repo. 3 files contained founder names that needed redaction (Joel B / Paul T patterns inside long JSON archive files); all were rewritten in place. Final findstr sweep confirms no `Joel Beam`, `Paul Thoma`, candidate names, or live API key patterns remain in tracked files (excluding the gitignored runtime working directory).

The full audit log lives in the source monorepo at `.fastops/spinout-tools/sanitize-destination-report.json` and was the last sanitizer run before this commit.

## Test status

The pre-spinout baseline was 354/360 unit+integration tests passing (6 environmental API-quota failures, not code bugs) — captured at `.spinout/baseline.json`. Re-run `npm test` after pulling this commit to confirm parity.

## What did NOT change

- `src/cli.ts` — CLI source untouched
- `ARCHITECTURE.md` — canonical architecture untouched
- `package.json` / `tsconfig.json` — dependencies untouched
- `.env` / `.env.example` — secrets untouched (`.env` remains gitignored)
- All previously-tracked engine code in `src/engine/` — only added to, not changed (sanitization aside)

## Rollback

If anything is wrong with this commit:

```
git reset --hard 714f81b
```

(The pre-spinout commit, captured in `.spinout/baseline.json`.)

## Related

- Source manifest: source monorepo at `.fastops/spinout-tools/manifest-coverage-report.json`
- Sibling spin-out: `joel5326/fastops-method` (committed as `711ec82` "Initial population: spin-out from Fastops5326/warrior-path-ai")
