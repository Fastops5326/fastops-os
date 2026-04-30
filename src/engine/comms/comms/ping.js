#!/usr/bin/env node
/**
 * FastOps Comms — Ping an Agent
 *
 * Writes a ping flag file that the PreToolUse ping-gate hook will detect.
 * When the target agent makes their next tool call, the hook blocks them
 * with the ping message, forcing acknowledgment before they can continue.
 *
 * Usage:
 *   node comms/ping.js <target-agent> <reason>
 *   node comms/ping.js Sextant "HANDOFF — team needs your deliverables"
 *   node comms/ping.js Azimuth "Joel needs status update"
 *
 * Clear a ping (used by the hook after acknowledgment):
 *   node comms/ping.js --clear <target-agent>
 *
 * List active pings:
 *   node comms/ping.js --list
 */

const fs = require('fs');
const path = require('path');

const FASTOPS_DIR = path.join(process.cwd(), '.fastops');
const PING_PREFIX = '.ping-';

function getPingFile(agentName) {
  return path.join(FASTOPS_DIR, `${PING_PREFIX}${agentName.toLowerCase()}.json`);
}

function listPings() {
  try {
    const files = fs.readdirSync(FASTOPS_DIR).filter(f => f.startsWith(PING_PREFIX));
    if (files.length === 0) {
      console.log('No active pings.');
      return;
    }
    for (const f of files) {
      const data = JSON.parse(fs.readFileSync(path.join(FASTOPS_DIR, f), 'utf-8'));
      const age = Math.round((Date.now() - new Date(data.ts).getTime()) / 1000);
      console.log(`  ${data.target} — from ${data.from}: "${data.reason}" (${age}s ago)`);
    }
  } catch (e) {
    console.error('Error listing pings:', e.message);
  }
}

function clearPing(agentName) {
  const file = getPingFile(agentName);
  try {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log(`Cleared ping for ${agentName}`);
    } else {
      console.log(`No active ping for ${agentName}`);
    }
  } catch (e) {
    console.error('Error clearing ping:', e.message);
  }
}

function sendPing(from, target, reason) {
  const file = getPingFile(target);
  const ping = {
    from,
    target,
    reason,
    ts: new Date().toISOString(),
    senderPpid: process.ppid, // Used by hook to skip showing ping to sender
  };

  try {
    fs.mkdirSync(FASTOPS_DIR, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(ping, null, 2));
    console.log(`PING sent to ${target}: "${reason}"`);
    console.log(`${target}'s next tool call will be blocked until they acknowledge.`);
  } catch (e) {
    console.error('Error sending ping:', e.message);
  }
}

// --- CLI ---
const args = process.argv.slice(2);

if (args[0] === '--list') {
  listPings();
} else if (args[0] === '--clear') {
  if (!args[1]) { console.log('Usage: node comms/ping.js --clear <agent-name>'); process.exit(1); }
  clearPing(args[1]);
} else if (args.length >= 2) {
  // Detect who is pinging: session-keyed identity (shared module — Session 141 fix)
  let from = 'Joel';
  try {
    const { getAgentName } = require(path.join(__dirname, '..', '.claude', 'hooks', 'lib', 'identity'));
    const resolved = getAgentName();
    if (resolved && resolved !== 'unknown') from = resolved;
  } catch {}

  const target = args[0];
  const reason = args.slice(1).join(' ');
  sendPing(from, target, reason);
} else {
  console.log('Usage: node comms/ping.js <target-agent> <reason>');
  console.log('       node comms/ping.js --clear <agent-name>');
  console.log('       node comms/ping.js --list');
  console.log('');
  console.log('Examples:');
  console.log('  node comms/ping.js Sextant "HANDOFF — need your deliverables"');
  console.log('  node comms/ping.js Azimuth "Joel needs status update"');
  console.log('  node comms/ping.js --list');
  process.exit(1);
}
