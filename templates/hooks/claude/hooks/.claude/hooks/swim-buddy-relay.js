#!/usr/bin/env node
/**
 * swim-buddy-relay.js — PostToolUse hook (TodoWrite trigger)
 *
 * When the agent creates its first todo plan, this hook reads the session
 * transcript, extracts JOEL coordination messages, and posts a condensed summary to
 * comms so the swim buddy has full conversation context before work starts.
 *
 * Design rationale: TodoWrite is the natural "I understand the task, planning
 * is done, work is starting" signal. The buddy gets briefed once, not on
 * every chat message.
 *
 * send.js auto-wake handles the CDP notification to the buddy.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG = path.join(ROOT, '.fastops', '.swim-buddy-config.json');
const STATE = path.join(ROOT, '.fastops', '.swim-buddy-relay-state.json');

// Claude Code transcript location
const PROJECTS_DIR = path.join(
  process.env.USERPROFILE || process.env.HOME || '',
  '.claude', 'projects',
  'c--Users-joelb-OneDrive-Desktop-Fastops-development-process'
);

let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);

    // Only fire on TodoWrite
    if (data.tool_name !== 'TodoWrite') {
      process.exit(0);
    }

    // Check if swim buddy is configured
    if (!fs.existsSync(CONFIG)) {
      process.exit(0);
    }
    const buddy = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    if (!buddy.name) {
      process.exit(0);
    }

    // Rate limit: only relay once per 10 minutes
    const now = Date.now();
    try {
      if (fs.existsSync(STATE)) {
        const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
        if (now - (state.lastRelay || 0) < 10 * 60 * 1000) {
          process.exit(0);
        }
      }
    } catch {}

    // Find the session transcript
    const sessionId = data.session_id || '';
    if (!sessionId) {
      process.exit(0);
    }

    const transcriptPath = path.join(PROJECTS_DIR, sessionId + '.jsonl');
    if (!fs.existsSync(transcriptPath)) {
      process.exit(0);
    }

    // Read tail of transcript (512KB — transcripts grow to 15MB+, need wide net)
    const stats = fs.statSync(transcriptPath);
    const readSize = Math.min(stats.size, 512 * 1024);
    const fd = fs.openSync(transcriptPath, 'r');
    const buf = Buffer.alloc(readSize);
    fs.readSync(fd, buf, 0, readSize, Math.max(0, stats.size - readSize));
    fs.closeSync(fd);

    const chunk = buf.toString('utf8');
    const firstNl = chunk.indexOf('\n');
    const clean = (stats.size > readSize && firstNl >= 0)
      ? chunk.substring(firstNl + 1) : chunk;
    const lines = clean.split('\n').filter(Boolean);

    // Extract JOEL coordination messages (userType: "external", type: "text" content)
    const humanMessages = [];
    for (const line of lines) {
      try {
        const m = JSON.parse(line);
        if (m.type !== 'user' || m.userType !== 'external') continue;
        const content = m.message?.content;
        if (!content) continue;

        let text = '';
        if (Array.isArray(content)) {
          text = content
            .filter(c => c.type === 'text' && !c.tool_use_id)
            .map(c => c.text)
            .join(' ')
            .trim();
        } else if (typeof content === 'string') {
          text = content.trim();
        }

        // Skip trivial messages (continue, ok, yes, etc.)
        if (text.length > 20 && !/^(continue|ok|yes|no|go|proceed|do it)\.?$/i.test(text.trim())) {
          humanMessages.push(text);
        }
      } catch {}
    }

    if (humanMessages.length === 0) {
      process.exit(0);
    }

    // Take last 5 human messages, truncate each to 200 chars
    const recent = humanMessages.slice(-5).map(
      m => m.length > 200 ? m.substring(0, 197) + '...' : m
    );

    // Get agent identity
    let agentName = 'claude';
    try {
      const agentsDir = path.join(ROOT, 'comms', 'data', '.agents');
      const sidFile = path.join(agentsDir, `sid-${sessionId}.json`);
      if (fs.existsSync(sidFile)) {
        const sid = JSON.parse(fs.readFileSync(sidFile, 'utf8'));
        agentName = sid.name || agentName;
      }
    } catch {}

    // Post summary to comms via temp file (avoids shell escaping issues with newlines)
    const summary = `[PEER COORDINATION RELAY] JOEL coordination relay for ${agentName}:\n` +
      recent.map((m, i) => `  ${i + 1}. ${m}`).join('\n') +
      `\n\nWork is starting. ${buddy.name}: check comms for full context. Over.`;

    const tmpFile = path.join(ROOT, '.fastops', '.swim-buddy-relay.tmp');
    fs.writeFileSync(tmpFile, summary);
    execSync(
      `node comms/send.js ${agentName} "$(cat .fastops/.swim-buddy-relay.tmp)"`,
      { cwd: ROOT, timeout: 10000, stdio: 'ignore', shell: 'bash' }
    );

    // Update state
    fs.writeFileSync(STATE, JSON.stringify({
      lastRelay: now,
      messageCount: recent.length
    }));

  } catch {}
  process.exit(0);
});
