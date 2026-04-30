#!/usr/bin/env node
/**
 * cadence-engage-watch.js — Accountability for Overwatch ENGAGE on the latest CADENCE pulse.
 *
 * Scans #general for the most recent CADENCE PULSE; passes if a later line contains
 * [ENGAGE re:<that-msg-id>]. Otherwise exits non-zero (for scripts) or optional nudge.
 *
 * Usage:
 *   node .fastops/cdp/cadence-engage-watch.js           # exit 0 if acked, 1 if not
 *   node .fastops/cdp/cadence-engage-watch.js --json    # print { ok, cadenceId, engaged }
 *   node .fastops/cdp/cadence-engage-watch.js --nudge   # if unacked & age > grace, CDP wake + comms line once per cadence id
 *
 * Env:
 *   FASTOPS_CADENCE_ENGAGE_GRACE_SEC  (default 300) — seconds before unacked counts / nudge
 *   FASTOPS_CADENCE_NUDGE_TARGET      (default claude) — cdp-wake --target
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const GENERAL = path.join(ROOT, 'comms', 'data', 'general.jsonl');
const NUDGE_STATE = path.join(__dirname, '..', '.cadence-engage-nudge-state.json');

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const doNudge = args.includes('--nudge');
const graceSec = parseInt(process.env.FASTOPS_CADENCE_ENGAGE_GRACE_SEC || '300', 10);
const nudgeTarget = process.env.FASTOPS_CADENCE_NUDGE_TARGET || 'claude';

function parseAll() {
  if (!fs.existsSync(GENERAL)) return [];
  const lines = fs.readFileSync(GENERAL, 'utf8').trim().split('\n');
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch (_) {}
  }
  return out;
}

function findLatestCadence(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const o = entries[i];
    const from = String(o.from || '').toLowerCase();
    const c = String(o.content || '');
    if (from === 'cadence' && /CADENCE PULSE/i.test(c)) return o;
  }
  return null;
}

function hasEngageAfter(entries, cadenceId) {
  const idx = entries.findIndex((o) => o.id === cadenceId);
  if (idx === -1) return false;
  const needle = `[ENGAGE re:${cadenceId}`;
  for (let i = idx + 1; i < entries.length; i++) {
    const c = String(entries[i].content || '');
    if (c.includes(needle) || c.includes(`[ENGAGE re: ${cadenceId}`)) return true;
  }
  return false;
}

function main() {
  const entries = parseAll();
  const cad = findLatestCadence(entries);
  if (!cad) {
    if (jsonOut) console.log(JSON.stringify({ ok: true, reason: 'no_cadence_pulse' }));
    process.exit(0);
  }
  const cadenceId = cad.id;
  const ts = new Date(cad.ts).getTime();
  const ageSec = (Date.now() - ts) / 1000;
  const engaged = hasEngageAfter(entries, cadenceId);
  const ok = engaged || ageSec < graceSec;

  if (jsonOut) {
    console.log(
      JSON.stringify({
        ok,
        cadenceId,
        engaged,
        ageSec: Math.floor(ageSec),
        graceSec,
        unacked: !engaged && ageSec >= graceSec,
      })
    );
  } else if (!engaged && ageSec >= graceSec) {
    console.error(
      `[cadence-engage-watch] UNACKED: no [ENGAGE re:${cadenceId}] after latest CADENCE PULSE (${Math.floor(ageSec)}s old). ` +
        `Run: node .fastops/cdp/engage-last-cadence.js --print-cmd`
    );
  }

  if (doNudge && !engaged && ageSec >= graceSec) {
    let state = {};
    try {
      if (fs.existsSync(NUDGE_STATE)) state = JSON.parse(fs.readFileSync(NUDGE_STATE, 'utf8'));
    } catch (_) {}
    if (state.nudgedForId === cadenceId) {
      process.exit(ok ? 0 : 1);
    }
    const send = path.join(ROOT, 'comms', 'send.js');
    const line = `[CADENCE-GUARD] Latest pulse ${cadenceId} has no [ENGAGE re:${cadenceId}] after ${Math.floor(ageSec)}s. Overwatch: run engage-last-cadence.js --print-cmd. Over.`;
    spawnSync(process.execPath, [send, 'CADENCE-GUARD', line, '--channel', 'general'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    const wake = path.join(__dirname, 'cdp-wake.js');
    spawnSync(
      process.execPath,
      [wake, '--target', nudgeTarget, '--comms-id', cadenceId, '--comms-channel', 'general'],
      { cwd: ROOT, stdio: 'inherit', env: process.env }
    );
    try {
      fs.writeFileSync(NUDGE_STATE, JSON.stringify({ nudgedForId: cadenceId, ts: new Date().toISOString() }));
    } catch (_) {}
  }

  process.exit(ok ? 0 : 1);
}

main();
