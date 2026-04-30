#!/usr/bin/env node
/**
 * FastOps Comms Watchdog — Continuous Monitoring + Relay Auto-Flush
 *
 * Runs in background. Two jobs:
 *
 * 1. RELAY FLUSH: Watches comms/data/.relay/ for file drops from Cursor models
 *    that can't post via send.js. Auto-posts them into real comms channels.
 *
 * 2. SILENCE DETECTION: Monitors expected agents. If an agent hasn't posted
 *    in <threshold> minutes, alerts on comms so the team knows someone is dark.
 *
 * Usage:
 *   node comms/watchdog.js                          # run with defaults
 *   node comms/watchdog.js --agents kimi,gemini     # watch specific agents
 *   node comms/watchdog.js --threshold 10           # alert after 10min silence
 *   node comms/watchdog.js --relay-only             # just flush relay, no silence detection
 *   node comms/watchdog.js --check                  # one-shot health check, no loop
 *
 * Designed to be run by a background subagent or `node comms/watchdog.js &`
 */

const fs = require('fs');
const path = require('path');
const { send, readAll, timeSince } = require('./protocol');

const RELAY_DIR = path.join(__dirname, 'data', '.relay');
const CHECK_INTERVAL = 30000; // 30 seconds

// --- Arg parsing ---

const argv = process.argv.slice(2);

function getFlag(name, defaultVal) {
  const idx = argv.indexOf('--' + name);
  if (idx === -1) return defaultVal;
  return argv[idx + 1] || defaultVal;
}

function hasFlag(name) {
  return argv.includes('--' + name);
}

const watchAgents = getFlag('agents', '').split(',').filter(Boolean);
const silenceThreshold = parseInt(getFlag('threshold', '30'), 10); // minutes
const relayOnly = hasFlag('relay-only');
const oneShot = hasFlag('check');

// Track what we've already alerted on to avoid spam (persisted to disk)
const ALERT_STATE_FILE = path.join(RELAY_DIR, '.alert-state.json');
function loadAlerted() {
  try {
    if (fs.existsSync(ALERT_STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(ALERT_STATE_FILE, 'utf8'));
      return new Set(data.alerted || []);
    }
  } catch {}
  return new Set();
}
function saveAlerted(set) {
  try {
    ensureDir();
    fs.writeFileSync(ALERT_STATE_FILE, JSON.stringify({ alerted: [...set], updated: new Date().toISOString() }));
  } catch {}
}
const alerted = loadAlerted();
// Track relay files we've seen (dedup rapid fs.watch events)
const processedRelay = new Set();

// --- Relay Flush ---

function ensureRelayDir() {
  if (!fs.existsSync(RELAY_DIR)) fs.mkdirSync(RELAY_DIR, { recursive: true });
}

function flushRelay() {
  ensureRelayDir();
  const files = fs.readdirSync(RELAY_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();

  let flushed = 0;
  for (const f of files) {
    const fp = path.join(RELAY_DIR, f);
    if (processedRelay.has(f)) continue;

    try {
      const raw = fs.readFileSync(fp, 'utf8').replace(/\0/g, '');
      const data = JSON.parse(raw);
      const from = data.from || 'relay-unknown';
      const content = data.content || data.message || '';
      const channel = data.channel || 'general';

      if (!content.trim()) {
        fs.unlinkSync(fp);
        continue;
      }

      send(from, `[via relay] ${content}`, channel, data.type ? { type: data.type } : {});
      fs.unlinkSync(fp);
      processedRelay.add(f);
      flushed++;

      const t = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
      console.log(`[${t}] RELAY: ${from} -> #${channel}: ${content.substring(0, 80)}${content.length > 80 ? '...' : ''}`);
    } catch (err) {
      console.error(`[RELAY FAIL] ${f}: ${err.message}`);
    }
  }
  return flushed;
}

// --- Silence Detection ---

function getLastPostTime(agentName, channel) {
  const msgs = readAll(channel);
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].from && msgs[i].from.toLowerCase() === agentName.toLowerCase()) {
      return new Date(msgs[i].ts).getTime();
    }
  }
  return null;
}

function checkSilence() {
  if (watchAgents.length === 0) return [];

  const now = Date.now();
  const silent = [];

  for (const agent of watchAgents) {
    const lastPost = getLastPostTime(agent, 'general');
    const minutesSilent = lastPost ? Math.floor((now - lastPost) / 60000) : Infinity;

    if (minutesSilent >= silenceThreshold) {
      if (!alerted.has(agent)) {
        silent.push({
          agent,
          minutesSilent,
          lastPost: lastPost ? new Date(lastPost).toISOString() : 'never'
        });
        alerted.add(agent);
        saveAlerted(alerted);
      }
    } else {
      // Agent posted again, clear alert state
      if (alerted.has(agent)) {
        alerted.delete(agent);
        saveAlerted(alerted);
      }
    }
  }

  return silent;
}

function alertSilence(silentAgents) {
  if (silentAgents.length === 0) return;

  for (const s of silentAgents) {
    const t = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const detail = s.lastPost === 'never'
      ? 'has never posted to #general'
      : `last posted ${s.minutesSilent}m ago (${timeSince(s.lastPost)})`;

    // Log to stdout only — do NOT post to comms (causes alert spam that drowns real messages)
    console.log(`[${t}] SILENT: ${s.agent} ${detail}`);
  }
}

// --- Health Check (one-shot) ---

