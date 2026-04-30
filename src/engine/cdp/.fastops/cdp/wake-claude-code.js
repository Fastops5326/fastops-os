#!/usr/bin/env node
/**
 * wake-claude-code.js — One-shot wake for Claude Code (seat-1 / bridge-iii)
 *
 * Problem this solves: cdp-wake.js refuses **self-wake** when FASTOPS_SEAT resolves
 * to the same seat as --target (e.g. you run the script from the Claude Code terminal
 * with FASTOPS_SEAT=bridge-iii → wake to seat-1 is blocked).
 *
 * Usage (from repo root):
 *   node .fastops/cdp/wake-claude-code.js --comms-id <id> [--comms-channel general]
 *   node .fastops/cdp/wake-claude-code.js --prompt "short message"
 *   node .fastops/cdp/wake-claude-code.js --comms-id <id> --operator-seat composer
 *
 * --operator-seat <alias|seat-N>  Force identity for self-wake check (default: composer).
 *                                  Use when running from bridge-iii / seat-1 shell.
 *
 * Prerequisites: Cursor with --remote-debugging-port=9223, Claude Code panel open.
 * Verify: node .fastops/vscode-wake.js --test
 */

const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf('--' + name);
  if (idx === -1) return fallback;
  return args[idx + 1] || fallback;
}

let operatorSeat = getArg('operator-seat', null);
const filtered = args.filter((a, i, arr) => {
  if (a === '--operator-seat') {
    return false;
  }
  if (arr[i - 1] === '--operator-seat') {
    return false;
  }
  return true;
});

const wakeScript = path.join(__dirname, 'cdp-wake.js');
const childArgs = ['--target', 'bridge-iii', ...filtered];

const env = { ...process.env };
if (operatorSeat) {
  env.FASTOPS_SEAT = operatorSeat;
} else if (!env.FASTOPS_SEAT) {
  env.FASTOPS_SEAT = 'composer';
}

const r = spawnSync(process.execPath, [wakeScript, ...childArgs], {
  stdio: 'inherit',
  env,
  cwd: path.join(__dirname, '..', '..'),
});

process.exit(r.status !== null ? r.status : 1);
