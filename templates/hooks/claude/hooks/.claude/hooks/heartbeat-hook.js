#!/usr/bin/env node
/**
 * heartbeat-hook.js — PostToolUse wrapper for heartbeat.js
 * Emits a heartbeat on every tool call for watchdog liveness detection.
 */
'use strict';
const path = require('path');
const hbPath = path.join(__dirname, '..', '..', '.fastops', 'heartbeat.js');

let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  try {
    const { beat } = require(hbPath);
    const data = JSON.parse(input);
    const tool = data.tool_name || 'unknown';
    const agent = process.env.CLAUDE_AGENT_NAME || 'claude';
    beat(agent, 'working', tool);
  } catch {}
  // PostToolUse hooks don't gate — always succeed silently
  process.exit(0);
});
