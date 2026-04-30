#!/usr/bin/env node
/**
 * deconflict.js — File Deconfliction CLI
 *
 * When the deconfliction gate blocks an agent (another agent owns a file),
 * the blocked agent must:
 *   1. Post to general channel: "DECONFLICT: <reason>"
 *   2. Run this tool to confirm
 *
 * Usage:
 *   node comms/deconflict.js <file_path>     Confirm deconfliction for a file
 *   node comms/deconflict.js --status         Show all current file claims
 *   node comms/deconflict.js --release <path> Release a file from your claims
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.cwd();
const COLONY_STATE_FILE = path.join(PROJECT_ROOT, '.fastops', 'COLONY-STATE.json');
const GENERAL_CHANNEL = path.join(PROJECT_ROOT, 'comms', 'data', 'general.jsonl');
const AGENTS_DIR = path.join(PROJECT_ROOT, 'comms', 'data', '.agents');
const FASTOPS_DIR = path.join(PROJECT_ROOT, '.fastops');
const DECONFLICT_WINDOW_MS = 2 * 60 * 1000; // 2 minutes

// --- Agent Identity ---
// v3 (Session 155): Use identity module (session-ID based), with lease fallback
const { fromBridge } = require(path.join(PROJECT_ROOT, '.claude', 'hooks', 'lib', 'identity'));

function getAgentId() {
  // Priority 1: Session-ID based identity (v2)
  try {
    const { name, sessionId } = fromBridge();
    if (name && name !== 'unknown') return name;
    if (sessionId) return sessionId.substring(0, 8);
  } catch {}

  // Priority 2: .active-agent fallback
  const activeFile = path.join(PROJECT_ROOT, 'comms', 'data', '.active-agent');
  try {
    const id = fs.readFileSync(activeFile, 'utf-8').trim();
    if (id) return id;
  } catch {}

  return null;
}

// --- Colony State ---

function loadColonyState() {
  try {
    return JSON.parse(fs.readFileSync(COLONY_STATE_FILE, 'utf-8'));
  } catch {
    return { active_agents: {} };
  }
}

function saveColonyState(state) {
  fs.writeFileSync(COLONY_STATE_FILE, JSON.stringify(state, null, 2));
}

// --- Post to general channel (same JSONL format as protocol.js) ---

function postToGeneral(from, content) {
  const crypto = require('crypto');
  const msg = {
    id: `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    from,
    content,
    channel: 'general',
    ts: new Date().toISOString()
  };
  fs.appendFileSync(GENERAL_CHANNEL, JSON.stringify(msg) + '\n');
  return msg;
}

// --- Check for recent DECONFLICT message ---

function hasRecentDeconflictPost(agentId) {
  try {
    const lines = fs.readFileSync(GENERAL_CHANNEL, 'utf-8').trim().split('\n');
    const cutoff = Date.now() - DECONFLICT_WINDOW_MS;

    // Check from the end (most recent first)
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const msg = JSON.parse(lines[i]);
        const msgTime = new Date(msg.ts).getTime();
        if (msgTime < cutoff) break; // Past the 2-minute window
        if (msg.from === agentId && msg.content && msg.content.startsWith('DECONFLICT:')) {
          return true;
        }
      } catch {}
    }
  } catch {}
  return false;
}

// --- Subcommands ---

function confirmDeconflict(filePath) {
  const agentId = getAgentId();
  if (!agentId) {
    console.error('ERROR: Cannot determine agent identity. Claim a name first:');
    console.error('  node comms/claim-name.js YOUR-NAME');
    process.exit(1);
  }

  const absPath = path.resolve(filePath);

  // Check that agent posted a DECONFLICT message recently
  if (!hasRecentDeconflictPost(agentId)) {
    console.error('REJECTED: You must post a deconfliction message to general channel first.');
    console.error('');
    console.error('  node comms/send.js ' + agentId + ' "DECONFLICT: <why you need this file>"');
    console.error('');
    console.error('Then re-run:');
    console.error('  node comms/deconflict.js ' + filePath);
    process.exit(1);
  }

  // Write confirmation file
  const confirmFile = path.join(FASTOPS_DIR, `.deconflict-confirmed-${agentId}`);
  const confirmation = {
    agent: agentId,
    file: absPath,
    confirmed_at: new Date().toISOString()
  };
  fs.writeFileSync(confirmFile, JSON.stringify(confirmation, null, 2));

  // Auto-post to general
  postToGeneral(agentId, `confirmed deconfliction for ${absPath}`);

  console.log(`Deconfliction confirmed for ${absPath}. Your next Write/Edit will proceed.`);
}

function showStatus() {
  const state = loadColonyState();
  const agents = state.active_agents || {};
  const entries = Object.entries(agents);

  if (entries.length === 0) {
    console.log('No active agents in COLONY-STATE.json.');
    return;
  }

  console.log('FILE CLAIMS (from COLONY-STATE.json):\n');

  let claimsFound = false;
  for (const [id, agent] of entries) {
    const files = agent.recent_files || [];
    if (files.length === 0) continue;
    claimsFound = true;

    const status = agent.status || 'unknown';
    const lastSeen = agent.last_heartbeat_ts
      ? timeSince(new Date(agent.last_heartbeat_ts))
      : 'unknown';

    console.log(`  ${id} (${status}, last seen ${lastSeen}):`);
    for (const f of files) {
      if (typeof f === 'string') {
        console.log(`    - ${f}`);
      } else if (f.path) {
        const age = f.ts ? timeSince(new Date(f.ts)) : '';
        console.log(`    - ${f.path}${age ? ' (' + age + ')' : ''}`);
      }
    }
    console.log('');
  }

  if (!claimsFound) {
    console.log('  No file claims registered by any agent.');
  }

  // Also show any pending deconfliction confirmations
  try {
    const confirmFiles = fs.readdirSync(FASTOPS_DIR)
      .filter(f => f.startsWith('.deconflict-confirmed-'));
    if (confirmFiles.length > 0) {
      console.log('PENDING DECONFLICTION CONFIRMATIONS:\n');
      for (const cf of confirmFiles) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(FASTOPS_DIR, cf), 'utf-8'));
          console.log(`  ${data.agent}: ${data.file} (${timeSince(new Date(data.confirmed_at))})`);
        } catch {}
      }
    }
  } catch {}
}

function releaseFile(filePath) {
  const agentId = getAgentId();
  if (!agentId) {
    console.error('ERROR: Cannot determine agent identity. Claim a name first.');
    process.exit(1);
  }

  const absPath = path.resolve(filePath);
  const state = loadColonyState();
  const agent = state.active_agents && state.active_agents[agentId];

  if (!agent) {
    console.error(`ERROR: Agent "${agentId}" not found in COLONY-STATE.json.`);
    process.exit(1);
  }

  if (!agent.recent_files || agent.recent_files.length === 0) {
    console.log(`Agent "${agentId}" has no file claims to release.`);
    return;
  }

  const before = agent.recent_files.length;
  agent.recent_files = agent.recent_files.filter(f => {
    const fPath = typeof f === 'string' ? f : (f.path || '');
    return path.resolve(fPath) !== absPath;
  });

  if (agent.recent_files.length === before) {
    console.log(`File "${absPath}" was not in your claims. No change.`);
    console.log('Your current claims:');
    for (const f of agent.recent_files) {
      console.log(`  - ${typeof f === 'string' ? f : f.path}`);
    }
    return;
  }

  saveColonyState(state);

  // Auto-post release notification
  postToGeneral(agentId, `released file claim on ${absPath}`);

  console.log(`Released: ${absPath}`);
  console.log(`Remaining claims: ${agent.recent_files.length}`);
}

// --- Utility ---

function timeSince(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// --- CLI ---

try {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage:');
    console.log('  node comms/deconflict.js <file_path>       Confirm deconfliction');
    console.log('  node comms/deconflict.js --status           Show all file claims');
    console.log('  node comms/deconflict.js --release <path>   Release a file claim');
    process.exit(0);
  }

  if (args[0] === '--status') {
    showStatus();
  } else if (args[0] === '--release') {
    if (!args[1]) {
      console.error('Usage: node comms/deconflict.js --release <file_path>');
      process.exit(1);
    }
    releaseFile(args[1]);
  } else if (!args[0].startsWith('--')) {
    confirmDeconflict(args[0]);
  } else {
    console.error('Unknown option:', args[0]);
    process.exit(1);
  }
} catch (err) {
  console.error('ERROR:', err.message);
  process.exit(1);
}
