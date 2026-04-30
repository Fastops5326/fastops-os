#!/usr/bin/env node
/**
 * joel-broadcast.js — UserPromptSubmit hook
 *
 * When Joel types a message in ANY terminal, this hook posts it to
 * comms/data/general.jsonl so ALL other agents see it via comms-push.
 *
 * Joel types once → everyone hears it.
 *
 * [FOR AGENT] tagging (Session 143):
 *   When Joel's message starts with an agent name ("Conduit, do X"),
 *   adds a `to` field so comms-push.js can route it as directed.
 *
 * Filters out very short messages (< 10 chars) to avoid broadcasting
 * "yes", "ok", "no" etc. that are terminal-specific.
 *
 * @contract contracts/message-schema.json — PRODUCER
 * This file writes messages to general.jsonl. The message shape is defined
 * in the shared contract. Changes to the message format MUST update the
 * contract first so consumers (comms-push.js) stay aligned.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = path.join(__dirname, '..', '..');
const GENERAL = path.join(BASE, 'comms', 'data', 'general.jsonl');
const COLONY_STATE = path.join(BASE, '.fastops', 'COLONY-STATE.json');
const MIN_LENGTH = 10; // Don't broadcast very short responses

// Session-keyed identity resolution (shared module — Session 141 fix)
const { getAgentId, getSessionKey } = require('./lib/identity');

/**
 * Detect if Joel's message starts with or addresses a specific agent by name.
 * Returns the agent name if found, null otherwise.
 */
function detectTargetAgent(prompt) {
  try {
    if (!fs.existsSync(COLONY_STATE)) return null;
    const cs = JSON.parse(fs.readFileSync(COLONY_STATE, 'utf-8'));
    const agents = cs.active_agents || {};
    const now = Date.now();
    const promptLower = prompt.toLowerCase();

    for (const [id, agent] of Object.entries(agents)) {
      const name = agent.session_name || id;
      if (!name || name === 'unknown') continue;
      // Only check agents seen in last 10 minutes
      const lastBeat = new Date(agent.last_heartbeat_ts).getTime();
      if (now - lastBeat > 600000) continue;

      const nameLower = name.toLowerCase();
      // Check if prompt starts with agent name (e.g. "Conduit, do X" or "Conduit — do X")
      if (promptLower.startsWith(nameLower)) {
        const afterName = prompt.charAt(nameLower.length);
        // Must be followed by punctuation/space/end (not part of longer word)
        if (!afterName || /[,\s\-—:.]/.test(afterName)) {
          return name;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

function main() {
  let input = '';

  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);
      const prompt = data.prompt || data.message || '';

      // Skip very short messages — likely terminal-specific
      if (prompt.length < MIN_LENGTH) return;

      // Skip if it looks like a command (starts with /)
      if (prompt.startsWith('/')) return;

      // Skip system notifications (task-notification, system-reminder, etc.)
      if (prompt.startsWith('<task-notification') || prompt.startsWith('<system-reminder')) return;

      // URGENT TAGS always broadcast — Joel shouldn't need [ALL] for emergencies
      const URGENT_TAGS = ['[URGENT]', '[STOP]', '[EMERGENCY]'];
      const promptUpper = prompt.toUpperCase();
      const isUrgent = URGENT_TAGS.some(tag => promptUpper.startsWith(tag));

      // OPT-IN BROADCAST: only write to general.jsonl if message starts with [ALL]
      // or an urgent tag. Joel's normal typing stays private to the terminal he typed in.
      const isAllBroadcast = prompt.startsWith('[ALL]') || prompt.startsWith('[all]');
      if (!isAllBroadcast && !isUrgent) return;

      // Strip [ALL] prefix from content so it doesn't render redundantly
      // (comms-push.js already adds [Joel BROADCAST] prefix)
      let content = prompt;
      if (isAllBroadcast) {
        content = prompt.replace(/^\[(?:ALL|all)\]\s*/, '');
      }

      // Identify which terminal Joel typed this in
      const terminalAgent = getAgentId();
      const sessionKey = getSessionKey();

      // Detect if Joel is addressing a specific agent
      const targetAgent = detectTargetAgent(content);

      // Build the message with terminal routing info
      const msg = {
        id: `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        from: 'joel',
        content: content.substring(0, 500), // Cap at 500 chars
        urgent: isUrgent || undefined,
        broadcast: isAllBroadcast || undefined,
        channel: 'general',
        words: prompt.split(/\s+/).length,
        ts: new Date().toISOString(),
        // Terminal routing: tells other agents which terminal Joel typed in
        terminal_agent: terminalAgent || undefined,
        terminal_session: sessionKey || undefined,
        // [FOR AGENT] tagging: if Joel addresses a specific agent
        to: targetAgent || undefined
      };

      // Append to general.jsonl
      fs.appendFileSync(GENERAL, JSON.stringify(msg) + '\n');

    } catch (e) {
      // Silent fail — don't break the agent
    }
  });
}

main();
