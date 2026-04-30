#!/usr/bin/env node
/**
 * FastOps Comms Protocol V2 — Stigmergy-First Communication
 *
 * V2 strips messaging to its core: send, receive, format.
 * Coordination flows through contracts (state mutations), not messages.
 * Context injection (gate.js) delivers awareness passively.
 * Conversation hopping (conversation-hop.js) handles deliberation.
 *
 * Deleted from V1: meetings, roster, thinking docs, brevity enforcement,
 * name pool, identity resolution, challenger toggles (~400 lines).
 *
 * What remains: the JSONL channel substrate and basic send/receive (~100 lines).
 *
 * Design: 3-round jailbreak (Gemini 2.5 Pro + DeepSeek R1)
 * See: .fastops/conversations/jailbreak-block9-comms.jsonl
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const DATA_DIR = path.join(__dirname, 'data');

// --- Core ---

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function channelFile(channel) {
  return path.join(DATA_DIR, `${channel}.jsonl`);
}

function stateFile(agentId) {
  return path.join(DATA_DIR, '.state', `${agentId}.json`);
}

// --- Send ---


function wakeRecipients(msg){try{var sm=require("path").resolve(__dirname,"..",".fastops","cdp","seat-map.json");if(!fs.existsSync(sm))return;var m=JSON.parse(fs.readFileSync(sm,"utf8")),t=[];if(msg.content.includes("[ALL]")){Object.values(m.seats).forEach(function(s){if(s.type==="cursor")t.push(s)})}else if(msg.to&&m.aliases[msg.to]){var sid=m.aliases[msg.to],s=m.seats[sid];if(s&&s.type==="cursor")t.push(s)}var w=require("path").resolve(__dirname,"..",".fastops","spawn-swim-buddy.js");if(!fs.existsSync(w))return;t.forEach(function(s){var c=require("child_process").spawn("node",[w,"--name",s.sidebar,"--wake","CHECK COMMS","--port",String(s.port)],{detached:true,stdio:"ignore"});c.unref()})}catch(e){}}

function send(from, content, channel = 'general', opts = {}) {
  ensureDir();

  const mentionMatch = content.match(/@(\w[\w-]*)/);
  const to = opts.to || (mentionMatch ? mentionMatch[1] : null);

  const msg = {
    id: `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    from,
    ...(to ? { to } : {}),
    ...(opts.type ? { type: opts.type } : {}),
    content,
    channel,
    ts: new Date().toISOString()
  };

  fs.appendFileSync(channelFile(channel), JSON.stringify(msg) + '\n');

  // Relay to Slack (fire-and-forget, non-blocking)
  // Triggers on squad-katie (Slack-facing channel) and general (cross-team)
  const slackRelayChannels = ['general', 'squad-katie'];
  if (slackRelayChannels.includes(channel) && !from.startsWith('SLACK:')) {
    const relay = path.resolve(__dirname, '..', 'slack-bridge', 'relay-outbound.js');
    if (fs.existsSync(relay)) {
      const child = spawn('node', [relay, from, content], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    }
  }

  wakeRecipients(msg);
  return msg;
}

function systemMsg(content, channel = 'general') {
  return send('system', content, channel);
}

// --- Read ---

function readAll(channel = 'general') {
  ensureDir();
  const f = channelFile(channel);
  if (!fs.existsSync(f)) return [];
  const raw = fs.readFileSync(f, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function getNew(agentId, channel = 'general') {
  ensureDir();
  const sf = stateFile(agentId);
  const stateDir = path.dirname(sf);
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });

  let state = {};
  try { if (fs.existsSync(sf)) state = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch {}

  const lastSeen = state[channel] || null;
  const all = readAll(channel);

  if (!lastSeen) {
    if (all.length > 0) {
      state[channel] = all[all.length - 1].id;
      fs.writeFileSync(sf, JSON.stringify(state, null, 2));
    }
    return [];
  }

  const idx = all.findIndex(m => m.id === lastSeen);
  const newMsgs = idx === -1 ? all : all.slice(idx + 1);

  if (newMsgs.length > 0) {
    state[channel] = all[all.length - 1].id;
    fs.writeFileSync(sf, JSON.stringify(state, null, 2));
  }

  return newMsgs;
}

function peek(agentId, channel = 'general') {
  ensureDir();
  const sf = stateFile(agentId);
  let state = {};
  try { if (fs.existsSync(sf)) state = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch {}

  const lastSeen = state[channel] || null;
  const all = readAll(channel);
  if (!lastSeen) return [];

  const idx = all.findIndex(m => m.id === lastSeen);
  return idx === -1 ? all : all.slice(idx + 1);
}

function markRead(agentId, channel = 'general') {
  ensureDir();
  const sf = stateFile(agentId);
  const stateDir = path.dirname(sf);
  if (!fs.existsSync(stateDir)) fs.mkdirSync(stateDir, { recursive: true });

  let state = {};
  try { if (fs.existsSync(sf)) state = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch {}

  const all = readAll(channel);
  if (all.length > 0) {
    state[channel] = all[all.length - 1].id;
    fs.writeFileSync(sf, JSON.stringify(state, null, 2));
  }
}

// --- Format ---

function fmt(msg) {
  const t = new Date(msg.ts).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit'
  });
  if (msg.from === 'system') return `  → ${msg.content}`;
  return `  [${t}] ${msg.from}: ${msg.content}`;
}

function timeSince(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

module.exports = {
  send, systemMsg, readAll, getNew, peek, markRead, fmt, timeSince,
  DATA_DIR, channelFile, stateFile
};

// --- CLI ---
if (require.main === module) {
  const [,, cmd, ...args] = process.argv;

  switch (cmd) {
    case 'send': {
      const [from, ...rest] = args;
      let channel = 'general';
      let parts = rest;
      if (parts[0] && parts[0].startsWith('#')) {
        channel = parts[0].substring(1);
        parts = parts.slice(1);
      }
      const content = parts.join(' ');
      if (!from || !content) { console.error('Usage: node protocol-v2.js send <from> [#channel] <msg>'); process.exit(1); }
      const msg = send(from, content, channel);
      const t = new Date(msg.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
      console.log(`[${t}] sent: ${msg.id}`);
      break;
    }
    case 'check': {
      const [channel, countStr] = args;
      const ch = channel || 'general';
      const count = parseInt(countStr) || 20;
      const msgs = readAll(ch);
      console.log(`=== #${ch} (${msgs.length} total) ===`);
      msgs.slice(-count).forEach(m => console.log(fmt(m)));
      break;
    }
    case 'new': {
      const [agentId, channel] = args;
      if (!agentId) { console.error('Usage: node protocol-v2.js new <agent-id> [channel]'); process.exit(1); }
      const msgs = getNew(agentId, channel || 'general');
      if (msgs.length === 0) console.log('No new messages.');
      else msgs.forEach(m => console.log(fmt(m)));
      break;
    }
    default:
      console.log('FastOps Comms V2 — Stigmergy-first communication');
      console.log('');
      console.log('Commands:');
      console.log('  send <from> [#channel] <msg>  — Send message');
      console.log('  check [channel] [count]       — Show recent messages');
      console.log('  new <agent-id> [channel]       — Show unread messages');
      console.log('');
      console.log('Coordination flows through contracts, not messages.');
      console.log('Context injection delivers awareness passively.');
      console.log('Conversation hopping handles deliberation.');
  }
}
