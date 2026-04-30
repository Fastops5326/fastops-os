#!/usr/bin/env node
/**
 * Ping EVERY Cursor sidebar agent (seat-map type:cursor, real model) until each has
 * confirmed on comms — reping missing seats in a loop. Does NOT succeed until all ack tokens appear.
 *
 * Ack tokens (must appear in message body on #general, in a line AFTER the anchor message):
 *   ACK:seat-2 … ACK:seat-7  (one per sidebar tab; see seat-map.json)
 *
 * Usage:
 *   FASTOPS_SEAT=composer FASTOPS_CALLSIGN=P0-CursorOps node .fastops/cdp/cdp-cursor-until-all-ack.js --post-anchor --callsign P0-CursorOps
 *   node .fastops/cdp/cdp-cursor-until-all-ack.js --comms-id <anchor-id>   # anchor already posted with ACK instructions
 *
 * Env: FASTOPS_SEAT — your seat (composer / seat-6); required to skip self.
 *
 *   --forever          Never stop on round count; keep reping until all ACKs or Ctrl+C
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { loadSeatMap, resolveEnvSeatToId } = require('./cdp-seat-utils');

const ROOT = path.join(__dirname, '..', '..');
const SEND = path.join(ROOT, 'comms', 'send.js');
const CDP_WAKE = path.join(__dirname, 'cdp-wake.js');

function getArg(name, fallback = null) {
  const idx = process.argv.indexOf('--' + name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const POST_ANCHOR = process.argv.includes('--post-anchor');
const FOREVER = process.argv.includes('--forever');
const channel = getArg('channel', 'general');
const maxRounds = FOREVER ? Infinity : Math.max(1, parseInt(getArg('max-rounds', '25'), 10));
const wakeDelayMs = parseInt(getArg('wake-delay-ms', '2200'), 10);
const roundPauseSec = Math.max(2, parseInt(getArg('round-pause-sec', '12'), 10));
const callsign = getArg('callsign', process.env.FASTOPS_CALLSIGN || 'OVERWATCH');
let anchorId = getArg('comms-id', null);

const seatMap = loadSeatMap();
const selfSeat = resolveEnvSeatToId(process.env.FASTOPS_SEAT, seatMap);

function cursorSidebarSeats() {
  const out = [];
  for (const [sid, cfg] of Object.entries(seatMap.seats || {})) {
    if (cfg.type !== 'cursor') continue;
    if (!cfg.model || String(cfg.model).trim() === '') continue;
    if (cfg.agent == null && /RESERVE/i.test(String(cfg.description || ''))) continue;
    if (selfSeat && sid === selfSeat) continue;
    out.push({ seatId: sid, cfg });
  }
  return out.sort((a, b) => a.seatId.localeCompare(b.seatId));
}

const peers = cursorSidebarSeats();
const expectedTokens = peers.map((p) => `ACK:${p.seatId}`);

function readMessages() {
  const jsonl = path.join(ROOT, 'comms', 'data', `${channel}.jsonl`);
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

function indexOfAnchor(msgs, id) {
  return msgs.findIndex((m) => m.id === id);
}

function ackStateAfterAnchor(msgs, anchorIdx, aid, peerList) {
  const tail = anchorIdx === -1 ? msgs : msgs.slice(anchorIdx + 1);
  const got = new Set();
  for (const m of tail) {
    const c = m.content || '';
    if (aid && !c.includes(aid)) continue;
    for (const p of peerList) {
      const tok = `ACK:${p.seatId}`;
      if (c.includes(tok)) got.add(tok);
    }
  }
  return got;
}

function postAnchor() {
  const body =
    `[CURSOR-NET ALL-ACK] Anchor = this line's JSONL \`id\`. Each Cursor SIDEBAR tab: post ONE line to #general ` +
    `that references this anchor (re:<id> or the id string) AND includes your exact token: ` +
    expectedTokens.join(' OR ') +
    `. One token per tab only (see .fastops/cdp/seat-map.json). ` +
    `Composer orchestrates — do not spoof another seat's token. ` +
    `Claude Code webview = seat-1 (not sidebar). Over.`;

  const r = spawnSync(process.execPath, [SEND, callsign, body, '--channel', channel], {
    cwd: ROOT,
    stdio: 'pipe',
    encoding: 'utf8',
    env: { ...process.env },
  });
  if (r.status !== 0) {
    console.error('[cursor-all-ack] send.js failed:', (r.stderr || r.stdout || '').slice(0, 400));
    process.exit(1);
  }
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  const idMatch = out.match(/sent:\s*(\S+)/i);
  if (!idMatch) {
    console.error('[cursor-all-ack] could not parse new message id from send.js output:', out.slice(0, 200));
    process.exit(1);
  }
  return idMatch[1];
}

function sleepSync(ms) {
  const buf = new SharedArrayBuffer(4);
  const ia = new Int32Array(buf);
  Atomics.wait(ia, 0, 0, ms);
}

function wakeSeat(seatId) {
  const r = spawnSync(
    process.execPath,
    [
      CDP_WAKE,
      '--target',
      seatId,
      '--comms-id',
      anchorId,
      '--comms-channel',
      channel,
      '--from',
      callsign,
    ],
    { cwd: ROOT, stdio: 'inherit', env: process.env }
  );
  return r.status === 0;
}

function main() {
  if (!process.env.FASTOPS_SEAT || !selfSeat) {
    console.error('[cursor-all-ack] Set FASTOPS_SEAT (e.g. composer) so your seat is skipped.');
    process.exit(2);
  }

  if (POST_ANCHOR) {
    anchorId = postAnchor();
    console.log(`[cursor-all-ack] anchor posted id=${anchorId}`);
  }

  if (!anchorId) {
    console.error(
      'Usage: node cdp-cursor-until-all-ack.js --comms-id <id> [--channel general] [--max-rounds 25] …\n' +
        '   or: --post-anchor --callsign YOU  (posts anchor with ACK:seat-N instructions)'
    );
    process.exit(1);
  }

  const msgs = readMessages();
  const anchorIdx = indexOfAnchor(msgs, anchorId);
  if (anchorIdx === -1) {
    console.error(`[cursor-all-ack] anchor id ${anchorId} not found in #${channel}`);
    process.exit(1);
  }

  console.log(
    `[cursor-all-ack] peers=${peers.map((p) => p.seatId).join(', ')} tokens=${expectedTokens.join(', ')}` +
      (FOREVER ? ' [FOREVER until all ACK or SIGINT]' : '')
  );

  let round = 0;
  while (true) {
    round++;
    if (!FOREVER && round > maxRounds) {
      const allFinal = readMessages();
      const finalGot = ackStateAfterAnchor(allFinal, indexOfAnchor(allFinal, anchorId), anchorId, peers);
      const still = expectedTokens.filter((t) => !finalGot.has(t));
      console.error(`[cursor-all-ack] FAIL after ${maxRounds} rounds — still missing: ${still.join(', ')}`);
      process.exit(1);
    }

    const all = readMessages();
    const aidx = indexOfAnchor(all, anchorId);
    const got = ackStateAfterAnchor(all, aidx, anchorId, peers);
    const missing = expectedTokens.filter((t) => !got.has(t));
    if (missing.length === 0) {
      console.log(`[cursor-all-ack] SUCCESS — all ${expectedTokens.length} sidebar ack tokens present (round ${round}).`);
      process.exit(0);
    }

    const cap = FOREVER ? '∞' : String(maxRounds);
    console.error(
      `[cursor-all-ack] round ${round}/${cap} — missing: ${missing.join(', ')} — reping those seats via CDP`
    );

    const missingSeats = peers.filter((p) => missing.includes(`ACK:${p.seatId}`));
    for (const { seatId } of missingSeats) {
      console.error(`[cursor-all-ack] wake ${seatId}…`);
      if (!wakeSeat(seatId)) {
        console.error(`[cursor-all-ack] wake FAILED for ${seatId} — will retry next round`);
      }
      if (wakeDelayMs > 0) sleepSync(wakeDelayMs);
    }

    console.error(`[cursor-all-ack] pause ${roundPauseSec}s for comms…`);
    sleepSync(roundPauseSec * 1000);
  }
}

main();
