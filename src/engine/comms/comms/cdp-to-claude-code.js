#!/usr/bin/env node
/**
 * comms/cdp-to-claude-code.js — Post to comms, then CDP-wake the **Anthropic Claude Code extension**
 * (webview), via unified router → vscode-wake.js (seat-map type:vscode).
 *
 * This is the **builder / Claude Code** path. For Cursor **sidebar** "Claude" tab use comms/cdp-to-claude.js.
 *
 * Usage:
 *   node comms/cdp-to-claude-code.js --from BRIDGE --message "Full text. Over."
 *   node comms/cdp-to-claude-code.js --comms-id <id> --channel general
 *   node comms/cdp-to-claude-code.js --from x --message "..." --no-wake
 *
 * Flags:
 *   --target <seat>   seat-map id (default seat-1)
 *   --channel         JSONL channel (default general)
 *   --no-wake         comms only
 */

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CDP_WAKE = path.join(ROOT, '.fastops', 'cdp', 'cdp-wake.js');

const { send } = require('./protocol');

function getArg(name, fallback = null) {
  const idx = process.argv.indexOf('--' + name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const hasFlag = (n) => process.argv.includes('--' + n);

const noWake = hasFlag('no-wake');
const from = getArg('from');
const message = getArg('message');
const channel = getArg('channel', 'general');
const commsIdArg = getArg('comms-id');
const targetSeat = getArg('target', 'seat-1');

let msgId = commsIdArg;

if (!msgId) {
  if (!from || !message) {
    console.error(`Usage:
  node comms/cdp-to-claude-code.js --from CALLSIGN --message "Full message" [--channel general] [--target seat-1]
  node comms/cdp-to-claude-code.js --comms-id <id> [--channel general] [--target seat-1]
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
  console.log('[comms/cdp-to-claude-code] --no-wake: skipping CDP.');
  process.exit(0);
}

const args = [CDP_WAKE, '--target', targetSeat, '--comms-id', msgId, '--comms-channel', channel];

console.log(`[comms/cdp-to-claude-code] waking Claude Code extension → --target ${targetSeat} (vscode-wake)`);

const r = spawnSync(process.execPath, args, {
  cwd: ROOT,
  stdio: 'inherit',
  env: process.env,
});

process.exit(r.status !== null ? r.status : 1);
