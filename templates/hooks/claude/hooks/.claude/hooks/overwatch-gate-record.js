#!/usr/bin/env node
/**
 * overwatch-gate-record.js — PostToolUse (Bash): count CDP wakes toward Overwatch
 * when gate is still closed (unanswered pings). Not registered in settings.json by default.
 * Spacing: overwatch-gate.js MIN_SECONDS_BETWEEN_CDP_PINGS.
 *
 * Fail-open always.
 */

'use strict';

const path = require('path');
const { recordOverwatchCdpPing, evaluateGate } = require(path.join(__dirname, '..', '..', '.fastops', 'overwatch-gate.js'));

function isCdpToOverwatch(command) {
  const c = String(command || '');
  if (!c) return false;
  const lower = c.toLowerCase();
  if (!lower.includes('cdp-wake') && !lower.includes('cdp\\cdp-wake') && !lower.includes('/cdp-wake')) {
    return false;
  }
  // --target overwatch OR seat-4 (Overwatch seat in seat-map)
  const targetMatch = c.match(/--target[\s=]+([^\s&|;`"']+)/i);
  if (!targetMatch) return false;
  const t = targetMatch[1].toLowerCase();
  return t === 'overwatch' || t === 'seat-4' || t === 'seat_4';
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
    const sessionId = data.session_id || '';

    if (toolName !== 'Bash') {
      process.exit(0);
      return;
    }

    const cmd = toolInput.command || '';
    if (!isCdpToOverwatch(cmd)) {
      process.exit(0);
      return;
    }

    const ev = evaluateGate(sessionId);
    if (ev.open && ev.reason !== 'locked') {
      process.exit(0);
      return;
    }

    recordOverwatchCdpPing(sessionId);
  } catch (_) {
    /* fail-open */
  }
  process.exit(0);
});
