#!/usr/bin/env node
/**
 * DEPRECATED — Use send.js (bracket conversion now built-in) or relay.js (file-drop fallback).
 *
 * This file is kept for backward compatibility only. It still works but
 * relay.js is the recommended fallback for Cursor models since it bypasses
 * shell execution entirely.
 *
 * Origin: Kimi K2.5 troubleshooting report (2026-03-11)
 */
console.error('NOTE: send-safe.js is deprecated. Use send.js or relay.js (file-drop fallback).');

const { send } = require('./protocol');

const args = process.argv.slice(2);

// Parse --channel flag
const channelIdx = args.indexOf('--channel');
let channel = 'general';
if (channelIdx !== -1) {
  channel = args[channelIdx + 1] || 'general';
  args.splice(channelIdx, 2);
}

// Parse --type flag
const typeIdx = args.indexOf('--type');
let msgType = null;
const VALID_TYPES = ['challenge', 'position', 'question'];
if (typeIdx !== -1) {
  const requested = (args[typeIdx + 1] || '').toLowerCase();
  if (VALID_TYPES.includes(requested)) {
    msgType = requested;
  }
  args.splice(typeIdx, 2);
}

const from = args[0];
let content = args.slice(1).join(' ');

if (!from || !content) {
  console.log('Usage: node comms/send-safe.js <from> <message> [--channel <channel>]');
  console.log('');
  console.log('Safe wrapper for external models (Cursor/PowerShell).');
  console.log('Handles bracket escaping, message truncation, and write retries.');
  console.log('');
  console.log('For Claude Code agents: use send.js directly instead.');
  process.exit(1);
}

// --- Fix 1: Convert bracket tags to plain text ---
// Cursor's content filter rejects messages with bracket tags like [QUESTION].
// Convert them to readable equivalents that won't trigger filtering.
const BRACKET_MAP = {
  '[ALL]': 'ALL:',
  '[QUESTION]': 'QUESTION:',
  '[SHIPPED]': 'SHIPPED:',
  '[BLOCKED]': 'BLOCKED:',
  '[URGENT]': 'URGENT:',
  '[TEST]': 'TEST:',
};

for (const [bracket, replacement] of Object.entries(BRACKET_MAP)) {
  content = content.replace(new RegExp(bracket.replace(/[[\]]/g, '\\$&'), 'gi'), replacement);
}

// --- Fix 2: Truncate long messages ---
// Messages >500 chars have higher rejection rate in Cursor.
// Truncate with indicator so the agent knows content was cut.
const MAX_LEN = 500;
if (content.length > MAX_LEN) {
  content = content.substring(0, MAX_LEN - 20) + ' [truncated by send-safe]';
}

// --- Fix 3: Send with retry ---
const opts = {};
if (msgType) opts.type = msgType;

let msg;
try {
  msg = send(from, content, channel, opts);
} catch (err) {
  // One retry on write failure (filesystem contention)
  try {
    msg = send(from, content, channel, opts);
  } catch (err2) {
    console.error('SEND FAILED (after retry): ' + err2.message);
    process.exit(1);
  }
}

const t = new Date(msg.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
const chLabel = channel !== 'general' ? ` [#${channel}]` : '';
console.log(`[${t}]${chLabel} sent: ${msg.id}`);
