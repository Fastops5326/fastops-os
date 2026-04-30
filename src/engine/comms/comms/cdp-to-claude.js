#!/usr/bin/env node
/**
 * comms/cdp-to-claude.js — Post to comms, then CDP-wake the **Cursor sidebar** tab whose
 * label matches --model (default `claude`). Uses cdp-target-model.js (sidebar click + inject).
 *
 * For the **Anthropic Claude Code extension** webview (builder), use **comms/cdp-to-claude-code.js**
 * (routes via cdp-wake.js → vscode-wake.js / seat-1).
 *
 * Semantic content stays in JSONL (comms). CDP injects only the wake stub.
 *
 * Requires: Cursor with --remote-debugging-port (default 9223) and target tab visible.
 *
 * Usage:
 *   node comms/cdp-to-claude.js --from overwatch --message "Full text. Over."
 *   node comms/cdp-to-claude.js --from overwatch --message "..." --channel general
 *   node comms/cdp-to-claude.js --comms-id 1774579838623-4f88b0 --channel general
 *   node comms/cdp-to-claude.js --from x --message "..." --no-wake
 *   node comms/cdp-to-claude.js --list   (delegate to cdp-target-model --list)
 *
 * Flags:
 *   --port <n>     CDP port (default 9223)
 *   --model <name> Sidebar match (default claude). Passed to cdp-target-model.js
 *   --no-wake      Only post to comms (no CDP)
 *   --strict-comms-id  Forward to cdp-target-model if id missing from JSONL tail
 */

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CDP_TARGET = path.join(ROOT, '.fastops', 'cdp-target-model.js');

const { send } = require('./protocol');

function getArg(name, fallback = null) {
  const idx = process.argv.indexOf('--' + name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const hasFlag = (n) => process.argv.includes('--' + n);

if (hasFlag('list')) {
  const r = spawnSync(process.execPath, [CDP_TARGET, '--list'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  process.exit(r.status ?? 1);
}

const noWake = hasFlag('no-wake');
const from = getArg('from');
const message = getArg('message');
const channel = getArg('channel', 'general');
const commsIdArg = getArg('comms-id');
const port = getArg('port', '9223');
const model = (getArg('model', 'claude') || 'claude').toLowerCase();

let msgId = commsIdArg;

if (!msgId) {
  if (!from || !message) {
    console.error(`Usage:
  node comms/cdp-to-claude.js --from CALLSIGN --message "Full message" [--channel general] [--port 9223] [--model claude]
  node comms/cdp-to-claude.js --comms-id <id> [--channel general] [--port 9223]
  node comms/cdp-to-claude.js --list
`);
    process.exit(1);
  }
  const msg = send(from, message, channel, {});
  msgId = msg.id;
  console.log(`[comms] posted to #${channel}: ${msgId}`);
} else {
  console.log(`[comms] using existing message id: ${msgId}`);
}

if (noWake) {
  console.log('[comms/cdp-to-claude] --no-wake: skipping CDP.');
  process.exit(0);
}

const args = [
  CDP_TARGET,
  '--model',
  model,
  '--comms-id',
  msgId,
  '--comms-channel',
  channel,
  '--port',
  String(port),
];
if (hasFlag('strict-comms-id')) args.push('--strict-comms-id');

const r = spawnSync(process.execPath, args, {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
});

process.exit(r.status !== null ? r.status : 1);
