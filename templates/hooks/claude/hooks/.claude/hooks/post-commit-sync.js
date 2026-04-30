#!/usr/bin/env node
/**
 * post-commit-sync.js — Auto-update mission files after git commits
 *
 * PostToolUse hook on Bash. Detects successful git commits and:
 *   1. Maps changed files → mission (deliverables/VRBO* → client-work, etc.)
 *   2. Calls mission-update.js with the detected mission
 *   3. Mission file gets a structured successor note appended automatically
 *
 * WHY THIS EXISTS:
 *   mission-update.js already does everything — detection, formatting, dedup,
 *   cross-mission refs, pruning. But it only fires at handoff (session end).
 *   Missions go stale mid-session because no agent remembers to update them.
 *   This hook makes it automatic: commit → mission updated. Zero agent overhead.
 *
 * DESIGN:
 *   - Fires PostToolUse on Bash (detects "git commit" in output)
 *   - Debounced: only fires once per 5 minutes to avoid spam
 *   - Maps files to missions using a simple prefix table
 *   - Falls back to mission-update.js auto-detection if no prefix match
 *   - Silent on failure — never blocks the agent
 *
 * citadel-xxxiii, Client Work mission. "Ship code, commit, mission updates itself."
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = path.resolve(__dirname, '..', '..');
const FASTOPS = path.join(BASE, '.fastops');
const DEBOUNCE_FILE = path.join(FASTOPS, '.post-commit-sync-last.json');
const DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes

// ─── File-to-Mission Mapping ────────────────────────────────────────────────
// Maps file path prefixes to mission IDs. More specific prefixes win.
const FILE_MISSION_MAP = [
  { prefix: 'deliverables/VRBO', mission: 'client-work' },
  { prefix: 'deliverables/WORLD-CUP', mission: 'client-work' },
  { prefix: 'deliverables/ANTHROPIC', mission: 'external-relations' },
  { prefix: 'deliverables/EVIDENCE', mission: 'external-relations' },
  { prefix: 'missions/warriorpath/', mission: 'warriorpath' },
  { prefix: 'missions/fastops-product/', mission: 'fastops-product' },
  { prefix: 'missions/client-work/', mission: 'client-work' },
  { prefix: 'missions/culture/', mission: 'culture' },
  { prefix: 'missions/agent-experience/', mission: 'agent-experience' },
  { prefix: 'missions/bootup-audit/', mission: 'bootup-audit' },
  { prefix: 'missions/external-relations/', mission: 'external-relations' },
  { prefix: 'missions/knowledge-management/', mission: 'knowledge-management' },
  { prefix: 'missions/ui-visual/', mission: 'ui-visual' },
  { prefix: 'missions/startupos/', mission: 'startupos' },
  { prefix: 'missions/devops/', mission: 'devops' },
  { prefix: 'missions/agents-choice/', mission: 'agents-choice' },
  { prefix: 'missions/security/', mission: 'security' },
  { prefix: 'missions/overwatch/', mission: 'overwatch' },
  { prefix: '.fastops/', mission: null }, // infrastructure — let mission-update.js auto-detect
  { prefix: '.claude/', mission: null },  // same
];

function main() {
  try {
    // Read hook input from stdin
    let input = '';
    try {
      input = fs.readFileSync(0, 'utf-8');
    } catch { return; }

    let data;
    try {
      data = JSON.parse(input);
    } catch { return; }

    // Only fire on Bash tool results that look like successful git commits
    const output = data?.tool_result?.stdout || data?.tool_result?.content || '';
    if (typeof output !== 'string') return;

    // Detect git commit success patterns
    const isCommit = /\[[\w-]+ [a-f0-9]+\]/.test(output) &&
                     (output.includes('file changed') || output.includes('files changed') ||
                      output.includes('insertion') || output.includes('deletion'));
    if (!isCommit) return;

    // Debounce — don't fire more than once per 5 minutes
    try {
      if (fs.existsSync(DEBOUNCE_FILE)) {
        const last = JSON.parse(fs.readFileSync(DEBOUNCE_FILE, 'utf-8'));
        if (Date.now() - last.ts < DEBOUNCE_MS) return;
      }
    } catch {}

    // Extract commit hash from output
    const hashMatch = output.match(/\[[\w-]+ ([a-f0-9]+)\]/);
    const commitHash = hashMatch ? hashMatch[1] : 'HEAD';

    // Get files changed in this commit
    let changedFiles = [];
    try {
      const diff = execSync(`git diff-tree --no-commit-id --name-only -r ${commitHash} 2>/dev/null`,
        { cwd: BASE, encoding: 'utf-8', timeout: 5000 });
      changedFiles = diff.trim().split('\n').filter(f => f.trim());
    } catch {
      // Fallback: try HEAD
      try {
        const diff = execSync('git diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null',
          { cwd: BASE, encoding: 'utf-8', timeout: 5000 });
        changedFiles = diff.trim().split('\n').filter(f => f.trim());
      } catch { return; }
    }

    if (changedFiles.length === 0) return;

    // Map files to mission
    let detectedMission = null;
    const missionVotes = {};

    for (const file of changedFiles) {
      const normalized = file.replace(/\\/g, '/');
      for (const mapping of FILE_MISSION_MAP) {
        if (normalized.startsWith(mapping.prefix) && mapping.mission) {
          missionVotes[mapping.mission] = (missionVotes[mapping.mission] || 0) + 1;
          break;
        }
      }
    }

    // Pick the mission with most file votes
    if (Object.keys(missionVotes).length > 0) {
      detectedMission = Object.entries(missionVotes)
        .sort((a, b) => b[1] - a[1])[0][0];
    }

    // Skip if we only changed infrastructure files and couldn't detect a mission
    if (!detectedMission) return;

    // Skip if the commit is TO the mission file itself (avoid loops)
    const missionFileChanged = changedFiles.some(f =>
      f.replace(/\\/g, '/') === `missions/${detectedMission}/MISSION.md`
    );
    // If ONLY the mission file changed, skip (that's a manual update, not a deliverable)
    if (missionFileChanged && changedFiles.length === 1) return;

    // Update debounce timestamp
    fs.writeFileSync(DEBOUNCE_FILE, JSON.stringify({ ts: Date.now(), mission: detectedMission, commit: commitHash }));

    // ─── Auto-Broadcast to Comms ──────────────────────────────────────────────
    // Every commit that touches a mission gets a comms post.
    // This is how other agents find out what happened — gate.js injects
    // recent comms into every agent's context via system-reminders.
    // No agent has to remember to post. It just happens.
    try {
      // Extract commit message
      let commitMsg = '';
      try {
        commitMsg = execSync(`git log -1 --format=%s ${commitHash} 2>/dev/null`,
          { cwd: BASE, encoding: 'utf-8', timeout: 5000 }).trim();
      } catch {
        commitMsg = output.split('\n')[0].substring(0, 100);
      }

      // Get agent name
      let agentName = 'unknown';
      try {
        const agentsDir = path.join(BASE, 'comms', 'data', '.agents');
        const agentFiles = fs.readdirSync(agentsDir)
          .filter(f => f.startsWith('sid-') && f.endsWith('.json'))
          .map(f => ({ name: f, mtime: fs.statSync(path.join(agentsDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        if (agentFiles.length > 0) {
          const data = JSON.parse(fs.readFileSync(path.join(agentsDir, agentFiles[0].name), 'utf-8'));
          agentName = data.name || data.agent_name || 'unknown';
        }
      } catch {}

      // Build concise broadcast message
      const fileList = changedFiles.slice(0, 3).join(', ');
      const moreFiles = changedFiles.length > 3 ? ` +${changedFiles.length - 3} more` : '';
      const broadcastMsg = `COMMIT [${detectedMission}]: ${commitMsg} (${fileList}${moreFiles})`;

      // Post to comms via send.js
      const sendPath = path.join(BASE, 'comms', 'send.js');
      if (fs.existsSync(sendPath)) {
        const { spawn } = require('child_process');
        const child = spawn('node', [sendPath, agentName, broadcastMsg, '--channel', detectedMission], {
          cwd: BASE,
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
      }
    } catch {
      // Silent — comms broadcast is best-effort
    }

    // ─── Update Mission File ──────────────────────────────────────────────────
    const missionUpdatePath = path.join(FASTOPS, 'mission-update.js');
    if (!fs.existsSync(missionUpdatePath)) return;

    try {
      execSync(`node "${missionUpdatePath}" --mission ${detectedMission}`, {
        cwd: BASE,
        encoding: 'utf-8',
        timeout: 15000,
        stdio: 'pipe',
      });
    } catch (e) {
      // Silent failure — never block the agent
      try {
        fs.appendFileSync(path.join(FASTOPS, '.post-commit-sync.log'),
          `${new Date().toISOString()} | FAIL | mission=${detectedMission} commit=${commitHash} err=${e.message?.substring(0, 100)}\n`
        );
      } catch {}
    }

  } catch {
    // Top-level catch — hooks must never crash
  }
}

main();
