#!/usr/bin/env node
/**
 * FastOps Comms — Delivery Guarantee (P5)
 *
 * Three-layer receipt system:
 *   1. SEND receipt — already exists (send.js returns message ID)
 *   2. READ receipt — logged when an agent reads a message
 *   3. ACTION receipt — logged when an agent acts on a message
 *
 * Receipt file: comms/data/.receipts.jsonl
 *
 * Usage:
 *   node comms/receipts.js read <callsign> <message-id>
 *   node comms/receipts.js action <callsign> <message-id> <action-type> [response-id]
 *   node comms/receipts.js check <message-id>
 *   node comms/receipts.js dark <message-id> <agent1> <agent2> ...
 *   node comms/receipts.js status [--since <minutes>]
 *
 * Built by OVERWATCH during P0 Meeting build phase.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const RECEIPTS_FILE = path.join(DATA_DIR, '.receipts.jsonl');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function appendReceipt(receipt) {
  ensureDir();
  fs.appendFileSync(RECEIPTS_FILE, JSON.stringify(receipt) + '\n');
  return receipt;
}

function readAllReceipts() {
  ensureDir();
  if (!fs.existsSync(RECEIPTS_FILE)) return [];
  const raw = fs.readFileSync(RECEIPTS_FILE, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function logRead(agentCallsign, messageId) {
  return appendReceipt({
    type: 'read',
    agent: agentCallsign.toLowerCase(),
    messageId,
    ts: new Date().toISOString()
  });
}

function logAction(agentCallsign, messageId, actionType, responseId) {
  return appendReceipt({
    type: 'action',
    agent: agentCallsign.toLowerCase(),
    messageId,
    action: actionType,
    ...(responseId ? { responseId } : {}),
    ts: new Date().toISOString()
  });
}

function checkMessage(messageId) {
  const all = readAllReceipts();
  const reads = all.filter(r => r.messageId === messageId && r.type === 'read');
  const actions = all.filter(r => r.messageId === messageId && r.type === 'action');
  return { messageId, reads, actions };
}

function statusSince(minutes) {
  const cutoff = Date.now() - (minutes * 60 * 1000);
  const all = readAllReceipts();
  return all.filter(r => new Date(r.ts).getTime() > cutoff);
}

function findDark(messageId, expectedAgents) {
  const status = checkMessage(messageId);
  const readAgents = new Set(status.reads.map(r => r.agent));
  return expectedAgents
    .map(a => a.toLowerCase())
    .filter(a => !readAgents.has(a));
}

function timeSince(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// --- CLI ---
if (require.main === module) {
  const [,, cmd, ...args] = process.argv;

  switch (cmd) {
    case 'read': {
      const [agent, messageId] = args;
      if (!agent || !messageId) {
        console.error('Usage: node comms/receipts.js read <callsign> <message-id>');
        process.exit(1);
      }
      const r = logRead(agent, messageId);
      console.log(`READ: ${r.agent} confirmed read on ${r.messageId}`);
      break;
    }

    case 'action': {
      const [agent, messageId, actionType, responseId] = args;
      if (!agent || !messageId || !actionType) {
        console.error('Usage: node comms/receipts.js action <callsign> <msg-id> <type> [response-id]');
        console.error('  Types: replied | built | escalated | acked | rejected');
        process.exit(1);
      }
      const r = logAction(agent, messageId, actionType, responseId);
      console.log(`ACTION: ${r.agent} ${r.action} on ${r.messageId}`);
      break;
    }

    case 'check': {
      const [messageId] = args;
      if (!messageId) {
        console.error('Usage: node comms/receipts.js check <message-id>');
        process.exit(1);
      }
      const status = checkMessage(messageId);
      console.log(`\nDelivery: ${messageId}`);
      if (status.reads.length === 0 && status.actions.length === 0) {
        console.log('  No receipts — message may be unread.');
      } else {
        if (status.reads.length > 0) {
          console.log(`  READ (${status.reads.length}):`);
          status.reads.forEach(r => console.log(`    ${r.agent} — ${timeSince(r.ts)} ago`));
        }
        if (status.actions.length > 0) {
          console.log(`  ACTED (${status.actions.length}):`);
          status.actions.forEach(r =>
            console.log(`    ${r.agent} — ${r.action}${r.responseId ? ` -> ${r.responseId}` : ''} — ${timeSince(r.ts)} ago`));
        }
      }
      break;
    }

    case 'dark': {
      const [messageId, ...expectedAgents] = args;
      if (!messageId || expectedAgents.length === 0) {
        console.error('Usage: node comms/receipts.js dark <message-id> <agent1> <agent2> ...');
        process.exit(1);
      }
      const dark = findDark(messageId, expectedAgents);
      if (dark.length === 0) {
        console.log('All expected agents have read the message.');
      } else {
        console.log(`DARK (no read receipt on ${messageId}):`);
        dark.forEach(d => console.log(`  ${d} — NO RECEIPT`));
      }
      break;
    }

    case 'status': {
      const sinceIdx = args.indexOf('--since');
      const minutes = sinceIdx !== -1 ? parseInt(args[sinceIdx + 1]) || 60 : 60;
      const recent = statusSince(minutes);
      if (recent.length === 0) {
        console.log(`No receipts in the last ${minutes}m.`);
      } else {
        console.log(`Receipts (last ${minutes}m): ${recent.length} total`);
        const byAgent = {};
        recent.forEach(r => {
          if (!byAgent[r.agent]) byAgent[r.agent] = { reads: 0, actions: 0 };
          if (r.type === 'read') byAgent[r.agent].reads++;
          if (r.type === 'action') byAgent[r.agent].actions++;
        });
        Object.entries(byAgent).forEach(([agent, counts]) => {
          console.log(`  ${agent}: ${counts.reads} reads, ${counts.actions} actions`);
        });
      }
      break;
    }

    default:
      console.log('FastOps Delivery Guarantee (P5)');
      console.log('');
      console.log('Commands:');
      console.log('  read <callsign> <message-id>              — Log read receipt');
      console.log('  action <callsign> <msg-id> <type> [resp]  — Log action receipt');
      console.log('  check <message-id>                        — Check delivery status');
      console.log('  dark <message-id> <agent1> <agent2>...    — Find who hasn\'t read');
      console.log('  status [--since <minutes>]                — Recent activity');
  }
}

module.exports = { logRead, logAction, checkMessage, statusSince, findDark, readAllReceipts };
