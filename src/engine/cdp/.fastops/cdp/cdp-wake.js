#!/usr/bin/env node
/**
 * cdp-wake.js — Unified CDP routing script
 * 
 * Replaces vscode-wake.js and cdp-target-model.js.
 * Routes wakes based on seat-map.json.
 * 
 * Usage:
 *   node .fastops/cdp/cdp-wake.js --target bridge-ii --comms-id <id> --comms-channel general
 *   node .fastops/cdp/cdp-wake.js --target seat-1 --prompt "direct message"
 *   node .fastops/cdp/cdp-wake.js --target gemini --comms-id <id>
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf('--' + name);
  if (idx === -1) return fallback;
  return args[idx + 1] || fallback;
}

const TARGET = getArg('target', '').toLowerCase();
const PROMPT = getArg('prompt', null);
const COMMS_ID = getArg('comms-id', null);
const COMMS_CHANNEL = getArg('comms-channel', 'general');
const FROM = getArg('from', '');
const DRY_RUN = args.includes('--dry-run');
const FORCE_SELF_WAKE = args.includes('--force-self-wake');

if (!TARGET) {
  console.error("Usage: node cdp-wake.js --target <seat|agent|model> [--comms-id ID | --prompt PROMPT]");
  process.exit(1);
}

const fastopsDir = path.join(__dirname, '..');
const statusScript = path.join(__dirname, 'cdp-status.js');
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// 0. UI Collision Check (Avoid Blind Wakes)
function checkUIStatus() {
  try {
    const result = spawnSync('node', [statusScript], { encoding: 'utf-8', windowsHide: true });
    if (result.status === 1) { // Exit code 1 means generating
      return true; // Is busy
    }
  } catch (e) {
    // Ignore, proceed if status script fails
  }
  return false;
}

// 1. Resolve Target
const mapPath = path.join(__dirname, 'seat-map.json');
if (!fs.existsSync(mapPath)) {
  console.error(`Missing seat-map.json at ${mapPath}`);
  process.exit(1);
}

const seatMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
let seatId = TARGET;

// Check if target is an alias
if (seatMap.aliases && seatMap.aliases[TARGET]) {
  seatId = seatMap.aliases[TARGET];
}

const seatConfig = seatMap.seats[seatId];
if (!seatConfig) {
  console.error(`Target "${TARGET}" not found in seat-map.json (resolved to "${seatId}")`);
  process.exit(1);
}

if (seatConfig.type !== 'api-node' && !seatConfig.pty_port) {
  console.log(`[cdp-wake] Checking UI status to prevent blind wakes...`);
  let waitCount = 0;
  while (checkUIStatus() && waitCount < 12) { // Wait up to 60 seconds (12 * 5s)
    console.log(`[cdp-wake] UI is currently generating. Pausing wake injection for 5 seconds... (${waitCount + 1}/12)`);
    sleepSync(5000);
    waitCount++;
  }

  if (waitCount >= 12) {
    console.log(`[cdp-wake] WARNING: UI remained busy for 60 seconds. Forcing wake injection.`);
  } else if (waitCount > 0) {
    console.log(`[cdp-wake] UI has returned to idle. Proceeding with wake.`);
  } else {
    console.log(`[cdp-wake] UI is idle. Proceeding.`);
  }
} else {
  console.log('[cdp-wake] API-NODE or PTY target detected — skipping UI busy check.');
}

/** Resolve env FASTOPS_SEAT (alias, seat-N, agent name, sidebar label) to canonical seat id. */
function resolveEnvSeatToId(raw, map) {
  if (!raw || !String(raw).trim()) return null;
  const lower = String(raw).toLowerCase().trim();
  if (map.seats[lower]) return lower;
  if (map.aliases && map.aliases[lower]) return map.aliases[lower];
  for (const [sid, cfg] of Object.entries(map.seats || {})) {
    if (cfg.agent && String(cfg.agent).toLowerCase() === lower) return sid;
    if (cfg.sidebar && String(cfg.sidebar).toLowerCase() === lower) return sid;
    if (cfg.model && String(cfg.model).toLowerCase() === lower) return sid;
  }
  return null;
}

const forceSelfWake = args.includes('--force-self-wake');
const selfSeat = resolveEnvSeatToId(process.env.FASTOPS_SEAT, seatMap);
if (selfSeat && selfSeat === seatId && !forceSelfWake) {
  console.error(
    `[cdp-wake] REFUSING self-wake: FASTOPS_SEAT resolves to ${selfSeat}, same as --target "${TARGET}". ` +
      `You would inject into this session's chat (endless loop). Wake a different seat, or set FASTOPS_SEAT correctly, or use --force-self-wake (emergency only). ` +
      `See .fastops/cdp/ROUTING.md`
  );
  process.exit(1);
}

