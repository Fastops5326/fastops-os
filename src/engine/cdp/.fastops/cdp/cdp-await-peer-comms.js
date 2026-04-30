#!/usr/bin/env node
/**
 * After a CDP wake, do NOT go idle until the net shows a response from someone else.
 * Polls comms JSONL for any NEW line whose `from` is not you (excluded callsigns).
 *
 * Usage:
 *   FASTOPS_CALLSIGN=P0-CursorOps node .fastops/cdp/cdp-await-peer-comms.js --seconds 90 --channel general
 *   node .fastops/cdp/cdp-await-peer-comms.js --not-from P0-CursorOps --not-from composer --seconds 120
 *
 *   node .fastops/cdp/cdp-await-peer-comms.js --min-distinct-peers 4 --seconds 180 --channel general
 *
 * Exit: 0 = enough distinct peer senders seen, 1 = timeout
 */

const fs = require('fs');
const path = require('path');

function getArg(name, fallback = null) {
  const idx = process.argv.indexOf('--' + name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const channel = getArg('channel', 'general');
const seconds = parseInt(getArg('seconds', '90'), 10);
const intervalMs = parseInt(getArg('interval', '2000'), 10);
const minDistinctPeers = Math.max(1, parseInt(getArg('min-distinct-peers', '1'), 10));

const exclude = new Set();
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--not-from' && process.argv[i + 1]) {
    exclude.add(String(process.argv[i + 1]).toLowerCase());
  }
}
if (process.env.FASTOPS_CALLSIGN && String(process.env.FASTOPS_CALLSIGN).trim()) {
  exclude.add(String(process.env.FASTOPS_CALLSIGN).toLowerCase().trim());
}

if (exclude.size === 0) {
  console.error(
    '[await-peer] Set FASTOPS_CALLSIGN or pass --not-from <callsign> (repeatable) so we know who is "self".'
  );
  process.exit(2);
}

const ROOT = path.join(__dirname, '..', '..');
const jsonl = path.join(ROOT, 'comms', 'data', `${channel}.jsonl`);

function readMessages() {
  if (!fs.existsSync(jsonl)) return [];
  const raw = fs.readFileSync(jsonl, 'utf8').replace(/\0/g, '');
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch (_) {}
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const seenIds = new Set();
  for (const m of readMessages()) seenIds.add(m.id);

  const deadline = Date.now() + seconds * 1000;
  const peerSenders = new Set();
  console.error(
    `[await-peer] #${channel} — need ${minDistinctPeers} distinct peer sender(s) (not: ${[...exclude].join(', ')}), ${seconds}s max`
  );

  while (Date.now() < deadline) {
    for (const m of readMessages()) {
      if (seenIds.has(m.id)) continue;
      seenIds.add(m.id);
      const f = (m.from || '').toLowerCase();
      if (exclude.has(f)) continue;
      peerSenders.add(f);
      const clip = (m.content || '').replace(/\s+/g, ' ').trim().slice(0, 280);
      console.log(`[await-peer] PEER ${peerSenders.size}/${minDistinctPeers} — from="${m.from}" id=${m.id}`);
      console.log(`[await-peer] ${clip}${(m.content || '').length > 280 ? '…' : ''}`);
      if (peerSenders.size >= minDistinctPeers) {
        console.log(`[await-peer] DONE — distinct peers: ${[...peerSenders].join(', ')}`);
        process.exit(0);
      }
    }
    await sleep(intervalMs);
  }

  console.error(
    `[await-peer] TIMEOUT — got ${peerSenders.size}/${minDistinctPeers} distinct peer(s): ${[...peerSenders].join(', ') || '(none)'}. CDP alone is not proof. ` +
      `Next: read JSONL, run \`node comms/poll-loop.js ${Math.min(seconds, 60)}\`, or wake a different seat. ` +
      `See .fastops/cdp/CDP-PEER-PROTOCOL.md`
  );
  process.exit(1);
}

main();
