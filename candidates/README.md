# `candidates/` — fastops-os

> **Status:** live as of 2026-05-07
> **Purpose:** Submission area for proposed engine additions and changes
> **See also:** `docs/architecture/contribution-model.md` (canonical spec)

## What this folder is

This is where contributions to the FastOps engine **land first**, awaiting Joel's review.

Anything in `candidates/` is **not** part of the validated engine. It is a draft. Customer projects pulling `fastops-os` from npm do **not** receive `candidates/` content — only `core/` content (the rest of this repo, excluding `candidates/`) ships in the published tarball.

## How content gets here

Use the CLI:

```bash
fastops contribute tool --file ./my-new-tool.ts --topic "cdp-screenshot-v2" --why "rationale"
```

The CLI:
1. Authenticates via `GITHUB_TOKEN` env var
2. Forks `joel5326/fastops-os` if needed
3. Creates a branch and copies your file/folder into `candidates/<category>/<your-github-username>/<topic>/`
4. Appends an entry to `_meta/submissions.jsonl`
5. Opens a PR back to `joel5326/fastops-os:main`

Direct commits to `candidates/` are also fine if you have write access; the CLI is just convenience.

## Categories

| Folder | What goes here |
|---|---|
| `tools/` | New engine tools, services, or adapter modules |
| `templates/` | New templates that `fastops init` should copy into mission repos |
| `slash-commands/` | New tool-agnostic commands for `.fastops/commands/` |

## Side-by-side competing drafts

If two contributors propose the same idea, both PRs can stay open simultaneously. Their drafts live in separate paths namespaced by submitter:

```
candidates/tools/<submitter-A>/cdp-screenshot-v2/
candidates/tools/<submitter-B>/cdp-screenshot-v2/
```

Joel compares them in GitHub's PR UI, picks one, merges. The other PR is closed with a comment.

## What promotion looks like

When Joel merges a candidate PR:
1. Files move from `candidates/<category>/<submitter>/<topic>/` to the appropriate location in `core/` (e.g., `src/engine/cdp/`, `templates/hooks/claude/`, `templates/commands/`)
2. The candidate folder is deleted in the same merge commit
3. `_meta/submissions.jsonl` `status` field is updated to `merged`
4. The next `fastops-os` release (1–2 week cadence) bundles the change into the published tarball
5. Customers see it after they bump their `fastops-os` version

## What rejection looks like

Joel closes the PR. The candidate folder remains in the closed branch (GitHub keeps history). `_meta/submissions.jsonl` `status` is updated to `rejected`. The submitter sees Joel's comment explaining why.

## Rules

1. **Don't import from `candidates/` in `core/` code.** Candidates are not stable. If you need to depend on something, it must already be promoted.
2. **Don't manually edit another submitter's candidate folder.** If you have a better version, submit your own draft alongside.
3. **One topic per PR.** If your idea is actually two ideas, split them.
4. **Include a clear `--why`.** Submissions without rationale will be closed.

## Schema for `_meta/submissions.jsonl`

```json
{
  "id": "uuid",
  "submittedAt": "ISO-8601 timestamp",
  "submitter": "github-username",
  "category": "tools|templates|slash-commands",
  "topic": "short-name",
  "path": "candidates/<...>",
  "prUrl": "https://github.com/joel5326/fastops-os/pull/N",
  "status": "open|merged|rejected",
  "why": "rationale string"
}
```

Append-only. Never edit existing lines; only add new ones (or update `status` via a CI bot in v2).
