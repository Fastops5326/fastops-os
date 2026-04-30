# GroupMe API Test Kit + Daily Check-in Pilot

Zero-dependency Node.js + PowerShell tooling for:

1. Posting messages to GroupMe groups via the API
2. Running a daily workout-accountability check-in (post + score + follow-up list)
3. Scheduling it on Windows so it runs M-F automatically

## Files

| File | Purpose |
|------|---------|
| `.env` | Your API token + default group ID (gitignored) |
| `lib.js` | Shared helpers (env loading, fetch wrapper, state I/O) |
| `list.js` | Discovery: shows your groups, members, DM threads |
| `send-group.js` | Send any one-off message to a group |
| `send-dm.js` | Send a direct message (currently blocked by GroupMe — kept for reference) |
| `checkin-post.js` | Posts the daily check-in question, saves message_id to `state/` |
| `checkin-report.js` | Reads who reacted vs. who didn't, prints + saves report |
| `state/` | Per-day check-in state and reports (gitignored) |
| `scripts/daily-workflow.ps1` | PowerShell wrapper: handles Post or Report mode |
| `scripts/install-scheduled-tasks.ps1` | Installs Windows scheduled tasks (M-F 6am post / 8pm report) |
| `scripts/uninstall-scheduled-tasks.ps1` | Removes the scheduled tasks |
| `scripts/post-now.ps1` | One-click manual post (double-clickable) |
| `scripts/report-now.ps1` | One-click manual report (double-clickable) |

## Setup (one-time)

```powershell
cd "C:\Users\joelb\OneDrive\Desktop\Fastops development process\groupme-test"

# Token already in .env. To rotate it: edit .env, paste new token from https://dev.groupme.com/

# Verify token + see your groups
node list.js
```

## Daily pilot — manual run

```powershell
# Morning: post the check-in (uses GROUPME_GROUP_ID from .env, currently KC = 105536297)
node checkin-post.js

# Evening: see who reacted, who didn't
node checkin-report.js
```

Both produce JSON files in `state/` for historical tracking and future Monday.com sync.

## Daily pilot — scheduled (currently active)

Already installed. Pops up a Y/N confirmation window at the scheduled time:

- **6:00 AM M-F** — "Post check-in? [Y/n]"
- **8:00 PM M-F** — "Run report? [Y/n]"

Default is Y — just press Enter.

### Switch to full automation (no prompts)

When you trust it enough to run unattended:

```powershell
cd "C:\Users\joelb\OneDrive\Desktop\Fastops development process\groupme-test"
powershell -ExecutionPolicy Bypass -File scripts\install-scheduled-tasks.ps1 -Auto
```

### Change times

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-scheduled-tasks.ps1 -PostTime '07:00' -ReportTime '21:00'
# Add -Auto if you also want no prompts
```

### Remove the schedule

```powershell
powershell -ExecutionPolicy Bypass -File scripts\uninstall-scheduled-tasks.ps1
```

### Manual one-click run

Double-click these any time (or run from PS):

- `scripts\post-now.ps1` — fires today's check-in immediately
- `scripts\report-now.ps1` — runs today's report immediately

## Key constraints

- **Tasks only run while your PC is on/awake.** If laptop is closed at 6 AM, the task fires when you wake it (via "Start when available"). For true 24/7 reliability, move to cloud cron later.
- **Direct messages via API are blocked** by GroupMe. Group sends only.
- **Weekends are skipped.** Workflow exits early on Sat/Sun.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `GROUPME_TOKEN is not set` | Token missing or `.env` malformed — paste fresh token from dev.groupme.com |
| `401 Unauthorized` | Token expired/revoked — get a new one |
| `404 Not Found` on group send | You're no longer a member of that group, or wrong group_id (run `node list.js`) |
| `Could not find the check-in message` | >1000 messages posted in group since check-in went out (very active group); the report can't see far enough back |
| Scheduled task didn't run | PC was off/asleep. Check Task Scheduler → "Last Run Result". `0x0` = success. |

## Architecture (where this is heading)

```
[ Today: Local pilot ]
  Win Task Scheduler → daily-workflow.ps1 → node checkin-post.js / checkin-report.js
                                                ↓
                                          state/*.json

[ Next: WarriorPath integration ]
  Existing routes at packages/warriorpath-unified/src/app/api/v1/groupme/
  Move post/report logic into server-side endpoints
  Schedule via Vercel Cron / GitHub Actions

[ Then: Monday.com sync ]
  After report runs → push per-warrior status to Monday board
  Columns: Last Workout 👍, Streak Days, Days Silent
  Trigger Monday automations for follow-up workflows

[ Finally: Escalation logic ]
  Day 1 silent → @mention in next check-in
  Day 3 silent → personal nudge (manual or SMS)
  Day 7 silent → coach intervention
```
