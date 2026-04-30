#!/usr/bin/env node
/**
 * PostToolUse hook: triggers external model engagement when send.js is called.
 *
 * Reads tool_input from stdin. If the Bash command contains "comms/send.js",
 * fires comms/external-trigger.js in the background.
 *
 * Lightweight — exits fast if not a send.js call.
 */

const { execSync, spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const command = data?.tool_input?.command || '';

    // Only trigger on send.js calls
    if (!command.includes('comms/send.js')) {
      process.exit(0);
    }

    // Extract channel from command if present
    const channelMatch = command.match(/--channel\s+(\S+)/);
    const channelArg = channelMatch ? `--channel ${channelMatch[1]}` : '';

    // Fire external-trigger in background (don't block the agent)
    const triggerPath = path.join(ROOT, 'comms', 'external-trigger.js');
    const child = spawn('node', [triggerPath, ...channelArg.split(' ').filter(Boolean)], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

  } catch {
    // Don't crash the hook pipeline
  }
  process.exit(0);
});
