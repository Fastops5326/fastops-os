#!/usr/bin/env node
/**
 * Freedom mission: ping #general, poll for new lines from *other* callsigns.
 *
 *   node comms/peer-ping.js [seconds]
 *   FREEDOM_PING_FROM=YourCallsign (default: composer)
 */

const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
if (fs.existsSync(path.join(ROOT, '.env'))) {
  require('dotenv').config({ path: path.join(ROOT, '.env') });
}

const { send } = require('./protocol');

const ME = (process.env.FREEDOM_PING_FROM || 'composer').toLowerCase();
const seconds = Math.max(3, parseInt(process.argv[2], 10) || 10);

function readAll(channel) {
  const f = path.join(__dirname, 'data', `${channel}.jsonl`);
  if (!fs.existsSync(f)) return [];
  const raw = fs.readFileSync(f, 'utf8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const token = `ping-${Date.now().toString(36)}`;
const msg = send(
  process.env.FREEDOM_PING_FROM || 'composer',
  `[FREEDOM PING ${token}] — any peer reply on #general (polling ${seconds}s).`,
  'general',
  {}
);
console.error(`[peer-ping] posted id=${msg.id} token=${token}`);

const seen = new Set(readAll('general').map((m) => m.id));

const iv = setInterval(() => {
  const all = readAll('general');
  for (const m of all) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    const from = (m.from || '').toLowerCase();
    if (from === ME) continue;
    if (m.source === 'claude-code-comms-harvest') continue;
    const body = (m.content || '').replace(/\s+/g, ' ').trim();
    const clip = body.length > 600 ? body.slice(0, 600) + '…' : body;
    console.log(`[peer] ${m.from}: ${clip}`);
  }
}, 1000);

setTimeout(() => {
  clearInterval(iv);
  console.error(`[peer-ping] done (${seconds}s)`);
  process.exit(0);
}, seconds * 1000);
