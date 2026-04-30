#!/usr/bin/env node
/**
 * team-talk-hook.js — Claude Code PreToolUse hook
 *
 * When team-talk is active, enforces that Claude writes to the
 * transcript before doing anything else. Also fires the doorbell
 * to Gemini once per turn.
 *
 * Does NOT extract Joel's message (PreToolUse hooks don't have
 * access to conversation history). Claude's rule file instructs
 * it to run team-talk-turn.js as its first action.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const FASTOPS = path.join(ROOT, '.fastops');
const ACTIVE_FLAG = path.join(FASTOPS, '.team-talk-active');

const allow = () => {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }));
  process.exit(0);
};

const deny = (reason) => {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  process.exit(0);
};

// Not active — allow everything
if (!fs.existsSync(ACTIVE_FLAG)) {
  allow();
}

let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || '';
    const toolInput = data.tool_input || {};

    // Always allow team-talk commands (transcript read/write, doorbell)
    if (toolName === 'Bash' || toolName === 'Shell') {
      const cmd = toolInput.command || '';
      if (cmd.includes('team-talk') || cmd.includes('cdp-target-model') || cmd.includes('cdp-screenshot')) {
        allow();
      }
    }

    // Always allow read-only tools (for QC and reasoning)
    if (['Read', 'Glob', 'Grep'].includes(toolName)) {
      allow();
    }

    // Check if Claude has written to the transcript this turn
    let status;
    try {
      const statusOut = execSync(
        `node "${path.join(FASTOPS, 'team-talk.js')}" --status`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }
      );
      status = JSON.parse(statusOut);
    } catch (e) {
      allow(); // Don't block if status check fails
    }

    if (status && status.joelAsked && !status.claudeResponded) {
      // Claude hasn't written to the transcript yet — block non-essential tools
      deny(
        'TEAM TALK: You must run team-talk-turn.js first, then write your response to the transcript.\n' +
        '1. node .fastops/team-talk-turn.js --message "JOEL_MESSAGE" --from claude\n' +
        '2. Respond to Joel\n' +
        '3. node .fastops/team-talk.js --write --role claude --content "YOUR_RESPONSE"'
      );
    }

    allow();
  } catch (err) {
    allow(); // Never hard-block on errors
  }
});
