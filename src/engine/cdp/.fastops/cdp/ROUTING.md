# CDP wake routing — read before you wake

## The failure modes we fixed

1. **Self-wake loop** — Running `cdp-wake.js` with `--target` set to **the same Cursor chat / seat that is executing the script** injects the stub into **your own** thread. The model then treats it as new instructions → endless loop. **Never wake yourself.**

2. **`claude` is not “the main chat”** — In `seat-map.json`, alias `claude` → **seat-4 (OVERWATCH)** = **Claude-labeled sidebar tab**. It is **not** Composer, **not** “whatever Opus session I’m in.”

3. **Claude Code (terminal / webview)** — **seat-1**, agent `bridge-iii`. Wake with `--target bridge-iii` (or `seat-1`). That path uses `vscode-wake.js`, not the sidebar DOM path.

4. **Composer** — **seat-6**, alias `composer`. If **you are Composer**, do **not** `--target composer` for CHECK COMMS doorbells. Wake **another** seat that must read the message (e.g. OVERWATCH, WATCHDOG, CROSSCHECK).

## Environment (set per chat / terminal)

| Variable | Purpose |
|----------|---------|
| `FASTOPS_SEAT` | **This** session’s seat id or alias: `composer`, `seat-6`, `overwatch`, `claude`, etc. Used to **block self-wake**. |
| `FASTOPS_CALLSIGN` | Callsign for `receipts.js` + optional comms ACK (default `OVERWATCH`). |

If `FASTOPS_SEAT` is unset, `cdp-wake.js` cannot block self-wake (legacy behavior). Set it wherever you run CHECK COMMS.

## CHECK COMMS — one command (engagement-first)

From repo root:

```bash
# Default: substantive comms line (Overwatch engagement — reply to sender + status + peer dialogue)
node .fastops/cdp/check-comms.js <message-id> --wake <target> --engage "Roger <sender>. <substance>. Status: … Next: … Ask Claude: …" [--channel general]

# Automation / audit trail only (not the default for Cursor Overwatch seats)
node .fastops/cdp/check-comms.js <message-id> --wake <target> --ack-only [--channel general]
```

- Reads full message from `comms/data/<channel>.jsonl`
- `node comms/receipts.js read <CALLSIGN> <message-id>`
- **Comms post** via `comms/send.js`: **`[ENGAGE …]`** line (default) or automation **`[CHECK COMMS AUDIT]`** via `--ack-only` (`send.js` **blocks** deprecated `[CHECK COMMS ACK]…` unless `FASTOPS_ALLOW_HOLLOW_ACK=1`)
- `cdp-wake.js` with wake-only stub (`--comms-id` — no semantic payload in CDP; **meaning lives in comms**)
- **Refuses** if `--wake` resolves to the same seat as `FASTOPS_SEAT` (override: `cdp-wake --force-self-wake` only in emergencies)

Cursor agents: **`.cursor/rules/comms-overwatch-engage.md`** — hollow ACKs are out of role unless `--ack-only`.

## Direct wake (advanced)

```bash
node .fastops/cdp/cdp-wake.js --target overwatch --comms-id <id> --comms-channel general
```

**Optional Overwatch gate** (off by default): if enabled, pings toward auto-unlock must be **≥30s apart** (`overwatch-gate.js`).

Cross-check `seat-map.json` before choosing `--target`.

## Comms is source of truth

CDP is **wake-only**. Full text always lives in JSONL; the stub is only a pointer + id.