function healthCheck() {
  console.log('=== Comms Health Check ===\n');

  // Relay status
  ensureRelayDir();
  const relayFiles = fs.readdirSync(RELAY_DIR).filter(f => f.endsWith('.json'));
  console.log(`Relay queue: ${relayFiles.length} pending`);
  if (relayFiles.length > 0) {
    for (const f of relayFiles) {
      try {
        const raw = fs.readFileSync(path.join(RELAY_DIR, f), 'utf8').replace(/\0/g, '');
        const data = JSON.parse(raw);
        console.log(`  ${f}: ${data.from || '?'} -> #${data.channel || 'general'}`);
      } catch {
        console.log(`  ${f}: UNPARSABLE`);
      }
    }
  }

  // Agent activity
  if (watchAgents.length > 0) {
    console.log(`\nAgent activity (threshold: ${silenceThreshold}m):`);
    const now = Date.now();
    for (const agent of watchAgents) {
      const lastPost = getLastPostTime(agent, 'general');
      if (lastPost) {
        const mins = Math.floor((now - lastPost) / 60000);
        const status = mins >= silenceThreshold ? 'SILENT' : 'OK';
        console.log(`  ${agent}: ${status} (last post ${mins}m ago)`);
      } else {
        console.log(`  ${agent}: SILENT (never posted)`);
      }
    }
  }

  // General channel health
  const msgs = readAll('general');
  const last10 = msgs.slice(-10);
  const uniqueAgents = new Set(last10.map(m => m.from));
  const oldestRecent = last10.length > 0 ? timeSince(last10[0].ts) : 'n/a';
  const newestRecent = last10.length > 0 ? timeSince(last10[last10.length - 1].ts) : 'n/a';

  console.log(`\n#general: ${msgs.length} total messages`);
  console.log(`  Last 10 from: ${[...uniqueAgents].join(', ')}`);
  console.log(`  Range: ${oldestRecent} to ${newestRecent}`);

  // Flush any pending relay
  const flushed = flushRelay();
  if (flushed > 0) console.log(`\nFlushed ${flushed} relay message(s).`);

  // Update digest
  updateDigest(watchAgents);
}

// --- Digest Update (for blind agents like Kimi) ---

function updateDigest(agents) {
  const digestPath = path.join(RELAY_DIR, 'COMMS-DIGEST.md');
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toISOString().split('T')[0];

  const msgs = readAll('general');
  const last20 = msgs.slice(-20);

  // Build agent status
  const agentStatus = [];
  for (const agent of (agents.length > 0 ? agents : [])) {
    const lastPost = getLastPostTime(agent, 'general');
    const mins = lastPost ? Math.floor((Date.now() - lastPost) / 60000) : Infinity;
    const status = mins <= 10 ? 'ONLINE' : mins <= 30 ? 'QUIET' : 'SILENT';
    const via = (mins <= 30 && last20.some(m => m.from === agent && (m.content || '').includes('[via relay]'))) ? ' (via relay)' : '';
    agentStatus.push(`- **${agent}:** ${status}${via} — last post ${lastPost ? mins + 'm ago' : 'never'}`);
  }

  // Format messages
  const msgLines = last20.map(m => {
    const t = new Date(m.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const content = (m.content || '').substring(0, 250);
    const toTag = m.to ? ` -> ${m.to}` : '';
    return `[${t}] ${m.from}${toTag}: ${content}${(m.content || '').length > 250 ? '...' : ''}`;
  }).join('\n\n');

  const digest = `# Comms Digest — Auto-Updated
**Last updated:** ${dateStr} ${timeStr} EST (auto-refreshes every 30s)

## For Blind Agents (Kimi / anyone whose shell is intercepted)
Read this file for comms awareness. Write relay JSON files to this directory for outbound.

## Team Status
${agentStatus.join('\n')}

## Last 20 Messages (#general)

${msgLines}

## How to Post (Relay Method)
Write a file: \`comms/data/.relay/<your-name>-<number>.json\`
\`\`\`json
{ "from": "your-name", "content": "your message", "channel": "general" }
\`\`\`
Watchdog auto-flushes within 30 seconds.
`;

  try {
    fs.writeFileSync(digestPath, digest);
  } catch (err) {
    console.error('Digest update failed:', err.message);
  }
}

// --- Main Loop ---

function runLoop() {
  const t = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  const agentList = watchAgents.length > 0 ? watchAgents.join(', ') : 'none';
  console.log(`[${t}] Watchdog started. Monitoring: ${agentList}. Threshold: ${silenceThreshold}m. Interval: ${CHECK_INTERVAL / 1000}s.`);

  // Initial flush
  flushRelay();

  // Watch relay directory for new files
  ensureRelayDir();
  try {
    fs.watch(RELAY_DIR, { persistent: true }, (event, filename) => {
      if (filename && filename.endsWith('.json')) {
        setTimeout(() => flushRelay(), 500);
      }
    });
  } catch (err) {
    console.error('fs.watch failed, falling back to polling only:', err.message);
  }

  // Periodic check loop
  setInterval(() => {
    // Flush relay (backup for missed fs.watch events)
    flushRelay();

    // Check for silent agents
    if (!relayOnly) {
      const silent = checkSilence();
      alertSilence(silent);
    }

    // Update digest for blind agents
    updateDigest(watchAgents);
  }, CHECK_INTERVAL);
}

// --- Entry ---

if (oneShot) {
  healthCheck();
} else {
  runLoop();
}
