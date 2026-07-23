# Contribution Model — fastops-os + fastops-method

> **Status:** approved (Joel sign-off 2026-05-07)
> **Audience:** Joel, future agents, future contributors
> **Replaces:** any prior assumption that engine/method are path-resolved on a single dev machine

---

## 1. TL;DR

Every customer project gets the FastOps engine and a snapshot of FastOps methodology by installing **one private npm package**: `fastops-os`. Reads are local and offline. Writes (new tools, new methodology, improvements) flow back through **GitHub pull requests** opened by the `fastops contribute` CLI command. Joel is the sole human gate for promotion. Promoted contributions ship in the next `fastops-os` release on a 1–2 week cadence. There is no central FastOps server, no shared dev machine, and no path-based linking.

---

## 2. Goals and non-goals

### Goals

1. **Cloud-native by default.** A customer in the cloud must be able to install `fastops-os`, run a project, and use the engine + methodology with zero dependence on Joel's local machine.
2. **Wikipedia-style evolution.** Any agent in any customer project can submit a contribution. Contributions land in a clearly marked `candidates/` area. Validation = Joel approval (informed eventually by use signals).
3. **Side-by-side competition.** Two contributors can submit conflicting drafts of the same idea. Both live in `candidates/`. Joel picks one, merges or rejects.
4. **Tool-agnostic agent vocabulary.** Slash commands, hooks, and rules are authored once at `.fastops/commands/` and projected per-tool (Claude, Cursor, Codex, Gemini, etc.).
5. **Discoverability without spelunking.** Every project carries a generated `.fastops/discovery.json` (committed) so a fresh agent on a fresh clone immediately knows what tools, methodology, and capabilities are available.
6. **Scale to 10 customers without infrastructure to run.** GitHub itself is the backend.

### Non-goals (v1)

- Real-time contribution feedback (PRs are async).
- Automatic promotion based on use telemetry. (Joel-as-gate is intentional for v1; telemetry is v2.)
- Front-line non-developer users authoring contributions directly. (Sandbox-and-harvest model is v3.)
- Public npm distribution. Everything stays in private GitHub Packages.
- Custom auth or permissions service. We rely on GitHub PATs.

---

## 3. Architecture overview

```
                          ┌───────────────────────────────────────┐
                          │ GitHub (source of truth)              │
                          │  joel5326/fastops-os                  │
                          │  joel5326/fastops-method              │
                          └───────────────────────────────────────┘
                                  ▲                  │
                                  │                  │ on release tag:
                                  │                  │ fastops-os build
                                  │                  │ bundles a frozen
                                  │                  │ method-snapshot/
                                  │                  ▼
                          ┌───────────────────────────────────────┐
                          │ GitHub Packages (private npm registry)│
                          │  fastops-os@x.y.z (engine + snapshot) │
                          └───────────────────────────────────────┘
                                  │
                ┌─────────────────┼─────────────────┐
                ▼                 ▼                 ▼
        ┌────────────┐    ┌────────────┐    ┌────────────┐
        │ Customer A │    │ Customer B │    │ Customer N │
        │ Cloud host │    │ Cloud host │    │ Cloud host │
        │ npm i      │    │ npm i      │    │ npm i      │
        │ fastops-os │    │ fastops-os │    │ fastops-os │
        └────────────┘    └────────────┘    └────────────┘
                │                 │                 │
                │ fastops contribute (CLI)          │
                └─────────────────┼─────────────────┘
                                  ▼
                          GitHub API: open PR ──▶ candidates/
                                  │
                          Joel reviews on GitHub web UI
                          Merge = promote (next release picks up)
                          Close = reject
```

Three properties:

| Property | Implication |
|---|---|
| **Reads are local + offline** | Customer products read methodology from `node_modules/fastops-os/method-snapshot/` — zero network calls to surface knowledge |
| **Writes are network-only and rare** | `fastops contribute` opens a GitHub PR. No persistent storage required at customer side |
| **No infrastructure to run** | No Cloudflare Worker, no Railway service, no shared API server. GitHub IS the backend |

---

## 4. Distribution model

### Engine (`fastops-os`)

- Published to **GitHub Packages** as `fastops-os` under scope `@joel5326`.
- Customer projects install via `.npmrc` line + GitHub PAT auth:
  ```
  @joel5326:registry=https://npm.pkg.github.com
  //npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
  ```
