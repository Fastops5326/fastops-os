#!/usr/bin/env node
'use strict';

/**
 * subagent-inline-check.js — PostToolUse hook for Agent/Task tool completions
 *
 * THE GAP: Inline subagents (Agent tool) run inside the parent's context.
 * No hooks fire independently for them. When they finish, nobody checks
 * whether they committed, wired, or documented their work.
 *
 * THE FIX: This hook fires AFTER every Task/Agent tool completion.
 * It snapshots git state, detects new uncommitted work and unwired tools,
 * and injects a warning back to the parent agent if gaps are found.
 *
 * WHAT IT DOES:
 *   1. Detects Task tool completion (subagent just finished)
 *   2. Snapshots git status for new uncommitted/untracked files
 *   3. Checks for new .js tools not wired into entry points
 *   4. Compares against pre-subagent snapshot (if available)
 *   5. Injects feedback to parent: "SUBAGENT GAP: X uncommitted, Y unwired"
 *
 * WHAT IT DOES NOT:
 *   - Call external models (that's the PreCompact audit's job)
 *   - Block tool use (exit 0 always, feedback only)
 *   - Log content or file paths beyond tool names
 *
 * PERFORMANCE: ~50ms (one git status call + file reads). Well within 3s timeout.
 *
 * Author: anvil-xi | Date: 2026-03-09
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = path.join(__dirname, '..', '..');
const FASTOPS = path.join(BASE, '.fastops');
const SETTINGS = path.join(BASE, '.claude', 'settings.json');
const PREFLIGHT = path.join(FASTOPS, 'preflight.js');
const SESSION_START = path.join(BASE, '.claude', 'commands', 'session-start.md');
const SNAPSHOT_FILE = path.join(FASTOPS, '.subagent-git-snapshot.json');

function exec(cmd) {
  try {
    return execSync(cmd, {
      cwd: BASE, encoding: 'utf8', timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    }).trim();
  } catch { return ''; }
}

function getGitSnapshot() {
  const status = exec('git status --short');
  if (!status) return { files: [], tools: [] };

  const files = status.split('\n').filter(Boolean);
  const tools = files
    .filter(l => l.includes('.fastops/') && l.trim().endsWith('.js'))
    .map(l => path.basename(l.substring(3).trim()));

  return { files, tools };
}

function isToolWired(toolBasename) {
  const name = toolBasename.replace('.js', '');
  for (const filePath of [SETTINGS, PREFLIGHT, SESSION_START]) {
    try {
      if (fs.readFileSync(filePath, 'utf8').includes(name)) return true;
    } catch {}
  }
  return false;
}

function loadSnapshot() {
  try {
    if (fs.existsSync(SNAPSHOT_FILE)) {
      return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
    }
  } catch {}
  return null;
}

function saveSnapshot(snapshot) {
  try {
    snapshot.ts = Date.now();
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot));
  } catch {}
}

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  await new Promise(resolve => {
    process.stdin.on('data', chunk => { input += chunk; });
    process.stdin.on('end', resolve);
    setTimeout(resolve, 300);
  });

  let data;
  try { data = JSON.parse(input); } catch { process.exit(0); return; }

  const toolName = data.hook?.toolName || data.tool_name || '';

  // Only run for Task/Agent tool completions (subagent just finished)
  if (toolName !== 'Task' && toolName !== 'Agent') {
    process.exit(0);
    return;
  }

  // Get current git state
  const current = getGitSnapshot();

  // Load pre-subagent snapshot to find what's NEW
  const previous = loadSnapshot();

  // Save current as new snapshot for next comparison
  saveSnapshot(current);

  // Find new files that appeared during this subagent's execution
  let newFiles = current.files;
  let newTools = current.tools;

  if (previous) {
    const prevSet = new Set(previous.files);
    newFiles = current.files.filter(f => !prevSet.has(f));
    const prevToolSet = new Set(previous.tools);
    newTools = current.tools.filter(t => !prevToolSet.has(t));
  }

  // Check for gaps
  const gaps = [];

  // New uncommitted files from this subagent
  const uncommittedNew = newFiles.filter(f => {
    const norm = f.replace(/\\/g, '/');
    // Skip noise
    return !norm.includes('.fastops/.') &&
           !norm.includes('node_modules/') &&
           !norm.includes('.agent-outputs/');
  });

  if (uncommittedNew.length > 0) {
    gaps.push(`${uncommittedNew.length} new uncommitted file(s): ${uncommittedNew.slice(0, 5).map(f => path.basename(f.substring(3).trim())).join(', ')}`);
  }

  // New tools not wired
  const unwiredNew = newTools.filter(t => !isToolWired(t));
  if (unwiredNew.length > 0) {
    gaps.push(`${unwiredNew.length} new tool(s) not wired: ${unwiredNew.join(', ')}`);
  }

  // Check if mission files were updated (successor documentation)
  const missionFilesTouched = newFiles.filter(f =>
    f.replace(/\\/g, '/').includes('missions/') && f.includes('MISSION.md')
  );
  const hasSubstantiveWork = uncommittedNew.length > 0 || newTools.length > 0;
  if (hasSubstantiveWork && missionFilesTouched.length === 0) {
    gaps.push('No mission file updated — if work is incomplete, successor notes are required');
  }

  // Check if subagent committed its own work
  if (previous) {
    const prevFileSet = new Set(previous.files.map(f => f.substring(3).trim()));
    const newUntracked = newFiles
      .filter(f => f.startsWith('??'))
      .map(f => f.substring(3).trim())
      .filter(f => !prevFileSet.has(f));
    const newModified = newFiles
      .filter(f => f.startsWith(' M') || f.startsWith('M '))
      .map(f => f.substring(3).trim())
      .filter(f => !prevFileSet.has(f));

    if ((newUntracked.length + newModified.length) > 2) {
      gaps.push(`Subagent created/modified ${newUntracked.length + newModified.length} file(s) but did not commit`);
    }
  }

  // Output feedback to parent agent
  if (gaps.length > 0) {
    const actions = [];
    actions.push('YOU MUST resolve each before continuing:');
    if (uncommittedNew.length > 0) actions.push('• git add + commit the subagent\'s work');
    if (unwiredNew.length > 0) actions.push('• Wire new tools into settings.json or preflight.js');
    if (hasSubstantiveWork && missionFilesTouched.length === 0) {
      actions.push('• Update the relevant mission file with successor notes if work is incomplete');
    }

    const feedback = [
      `⚠ SUBAGENT ACCOUNTABILITY CHECK: ${gaps.join('. ')}.`,
      actions.join('\n')
    ].join('\n');

    // Output as user_feedback so the parent agent sees it
    console.log(JSON.stringify({ result: 'warn', message: feedback }));
  }

  process.exit(0);
}

main().catch(() => process.exit(0));
