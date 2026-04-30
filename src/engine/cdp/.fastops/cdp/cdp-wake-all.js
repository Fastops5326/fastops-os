#!/usr/bin/env node
/**
 * Wake every mapped seat except the caller's seat (FASTOPS_SEAT).
 * Use after posting to comms so each agent gets a stub pointing at the same message id.
 *
 * Usage:
 *   FASTOPS_SEAT=composer node .fastops/cdp/cdp-wake-all.js --comms-id <id> --comms-channel general --from P0-CursorOps
 *   node .fastops/cdp/cdp-wake-all.js --comms-id <id> --only-targets gemini,gpt,claude-sidebar,haiku
 *   node .fastops/cdp/cdp-wake-all.js --comms-id <id> --sidebar-only   # cursor seats only (skip Claude Code webview)
 *
 * Env:
 *   FASTOPS_SEAT — required for correct self-skip (set to this chat's seat alias or seat-N)
 *   FASTOPS_EXPECTED_AGENT_COUNT — optional; if set, logs a reminder to verify tab count (e.g. 4 Composer 2 peers)
 */

const { spawnSync } = require('child_process');
const path = require('path');
const { loadSeatMap, resolveEnvSeatToId } = require('./cdp-seat-utils');

function sleepSync(ms) {
  const buf = new SharedArrayBuffer(4);
  const ia = new Int32Array(buf);
  Atomics.wait(ia, 0, 0, ms);
}

function getArg(name, fallback = null) {
  const idx = process.argv.indexOf('--' + name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const COMMS_ID = getArg('comms-id');
const COMMS_CHANNEL = getArg('comms-channel', 'general');
const FROM = getArg('from', process.env.FASTOPS_CALLSIGN || '');
const DELAY_MS = parseInt(getArg('delay-ms', '2500'), 10);
const SIDEBAR_ONLY = process.argv.includes('--sidebar-only');
const ONLY_TARGETS_RAW = getArg('only-targets', null);
const onlyTargets = ONLY_TARGETS_RAW
  ? ONLY_TARGETS_RAW.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  : null;

function seatMatchesOnlyList(seatId, cfg, map) {
  if (!onlyTargets || onlyTargets.length === 0) return true;
  const candidates = new Set([seatId.toLowerCase()]);
  if (cfg.model) candidates.add(String(cfg.model).toLowerCase());
  if (cfg.agent) candidates.add(String(cfg.agent).toLowerCase());
  if (cfg.sidebar) candidates.add(String(cfg.sidebar).toLowerCase());
  for (const [al, sid] of Object.entries(map.aliases || {})) {
    if (sid === seatId) candidates.add(String(al).toLowerCase());
  }
  for (const want of onlyTargets) {
    if (candidates.has(want)) return true;
  }
  return false;
}

if (!COMMS_ID) {
  console.error(
    'Usage: node .fastops/cdp/cdp-wake-all.js --comms-id <id> [--comms-channel general] [--from callsign] [--delay-ms 2500] [--sidebar-only]\n' +
      'Set FASTOPS_SEAT to this session seat so your own tab is skipped.'
  );
  process.exit(1);
}

const seatMap = loadSeatMap();
const selfSeat = resolveEnvSeatToId(process.env.FASTOPS_SEAT, seatMap);
if (!process.env.FASTOPS_SEAT || !selfSeat) {
  console.error(
    '[cdp-wake-all] WARN: FASTOPS_SEAT unset or unresolvable — cannot skip self; risk of self-wake. Set e.g. FASTOPS_SEAT=composer or seat-6.'
  );
}

const expected = process.env.FASTOPS_EXPECTED_AGENT_COUNT;
if (expected) {
  console.log(`[cdp-wake-all] FASTOPS_EXPECTED_AGENT_COUNT=${expected} — confirm with: node .fastops/cdp-target-model.js --list`);
}

const REPO_ROOT = path.join(__dirname, '..', '..');
const cdpWake = path.join(__dirname, 'cdp-wake.js');
const seatIds = Object.keys(seatMap.seats || {}).sort();

let n = 0;
for (const seatId of seatIds) {
  const cfg = seatMap.seats[seatId];
  if (!cfg) continue;
  if (SIDEBAR_ONLY && cfg.type !== 'cursor') continue;
  if (selfSeat && seatId === selfSeat) {
    console.log(`[cdp-wake-all] skip self: ${seatId}`);
    continue;
  }
  if (!seatMatchesOnlyList(seatId, cfg, seatMap)) {
    console.log(`[cdp-wake-all] skip (not in --only-targets): ${seatId}`);
    continue;
  }
  console.log(`[cdp-wake-all] waking ${seatId} (${cfg.type})…`);
  const r = spawnSync(
    process.execPath,
    [
      cdpWake,
      '--target',
      seatId,
      '--comms-id',
      COMMS_ID,
      '--comms-channel',
      COMMS_CHANNEL,
      ...(FROM ? ['--from', FROM] : []),
    ],
    { stdio: 'inherit', env: process.env, cwd: REPO_ROOT }
  );
  if (r.status !== 0) {
    console.error(`[cdp-wake-all] wake failed for ${seatId} (exit ${r.status})`);
    process.exit(r.status ?? 1);
  }
  n++;
  if (DELAY_MS > 0) {
    sleepSync(DELAY_MS);
  }
}

console.log(`[cdp-wake-all] done: ${n} wake(s) (self skipped: ${selfSeat || 'unknown'}).`);
