#!/usr/bin/env node
'use strict';

/**
 * subagent-snapshot.js — PreToolUse hook: snapshots git state before subagent runs
 *
 * Paired with subagent-inline-check.js (PostToolUse). Takes a git status
 * snapshot BEFORE the subagent executes so the post-hook can diff and
 * detect exactly what the subagent changed.
 *
 * ~30ms. Never blocks.
 *
 * Author: anvil-xi | Date: 2026-03-09
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = path.join(__dirname, '..', '..');
const SNAPSHOT_FILE = path.join(BASE, '.fastops', '.subagent-git-snapshot.json');

function main() {
  // Consume stdin (hook protocol)
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const status = execSync('git status --short', {
        cwd: BASE, encoding: 'utf8', timeout: 3000,
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
      }).trim();

      const files = status ? status.split('\n').filter(Boolean) : [];
      const tools = files
        .filter(l => l.includes('.fastops/') && l.trim().endsWith('.js'))
        .map(l => path.basename(l.substring(3).trim()));

      fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({ files, tools, ts: Date.now() }));
    } catch {}

    process.exit(0);
  });
}

main();
