#!/usr/bin/env node
/**
 * FastOps Priority Messages — File-backed persistent ambient messages
 *
 * NOT an interrupt. Honest naming: these are ambient messages with persistence.
 * They get re-injected into PreToolUse additionalContext on every tool call
 * until acknowledged. Survives compaction (re-read from file, not context).
 *
 * Design rationale (3-round jailbreak, Block 9):
 * - True interrupts are architecturally impossible for LLM agents
 * - Agents lack temporal consciousness between tool calls
 * - But some messages MUST persist across compaction (urgent coordination)
 * - Solution: file-backed messages re-injected until ack'd
 *
 * Usage:
 *   node comms/priority.js send <target-session-id> <from> <message>
 *   node comms/priority.js check <session-id>
 *   node comms/priority.js ack <session-id>
 *   node comms/priority.js list
 */

const fs = require('fs');
const path = require('path');

const PRIORITY_DIR = path.resolve(__dirname, '..', '.fastops', 'priority');

function ensureDir() {
  if (!fs.existsSync(PRIORITY_DIR)) fs.mkdirSync(PRIORITY_DIR, { recursive: true });
}

function msgFile(sessionId) {
  return path.join(PRIORITY_DIR, `${sessionId}.msg`);
}

function ackFile(sessionId) {
  return path.join(PRIORITY_DIR, `${sessionId}.ack`);
}

/**
 * Send a priority message to a target session.
 * Overwrites any existing unacknowledged message (latest wins).
 */
function sendPriority(targetSessionId, from, content) {
  ensureDir();
  const msg = {
    from,
    content,
    target: targetSessionId,
    ts: new Date().toISOString()
  };
  fs.writeFileSync(msgFile(targetSessionId), JSON.stringify(msg, null, 2));

  // Clear any previous ack
  const ack = ackFile(targetSessionId);
  if (fs.existsSync(ack)) fs.unlinkSync(ack);

  return msg;
}

/**
 * Check for a pending priority message for this session.
 * Returns the message object or null.
 * Called by gate.js on every tool call for re-injection.
 */
function checkPriority(sessionId) {
  const mf = msgFile(sessionId);
  const af = ackFile(sessionId);

  if (!fs.existsSync(mf)) return null;
  if (fs.existsSync(af)) return null; // already acknowledged

  try {
    return JSON.parse(fs.readFileSync(mf, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Acknowledge a priority message (stops re-injection).
 */
function acknowledge(sessionId) {
  ensureDir();
  fs.writeFileSync(ackFile(sessionId), new Date().toISOString());
}

/**
 * List all pending (unacknowledged) priority messages.
 */
function listPending() {
  ensureDir();
  const files = fs.readdirSync(PRIORITY_DIR).filter(f => f.endsWith('.msg'));
  const pending = [];

  for (const file of files) {
    const sessionId = file.replace('.msg', '');
    const af = ackFile(sessionId);
    if (fs.existsSync(af)) continue;

    try {
      const msg = JSON.parse(fs.readFileSync(path.join(PRIORITY_DIR, file), 'utf8'));
      pending.push(msg);
    } catch {}
  }

  return pending;
}

module.exports = { sendPriority, checkPriority, acknowledge, listPending, PRIORITY_DIR };

// --- CLI ---
if (require.main === module) {
  const [,, cmd, ...args] = process.argv;

  switch (cmd) {
    case 'send': {
      const [target, from, ...rest] = args;
      const content = rest.join(' ');
      if (!target || !from || !content) {
        console.error('Usage: node comms/priority.js send <target-session-id> <from> <message>');
        process.exit(1);
      }
      const msg = sendPriority(target, from, content);
      console.log(`[PRIORITY] Sent to ${target}: ${content.substring(0, 80)}`);
      break;
    }
    case 'check': {
      const [sessionId] = args;
      if (!sessionId) { console.error('Usage: node comms/priority.js check <session-id>'); process.exit(1); }
      const msg = checkPriority(sessionId);
      if (msg) {
        console.log(`[PRIORITY] From ${msg.from} (${msg.ts}): ${msg.content}`);
      } else {
        console.log('No pending priority messages.');
      }
      break;
    }
    case 'ack': {
      const [sessionId] = args;
      if (!sessionId) { console.error('Usage: node comms/priority.js ack <session-id>'); process.exit(1); }
      acknowledge(sessionId);
      console.log(`Acknowledged priority message for ${sessionId}`);
      break;
    }
    case 'list': {
      const pending = listPending();
      if (pending.length === 0) {
        console.log('No pending priority messages.');
      } else {
        console.log(`${pending.length} pending priority message(s):`);
        pending.forEach(m => {
          console.log(`  → ${m.target} (from ${m.from}): ${m.content.substring(0, 80)}`);
        });
      }
      break;
    }
    default:
      console.log('FastOps Priority Messages — Persistent ambient (not interrupts)');
      console.log('');
      console.log('Commands:');
      console.log('  send <target> <from> <message>  — Send priority message');
      console.log('  check <session-id>               — Check for pending message');
      console.log('  ack <session-id>                 — Acknowledge (stop re-injection)');
      console.log('  list                             — List all pending messages');
  }
}