- Tarball includes: `dist/`, `templates/`, `contracts/`, `method-snapshot/`, `capability.json`, `AGENTS.md`, `INDEX.md`, `README.md`.
- Tarball excludes: `fastops-ui/`, `.archive/`, `.fastops-engine/`, `evidence/`, `services/`, `src/` (compiled output ships, not source), `.env*`, `FASTOPS-PARTNER-SECRETS.txt`.
- Enforced by `package.json` `files` whitelist + `.npmignore`.

### Methodology (`fastops-method`)

- **Not** published as a standalone package.
- Bundled as a **frozen snapshot** into `fastops-os`'s tarball at `method-snapshot/` at publish time.
- The snapshot contains only `core/` content from `fastops-method`. The `candidates/` folder is excluded from snapshots.
- Customer products read methodology from `node_modules/fastops-os/method-snapshot/` with no network call.
- New methodology becomes available to customers only when they bump `fastops-os` to a version whose snapshot includes it.

### Why this shape

- **Customers never touch `fastops-method` directly.** They only consume the engine. This makes auth simpler (one token, one repo) and prevents drift.
- **Methodology updates are coupled to engine releases.** Same release, same version. No "method-only" updates that could leave engine and method out of sync.
- **Solo-friendly.** Joel publishes from one machine; everywhere else just installs.

---

## 5. Contribution model

### Folder structure (added to both repos)

```
fastops-os/
├── (current folders = CORE — Joel-only writes)
└── candidates/                     ← NEW. Anyone with a PAT can submit.
    ├── README.md                    Explains the rules
    ├── tools/                       Drafts of new engine tools or services
    ├── templates/                   Drafts of new templates
    ├── slash-commands/              Drafts of new commands
    └── _meta/
        └── submissions.jsonl        Append-only ledger of every submission

fastops-method/
├── (current folders = CORE — Joel-only writes)
└── candidates/                     ← NEW. Anyone with a PAT can submit.
    ├── README.md                    Explains the rules
    ├── methodology/
    ├── lessons/
    ├── case-studies/
    └── _meta/
        └── submissions.jsonl
```

### Submission flow

```
Agent in customer project has an idea
  │
  ▼
fastops contribute method --file <local-path> --topic "<short-name>" --why "<rationale>"
  │
  ▼
CLI:
  1. Authenticates via GITHUB_TOKEN env var
  2. Forks fastops-method (if no fork exists yet for this PAT owner)
  3. Creates a branch named: contrib/<topic>-<short-sha>
  4. Copies the file/folder to: candidates/<category>/<submitter>/<topic>/
  5. Appends an entry to candidates/_meta/submissions.jsonl
  6. Opens a PR back to joel5326/fastops-method:main
  7. PR title: "[contrib] <category>: <topic> (by <submitter>)"
  8. PR body: rationale + use-context + provenance link
  │
  ▼
GitHub creates the PR. Joel gets a notification.
```

### Side-by-side competing drafts

- Two contributors submitting drafts of "the same idea" land in **separate folders namespaced by submitter**: `candidates/tools/<submitter-A>/cdp-screenshot-v2/` and `candidates/tools/<submitter-B>/cdp-screenshot-v2/`.
- Both PRs are open simultaneously. Joel reviews them side-by-side in GitHub.
- When Joel picks a winner, the chosen PR is merged (with optional edits). The other is closed with a comment explaining why.
- The merged content moves into the appropriate `core/` location. The candidate folder is deleted in the same merge commit.

### Submission ledger

`candidates/_meta/submissions.jsonl` is append-only. Each line:

```json
{
  "id": "uuid",
  "submittedAt": "ISO-8601",
  "submitter": "github-username",
  "category": "tools|templates|slash-commands|methodology|lessons|case-studies",
  "topic": "short-name",
  "path": "candidates/<...>",
  "prUrl": "https://github.com/joel5326/<repo>/pull/N",
  "status": "open|merged|rejected",
  "why": "rationale string"
}
```

This gives us an audit trail without needing a database.

---

## 6. Validation / promotion model

### v1: Joel-as-gate, manually informed

- **All promotion = Joel merging a PR on github.com.** No automatic promotion.
- **All rejection = Joel closing a PR on github.com.** A bot or a follow-up commit updates `submissions.jsonl` `status` field.
- **Promotion mechanics:** the merged PR moves content from `candidates/` into the appropriate `core/` location and updates `submissions.jsonl`. The promotion is then visible to all customers on the next `fastops-os` release.

### v2 (later, when use signal is real): use-informed promotion

Joel's review will be assisted (not replaced) by:

