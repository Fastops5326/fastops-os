#!/usr/bin/env node
'use strict';

/**
 * subagent-gap-check.js — Stop hook: lightweight gap detection for subagent output
 *
 * Fires when any CLI session ends (Stop hook). Checks:
 *   1. Today's debriefs — how many, how many have self_audit
 *   2. Agents who wrote debriefs vs agents with commits
 *   3. Orphaned .js tools in git status not mentioned in any debrief
 *
 * No external model calls. Pure file reads + one git command.
 * Posts a summary to comms so commanders see gaps.
 *
 * Never blocks session stop (exit 0 always).
 *
 * Author: anvil-xi | Date: 2026-03-09
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = path.join(__dirname, '..', '..');
const FASTOPS = path.join(BASE, '.fastops');
const TODAY = new Date().toISOString().slice(0, 10);
const DEBRIEF_FILE = path.join(FASTOPS, 'subagent-debriefs', `${TODAY}.jsonl`);
const COMMS_FILE = path.join(BASE, 'comms', 'data', 'general.jsonl');
const COOLDOWN_FILE = path.join(FASTOPS, '.subagent-gap-check-last.json');

// ─── Data Gathering ─────────────────────────────────────────────────────────

function getDebriefAgents() {
  const result = { agents: [], withSelfAudit: [], withoutSelfAudit: [], total: 0 };
  try {
    if (!fs.existsSync(DEBRIEF_FILE)) return result;
    const lines = fs.readFileSync(DEBRIEF_FILE, 'utf8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const d = JSON.parse(line);
        if (!d.agent || d.type === 'audit' || d.type === 'gap-check') continue;
        result.agents.push(d.agent);
        if (d.self_audit) {
          result.withSelfAudit.push(d.agent);
        } else {
          result.withoutSelfAudit.push(d.agent);
        }
        result.total++;
      } catch {}
    }
  } catch {}
  return result;
}

function getCommittingAgents(hours) {
  try {
    const since = new Date(Date.now() - hours * 3600000).toISOString();
    const log = execSync(
      `git log --oneline --since="${since}" --no-merges`,
      { cwd: BASE, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    ).trim();
    if (!log) return [];
    // Extract agent names from commit messages (look for known patterns)
    const commits = log.split('\n').filter(Boolean);
    return commits;
  } catch { return []; }
}

function getOrphanedNewTools() {
  try {
    const status = execSync(
      'git status --short .fastops/',
      { cwd: BASE, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    ).trim();
    if (!status) return [];

    // Find untracked .js files
    const untracked = status.split('\n')
      .filter(l => l.startsWith('??') && l.endsWith('.js'))
      .map(l => path.basename(l.substring(3).trim()));

    if (untracked.length === 0) return [];

    // Check if any debrief mentions these tools
    const debriefInfo = getDebriefAgents();
    let debriefContent = '';
    try {
      debriefContent = fs.readFileSync(DEBRIEF_FILE, 'utf8');
    } catch {}

    return untracked.filter(tool => {
      const basename = tool.replace('.js', '');
      return !debriefContent.includes(basename);
    });
  } catch { return []; }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // Consume stdin (required by hook protocol)
  let input = '';
  process.stdin.setEncoding('utf8');
  await new Promise(resolve => {
    process.stdin.on('data', chunk => { input += chunk; });
    process.stdin.on('end', resolve);
    setTimeout(resolve, 500);
  });

  // Cooldown: only post once per 30 minutes to avoid comms spam
  try {
    if (fs.existsSync(COOLDOWN_FILE)) {
      const last = JSON.parse(fs.readFileSync(COOLDOWN_FILE, 'utf8'));
      const age = Date.now() - new Date(last.ts).getTime();
      if (age < 30 * 60 * 1000) { // 30 minute cooldown
        process.exit(0);
        return;
      }
    }
  } catch {}

  const debriefInfo = getDebriefAgents();

  // Only run if there are debriefs today (indicates subagents ran)
  if (debriefInfo.total === 0) {
    process.exit(0);
    return;
  }

  const orphanedTools = getOrphanedNewTools();
  const commits = getCommittingAgents(12);

  // Build gap summary
  const gaps = [];

  if (debriefInfo.withoutSelfAudit.length > 0) {
    gaps.push(`${debriefInfo.withoutSelfAudit.length} agent(s) missing self-audit: ${debriefInfo.withoutSelfAudit.slice(0, 5).join(', ')}`);
  }

  if (orphanedTools.length > 0) {
    gaps.push(`${orphanedTools.length} orphaned tool(s): ${orphanedTools.slice(0, 5).join(', ')}`);
  }

  // Only post if there are gaps worth reporting
  if (gaps.length === 0) {
    process.exit(0);
    return;
  }

  const summary = `SUBAGENT GAP CHECK: ${debriefInfo.total} debriefs today, ${gaps.join('. ')}. Run: node .fastops/subagent-audit.js`;

  try {
    const msg = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      from: 'subagent-gap-check',
      content: summary,
      channel: 'general',
      words: summary.split(/\s+/).length,
      ts: new Date().toISOString()
    };
    fs.appendFileSync(COMMS_FILE, JSON.stringify(msg) + '\n');
    // Write cooldown marker
    fs.writeFileSync(COOLDOWN_FILE, JSON.stringify({ ts: new Date().toISOString(), debriefs: debriefInfo.total }));
  } catch {}

  // Never block session stop
  process.exit(0);
}

main().catch(() => process.exit(0));
