#!/usr/bin/env node
/**
 * claim-seat.js — Atomic seat claiming for agent boot-up
 *
 * On boot, an agent runs this to claim the first open seat.
 * Uses file locking to prevent race conditions between concurrent boots.
 *
 * Usage:
 *   node .fastops/cdp/claim-seat.js --agent bridge-iii --model claude
 *   node .fastops/cdp/claim-seat.js --agent watchdog --model gemini --sidebar WATCHDOG
 *   node .fastops/cdp/claim-seat.js --release seat-2
 *   node .fastops/cdp/claim-seat.js --status
 *
 * Returns JSON to stdout: { seat, buddy, port, type }
 */

const fs = require('fs');
const path = require('path');

const SEAT_MAP_PATH = path.join(__dirname, 'seat-map.json');
const LOCK_PATH = path.join(__dirname, '.seat-claim.lock');
const HEARTBEAT_DIR = path.join(__dirname, '.heartbeats');
const HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes — seat freed if no heartbeat

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf('--' + name);
  if (idx === -1) return fallback;
  return args[idx + 1] || fallback;
}

const AGENT = getArg('agent', null);
const MODEL = getArg('model', null);
const SIDEBAR = getArg('sidebar', null);
const RELEASE = getArg('release', null);
const STATUS = args.includes('--status');

// Buddy pairs: 1<>2, 3<>4, 5<>6, 7<>8, 9<>10
function getBuddy(seatNum) {
  if (seatNum % 2 === 1) return `seat-${seatNum + 1}`;
  return `seat-${seatNum - 1}`;
}

function acquireLock() {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      fs.writeFileSync(LOCK_PATH, process.pid.toString(), { flag: 'wx' });
      return true;
    } catch {
      // Lock exists — check if stale (>10s)
      try {
        const stat = fs.statSync(LOCK_PATH);
        if (Date.now() - stat.mtimeMs > 10000) {
          fs.unlinkSync(LOCK_PATH);
          continue;
        }
      } catch {}
      // Wait 50ms and retry
      const start = Date.now();
      while (Date.now() - start < 50) {}
    }
  }
  return false;
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_PATH); } catch {}
}

function loadMap() {
  return JSON.parse(fs.readFileSync(SEAT_MAP_PATH, 'utf8'));
}

function saveMap(map) {
  fs.writeFileSync(SEAT_MAP_PATH, JSON.stringify(map, null, 2) + '\n');
}

function writeHeartbeat(seatId, agent) {
  if (!fs.existsSync(HEARTBEAT_DIR)) fs.mkdirSync(HEARTBEAT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(HEARTBEAT_DIR, `${seatId}.json`),
    JSON.stringify({ agent, ts: new Date().toISOString(), pid: process.pid })
  );
}

function checkHeartbeat(seatId) {
  const hbFile = path.join(HEARTBEAT_DIR, `${seatId}.json`);
  try {
    const stat = fs.statSync(hbFile);
    return (Date.now() - stat.mtimeMs) < HEARTBEAT_TIMEOUT_MS;
  } catch {
    return false;
  }
}

function clearHeartbeat(seatId) {
  try { fs.unlinkSync(path.join(HEARTBEAT_DIR, `${seatId}.json`)); } catch {}
}

// --- Status mode ---
if (STATUS) {
  const map = loadMap();
  console.log('SEAT STATUS:');
  for (const [id, config] of Object.entries(map.seats)) {
    const alive = config.agent ? checkHeartbeat(id) : false;
    const status = config.agent ? (alive ? 'ACTIVE' : 'STALE') : 'OPEN';
    const buddy = getBuddy(parseInt(id.replace('seat-', '')));
    console.log(`  ${id}: ${status} agent=${config.agent || '-'} model=${config.model || '-'} buddy=${buddy}`);
  }
  process.exit(0);
}

// --- Release mode ---
if (RELEASE) {
  if (!acquireLock()) {
    console.error('Failed to acquire lock');
    process.exit(1);
  }
  try {
    const map = loadMap();
    const seat = map.seats[RELEASE];
    if (!seat) {
      console.error(`Seat ${RELEASE} not found`);
      process.exit(1);
    }
    // Remove alias
    if (seat.agent && map.aliases[seat.agent]) {
      delete map.aliases[seat.agent];
    }
    if (seat.model && map.aliases[seat.model]) {
      delete map.aliases[seat.model];
    }
    seat.agent = null;
    seat.sidebar = null;
    seat.model = null;
    seat.description = 'RESERVE';
    saveMap(map);
    clearHeartbeat(RELEASE);
    console.log(JSON.stringify({ released: RELEASE, ok: true }));
  } finally {
    releaseLock();
  }
  process.exit(0);
}

// --- Claim mode ---
if (!AGENT) {
  console.error('Usage: node claim-seat.js --agent NAME --model MODEL [--sidebar SIDEBAR]');
  process.exit(1);
}

if (!acquireLock()) {
  console.error('Failed to acquire seat claim lock — another agent may be claiming');
  process.exit(1);
}

try {
  const map = loadMap();

  // Check if this agent already has a seat
  if (map.aliases[AGENT.toLowerCase()]) {
    const existingSeat = map.aliases[AGENT.toLowerCase()];
    const config = map.seats[existingSeat];
    const seatNum = parseInt(existingSeat.replace('seat-', ''));
    const buddy = getBuddy(seatNum);
    writeHeartbeat(existingSeat, AGENT);
    console.log(JSON.stringify({
      seat: existingSeat,
      buddy,
      port: config.port,
      type: config.type,
      agent: config.agent,
      existing: true
    }));
    process.exit(0);
  }

  // Reclaim stale seats — only if heartbeat FILE EXISTS but is expired
  // (no heartbeat file = manually assigned seat, don't touch it)
  for (const [id, config] of Object.entries(map.seats)) {
    if (!config.agent) continue;
    const hbFile = path.join(HEARTBEAT_DIR, `${id}.json`);
    if (!fs.existsSync(hbFile)) continue; // No heartbeat file = manual assignment, skip
    if (!checkHeartbeat(id)) {
      console.error(`[claim-seat] Reclaiming stale seat ${id} (was ${config.agent}, heartbeat expired)`);
      if (config.agent && map.aliases[config.agent]) delete map.aliases[config.agent];
      if (config.model && map.aliases[config.model]) delete map.aliases[config.model];
      config.agent = null;
      config.sidebar = null;
      config.model = null;
      config.description = 'RESERVE';
      clearHeartbeat(id);
    }
  }

  // Find first open seat
  let claimedSeat = null;
  for (const [id, config] of Object.entries(map.seats)) {
    if (!config.agent) {
      config.agent = AGENT.toLowerCase();
      config.model = MODEL;
      config.sidebar = SIDEBAR || AGENT.toUpperCase();
      config.description = `${AGENT} (${MODEL || 'unknown'})`;
      map.aliases[AGENT.toLowerCase()] = id;
      if (MODEL) map.aliases[MODEL.toLowerCase()] = id;
      claimedSeat = id;
      break;
    }
  }

  if (!claimedSeat) {
    console.error('No open seats available');
    saveMap(map); // Save any reclaimed seats
    process.exit(1);
  }

  saveMap(map);
  writeHeartbeat(claimedSeat, AGENT);

  const seatNum = parseInt(claimedSeat.replace('seat-', ''));
  const buddy = getBuddy(seatNum);
  const config = map.seats[claimedSeat];

  console.log(JSON.stringify({
    seat: claimedSeat,
    buddy,
    port: config.port,
    type: config.type,
    agent: AGENT,
    existing: false
  }));
} finally {
  releaseLock();
}
