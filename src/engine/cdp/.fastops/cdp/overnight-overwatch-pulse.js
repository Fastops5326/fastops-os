#!/usr/bin/env node
/**
 * overnight-overwatch-pulse.js
 *
 * Every run:
 * 1) Posts a pulse message to #general with ACK token.
 * 2) Wakes COMPOSER (this seat) via CDP comms-id stub.
 * 3) Wakes only IDLE Claude Code sessions via vscode-wake.
 * 4) Waits for ACK token in comms.
 * 5) If no ACK, runs diagnostics + posts alert.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BASE = path.join(__dirname, '..', '..');
const CHANNEL = 'general';
const CALLSIGN = 'OVERWATCH';
const ACK_WAIT_MS = Number(process.argv[2] || 90000);
const LOCK_PATH = path.join(BASE, '.fastops', '.overnight-overwatch-pulse.lock');
const STATE_PATH = path.join(BASE, '.fastops', '.overnight-overwatch-pulse-state.json');

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runNode(args, description) {
  const res = spawnSync(process.execPath, args, {
    cwd: BASE,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (res.status !== 0) {
    const err = (res.stderr || '').trim();
    const out = (res.stdout || '').trim();
    throw new Error(`${description} failed (exit ${res.status})${err ? `\n${err}` : out ? `\n${out}` : ''}`);
  }
  return (res.stdout || '').trim();
}

function safeRunNode(args, description) {
  try {
    const out = runNode(args, description);
    return { ok: true, out };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function appendLog(line) {
  const logDir = path.join(BASE, '.fastops', 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, 'overnight-overwatch-pulse.log');
  fs.appendFileSync(logPath, `${nowIso()} ${line}\n`);
}

function parseSendId(sendOutput) {
  const m = sendOutput.match(/sent:\s*([^\s]+)/i);
  return m ? m[1] : null;
}

function parseSidebarTabs(listOutput) {
  const rows = String(listOutput || '').split(/\r?\n/);
  const tabs = [];
  for (const row of rows) {
    const m = row.match(/^\s*\[(\d+)\]\s+(.+?)(?:\s+\|.*)?$/);
    if (!m) continue;
    tabs.push({ index: Number(m[1]), label: String(m[2] || '').trim() });
  }
  return tabs;
}

function pickFallbackSidebarIndex(listOutput) {
  const tabs = parseSidebarTabs(listOutput);
  if (!tabs.length) return null;
  const composerLike = tabs.find((t) => /composer/i.test(t.label));
  return (composerLike || tabs[0]).index;
}

function readCommsLines() {
  const p = path.join(BASE, 'comms', 'data', `${CHANNEL}.jsonl`);
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => {
    try {
      return JSON.parse(line);
    } catch (_) {
      return null;
    }
  }).filter(Boolean);
}

function readState() {
  try {
    if (!fs.existsSync(STATE_PATH)) return { consecutiveNoAck: 0 };
    const raw = fs.readFileSync(STATE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      consecutiveNoAck: Number(parsed.consecutiveNoAck || 0),
    };
  } catch (_) {
    return { consecutiveNoAck: 0 };
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function findAckForToken(token, excludeMessageId) {
  const needle = `token:${token}`;
  const lines = readCommsLines();
  for (let i = lines.length - 1; i >= 0; i--) {
    const row = lines[i];
    if (!row || row.id === excludeMessageId) continue;
    if (String(row.from || '').toUpperCase() === CALLSIGN) continue;
    const msg = String(row.content || '');
    if (!msg.includes(needle)) continue;
    // Require substantive engagement, not receipt-only ACK.
    const hasStatus = /status\s*:/i.test(msg);
    const hasNext = /next\s*:/i.test(msg);
    if (hasStatus && hasNext) return row;
  }
  return null;
}

function acquireLock() {
  if (fs.existsSync(LOCK_PATH)) {
    const mtime = fs.statSync(LOCK_PATH).mtimeMs;
    const ageMs = Date.now() - mtime;
    if (ageMs < 25 * 60 * 1000) {
      appendLog('[SKIP] lock exists; previous run still active');
      return false;
    }
  }
  fs.writeFileSync(LOCK_PATH, JSON.stringify({ startedAt: nowIso(), pid: process.pid }));
  return true;
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_PATH)) fs.unlinkSync(LOCK_PATH);
  } catch (_) {}
}

async function main() {
  if (!acquireLock()) return;
  const state = readState();

  const token = `ow-${Date.now()}`;
  appendLog(`[START] token=${token}`);

  try {
    const pulseText =
      `[OVERNIGHT-PULSE] token:${token} ` +
      `Overwatch check-in. Reply in #${CHANNEL} with one substantive line referencing token:${token} ` +
      `and include "Status:" plus "Next:". Do not stop for ACK theater; keep building city work continuously.`;

    const sendOut = runNode(
      ['comms/send.js', CALLSIGN, pulseText, '--channel', CHANNEL],
      'comms/send pulse'
    );
    const msgId = parseSendId(sendOut);
    if (!msgId) throw new Error(`Could not parse comms message id from output: ${sendOut}`);
    appendLog(`[PULSE] msgId=${msgId}`);

    // Wake this seat first so Overwatch can act if available.
    const composerWake = safeRunNode(
      ['.fastops/cdp/cdp-wake.js', '--target', 'composer', '--comms-id', msgId, '--comms-channel', CHANNEL, '--from', CALLSIGN],
      'CDP wake composer'
    );
    if (composerWake.ok) {
      appendLog('[WAKE] composer wake sent');
    } else {
      appendLog(`[WARN] composer wake failed: ${composerWake.error}`);
      // If composer seat is down, fallback to whichever sidebar tab is currently live.
      const looksDown = /ECONNREFUSED|connect refused|connection refused/i.test(composerWake.error);
      if (looksDown) {
        const listOut = safeRunNode(['.fastops/cdp-target-model.js', '--list'], 'cdp-target-model list for fallback');
        if (listOut.ok) {
          const fallbackIndex = pickFallbackSidebarIndex(listOut.out);
          if (fallbackIndex) {
            const fallbackWake = safeRunNode(
              [
                '.fastops/cdp-target-model.js',
                '--target-index',
                String(fallbackIndex),
                '--idle-only',
                '--comms-id',
                msgId,
                '--comms-channel',
                CHANNEL,
                '--from',
                CALLSIGN,
              ],
              `CDP fallback wake index ${fallbackIndex}`
            );
            if (fallbackWake.ok) {
              appendLog(`[WAKE] fallback sidebar wake sent to index=${fallbackIndex}`);
            } else {
              appendLog(`[WARN] fallback sidebar wake failed: ${fallbackWake.error}`);
            }
          } else {
            appendLog('[WARN] fallback sidebar wake skipped: no tabs parsed from --list');
          }
        } else {
          appendLog(`[WARN] fallback sidebar wake skipped: list failed: ${listOut.error}`);
        }
      }
    }

    // User policy: do not target Claude Code sessions from this pulse.
    appendLog('[WAKE] Claude Code targeting disabled by policy; Cursor sidebar idle-only only');

    await sleep(ACK_WAIT_MS);
    const ack = findAckForToken(token, msgId);
    if (ack) {
      state.consecutiveNoAck = 0;
      writeState(state);
      appendLog(`[ACK] received from=${ack.from} id=${ack.id}`);
      runNode(
        ['comms/send.js', CALLSIGN, `[OVERNIGHT-PULSE-OK] token:${token} ack:${ack.id} from:${ack.from}. Continuing 24/7 city cadence.`, '--channel', CHANNEL],
        'comms/send pulse-ok'
      );
      return;
    }

    appendLog('[WARN] no ACK within window; running diagnostics');
    state.consecutiveNoAck += 1;
    writeState(state);
    const listDiag = safeRunNode(['.fastops/cdp-target-model.js', '--list'], 'cdp-target-model list');
    const discoverDiag = safeRunNode(['.fastops/vscode-wake.js', '--discover'], 'vscode-wake discover');
    appendLog(`[DIAG] sidebar tabs:\n${listDiag.ok ? listDiag.out : listDiag.error}`);
    appendLog(`[DIAG] vscode discover:\n${discoverDiag.ok ? discoverDiag.out : discoverDiag.error}`);
    const shouldAlert = state.consecutiveNoAck === 1 || state.consecutiveNoAck % 3 === 0;
    if (shouldAlert) {
      runNode(
        [
          'comms/send.js',
          CALLSIGN,
          `[OVERNIGHT-PULSE-ALERT] token:${token} no ACK in ${Math.round(ACK_WAIT_MS / 1000)}s. ` +
            `Troubleshooting ran (sidebar list + vscode discover). no-ack streak=${state.consecutiveNoAck}.`,
          '--channel',
          CHANNEL,
        ],
        'comms/send pulse-alert'
      );
    } else {
      appendLog(`[WARN] alert suppressed; no-ack streak=${state.consecutiveNoAck}`);
    }
  } catch (err) {
    appendLog(`[ERROR] ${err.message}`);
    try {
      runNode(
        ['comms/send.js', CALLSIGN, `[OVERNIGHT-PULSE-ERROR] ${err.message}`, '--channel', CHANNEL],
        'comms/send pulse-error'
      );
    } catch (_) {}
  } finally {
    releaseLock();
    appendLog('[END]');
  }
}

main();

