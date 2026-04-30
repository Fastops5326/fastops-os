#!/usr/bin/env node
/**
 * FastOps Slack Bridge — Outbound Relay
 *
 * Called by comms/protocol-v2.js after every send() to relay agent messages to Slack.
 * Runs as a fire-and-forget subprocess so it doesn't block comms.
 *
 * Usage (called automatically by protocol-v2):
 *   node slack-bridge/relay-outbound.js <from> <message>
 *
 * Env vars (or .env in slack-bridge/):
 *   SLACK_BRIDGE_URL     — Worker URL
 *   SLACK_BRIDGE_API_KEY — Shared secret
 */

const fs = require('fs');
const path = require('path');

// Load .env
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.+)$/);
    if (match) process.env[match[1]] = match[2].trim();
  }
}

const BRIDGE_URL = process.env.SLACK_BRIDGE_URL;
const API_KEY = process.env.SLACK_BRIDGE_API_KEY;

if (!BRIDGE_URL || !API_KEY) process.exit(0); // Silently skip if not configured

const [,, from, ...rest] = process.argv;
const message = rest.join(' ');

if (!from || !message) process.exit(0);

// Don't relay Slack messages back to Slack
if (from.startsWith('SLACK:')) process.exit(0);
if (from.startsWith('RELAY:')) process.exit(0);

// Loop prevention: never send [BUDDY RELAY] tagged messages to Slack
if (message.includes('[BUDDY RELAY]')) process.exit(0);

// Radio Watch: only the assigned RTO and key agents post to Slack
// Other agents contribute via general comms; RTO synthesizes and responds
const SLACK_RTO = process.env.SLACK_RTO || 'resonance';
const allowedPosters = [SLACK_RTO, 'joel', 'overwatch', 'bridge-ii', 'watchdog'];
if (!allowedPosters.includes(from.toLowerCase())) {
  process.exit(0);
}

fetch(`${BRIDGE_URL}/api/send`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ from, message }),
}).catch(() => {}); // Fire and forget
