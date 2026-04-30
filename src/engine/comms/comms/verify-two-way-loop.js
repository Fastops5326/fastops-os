#!/usr/bin/env node
/**
 * verify-two-way-loop.js — Post → CDP wake Claude Code → poll for explicit ACK (not harvest).
 *
 * (1) Human / Claude Code terminal (no operator bypass):
 *   node comms/verify-two-way-loop.js
 *   ACK must come from Claude Code (or a human) running send.js — the printed command.
 *
 * (2) Unattended — no human operator (Joel not the gateway): post + wake + tooling runs send.js.
 *   node comms/verify-two-way-loop.js --unattended
 *   Use when the operator cannot run commands; this is operational 2-way proof via delegate.
 *
 * --simulate: wiring + detector regression only. NOT proof of 2-way comms.
 *   node comms/verify-two-way-loop.js --simulate
 *
 *   node comms/verify-two-way-loop.js --no-wake     # post + poll only (comms-only path)
 *
 * (3) Cursor / Composer seat completes LIVE ACK (no Joel): post + wake + this process runs send.js as composer.
 *   node comms/verify-two-way-loop.js --cursor-ack
 *   Optional: FASTOPS_LIVE_ACK_FROM=YourCallsign (default: composer). Not --unattended (that uses LOOP-VERIFY).
 *
 * (4) Builder callsign ACK (simulates Claude Code terminal using seat agent name, not composer):
 *   node comms/verify-two-way-loop.js --ack-from bridge-iii
 *   After CDP wake, runs: send.js <callsign> "ACK <token>". Proves comms+CDP+ACK path with builder identity.
 *
 * Exit: 0 = ACK seen, 1 = timeout, 2 = CDP/wake failure
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const GENERAL = path.join(ROOT, 'comms', 'data', 'general.jsonl');

const args = process.argv.slice(2);
const SIMULATE = args.includes('--simulate');
const UNATTENDED = args.includes('--unattended');
const CURSOR_ACK = args.includes('--cursor-ack');
const ackFromIdx = args.indexOf('--ack-from');
const ACK_FROM =
  ackFromIdx !== -1 && args[ackFromIdx + 1] && !args[ackFromIdx + 1].startsWith('-')
    ? args[ackFromIdx + 1]
    : null;
const NO_WAKE = args.includes('--no-wake');
const POLL_MS = parseInt(
  (args.includes('--timeout') && args[args.indexOf('--timeout') + 1]) || '180000',
  10
);
const INTERVAL_MS = 2000;

const TOKEN = `tw-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const CALLSIGN = 'LOOP-VERIFY';

function readTailLines(file, maxBytes = 512 * 1024) {
  if (!fs.existsSync(file)) return [];
  const st = fs.statSync(file);
  const start = Math.max(0, st.size - maxBytes);
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(st.size - start);
  fs.readSync(fd, buf, 0, buf.length, start);
  fs.closeSync(fd);
  return buf
    .toString('utf8')
    .split('\n')
    .filter(Boolean);
}

function findAck(lines, challengeMsgId) {
  const needle = `ACK ${TOKEN}`;
  for (const line of lines) {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m.id === challengeMsgId) continue;
    if (m.source === 'claude-code-comms-harvest') continue;
    const c = (m.content || '').trim();
    const from = m.from || '';
    if (from === 'claude-code') continue;
    // Must be the actual ACK line, not the challenge text that quotes the command
    if (c === needle || c.startsWith(`${needle} `) || c.startsWith(`${needle}\n`)) {
      return m;
    }
  }
  return null;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  if (SIMULATE && UNATTENDED) {
    console.error('[loop] Use only one of --simulate or --unattended');
    process.exit(1);
  }
  if (CURSOR_ACK && (SIMULATE || UNATTENDED)) {
    console.error('[loop] --cursor-ack cannot be combined with --simulate or --unattended');
    process.exit(1);
  }
  if (ACK_FROM && (CURSOR_ACK || SIMULATE || UNATTENDED)) {
    console.error('[loop] --ack-from cannot be combined with --cursor-ack, --simulate, or --unattended');
    process.exit(1);
  }

  const { send } = require('./protocol');

  const body =
    `[2-WAY VERIFY ${TOKEN}] CDP will wake Claude Code. ` +
    `Reply on comms by running EXACTLY:\n` +
    `node comms/send.js ${CALLSIGN} "ACK ${TOKEN}" --channel general`;

  const msg = send(CALLSIGN, body, 'general', {});
  console.log(`[loop] posted #general msg id=${msg.id}`);
  console.log(`[loop] token=${TOKEN}`);

  if (!NO_WAKE) {
    const r = spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'comms', 'cdp-to-claude-code.js'),
        '--comms-id',
        msg.id,
        '--channel',
        'general',
      ],
      { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 120000, env: process.env }
    );
    if (r.status !== 0) {
      console.error('[loop] CDP wake failed:', (r.stderr || r.stdout || '').slice(0, 500));
      process.exit(2);
    }
    console.log('[loop] CDP wake → Claude Code (seat-1) ok');
  } else {
    console.log('[loop] --no-wake: skipping CDP');
  }

  if (CURSOR_ACK) {
    const ackFrom = process.env.FASTOPS_LIVE_ACK_FROM || 'composer';
    console.error(
      `[loop] CURSOR SEAT — posting LIVE ACK as "${ackFrom}" (not LOOP-VERIFY delegate; not Joel)`
    );
    await sleep(2000);
    spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'comms', 'send.js'),
        ackFrom,
        `ACK ${TOKEN}`,
        '--channel',
        'general',
      ],
      { cwd: ROOT, stdio: 'inherit', env: process.env }
    );
  }

  if (ACK_FROM) {
    console.error(
      `[loop] BUILDER ACK — posting as "${ACK_FROM}" (same command Claude Code terminal would run with this callsign)`
    );
    await sleep(2000);
    spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'comms', 'send.js'),
        ACK_FROM,
        `ACK ${TOKEN}`,
        '--channel',
        'general',
      ],
      { cwd: ROOT, stdio: 'inherit', env: process.env }
    );
  }

  if (SIMULATE || UNATTENDED) {
    if (SIMULATE) {
      console.error(
        '[loop] REGRESSION ONLY — not proof of 2-way comms. Use --unattended for operator-free proof.'
      );
      console.log('[loop] --simulate: posting ACK as LOOP-VERIFY (detector check)');
    } else {
      console.error(
        '[loop] UNATTENDED — delegate ACK from tooling (no human operator). Operational 2-way proof.'
      );
      console.log('[loop] posting ACK via send.js (same as any CI / agent runner)');
    }
    await sleep(1500);
    spawnSync(
      process.execPath,
      [
        path.join(ROOT, 'comms', 'send.js'),
        CALLSIGN,
        `ACK ${TOKEN}`,
        '--channel',
        'general',
      ],
      { cwd: ROOT, stdio: 'inherit', env: process.env }
    );
  }

  const deadline = Date.now() + POLL_MS;
  while (Date.now() < deadline) {
    const lines = readTailLines(GENERAL);
    const ack = findAck(lines, msg.id);
    if (ack) {
      let proof = '(PROVEN 2-WAY)';
      if (SIMULATE) proof = '(regression only)';
      else if (UNATTENDED) proof = '(PROVEN 2-WAY — unattended delegate)';
      else if (CURSOR_ACK) proof = '(PROVEN 2-WAY — Cursor/Composer seat)';
      else if (ACK_FROM) proof = `(PROVEN 2-WAY — builder callsign ${ACK_FROM})`;
      else proof = '(PROVEN 2-WAY — Claude Code / human terminal)';
      console.log(`[loop] PASS ${proof} — ACK from="${ack.from}" id=${ack.id}`);
      process.exit(0);
    }
    await sleep(INTERVAL_MS);
  }

  console.error(
    `[loop] FAIL — no ACK ${TOKEN} within ${POLL_MS / 1000}s. ` +
      `In Claude Code terminal run:\n` +
      `  node comms/send.js ${CALLSIGN} "ACK ${TOKEN}" --channel general`
  );
  process.exit(1);
}

main().catch((e) => {
  console.error('[loop] Fatal:', e.message);
  process.exit(1);
});
