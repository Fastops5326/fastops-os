#!/usr/bin/env node
/**
 * cdp-comms-watch.js — Auto-wake bridge between Cursor and Claude Code
 *
 * Watches comms/data/general.jsonl for new messages from Cursor agents.
 * When a Cursor agent posts, auto-wakes Claude Code via CDP with the message ID.
 * When Claude Code posts, auto-wakes Composer via CDP.
 *
 * This closes the bidirectional loop WITHOUT requiring Composer to run CDP commands.
 * Composer just needs to run: node comms/send.js composer "message" --channel general
 * This watcher handles the CDP wake automatically.
 *
 * Usage:
 *   node .fastops/cdp/cdp-comms-watch.js                    # Watch and auto-wake (foreground)
 *   node .fastops/cdp/cdp-comms-watch.js --daemon             # Start as background daemon
 *   node .fastops/cdp/cdp-comms-watch.js --stop               # Stop running daemon
 *   node .fastops/cdp/cdp-comms-watch.js --status             # Check daemon status
 *   node .fastops/cdp/cdp-comms-watch.js --interval 5        # Poll every 5 seconds
 *   node .fastops/cdp/cdp-comms-watch.js --once               # Single check, no loop
 *   node .fastops/cdp/cdp-comms-watch.js --dry-run            # Show what would wake, don't wake
 *
 * Session 346: Built to solve the Composer←→Claude Code CDP loop.
 * Session 347: Upgraded to persistent daemon with PID file, log rotation, start/stop/status.
 * The core insight: don't teach Composer to CDP — watch comms and auto-wake.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const idx = args.indexOf('--' + name);
  return idx === -1 ? fallback : (args[idx + 1] || fallback);
};
const hasFlag = (name) => args.includes('--' + name);

const INTERVAL = parseInt(getArg('interval', '8'), 10); // seconds
const ONCE = hasFlag('once');
const DRY_RUN = hasFlag('dry-run');
const DAEMON = hasFlag('daemon');
const STOP = hasFlag('stop');
const STATUS = hasFlag('status');
const CHANNEL = getArg('channel', 'general');
const JSONL_PATH = path.join(__dirname, '..', '..', 'comms', 'data', `${CHANNEL}.jsonl`);

// ── Daemon infrastructure ────────────────────────────────────────────
const PID_FILE = path.join(__dirname, '..', '.comms-watch-daemon.pid'); // Same as ensure-comms-watch.js
const LOG_FILE = path.join(__dirname, '..', '.comms-watch.log');
const MAX_LOG_SIZE = 512 * 1024; // 512KB, then rotate

function readPid() {
  try { return parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10); } catch { return null; }
}

function isRunning(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function logToFile(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    // Rotate if too large
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_LOG_SIZE) {
      const rotated = LOG_FILE + '.1';
      if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
      fs.renameSync(LOG_FILE, rotated);
    }
    fs.appendFileSync(LOG_FILE, line);
  } catch { /* best effort */ }
}

// Unified log — writes to console (foreground) or file (daemon)
const isDaemonChild = process.env.__COMMS_WATCH_DAEMON === '1';
function log(msg) {
  if (isDaemonChild) {
    logToFile(msg);
  } else {
    console.log(msg);
  }
}

// ── Handle --stop ────────────────────────────────────────────────────
if (STOP) {
  const pid = readPid();
  if (!pid || !isRunning(pid)) {
    console.log('[comms-watch] No daemon running.');
    try { fs.unlinkSync(PID_FILE); } catch {}
  } else {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`[comms-watch] Stopped daemon (PID ${pid}).`);
    } catch (e) {
      console.error(`[comms-watch] Failed to stop PID ${pid}: ${e.message}`);
    }
    try { fs.unlinkSync(PID_FILE); } catch {}
  }
  process.exit(0);
}

// ── Handle --status ──────────────────────────────────────────────────
if (STATUS) {
  const pid = readPid();
  if (pid && isRunning(pid)) {
    console.log(`[comms-watch] Daemon RUNNING (PID ${pid})`);
    if (fs.existsSync(LOG_FILE)) {
      const tail = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(l => l).slice(-5);
      console.log(`[comms-watch] Last 5 log lines:`);
      tail.forEach(l => console.log(`  ${l}`));
    }
  } else {
    console.log('[comms-watch] Daemon NOT RUNNING.');
    if (pid) { try { fs.unlinkSync(PID_FILE); } catch {} }
  }
  process.exit(0);
}

// ── Handle --daemon (fork into background) ───────────────────────────
if (DAEMON && !isDaemonChild) {
  // Check if already running
  const existingPid = readPid();
  if (existingPid && isRunning(existingPid)) {
    console.log(`[comms-watch] Already running (PID ${existingPid}). Use --stop first.`);
    process.exit(0);
  }

  // Spawn detached child
  const child = spawn(process.execPath, [__filename, '--interval', String(INTERVAL), '--channel', CHANNEL], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, __COMMS_WATCH_DAEMON: '1' }
  });
  child.unref();

  fs.writeFileSync(PID_FILE, String(child.pid));
  console.log(`[comms-watch] Daemon started (PID ${child.pid}). Log: ${LOG_FILE}`);
  console.log(`[comms-watch] Stop: node .fastops/cdp/cdp-comms-watch.js --stop`);
  console.log(`[comms-watch] Status: node .fastops/cdp/cdp-comms-watch.js --status`);
  process.exit(0);
}