1. **Reference count** — static scan: how many files in `core/` link to this candidate? How many mission repos reference it?
2. **CLI run count** — telemetry: every `fastops <subcmd>` invocation appends a line to a usage stream. Aggregated across customers (with consent), shows what's actually being called.

These signals appear in PR comments via a GitHub Action that runs `fastops audit --pr <N>` on every candidate PR. Joel still merges or closes manually — the data just informs.

### v3 (future): demotion

A periodic `fastops audit --core` job lists `core/` items with low or zero reference + run count over a window (e.g. 90 days). Joel reviews flagged items, decides:
- Keep (mark "low-use, retained")
- Archive to `core-archive/`
- Delete (rare)

### Conflict policy

**Zero conflicts in `core/`.** Two competing drafts can coexist in `candidates/` with separate paths (namespaced by submitter). Once Joel picks one, the conflict resolves at merge time. No simultaneous "v1 vs v2" entries are allowed in `core/` — replacement is the only mode.

---

## 7. Discovery model

### `.fastops/discovery.json` (committed in every mission repo)

Generated by `fastops doctor`. Contains:

```json
{
  "schema": "fastops/discovery/v1",
  "generatedAt": "ISO-8601",
  "engine": {
    "name": "fastops-os",
    "installedVersion": "1.2.3",
    "capabilities": [
      { "id": "engine.cdp", "status": "core",      "callVia": "fastops cdp ..."   },
      { "id": "engine.comms", "status": "core",    "callVia": "fastops comms ..." },
      { "id": "tool.cdp-screenshot-v2", "status": "candidate", "submitter": "agent-x", "callVia": "fastops cdp screenshot-v2 ..." }
    ],
    "cliSubcommands": ["init", "register", "mature", "doctor", "list", "resolve-config", "contribute", "audit"]
  },
  "method": {
    "snapshotVersion": "bundled-with-fastops-os-1.2.3",
    "categories": ["methodology", "lessons", "case-studies", "memories"],
    "accessVia": "fastops surface --query '<terms>' (reads from node_modules/fastops-os/method-snapshot)"
  },
  "mission": {
    "name": "<mission-name>",
    "registeredCapabilities": [],
    "fastopsConfigPath": "fastops.config.json"
  },
  "ifYouNeedTo": {
    "see what tools exist":      "fastops list",
    "screenshot a URL":          "fastops cdp screenshot --url <url>",
    "post to a comms channel":   "fastops comms send --channel <name>",
    "find a past mission":       "fastops surface --query '<terms>'",
    "submit an idea":            "fastops contribute method --file <path> --topic '<name>'",
    "validate the install":      "fastops doctor"
  }
}
```

### `AGENTS.md` (committed in every mission repo)

The mission repo's agents-first orientation file. Generated by `fastops init`. Points at `.fastops/discovery.json` as required reading. Contains:

