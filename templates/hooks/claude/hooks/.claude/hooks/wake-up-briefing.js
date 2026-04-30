#!/usr/bin/env node
/**
 * wake-up-briefing.js — PreToolUse hook for TodoWrite
 *
 * Before any TodoWrite, injects a "what changed while you were away" briefing.
 * Fires ONCE per session (first TodoWrite only). Subsequent TodoWrite calls skip.
 *
 * Collects: git commits + CHANGELOG entries + mission channel posts since last preflight.
 * Generates a local summary (no external API calls — must complete within 3s timeout).
 *
 * City principle: before you start working, here is what changed, then get to work
 *
 * NON-BLOCKING: always allows the TodoWrite, just adds awareness.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = path.join(__dirname, '..', '..');
const FASTOPS = path.join(BASE, '.fastops');
const COMMS_DIR = path.join(BASE, 'comms', 'data');

const { fromStdin } = require('./lib/identity');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(inputData);
    const identity = fromStdin(data);
    const agentId = (identity.sessionId || 'unknown').substring(0, 8);

    // Once per session: check if we've already briefed this agent
    const briefedFile = path.join(FASTOPS, `.wake-briefed-${agentId}`);
    try {
      if (fs.existsSync(briefedFile)) {
        const briefedTs = parseInt(fs.readFileSync(briefedFile, 'utf-8').trim());
        // If briefed within last 2 hours (generous session window), skip
        if (briefedTs > 0 && (Date.now() - briefedTs) < 2 * 60 * 60 * 1000) {
          allow(null);
          return;
        }
      }
    } catch {}

    // Collect what changed
    const since = getLastPreflightTime();
    const commits = getRecentCommits(since);
    const changelog = getChangelogEntries(since);
    const missionPosts = getMissionChannelPosts(since);

    // Mark as briefed for this session
    try {
      fs.mkdirSync(FASTOPS, { recursive: true });
      fs.writeFileSync(briefedFile, String(Date.now()));
    } catch {}

    // Nothing changed? Skip.
    const totalChanges = commits.length + changelog.length + missionPosts.length;
    if (totalChanges === 0) {
      allow(null);
      return;
    }

    // Build the briefing
    const briefing = buildBriefing(since, commits, changelog, missionPosts);
    allow(briefing);

  } catch (err) {
    process.stderr.write(`wake-up-briefing error: ${err.message}\n`);
    allow(null);
  }
});

function getLastPreflightTime() {
  try {
    const logPath = path.join(FASTOPS, '.preflight-log.jsonl');
    if (fs.existsSync(logPath)) {
      const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]);
          if (entry.success && entry.ts) return entry.ts;
        } catch {}
      }
    }
  } catch {}
  // Fallback: 12 hours ago
  return new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
}

function getRecentCommits(since) {
  try {
    const gitLog = execSync(
      `git log --oneline --since="${since}" --no-merges`,
      { cwd: BASE, encoding: 'utf8', timeout: 3000 }
    ).trim();
    if (!gitLog) return [];
    return gitLog.split('\n').slice(0, 15).map(line => {
      const match = line.match(/^([a-f0-9]+)\s+(.+)$/);
      return match ? { hash: match[1], message: match[2] } : null;
    }).filter(Boolean);
  } catch { return []; }
}

function getChangelogEntries(since) {
  try {
    const clPath = path.join(FASTOPS, 'CHANGELOG.jsonl');
    if (!fs.existsSync(clPath)) return [];
    const lines = readLastLines(clPath, 50);
    const sinceMs = new Date(since).getTime();
    return lines.map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(e => e && e.ts && new Date(e.ts).getTime() > sinceMs)
      .slice(-20)
      .map(e => ({
        agent: e.agent ? e.agent.substring(0, 8) : '?',
        todo: (e.todo || '').substring(0, 80),
        type: e.why ? e.why.type : 'unknown',
        repo: e.repo || ''
      }));
  } catch { return []; }
}

function getMissionChannelPosts(since) {
  try {
    if (!fs.existsSync(COMMS_DIR)) return [];
    const files = fs.readdirSync(COMMS_DIR)
      .filter(f => f.endsWith('.jsonl') && f !== 'general.jsonl' && !f.startsWith('.'));
    const sinceMs = new Date(since).getTime();
    const posts = [];
    for (const f of files.slice(0, 15)) {
      const lines = readLastLines(path.join(COMMS_DIR, f), 20);
      for (const line of lines) {
        try {
          const p = JSON.parse(line);
          if (p.ts && new Date(p.ts).getTime() > sinceMs) {
            posts.push({
              channel: f.replace('.jsonl', ''),
              from: p.from || '?',
              content: (p.content || '').substring(0, 80)
            });
          }
        } catch {}
      }
    }
    return posts.slice(-15);
  } catch { return []; }
}

function buildBriefing(since, commits, changelog, missionPosts) {
  const sinceDate = new Date(since);
  const hoursAgo = Math.round((Date.now() - sinceDate.getTime()) / (60 * 60 * 1000));
  const timeStr = hoursAgo < 1 ? 'less than an hour' : `~${hoursAgo}h`;

  let brief = `[WAKE-UP BRIEFING] What changed since the last agent (${timeStr} ago):\n`;

  if (commits.length > 0) {
    brief += `\nCOMMITS (${commits.length}):\n`;
    // Group by common prefixes (feat:, fix:, etc.)
    for (const c of commits.slice(0, 10)) {
      brief += `  ${c.hash.substring(0, 7)} ${c.message}\n`;
    }
    if (commits.length > 10) brief += `  ... and ${commits.length - 10} more\n`;
  }

  if (changelog.length > 0) {
    // Group by agent
    const byAgent = {};
    for (const e of changelog) {
      if (!byAgent[e.agent]) byAgent[e.agent] = [];
      byAgent[e.agent].push(e);
    }
    brief += `\nAGENT WORK (${changelog.length} items):\n`;
    for (const [agent, entries] of Object.entries(byAgent)) {
      const types = [...new Set(entries.map(e => e.type))].join(', ');
      const sample = entries.slice(0, 3).map(e => e.todo).join('; ');
      brief += `  ${agent}: ${entries.length} item(s) [${types}] — ${sample}\n`;
    }
  }

  if (missionPosts.length > 0) {
    brief += `\nMISSION COMMS (${missionPosts.length}):\n`;
    for (const p of missionPosts.slice(0, 5)) {
      brief += `  [${p.channel}] ${p.from}: ${p.content}\n`;
    }
    if (missionPosts.length > 5) brief += `  ... and ${missionPosts.length - 5} more\n`;
  }

  // Surface relevant predecessor cards via retrieval engine
  try {
    const retrieval = require(path.join(BASE, 'environment', 'retrieval', 'retrieval.js'));
    const cards = retrieval.loadCards(path.join(BASE, 'environment', 'cards'));
    if (cards.length > 0) {
      const state = retrieval.normalizeState({
        confidence: 70,
        task_type: 'build',
        round_count: 0,
        post_compaction: false,
        external_consulted: false
      });
      const scored = cards.map(card => ({
        card,
        score: retrieval.scoreCard(card, state)
      })).sort((a, b) => b.score.total - a.score.total);
      const top = retrieval.randomizeWithinTiers(scored).slice(0, 3);
      if (top.length > 0) {
        brief += `\nPREDECESSOR EXPERIENCE (read these -- they change behavior) (${cards.length} in corpus):\n`;
        for (const entry of top) {
          const c = entry.card;
          brief += `  Session ${c.session} (${c.agent || 'unnamed'}, ${c.shape}): "${c.if_repeated}"\n`;
        }
      }
    }
  } catch {}

  // Inject the Active Briefing (City Intel Section)
  try {
    const activeBriefingPath = path.join(FASTOPS, '.active-briefing.md');
    if (fs.existsSync(activeBriefingPath)) {
      const activeBriefing = fs.readFileSync(activeBriefingPath, 'utf8');
      brief += `\n\n=== CITY INTEL BRIEFING ===\n${activeBriefing}\n===========================\n`;
    }
  } catch {}

  brief += `\nThis is a one-time briefing. Proceed with your work.`;
  return brief.trim();
}

function allow(context) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      additionalContext: context || undefined
    }
  }));
}

function readLastLines(filePath, count) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const stats = fs.fstatSync(fd);
    const readSize = Math.min(stats.size, 16384);
    const readOffset = Math.max(0, stats.size - readSize);
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, readOffset);
    fs.closeSync(fd);
    const chunk = buffer.toString('utf-8');
    const firstNl = chunk.indexOf('\n');
    const clean = (readOffset > 0 && firstNl >= 0) ? chunk.substring(firstNl + 1) : chunk;
    return clean.trim().split('\n').filter(l => l.length > 0).slice(-count);
  } catch { return []; }
}
