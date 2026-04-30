#!/usr/bin/env node
/**
 * overwatch-gate-hook.js — PreToolUse: hard lock until Overwatch clears gate (or fallback).
 * Not registered in .claude/settings.json by default; opt-in by re-adding the hook + FASTOPS_OVERWATCH_GATE=1.
 *
 * Fail-open on any thrown error (broken gate must not brick the session).
 *
 * Matcher (settings.json): Write|Edit|Bash|Task|Skill|TodoWrite
 * Not matched: Read, Grep, Glob — agents can still read docs while locked.
 */

'use strict';

const path = require('path');
const {
  evaluateGate,
  isBashAllowedWhenLocked,
  canonicalSessionId,
} = require(path.join(__dirname, '..', '..', '.fastops', 'overwatch-gate.js'));

const FAIL_OPEN = JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
  },
});

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
}


let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inputData += chunk;
});
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(inputData || '{}');
    const toolName = data.tool_name || '';
    const toolInput = data.tool_input || {};
    const sessionId = canonicalSessionId(data.session_id || '');

    const { open, reason, state } = evaluateGate(sessionId);

    if (open) {
      process.stdout.write(FAIL_OPEN);
      process.exit(0);
      return;
    }

    if (toolName === 'Bash') {
      const cmd = toolInput.command || '';
      if (isBashAllowedWhenLocked(cmd)) {
        process.stdout.write(FAIL_OPEN);
        process.exit(0);
        return;
      }
    }

    const pings = state?.cdpPingsUnanswered ?? 0;
    const msg = [
      '[OVERWATCH GATE] Session is locked until Overwatch clears onboarding.',
      `Reason: ${reason}.`,
      'Post on comms + CDP wake Overwatch; Overwatch replies with a line containing:',
      `[GATE CLEAR session:${sessionId}]`,
      `If Overwatch is unreachable, CDP pings to Overwatch count toward fallback (${pings}/5 — at 5, gate opens automatically). Wait ≥30s between each ping; rapid-fire does not count.`,
      'Joel: FASTOPS_OVERWATCH_GATE_OVERRIDE=1 or touch .fastops/.overwatch-gate-override',
      'Gate is off by default; opt-in: FASTOPS_OVERWATCH_GATE=1 + hook in settings.',
    ].join(' ');

    deny(msg);
    process.exit(0);
  } catch (e) {
    process.stdout.write(FAIL_OPEN);
    process.exit(0);
  }
});