- The "If you need to ... call ..." table (mirrors `discovery.json`)
- Slash command listing
- Sibling repo conventions
- Trust rules (don't browse `node_modules/fastops-os/method-snapshot/` directly — call `fastops surface`)

### Tool-agnostic command surface

Source of truth: `.fastops/commands/` (committed). Each command is a markdown file with a short header.

`fastops doctor` runs **per-tool generators** that produce:

- `.claude/commands/<name>.md`
- `.cursor/rules/<name>.mdc`
- `.codex/commands/<name>.md`
- `.gemini/commands/<name>.md`
- ...one generator per supported tool

This means agents in any of the 5+ foundation models you run see the same vocabulary, and you only author each command once.

---

## 8. Trust model (v1)

| Action | Who can do it | How |
|---|---|---|
| Read engine | Any customer with a valid `GITHUB_TOKEN` that has `read:packages` scope | `npm install` |
| Read methodology | Same (it's bundled into the engine tarball) | `fastops surface` |
| Submit contribution | Any human or agent with a `GITHUB_TOKEN` that has `repo` scope | `fastops contribute` (opens a PR) |
| Promote / reject | Joel only | Merge or close a PR on github.com |
| Direct write to `core/` | Joel only | Direct commit to `joel5326/fastops-os` or `joel5326/fastops-method` `main` |

**Anonymous submissions are not supported in v1.** Every contribution carries a GitHub identity via the PAT used to open the PR.

### Secrets

Each customer manages their own secrets in their own deployment environment (Vercel env vars, Railway env vars, etc.). The CLI reads from `process.env`. There is no central FastOps secrets store. There is no `~/.fastops/secrets.env` — that pattern is dead.

The only FastOps-issued secret is each customer's `GITHUB_TOKEN` for installing the package and contributing. Joel issues these by adding the customer's GitHub user as a collaborator on `joel5326/fastops-os` (or a fine-grained PAT bound to specific repos).

---

## 9. Release cadence

- **Cadence:** every **1–2 weeks**, Joel cuts a new `fastops-os` patch or minor release.
- **What gets bundled:** all PRs merged into `core/` of `fastops-os` and `fastops-method` since the prior release.
- **Versioning:** semver. `1.x.y` patch for fixes + new candidates promoted to core. `1.x.0` minor for new top-level capabilities. `2.0.0` major for breaking CLI / config changes.
- **Customer update path:** customers bump `fastops-os` in their `package.json` on their own cadence. They are **not** automatically updated.
- **Release artifact:** GitHub Release on `joel5326/fastops-os` with notes describing what's new (especially what was promoted out of `candidates/`).

---

## 10. CLI surface

### Authoring path (Joel's machine, dev environment)

Currently lives at `fastops-os/src/cli.ts`. After build, ships as `dist/cli.js`. Available everywhere `fastops-os` is installed via the `bin: { fastops: ./dist/cli.js }` field in `package.json`.

### Subcommands (v1)

| Subcommand | Purpose |
|---|---|
| `fastops init` | Scaffold a new mission repo: write `fastops.config.json`, `AGENTS.md`, `.fastops/`, copy templates, run per-tool generators |
| `fastops doctor` | Validate engine install, regenerate `.fastops/discovery.json`, re-run per-tool generators |
| `fastops list` | Print capabilities from local `.fastops/discovery.json` |
| `fastops surface --query <terms>` | Search the bundled `method-snapshot/` for relevant material |
| `fastops contribute <category> --file <path> --topic <name> [--why <text>]` | Open a GitHub PR against `fastops-os` or `fastops-method` candidates/ |
| `fastops register <capability>` | Register a mission-repo-local capability into the local discovery manifest |
| `fastops resolve-config` | Print the resolved `fastops.config.json` for debugging |

### Subcommands (v2 — later)

| Subcommand | Purpose |
|---|---|
| `fastops audit --core` | List low-use core items for demotion review |
| `fastops audit --pr <N>` | Compute use signals for a candidate PR (used by GH Action) |
| `fastops mature` | Tier-gated promotion helper (T1/T2/T3) |
| `fastops doctor --ci` | CI-friendly validation that doesn't try to write to disk |

---

## 11. Future phases

### v2: telemetry + audit

- Usage logging from the CLI
- Reference-count scanner
- `fastops audit` subcommand
- GH Action that comments on candidate PRs with use signals
- Auto-suggest demotion candidates

### v3: front-line user product (sandbox-and-harvest)

- Front-line non-developer users build their own AI solutions in **sandboxed environments**.
- A harvest pipeline detects useful sandbox content and surfaces it to Joel as a contribution candidate.
- Sandboxes are isolated; they cannot directly write to `fastops-os` or `fastops-method`.
- The "use validates" loop here is: how many other front-line users adopt a sandbox-built solution? At a threshold, the harvester nominates it.

This is explicitly **out of scope for v1** but the v1 architecture is shaped to accommodate it.

---

## 12. Build plan

| # | Item | Effort | Status |
|---|---|---|---|
| 1 | This design doc | 30 min | in progress |
| 2 | `candidates/` skeleton in `fastops-os` | 30 min | pending |
| 3 | `candidates/` skeleton in `fastops-method` | 30 min | pending |
| 4 | Update `capability.json` / `AGENTS.md` / `INDEX.md` in `fastops-os` | 30 min | pending |
| 5 | Update same in `fastops-method` | 30 min | pending |
| 6 | npm `files` whitelist + method-snapshot bundling step | half day | pending |
| 7 | `fastops init` CLI | 1 day | pending |
| 8 | `fastops doctor` CLI + per-tool generators | 1 day | pending |
| 9 | `fastops contribute` CLI | half day | pending |
| 10 | `fastops list` CLI | 1 hour | pending |
| 11 | First publish to GitHub Packages | half day | pending |
| 12 | Pilot: install into `warriorpath/`, run `fastops init`, verify build still passes | half day | pending |

**Total: ~3.5 days of focused work for a working v1.**

---

## 13. Provenance

- Architecture conversation: 2026-05-07 with Joel.
- Locked-in decisions captured in this doc.
- Source-of-truth this doc is the canonical reference. Any code that contradicts this doc is wrong; either the code gets fixed, or this doc gets a versioned update with a changelog entry.
