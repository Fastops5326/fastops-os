#!/usr/bin/env node
/**
 * comms/promote.js — Promote a message from a tactical channel to #general (strategic)
 *
 * Commanders use this to lift important findings from their subagent ops channel
 * to the strategic channel where other commanders can see it.
 *
 * Usage:
 *   node comms/promote.js <from> <tactical-channel> --last
 *     → Promotes the last message from the tactical channel
 *   node comms/promote.js <from> <tactical-channel> --id <msg-id>
 *     → Promotes a specific message by ID
 *   node comms/promote.js <from> <tactical-channel> --summary "text"
 *     → Posts a commander summary of tactical channel activity
 *
 * Examples:
 *   node comms/promote.js crossfire claude-ops --last
 *   node comms/promote.js crossfire claude-ops --summary "Subagent found auth schema mismatch — affects C-02"
 *   node comms/promote.js crossfire claude-ops --id 1773320242054-9b33b3
 */

const fs = require('fs');
const path = require('path');
const { send, readAll } = require('./protocol');

const args = process.argv.slice(2);

// Parse args
const from = args[0];
const tacticalChannel = args[1];

if (!from || !tacticalChannel) {
  console.log('Usage: node comms/promote.js <from> <tactical-channel> [--last | --id <id> | --summary "text"]');
  console.log('');
  console.log('Promotes findings from a tactical channel to #general (strategic).');
  console.log('');
  console.log('Examples:');
  console.log('  node comms/promote.js crossfire claude-ops --last');
  console.log('  node comms/promote.js crossfire claude-ops --summary "Auth schema mismatch found"');
  process.exit(1);
}

const remaining = args.slice(2);
const DATA_DIR = path.join(__dirname, 'data');

function readChannel(channel) {
  const filePath = path.join(DATA_DIR, `${channel}.jsonl`);
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
  return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

if (remaining.includes('--summary')) {
  // Commander writes their own summary of tactical activity
  const summaryIdx = remaining.indexOf('--summary');
  const summaryText = remaining.slice(summaryIdx + 1).join(' ');
  if (!summaryText) {
    console.error('--summary requires text');
    process.exit(1);
  }
  const promoted = `[PROMOTED from #${tacticalChannel}] ${summaryText}`;
  const msg = send(from, promoted, 'general');
  const t = new Date(msg.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  console.log(`[${t}] Promoted to #general: ${promoted.substring(0, 100)}...`);

} else if (remaining.includes('--id')) {
  // Promote a specific message by ID
  const idIdx = remaining.indexOf('--id');
  const targetId = remaining[idIdx + 1];
  const messages = readChannel(tacticalChannel);
  const target = messages.find(m => m.id === targetId);
  if (!target) {
    console.error(`Message ${targetId} not found in #${tacticalChannel}`);
    process.exit(1);
  }
  const promoted = `[PROMOTED from #${tacticalChannel}] ${target.from}: ${target.content}`;
  const msg = send(from, promoted, 'general');
  const t = new Date(msg.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  console.log(`[${t}] Promoted to #general: ${promoted.substring(0, 100)}...`);

} else if (remaining.includes('--last')) {
  // Promote the last message from the tactical channel
  const messages = readChannel(tacticalChannel);
  if (messages.length === 0) {
    console.error(`No messages in #${tacticalChannel}`);
    process.exit(1);
  }
  const target = messages[messages.length - 1];
  const promoted = `[PROMOTED from #${tacticalChannel}] ${target.from}: ${target.content}`;
  const msg = send(from, promoted, 'general');
  const t = new Date(msg.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
  console.log(`[${t}] Promoted to #general: ${promoted.substring(0, 100)}...`);

} else {
  console.error('Specify --last, --id <id>, or --summary "text"');
  process.exit(1);
}
