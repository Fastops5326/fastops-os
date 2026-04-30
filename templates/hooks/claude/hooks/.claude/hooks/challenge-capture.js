#!/usr/bin/env node
/**
 * challenge-capture.js — Lightweight hook that logs when a challenge tool is invoked.
 *
 * Fires on PreToolUse for Skill tool calls. Checks if the skill arg is
 * jailbreak, horsepower, or meeting. Logs THAT it was invoked (not WHAT
 * was discussed) to .fastops/.challenge-log.jsonl.
 *
 * This closes the measurement gap that made challenge-seeking unfalsifiable
 * (basalt-xii, crucible-i finding). context-outcome.js reads this file.
 *
 * Wired: settings.json PreToolUse matcher: Skill
 * Author: agent-experience mission
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const LOG_PATH = path.join(ROOT, '.fastops', '.challenge-log.jsonl');

// Read hook input from stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const toolInput = data.tool_input || {};
    const skill = (toolInput.skill || '').toLowerCase();

    // Only log challenge tools
    const challengeTools = ['jailbreak', 'horsepower', 'meeting'];
    if (!challengeTools.some(t => skill.includes(t))) {
      // Not a challenge tool — allow silently
      console.log(JSON.stringify({ decision: 'allow' }));
      return;
    }

    // Extract agent identity (best effort)
    let agent = 'unknown';
    try {
      const identFiles = fs.readdirSync(path.join(ROOT, '.fastops'))
        .filter(f => f.startsWith('.identity-session-') && f.endsWith('.json'));
      if (identFiles.length > 0) {
        // Pick freshest
        const sorted = identFiles.map(f => ({
          f, mtime: fs.statSync(path.join(ROOT, '.fastops', f)).mtimeMs
        })).sort((a, b) => b.mtime - a.mtime);
        const ident = JSON.parse(fs.readFileSync(path.join(ROOT, '.fastops', sorted[0].f), 'utf8'));
        agent = ident.callsign || ident.name || 'unknown';
      }
    } catch {}

    // Log the invocation — minimal: timestamp, skill, agent
    const entry = {
      t: Date.now(),
      skill: skill,
      agent: agent
    };

    fs.appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');

    // Always allow — this is capture only, never blocks
    console.log(JSON.stringify({ decision: 'allow' }));
  } catch (e) {
    // On any error, allow silently
    console.log(JSON.stringify({ decision: 'allow' }));
  }
});