function buildSeatCandidates(primarySeatId, map) {
  const primary = map.seats[primarySeatId];
  if (!primary) return [primarySeatId];
  const candidates = [];
  const seen = new Set();
  const addCandidate = (sid) => {
    if (!sid || seen.has(sid)) return;
    if (selfSeat && sid === selfSeat && !FORCE_SELF_WAKE) return;
    seen.add(sid);
    candidates.push(sid);
  };

  addCandidate(primarySeatId);
  // Preferred failover policy: same type + same model to keep role semantics stable.
  for (const [sid, cfg] of Object.entries(map.seats || {})) {
    if (sid === primarySeatId) continue;
    if (cfg.type !== primary.type) continue;
    if (String(cfg.model || '').toLowerCase() !== String(primary.model || '').toLowerCase()) continue;
    addCandidate(sid);
  }

  // If no same-model backup exists for a Cursor target, degrade gracefully to other Cursor seats.
  // This preserves comms-first continuity when one seat/port is down.
  if (primary.type === 'cursor' && candidates.length <= 1) {
    for (const [sid, cfg] of Object.entries(map.seats || {})) {
      if (sid === primarySeatId) continue;
      if (cfg.type !== 'cursor') continue;
      addCandidate(sid);
    }
  }
  return candidates;
}

const seatCandidates = buildSeatCandidates(seatId, seatMap);
let lastStatus = 1;

for (let i = 0; i < seatCandidates.length; i++) {
  const candidateSeatId = seatCandidates[i];
  const candidateSeatConfig = seatMap.seats[candidateSeatId];
  if (!candidateSeatConfig) continue;
  if (selfSeat && selfSeat === candidateSeatId && !FORCE_SELF_WAKE) {
    console.log(`[cdp-wake] Skipping candidate ${candidateSeatId} (self seat).`);
    continue;
  }

  console.log(
    `[cdp-wake] Routing "${TARGET}" -> ${candidateSeatId} (${candidateSeatConfig.type}` +
      `${candidateSeatConfig.port !== null && candidateSeatConfig.port !== undefined ? ` on port ${candidateSeatConfig.port}` : ''})`
  );

  // 2. Build Arguments
  const targetArgs = [];
  if (COMMS_ID) {
    targetArgs.push('--comms-id', COMMS_ID);
    if (COMMS_CHANNEL) targetArgs.push('--comms-channel', COMMS_CHANNEL);
    if (FROM) targetArgs.push('--from', FROM);
  } else if (PROMPT) {
    targetArgs.push('--prompt', PROMPT);
    // Pass the legacy flag for cdp-target-model so it doesn't complain
    targetArgs.push('--legacy-full-prompt');
  } else {
    console.error(`Must provide either --comms-id or --prompt`);
    process.exit(1);
  }

  // 3. Delegate to specific script
  let scriptPath;

  if (candidateSeatConfig.type === 'vscode') {
    scriptPath = path.join(fastopsDir, 'vscode-wake.js');
    targetArgs.push('--port', candidateSeatConfig.port.toString());
    targetArgs.push('--seat', candidateSeatId);
  } else if (candidateSeatConfig.type === 'cursor') {
    scriptPath = path.join(fastopsDir, 'cdp-target-model.js');
    targetArgs.push('--port', candidateSeatConfig.port.toString());
    if (candidateSeatConfig.model) {
      targetArgs.push('--model', candidateSeatConfig.model);
    }
  } else if (candidateSeatConfig.type === 'api-node') {
    scriptPath = path.join(__dirname, 'api-node-wake.js');
    targetArgs.push('--seat', candidateSeatId);
    targetArgs.push('--agent', candidateSeatConfig.agent || candidateSeatId);
    targetArgs.push('--model', candidateSeatConfig.model || 'unknown');
    targetArgs.push('--model-id', candidateSeatConfig.modelId || '');
  } else {
    console.error(`Unknown seat type: ${candidateSeatConfig.type}`);
    continue;
  }

  if (DRY_RUN) {
    targetArgs.push('--dry-run');
  }

  console.log(`[cdp-wake] Executing: node ${path.basename(scriptPath)} ${targetArgs.join(' ')}`);
  const result = spawnSync(process.execPath, [scriptPath, ...targetArgs], {
  stdio: 'inherit',
  windowsHide: true
  });
  const status = result.status !== null ? result.status : 1;
  if (status === 0) process.exit(0);
  lastStatus = status;
  if (i < seatCandidates.length - 1) {
    console.log(`[cdp-wake] Wake failed on ${candidateSeatId}; attempting failover candidate...`);
  }
}

console.error('[cdp-wake] All candidate seats failed.');
process.exit(lastStatus);