#!/usr/bin/env node
/**
 * FastOps Ambient Injection — Enriched peer awareness for PreToolUse
 *
 * Reads contract state and produces context blocks for gate.js injection:
 *   [CONTRACTS] — peer claimed contracts with file boundaries
 *   [COMPLETIONS] — recently completed contracts with outputs
 *   [DEPENDENCIES] — unmet dependencies for your claimed contract
 *   [PRIORITY] — file-backed persistent messages (survives compaction)
 *
 * Design: Block 9 (agent-communication), post-jailbreak stigmergy model.
 * Coordination through environment observation, not messaging.
 *
 * Called by gate.js on each tool call (rate-limited externally).
 * Returns an array of context strings to append to additionalContext.
 */

const fs = require('fs');
const path = require('path');

const FASTOPS = path.resolve(__dirname, '..', '.fastops');
const WORK_LIST = path.join(FASTOPS, 'work-list.json');
const CLAIMS_DIR = path.join(FASTOPS, 'claims');
const PRIORITY_DIR = path.join(FASTOPS, 'priority');

/**
 * Get all enriched ambient context blocks for a given agent.
 * @param {string} mySessionId — this agent's session ID (or short ID)
 * @returns {string[]} — array of context block strings
 */
function getAmbientContext(mySessionId) {
  const blocks = [];

  try {
    const contracts = loadContracts();
    if (!contracts.length) return blocks;

    const myContract = findMyContract(contracts, mySessionId);
    const peerContracts = getPeerContracts(contracts, mySessionId);
    const completions = getRecentCompletions(contracts);

    // [CONTRACTS] — what peers are working on + their file boundaries
    if (peerContracts.length > 0) {
      const lines = peerContracts.map(c => {
        const files = (c.file_boundaries || []).slice(0, 3).join(', ');
        return `  ${c.claimed_by}: ${c.id} (${files})`;
      });
      blocks.push(`[CONTRACTS] ${peerContracts.length} peer contract(s):\n${lines.join('\n')}`);
    }

    // [COMPLETIONS] — recently completed contracts with outputs
    if (completions.length > 0) {
      const lines = completions.map(c => {
        const outputs = (c.outputs || []).slice(0, 3).join(', ') || 'no outputs listed';
        return `  ${c.completed_by}: ${c.id} → ${outputs}`;
      });
      blocks.push(`[COMPLETIONS] ${completions.length} recent completion(s):\n${lines.join('\n')}`);
    }

    // [DEPENDENCIES] — unmet dependencies for your contract
    if (myContract && myContract.depends_on && myContract.depends_on.length > 0) {
      const unmet = myContract.depends_on.filter(depId => {
        const dep = contracts.find(c => c.id === depId);
        return !dep || dep.status !== 'done';
      });
      if (unmet.length > 0) {
        blocks.push(`[DEPENDENCIES] Your contract (${myContract.id}) has ${unmet.length} unmet dependency(s): ${unmet.join(', ')}`);
      }
    }

    // [PRIORITY] — file-backed persistent messages
    const priority = checkPriorityMessage(mySessionId);
    if (priority) {
      blocks.push(`[PRIORITY] From ${priority.from} (${timeSince(priority.ts)}): ${priority.content}\n  Acknowledge: node comms/priority.js ack ${mySessionId}`);
    }
  } catch {}

  return blocks;
}

// --- Internal ---

function loadContracts() {
  try {
    if (!fs.existsSync(WORK_LIST)) return [];
    const data = JSON.parse(fs.readFileSync(WORK_LIST, 'utf8'));
    return data.contracts || [];
  } catch { return []; }
}

function findMyContract(contracts, mySessionId) {
  // Match by claimed_by containing session ID or short ID
  const short = mySessionId.substring(0, 8);
  return contracts.find(c =>
    c.status === 'claimed' && (
      c.claimed_by === mySessionId ||
      c.claimed_by === short ||
      (c.claimed_by && c.claimed_by.includes(short))
    )
  ) || null;
}

function getPeerContracts(contracts, mySessionId) {
  const short = mySessionId.substring(0, 8);
  return contracts.filter(c =>
    c.status === 'claimed' &&
    c.claimed_by !== mySessionId &&
    c.claimed_by !== short &&
    !(c.claimed_by && c.claimed_by.includes(short))
  );
}

function getRecentCompletions(contracts) {
  // Show contracts completed in the last 2 hours
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  const now = Date.now();
  return contracts.filter(c => {
    if (c.status !== 'done') return false;
    if (!c.completed_at) return false;
    return now - new Date(c.completed_at).getTime() < TWO_HOURS;
  });
}

function checkPriorityMessage(sessionId) {
  try {
    if (!fs.existsSync(PRIORITY_DIR)) return null;
    // Check both full session ID and short ID
    const candidates = [sessionId, sessionId.substring(0, 8)];
    for (const id of candidates) {
      const msgFile = path.join(PRIORITY_DIR, `${id}.msg`);
      const ackFile = path.join(PRIORITY_DIR, `${id}.ack`);
      if (fs.existsSync(msgFile) && !fs.existsSync(ackFile)) {
        return JSON.parse(fs.readFileSync(msgFile, 'utf8'));
      }
    }
    return null;
  } catch { return null; }
}

function timeSince(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

module.exports = { getAmbientContext };
