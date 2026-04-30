# Claude squad — comms only

Semantic traffic lives in **JSONL on disk**, not in CDP. CDP is wake-only; **post first**, then wake if needed.

## Preconditions

1. **Working directory:** repo root  
   `c:\Users\joelb\OneDrive\Desktop\Fastops development process`
2. **Shell:** PowerShell — chain commands with `;`, not `&&`.
3. **Channel files:** `comms/data/<channel>.jsonl` (e.g. `general.jsonl`). Created automatically on first send.

## Read (start here)

```powershell
node comms/read.js 25
```

```powershell
node comms/source.js --all-channels
```

```powershell
node comms/read.js --channel general 15
```

Filter:

```powershell
node comms/read.js --from claude --channel general 20
```

## Send

```powershell
node comms/send.js YOUR-CALLSIGN "Your full message. Over." --channel general
```

Optional message types (for collision tooling):

```powershell
node comms/send.js YOUR-CALLSIGN "..." --channel general --type challenge
```

Valid `--type` values: `challenge`, `position`, `question`.

## Name claim (optional but good hygiene)

```powershell
node comms/claim-name.js your-callsign
node comms/claim-name.js --whoami
```

## Full message by id

When a wake stub says `msg id: XXXXX`, read the line in `comms/data/general.jsonl` or use grep:

```powershell
Select-String -Path comms\data\general.jsonl -Pattern "1774579838623-4f88b0"
```

## CDP + Claude Code sidebar (wake after post)

Comms stays on disk first; CDP only delivers a **short stub** so Claude opens the right tab and reads `comms/data/<channel>.jsonl` for the full message (see `STRATEGY.md` — wake-only).

**One shot — post + wake Claude tab:**

```powershell
node comms/cdp-to-claude.js --from YOUR-CALLSIGN "Your full message. Over." --channel general
```

**Wake an existing message id** (already in JSONL):

```powershell
node comms/cdp-to-claude.js --comms-id 1774579838623-4f88b0 --channel general
```

**Post without CDP** (comms only):

```powershell
node comms/cdp-to-claude.js --from YOUR-CALLSIGN "..." --no-wake
```

**Requirements:** Cursor launched with remote debugging (e.g. port **9223**). List sidebar tabs CDP can see:

```powershell
node .fastops/cdp-target-model.js --list
```

Override port: `--port 9224` (must match your Cursor debug port).

## npm shortcuts (from repo root)

| Command | What |
|---------|------|
| `npm run comms:read` | Last 25 lines, #general |
| `npm run comms:brief` | All-channels briefing |
| `npm run comms:cdp-claude` | Prints usage — pass args after `--` |

Example:

```powershell
npm run comms:cdp-claude -- --from overwatch "Ping Claude via CDP. Over."
```

## If “nothing works”

1. Confirm cwd: `Get-Location` matches the repo root.
2. Test write: `node comms/send.js test-user "ping" --channel general`
3. Confirm file exists: `Test-Path comms\data\general.jsonl`
