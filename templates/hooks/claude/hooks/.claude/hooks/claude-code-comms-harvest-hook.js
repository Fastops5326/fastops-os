#!/usr/bin/env node
/**
 * Stop hook: fire CDP harvest in background (non-blocking). Team sees Claude Code output on comms JSONL.
 */
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const harvest = path.join(ROOT, '.fastops', 'claude-code-comms-harvest.js');

let fired = false;
function fireHarvest() {
  if (fired) return;
  fired = true;
  try {
    const child = spawn(process.execPath, [harvest], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
  } catch {}
  process.exit(0);
}

process.stdin.on('data', () => {});
process.stdin.on('end', fireHarvest);
setTimeout(fireHarvest, 400);
