#!/usr/bin/env node
/**
 * engage-last-cadence.js — Find the latest CADENCE PULSE in #general and print the exact
 * check-comms --engage command (lowers friction so Overwatch closes the loop on comms).
 *
 * Usage (repo root):
 *   node .fastops/cdp/engage-last-cadence.js
 *   node .fastops/cdp/engage-last-cadence.js --print-cmd
 *   node .fastops/cdp/engage-last-cadence.js --id-only
 *
 * Env: FASTOPS_SEAT, FASTOPS_CALLSIGN (passed through when you copy the printed command)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const GENERAL = path.join(ROOT, 'comms', 'data', 'general.jsonl');

const args = process.argv.slice(2);
const printCmd = args.includes('--print-cmd') || args.length === 0;
const idOnly = args.includes('--id-only');

function main() {
  if (!fs.existsSync(GENERAL)) {
    console.error('[engage-last-cadence] Missing', GENERAL);
    process.exit(1);
  }
  const lines = fs.readFileSync(GENERAL, 'utf8').trim().split('\n');
  let latest = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    try {
      const o = JSON.parse(lines[i]);
      const from = String(o.from || '').toLowerCase();
      const c = String(o.content || '');
      if (from === 'cadence' && /CADENCE PULSE/i.test(c)) {
        latest = o;
        break;
      }
    } catch (_) {}
  }
  if (!latest || !latest.id) {
    console.error('[engage-last-cadence] No CADENCE PULSE found in general.jsonl');
    process.exit(1);
  }

  if (idOnly) {
    console.log(latest.id);
    process.exit(0);
  }

  const id = latest.id;
  const ch = latest.channel || 'general';
  const engagePlaceholder =
    'Roger CADENCE. Heard pulse. Status: <what you are doing>. Next: <next action>. Ask Claude: <question if any>.';

  const cmd =
    `node .fastops/cdp/check-comms.js ${id} --wake claude --channel ${ch} --callsign ${process.env.FASTOPS_CALLSIGN || 'OVERWATCH'} --engage "${engagePlaceholder}"`;

  if (printCmd) {
    console.log('Latest CADENCE PULSE msg id:', id);
    console.log('');
    console.log('Set FASTOPS_SEAT so you do not self-wake (e.g. composer). Then run:');
    console.log('');
    console.log(cmd);
    console.log('');
  }
}

main();
