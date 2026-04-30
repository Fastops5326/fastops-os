#!/usr/bin/env node
/**
 * city-orchestrator.js — Self-sustaining loop: detect gaps → dispatch → review → merge
 * Rotates through deepseek, grok-full, kimi-k2 for gap resolution
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const cycle = args.includes('--cycle');
const MODELS = ['deepseek', 'grok-full', 'kimi-k2'];
let modelIndex = 0;

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', cwd: __dirname }).trim();
  } catch (e) {
    log(`CMD FAIL: ${cmd} — ${e.message}`);
    return null;
  }
}

function detectGaps() {
  const out = run('node city-brief.js --gaps --hours 24');
  if (!out) return [];
  const lines = out.split('\n').filter(l => l.includes('severity: high'));
  return lines.map(l => {
    const m = l.match(/gap: (.+?) —/);
    return m ? m[1] : null;
  }).filter(Boolean);
}

function dispatchSession(gap) {
  const model = MODELS[modelIndex++ % MODELS.length];
  const task = `Resolve high-severity gap: ${gap}`;
  const cmd = `node city-session.js --model ${model} --task "${task}"`;
  log(`DISPATCH: ${cmd}`);
  if (dryRun) return;
  const out = run(cmd);
  if (out) log(`DISPATCHED: ${out.split('\n')[0]}`);
}

function reviewCompleted() {
  const out = run('node city-session.js --list');
  if (!out) return;
  const sessions = out.split('\n').filter(l => l.includes('completed'));
  sessions.forEach(line => {
    const m = line.match(/(\w+)/);
    if (m) {
      const id = m[1];
      log(`REVIEW: ${id}`);
      if (!dryRun) run(`node city-session.js --review ${id}`);
    }
  });
}

function main() {
  log('START orchestrator');
  const gaps = detectGaps();
  if (gaps.length) {
    log(`FOUND ${gaps.length} high-severity gaps`);
    gaps.forEach(dispatchSession);
  } else {
    log('No high-severity gaps found');
  }
  reviewCompleted();
  log('END orchestrator');
  if (!cycle) process.exit(0);
  setTimeout(main, 60000); // 1min loop
}

main();