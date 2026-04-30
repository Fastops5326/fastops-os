#!/usr/bin/env node
/**
 * cdp-preflight-hook.js — SessionStart hook
 * Verifies CDP port 9223 is reachable. If not, warns the agent immediately.
 * Also compiles state and checks for stuck agents.
 */
'use strict';
const http = require('http');
const path = require('path');
const { execSync } = require('child_process');

const PORT = 9223;
const BASE = path.join(__dirname, '..', '..');

function checkCDP() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/json`, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ up: true, tabs: data }));
    });
    req.on('error', () => resolve({ up: false }));
    req.setTimeout(2000, () => { req.destroy(); resolve({ up: false }); });
  });
}

async function main() {
  const cdp = await checkCDP();

  const warnings = [];

  if (!cdp.up) {
    warnings.push('CDP PORT 9223 IS DOWN. Cursor was not launched with --remote-debugging-port=9223. Tell Joel IMMEDIATELY. No team communication until this is fixed.');
  }

  // Compile state if state-compiler exists
  try {
    execSync(`node "${path.join(BASE, '.fastops', 'state-compiler.js')}" --compile`, { timeout: 5000, stdio: 'pipe' });
  } catch {}

  // Check for stuck agents via loop-detector
  try {
    const result = execSync(`node "${path.join(BASE, '.fastops', 'loop-detector.js')}" --all --window 30`, { timeout: 5000, stdio: 'pipe' });
    const output = result.toString();
    if (output.includes('LOOPING')) {
      warnings.push('LOOP DETECTED: ' + output.trim().split('\n').filter(l => l.includes('LOOPING')).join('; '));
    }
  } catch {}

  if (warnings.length > 0) {
    process.stderr.write('[CDP-PREFLIGHT] ' + warnings.join(' | ') + '\n');
  }
}

main().catch(() => {}).finally(() => process.exit(0));
