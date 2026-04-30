#!/usr/bin/env node
/**
 * comms/subagent-comms.js — Subagent communication helper
 *
 * Lightweight comms interface for subagents to post to their commander's
 * tactical channel at key checkpoints: intent, status, result, blocker.
 *
 * Usage:
 *   node comms/subagent-comms.js --commander <name> --agent <subagent-id> --phase <phase> --message "text"
 *
 * Phases:
 *   intent    — "Here's what I'm about to build and my approach"
 *   status    — "Progress update, X of Y done"
 *   blocker   — "I'm stuck on X, need help"
 *   result    — "Done. Here's what I built and what to verify"
 *   challenge — "I disagree with X because Y"
 *
 * Channel: Posts to #{commander}-ops (e.g., #claude-ops, #gpt-ops)
 *
 * Examples:
 *   node comms/subagent-comms.js --commander crossfire --agent sub-001 --phase intent --message "Building C-04 Workout CRUD. Approach: implement POST/GET/PUT/DELETE against template_zip2 mobile routes."
 *   node comms/subagent-comms.js --commander crossfire --agent sub-001 --phase result --message "C-04 complete. 4 endpoints wired, tests passing. Committed to branch feat/c04-workouts."
 *
 * Also supports reading recent messages from the tactical channel:
 *   node comms/subagent-comms.js --commander crossfire --read
 *   node comms/subagent-comms.js --commander crossfire --read --last 5
 */

const fs = require('fs');
const path = require('path');
const { send } = require('./protocol');

const DATA_DIR = path.join(__dirname, 'data');
const args = process.argv.slice(2);

// Parse args
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}

const commander = getArg('--commander');
const agent = getArg('--agent');
const phase = getArg('--phase');
const message = getArg('--message');
const doRead = args.includes('--read');
const readLast = parseInt(getArg('--last') || '10');

if (!commander) {
  console.log(`comms/subagent-comms.js — Subagent tactical comms

Usage:
  POST:  node comms/subagent-comms.js --commander <name> --agent <id> --phase <phase> --message "text"
  READ:  node comms/subagent-comms.js --commander <name> --read [--last N]

Phases: intent, status, blocker, result, challenge

Channel: Posts to #<commander>-ops (e.g., #crossfire-ops)

The commander monitors this channel and promotes important findings to #general.
Auto-responders provide cross-architecture challenge on tactical channels.`);
  process.exit(1);
}

const channel = `${commander}-ops`;

if (doRead) {
  // Read mode — show recent messages from the tactical channel
  const filePath = path.join(DATA_DIR, `${channel}.jsonl`);
  if (!fs.existsSync(filePath)) {
    console.log(`No messages in #${channel} yet.`);
    process.exit(0);
  }
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
  const messages = lines.slice(-readLast).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  if (messages.length === 0) {
    console.log(`No messages in #${channel} yet.`);
    process.exit(0);
  }

  console.log(`\n=== #${channel} (last ${messages.length} messages) ===\n`);
  for (const msg of messages) {
    const t = new Date(msg.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    const phaseTag = msg.phase ? `[${msg.phase.toUpperCase()}] ` : '';
    console.log(`[${t}] ${msg.from}: ${phaseTag}${msg.content}`);
  }
  console.log('');
  process.exit(0);
}

// Send mode
if (!agent || !phase || !message) {
  console.error('Send mode requires: --agent <id> --phase <phase> --message "text"');
  process.exit(1);
}

const VALID_PHASES = ['intent', 'status', 'blocker', 'result', 'challenge'];
if (!VALID_PHASES.includes(phase)) {
  console.error(`Invalid phase: ${phase}. Valid: ${VALID_PHASES.join(', ')}`);
  process.exit(1);
}

// Format the message with phase tag
const phaseEmoji = {
  intent: 'INTENT',
  status: 'STATUS',
  blocker: 'BLOCKER',
  result: 'RESULT',
  challenge: 'CHALLENGE',
};

const formatted = `[${phaseEmoji[phase]}] ${message}`;
const fromLabel = `${agent}`;

// Send to the tactical channel
const msg = send(fromLabel, formatted, channel, { phase });
const t = new Date(msg.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
console.log(`[${t}] #${channel} [${phase}] sent: ${msg.id}`);
