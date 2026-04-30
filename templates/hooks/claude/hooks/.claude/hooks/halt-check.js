#!/usr/bin/env node
/**
 * halt-check.js — Global Kill Switch (PreToolUse)
 *
 * Checks for .fastops/HALT sentinel file before every tool execution.
 * If present, denies ALL tool calls with the reason from the file.
 *
 * Design: absolute minimum latency. Single fs.existsSync on hot path.
 * When HALT is absent (99.99% of calls): ~1ms overhead.
 *
 * Built by C-04 (Cohort C prototype) based on Cohort B research.
 */

const fs = require('fs');
const path = require('path');

const HALT_FILE = path.join(__dirname, '..', '..', '.fastops', 'HALT');

// Fast path: no HALT file = allow immediately
if (!fs.existsSync(HALT_FILE)) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow'
    }
  }));
  process.exit(0);
}

// Slow path: HALT file exists — read reason and deny
let reason = 'No reason provided';
try {
  const contents = fs.readFileSync(HALT_FILE, 'utf-8').trim();
  if (contents) {
    // Parse JSON if possible, otherwise use raw text
    try {
      const data = JSON.parse(contents);
      reason = data.reason || contents;
    } catch {
      reason = contents;
    }
  }
} catch {}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: `SYSTEM HALT: ${reason}. Remove .fastops/HALT to resume.`
  }
}));
