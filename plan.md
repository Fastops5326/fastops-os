---
mission_ref: "Joel 2026-08-12: 'every single new agent tells me GH is not installed here... every agent defaults to building locally which is absolutely the worst possible outcome... lets amend so that globally agents understand how to work successfully, not locally and via the permissions we've created.' The machine-level rule never loaded (wrong extension) for three weeks; AGENTS.md is the one channel that reaches agents in every environment, so the access standard becomes law in every repo."
risk: low
predicted_files:
  - AGENTS.md
---

# Plan: standard GitHub-access section in AGENTS.md (this repo)

## OUTCOME

`AGENTS.md` on **this repo's** default branch gains (or is created with)
the one canonical section `## GitHub access (Fastops5326 standard)`:
GitHub is always available and logged-out is the designed state;
builder-app authentication via `builder-auth.ps1` on Joel's machine,
ambient credentials elsewhere; never ask Joel to log in; never treat
local-only as done; the pipeline is the only path to merge (plan PR,
`Plan:`/`Plan-SHA:` declaration, gates, auto-merge); gate-watching via the
Actions API; the GitHub-refused surface listed; break-glass rail
instructions; walls are findings.

This repo is one instance of an org-wide campaign, but **the campaign is
context, not this plan's definition of done**. This plan is satisfied when
the section is live on this repo's default branch; it makes no claim about
any other repo, and nothing here should be read as asserting org-wide
coverage. Campaign-level tracking lives with the campaign, not in this
repo's gate.

The two-PR ceremony this plan rides is the standard one:

1. **This plan PR** — adds `plan.md` only, and is approved by the plan
   gate. Its head SHA becomes the `Plan-SHA`.
2. **The implementation PR** — adds the section to `AGENTS.md` only, and
   declares `Plan: #<this PR>` and `Plan-SHA: <that sha>` in its body so
   the merge gate can bind the change to this approval.

Done means: PR 2 merged, and the verification below passes on the default
branch. This plan PR is then closed as an approved record.

## EXECUTABLE CHECKS

Let `BASE` be the default branch's `AGENTS.md` as it stands before the
implementation PR (empty if the file does not yet exist).

- `grep -c '^## GitHub access (Fastops5326 standard)$' AGENTS.md` prints
  exactly `1`.
- The section names all of: `builder-auth.ps1`, `admin:request`,
  `bootstrap-repo`, `Plan-SHA`, and the Actions-API run-watch recipe
  (`actions/runs?head_sha=`). `grep -q` for each exits `0`.
- The implementation PR changes exactly one path:
  `gh pr diff <n> --name-only` prints `AGENTS.md` and nothing else.
- Append-only, as a concrete command: with `n=$(wc -l < BASE)`, the first
  `n` lines of the new file are byte-identical to `BASE` —
  `head -n "$n" AGENTS.md | diff -q - BASE` exits `0`. Equivalently
  `cmp -n "$(wc -c < BASE)" AGENTS.md BASE` exits `0`. When `BASE` does
  not exist, `n` is `0` and this check is trivially satisfied.

## BLAST RADIUS

- One documentation file in this repo; zero code paths, zero workflows.
- Worst case is misleading instructions in front of every agent — which is
  precisely today's status quo, minus the instructions.

## FALLBACK

- Detect: the executable checks above; agents citing the section wrongly.
- Undo: revert the implementation PR, which removes the appended section
  and restores `AGENTS.md` to `BASE` exactly.
- Irreversible: nothing.

## COLLISIONS

- `plan.md` is the rolling baton: any open plan PRs in this repo overlap it
  as baton passes only, disposed by design.
- No open PR in this repo predicts `AGENTS.md`. If the gate map shows one,
  this plan defers to it and this repo is handled by hand instead.

## NON-GOALS

- No changes to any existing `AGENTS.md` content — the change is
  append-only.
- No code, workflow, or variable changes anywhere.
- No claim of, or mechanism for, org-wide coverage — that is the
  campaign's business, tracked outside this repo.
- Not the machine-level fixes (rule extension, shell hook) — already live
  outside this repo.
