---
mission_ref: "Joel 2026-08-12: 'every single new agent tells me GH is not installed here... every agent defaults to building locally which is absolutely the worst possible outcome... lets amend so that globally agents understand how to work successfully, not locally and via the permissions we've created.' The machine-level rule never loaded (wrong extension) for three weeks; AGENTS.md is the one channel that reaches agents in every environment, so the access standard becomes law in every repo."
risk: low
predicted_files:
  - AGENTS.md
---

# Plan: standard GitHub-access section in AGENTS.md (org-wide campaign)

## OUTCOME

`AGENTS.md` on this repo's default branch gains (or is created with) the
one canonical section `## GitHub access (Fastops5326 standard)`: GitHub is
always available and logged-out is the designed state; builder-app
authentication via `builder-auth.ps1` on Joel's machine, ambient
credentials elsewhere; never ask Joel to log in; never treat local-only as
done; pipeline is the only path to merge (plan PR, `Plan:`/`Plan-SHA:`
declaration, gates, auto-merge); gate-watching via the Actions API; the
GitHub-refused surface listed; break-glass rail instructions; walls are
findings. Identical text lands in every non-archived org repo through this
same two-PR ceremony — zero exceptions.

## EXECUTABLE CHECKS

- On the implementation branch, `grep -c "## GitHub access (Fastops5326
  standard)" AGENTS.md` prints exactly 1.
- The section names all of: `builder-auth.ps1`, `admin:request`,
  `bootstrap-repo`, `Plan-SHA`, and the Actions-API run-watch recipe
  (`actions/runs?head_sha=`); `grep` for each exits 0.
- No file other than `AGENTS.md` changes in the implementation PR
  (`gh pr diff --name-only` lists exactly one path).
- Existing `AGENTS.md` content above the new section is byte-identical to
  the default branch's current content (the campaign only appends).

## BLAST RADIUS

- One documentation file per repo; zero code paths.
- Worst case is misleading instructions in front of every agent — which is
  precisely today's status quo, minus the instructions.

## FALLBACK

- Detect: the executable greps; agents citing the section wrongly.
- Undo: revert the implementation PR; the section leaves the file.
- Irreversible: nothing.

## COLLISIONS

- `plan.md` is the rolling baton: any open plan PRs in this repo overlap it
  as baton passes only, disposed by design.
- No open PR in this repo predicts `AGENTS.md`. If the gate map shows one,
  this plan defers to it and the campaign skips this repo for manual
  handling.

## NON-GOALS

- No changes to any other AGENTS.md content — append-only.
- No code, workflow, or variable changes anywhere.
- Not the machine-level fixes (rule extension, shell hook) — already live
  outside this repo.
