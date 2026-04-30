#!/usr/bin/env node
/**
 * FastOps Comms — Live Watch
 *
 * Polls all channels and displays new messages in real-time.
 * Run: node comms/watch.js
 * Optional: node comms/watch.js --channel exec
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const CHANNELS = ['general', 'exec', 'agents'];
const POLL_MS = 2000;

// ANSI colors
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
};

const CHANNEL_COLORS = {
  general: C.green,
  exec: C.cyan,
  agents: C.magenta,
};

// Parse args
const args = process.argv.slice(2);
const channelFilter = args.includes('--channel') ? args[args.indexOf('--channel') + 1] : null;
const channels = channelFilter ? [channelFilter] : CHANNELS;

// Track last seen message per channel
const lastSeen = {};

function readChannel(channel) {
  const file = path.join(DATA_DIR, `${channel}.jsonl`);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

function displayMessage(msg, channel) {
  const color = CHANNEL_COLORS[channel] || C.white;
  const time = formatTime(msg.ts);
  const from = msg.from === 'system' ? `${C.dim}system${C.reset}` : `${C.bold}${msg.from}${C.reset}`;
  const prefix = `${C.gray}${time}${C.reset} ${color}#${channel}${C.reset}`;
  console.log(`${prefix} ${from}: ${msg.content}`);
}

function poll() {
  for (const channel of channels) {
    const messages = readChannel(channel);
    if (messages.length === 0) continue;

    if (!lastSeen[channel]) {
      // First poll: just mark position, show last 3 for context
      const recent = messages.slice(-3);
      if (recent.length > 0) {
        console.log(`${C.dim}--- Recent from #${channel} ---${C.reset}`);
        recent.forEach(m => displayMessage(m, channel));
      }
      lastSeen[channel] = messages[messages.length - 1].id;
      continue;
    }

    const lastIdx = messages.findIndex(m => m.id === lastSeen[channel]);
    const newMsgs = lastIdx === -1 ? messages.slice(-20) : messages.slice(lastIdx + 1);

    for (const msg of newMsgs) {
      displayMessage(msg, channel);
    }

    if (messages.length > 0) {
      lastSeen[channel] = messages[messages.length - 1].id;
    }
  }
}

// Header
console.log(`${C.bold}FastOps Comms — Live Watch${C.reset}`);
console.log(`${C.dim}Channels: ${channels.join(', ')} | Polling every ${POLL_MS / 1000}s | Ctrl+C to stop${C.reset}`);
console.log('');

// Initial poll + interval
poll();
setInterval(poll, POLL_MS);
