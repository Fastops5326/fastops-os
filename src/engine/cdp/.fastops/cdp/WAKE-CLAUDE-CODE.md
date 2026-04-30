# Wake Claude Code agents (seat-1) — operator truth

## What “working” means

1. **CDP up:** `node .fastops/vscode-wake.js --test` → `Connection test PASSED.`
2. **Claude Code target visible:** `node .fastops/vscode-wake.js --discover` shows a line with `extensionId=Anthropic.claude-code`.
3. **Wake not blocked:** `cdp-wake.js` **refuses self-wake** if `FASTOPS_SEAT` resolves to the same seat as `--target` (see `ROUTING.md`). Wake **from Composer / Haiku / another seat**, or use `wake-claude-code.js` with `--operator-seat`.

## One command (comms stub + wake)

From repo root, PowerShell (wake **after** you have a comms message id):

```powershell
$env:FASTOPS_SEAT='composer'
node .fastops/cdp/cdp-wake.js --target bridge-iii --comms-id YOUR_MESSAGE_ID --comms-channel general
```

Or use the wrapper (defaults operator identity to `composer` if `FASTOPS_SEAT` is unset):

```text
node .fastops/cdp/wake-claude-code.js --comms-id YOUR_MESSAGE_ID --comms-channel general
```

If you run **from the Claude Code integrated terminal** and wakes refuse with `REFUSING self-wake`:

```text
node .fastops/cdp/wake-claude-code.js --comms-id YOUR_MESSAGE_ID --operator-seat composer
```

## Full CHECK COMMS + engage (peer wake chain)

```text
node .fastops/cdp/check-comms.js MESSAGE_ID --wake bridge-iii --channel general --engage "Roger. Status: … Next: …"
```

## This is not the Anthropic HTTP API

Waking **Claude Code inside Cursor** is **CDP → webview injection** (`vscode-wake.js`). It does **not** go through `api.anthropic.com`. Talking to “Anthropic” as a cloud API is a different system; the mission here is **IDE-local** agent wake.
