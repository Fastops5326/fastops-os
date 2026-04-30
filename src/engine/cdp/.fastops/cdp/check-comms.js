#!/usr/bin/env node
/**
 * check-comms.js — Read a message by id, log receipt, post to comms, CDP wake (not self).
 *
 * Default comms post is **engagement** — substantive reply to the message, not a hollow ACK.
 * Use --ack-only for mechanical audit lines (automation/CI). Cursor Overwatch seats should
 * use --engage "..." with real response + status + peer dialogue.
 *
 * Usage (from repo root):
 *   FASTOPS_SEAT=composer node .fastops/cdp/check-comms.js <id> --wake claude --engage "Roger. Status: … Next: …"
 *   node .fastops/cdp/check-comms.js <msg-id> --wake watchdog --channel general --callsign OVERWATCH --engage "…"
 *   node .fastops/cdp/check-comms.js <msg-id> --wake crosscheck --no-wake --ack-only
 *
 * Env:
 *   FASTOPS_SEAT   — seat alias or seat-N for this session (blocks self-wake)
 *   FASTOPS_CALLSIGN — default OVERWATCH
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BASE = path.join(__dirname, '..', '..');
const CDP_DIR = __dirname;

function getArg(name, fallback = null) {
  const idx = process.argv.indexOf('--' + name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

const msgId = process.argv[2];
if (!msgId || msgId.startsWith('--')) {
  console.error(
    `Usage: node check-comms.js <message-id> --wake <seat|alias> [--engage "substantive reply"] [--ack-only] [--channel general] [--callsign NAME] [--no-ack] [--no-wake]\n` +
      `  Require --engage "…" (or --reply "…") for real comms posts unless --ack-only or --no-ack.`
  );
  process.exit(1);
}

const channel = getArg('channel', 'general');
const wakeTarget = getArg('wake', '');
const callsign = getArg('callsign', process.env.FASTOPS_CALLSIGN || 'OVERWATCH');
const noAck = process.argv.includes('--no-ack');
const noWake = process.argv.includes('--no-wake');
const ackOnly = process.argv.includes('--ack-only');

/** Collect text after --engage or --reply until next known flag. */
function getEngageText() {
  const engageIdx = process.argv.indexOf('--engage');
  const replyIdx = process.argv.indexOf('--reply');
  const idx = engageIdx !== -1 ? engageIdx : replyIdx !== -1 ? replyIdx : -1;
  if (idx === -1) return null;
  const STOP = new Set([
    '--channel',
    '--wake',
    '--callsign',
    '--no-ack',
    '--no-wake',
    '--ack-only',
    '--engage',
    '--reply',
    '--engage-file',
  ]);
  const parts = [];
  for (let i = idx + 1; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith('--')) {
      const name = a.split('=')[0];
      if (STOP.has(name)) break;
    }
    parts.push(a);
  }
  const t = parts.join(' ').trim();
  return t || null;
}

const engageFile = getArg('engage-file', null);
let engageText = getEngageText();
if (engageFile) {
  try {
    const p = path.isAbsolute(engageFile) ? engageFile : path.join(process.cwd(), engageFile);
    engageText = fs.readFileSync(p, 'utf8').trim().replace(/\s+/g, ' ');
  } catch (e) {
    console.error(`[check-comms] --engage-file: ${e.message}`);
    process.exit(1);
  }
}

const jsonlPath = path.join(BASE, 'comms', 'data', `${channel}.jsonl`);
if (!fs.existsSync(jsonlPath)) {
  console.error(`Channel file not found: ${jsonlPath}`);
  process.exit(1);
}

function findMessageByIdInTail(filePath, id, tailBytes = 4 * 1024 * 1024) {
  try {
    const st = fs.statSync(filePath);
    const bytes = Math.min(st.size, tailBytes);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(bytes);
    fs.readSync(fd, buf, 0, bytes, Math.max(0, st.size - bytes));
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line || !line.includes(id)) continue;
      try {
        const o = JSON.parse(line);
        if (o.id === id) return o;
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

function findMessageByIdFull(filePath, id) {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line);
      if (o.id === id) return o;
    } catch (_) {}
  }
  return null;
}

let found = findMessageByIdInTail(jsonlPath, msgId);
if (!found) found = findMessageByIdFull(jsonlPath, msgId);

if (!found) {
  console.error(`No message with id ${msgId} in #${channel}`);
  process.exit(1);
}

console.log('=== FULL MESSAGE (comms JSONL) ===');
console.log(JSON.stringify(found, null, 2));
console.log('==================================\n');

if (!noAck && !ackOnly && !engageText) {
  console.error(
    `[check-comms] Missing substantive comms. Provide --engage "response to sender + status + next action" ` +
      `(or --reply / --engage-file). For mechanical audit lines only, use --ack-only. ` +
      `See .cursor/rules/comms-overwatch-engage.md`
  );
  process.exit(1);
}

if (!noAck && !ackOnly) {
  const hasStatus = /status\s*:/i.test(engageText || '');
  const hasNext = /next\s*:/i.test(engageText || '');
  if (!hasStatus || !hasNext) {
    console.error(
      '[check-comms] --engage must include both "Status:" and "Next:" to prevent hollow coordination.\n' +
        '  Example: --engage "Roger. Status: validating parser fix. Next: patch and run tests."'
    );
    process.exit(1);
  }
}

const receipts = path.join(BASE, 'comms', 'receipts.js');
const r = spawnSync(process.execPath, [receipts, 'read', callsign, msgId], {
  cwd: BASE,
  stdio: 'inherit',
});
if (r.status !== 0) process.exit(r.status ?? 1);

if (!noAck) {
  const send = path.join(BASE, 'comms', 'send.js');
  const fromLabel = found.from ? String(found.from) : '?';
  let ackText;
  if (ackOnly) {
    ackText =
      `[CHECK COMMS AUDIT] msg:${msgId} #${channel} READ+receipt logged. ` +
      `Wake target: ${wakeTarget || '(none)'}. ${noWake ? 'CDP skipped.' : 'CDP next.'} Over.`;
  } else {
    ackText =
      `[ENGAGE re:${msgId} from:${fromLabel}] ${callsign}: ${engageText} ` +
      `(receipt logged; ${noWake ? 'CDP off' : `CDP→${wakeTarget || '?'}`})`;
  }
  const s = spawnSync(process.execPath, [send, callsign, ackText, '--channel', channel], {
    cwd: BASE,
    stdio: 'inherit',
  });
  if (s.status !== 0) {
    console.error('[check-comms] send.js failed; comms post not sent.');
    process.exit(s.status ?? 1);
  }
}

if (noWake) {
  console.log('[check-comms] --no-wake: skipping CDP.');
  process.exit(0);
}

if (!wakeTarget) {
  console.error('[check-comms] Provide --wake <target> or use --no-wake.');
  process.exit(1);
}

const wakeScript = path.join(CDP_DIR, 'cdp-wake.js');
const w = spawnSync(
  process.execPath,
  [
    wakeScript,
    '--target',
    wakeTarget,
    '--comms-id',
    msgId,
    '--comms-channel',
    channel,
    '--from',
    callsign,
  ],
  { cwd: BASE, stdio: 'inherit', env: { ...process.env } }
);
process.exit(w.status !== null ? w.status : 1);
