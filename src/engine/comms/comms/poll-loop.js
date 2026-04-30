#!/usr/bin/env node
/**
 * Symmetric comms wake (jailbreak for asymmetric CDP):
 * both Claude Code and Cursor chat agents poll the JSONL channel — no reverse-CDP required.
 *
 * Usage:
 *   node comms/poll-loop.js                    # 10s window, 1s tick, #general
 *   node comms/poll-loop.js 15                 # 15 seconds
 *   node comms/poll-loop.js --seconds 10 --channel general --interval 1000
 *
 * Prints each NEW message as it appears (by id). Exit 0 when time elapses.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

function parseArgs(argv) {
  let seconds = 10;
  let channel = 'general';
  let intervalMs = 1000;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seconds' && argv[i + 1]) seconds = Math.max(1, parseInt(argv[++i], 10) || 10);
    else if (a === '--channel' && argv[i + 1]) channel = argv[++i];
    else if (a === '--interval' && argv[i + 1]) intervalMs = Math.max(200, parseInt(argv[++i], 10) || 1000);
    else if (/^\d+$/.test(a)) seconds = Math.max(1, parseInt(a, 10));
    else rest.push(a);
  }
  return { seconds, channel, intervalMs };
}

function readMessages(channel) {
  const filePath = path.join(DATA_DIR, `${channel}.jsonl`);
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').replace(/\0/g, '');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function main() {
  const { seconds, channel, intervalMs } = parseArgs(process.argv.slice(2));
  const seen = new Set();
  let initial = readMessages(channel);
  for (const m of initial) seen.add(m.id);

  const t0 = Date.now();
  console.error(`[poll-loop] #${channel} for ${seconds}s (tick ${intervalMs}ms) — watching for NEW lines`);

  const tick = () => {
    const msgs = readMessages(channel);
    for (const m of msgs) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const time = new Date(m.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
      const from = m.from || '?';
      const to = m.to ? ` -> ${m.to}` : '';
      const body = (m.content || '').replace(/\s+/g, ' ').trim();
      const clip = body.length > 500 ? body.slice(0, 500) + '…' : body;
      console.log(`[${time}] ${from}${to}: ${clip}`);
    }
  };

  const iv = setInterval(tick, intervalMs);
  tick();

  setTimeout(() => {
    clearInterval(iv);
    tick();
    console.error(`[poll-loop] done (${seconds}s)`);
    process.exit(0);
  }, seconds * 1000);
}

main();