// Write PID for daemon child or foreground process
if (isDaemonChild) {
  fs.writeFileSync(PID_FILE, String(process.pid));
  // Clean up PID file on exit
  const cleanup = () => { try { fs.unlinkSync(PID_FILE); } catch {} };
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  process.on('exit', cleanup);
}

// Track what we've already processed
let lastProcessedId = null;
let lastFileSize = 0;

// Agents that live in Cursor (their posts should wake Claude Code)
const CURSOR_AGENTS = new Set([
  'composer', 'overwatch', 'watchdog', 'crosscheck',
  'composer-peer-a', 'composer-peer-b', 'composer-peer-c',
  'composer-peer-d', 'composer-peer-e', 'rivet', 'ballast',
  'resonance',
  'session-350', // THE SHAPE pyramid — Cursor-side mission voice → wake Claude Code
]);

// Agents that live in Claude Code (their posts should wake Composer)
const CLAUDE_CODE_AGENTS = new Set([
  'claude-code', 'bridge-iii', 'claude'
]);

function getNewLines() {
  if (!fs.existsSync(JSONL_PATH)) return [];

  const stat = fs.statSync(JSONL_PATH);
  if (stat.size <= lastFileSize) return [];

  // Read only new bytes
  const fd = fs.openSync(JSONL_PATH, 'r');
  const readStart = lastFileSize > 0 ? lastFileSize : Math.max(0, stat.size - 4096); // On first run, read last 4KB
  const buf = Buffer.alloc(stat.size - readStart);
  fs.readSync(fd, buf, 0, buf.length, readStart);
  fs.closeSync(fd);

  lastFileSize = stat.size;

  const lines = buf.toString('utf8').split('\n').filter(l => l.trim());
  const parsed = [];
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch (e) { /* skip malformed */ }
  }
  return parsed;
}

function wakeTarget(target, commsId, from) {
  const cdpWake = path.join(__dirname, 'cdp-wake.js');
  log(`[comms-watch] WAKE ${target} <- ${from} (comms: ${commsId})`);

  if (DRY_RUN) {
    log(`[comms-watch] DRY RUN — would run: node cdp-wake.js --target ${target} --comms-id ${commsId} --from ${from}`);
    return;
  }

  const seatEnv = target === 'claude-code' ? 'composer' : 'claude-code';
  const result = spawnSync(process.execPath, [
    cdpWake,
    '--target', target,
    '--comms-id', commsId,
    '--comms-channel', CHANNEL,
    '--from', from
  ], {
    encoding: 'utf-8',
    timeout: 45000,
    windowsHide: true,
    env: { ...process.env, FASTOPS_SEAT: seatEnv, FASTOPS_CALLSIGN: 'comms-watch' }
  });

  if (result.status === 0) {
    log(`[comms-watch] WAKE SUCCESS: ${target}`);
  } else {
    log(`[comms-watch] WAKE FAILED (exit ${result.status}): ${(result.stderr || '').substring(0, 200)}`);
  }
}

function processNewMessages() {
  const lines = getNewLines();
  if (lines.length === 0) return;

  for (const msg of lines) {
    if (!msg.id || !msg.from) continue;
    if (msg.id === lastProcessedId) continue;

    const from = msg.from.toLowerCase();

    // Skip system messages, harvests, peer coordination relays
    if (msg.source && msg.source.includes('harvest')) continue;
    if ((msg.content || '').includes('[PEER COORDINATION RELAY]')) continue;
    if ((msg.content || '').includes('comms-watch')) continue; // Don't react to our own wake receipts

    // Cursor agent posted → wake Claude Code
    if (CURSOR_AGENTS.has(from)) {
      log(`[comms-watch] Cursor agent "${msg.from}" posted (${msg.id}): ${(msg.content || '').substring(0, 60)}`);
      wakeTarget('claude-code', msg.id, msg.from);
      lastProcessedId = msg.id;
    }
    // Claude Code agent posted → wake Composer
    else if (CLAUDE_CODE_AGENTS.has(from)) {
      log(`[comms-watch] Claude Code agent "${msg.from}" posted (${msg.id}): ${(msg.content || '').substring(0, 60)}`);
      wakeTarget('composer', msg.id, msg.from);
      lastProcessedId = msg.id;
    }
  }
}

// Initialize: set file size to current (don't process old messages)
if (fs.existsSync(JSONL_PATH)) {
  lastFileSize = fs.statSync(JSONL_PATH).size;
}

log(`[comms-watch] Watching #${CHANNEL} for bidirectional CDP auto-wake`);
log(`[comms-watch] Cursor agents: ${[...CURSOR_AGENTS].join(', ')}`);
log(`[comms-watch] Claude Code agents: ${[...CLAUDE_CODE_AGENTS].join(', ')}`);
log(`[comms-watch] Poll interval: ${INTERVAL}s | Dry run: ${DRY_RUN} | Mode: ${isDaemonChild ? 'daemon' : 'foreground'}`);

if (ONCE) {
  processNewMessages();
  process.exit(0);
}

// Main loop
setInterval(processNewMessages, INTERVAL * 1000);
log(`[comms-watch] Running... (${isDaemonChild ? 'daemon PID ' + process.pid : 'Ctrl+C to stop'})`);
