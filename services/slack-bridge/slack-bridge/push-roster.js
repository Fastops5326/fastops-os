#!/usr/bin/env node
/**
 * push-roster.js — Push buddy pairs and channel map to the Cloudflare Worker
 *
 * Reads local swim buddy config and pushes to Worker KV so the
 * buddy relay operates with current pair data.
 *
 * Usage:
 *   node slack-bridge/push-roster.js
 *   node slack-bridge/push-roster.js --channel-map '{"C123":"general","C456":"bridge-ii"}'
 *   node slack-bridge/push-roster.js --buddy-pairs '{"bridge-ii":"watchdog","watchdog":"bridge-ii"}'
 *   node slack-bridge/push-roster.js --read   # Read current roster from Worker
 *
 * Without flags, reads .fastops/.swim-buddy-config.json and builds pairs automatically.
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

if (!BRIDGE_URL || !API_KEY) {
  console.error('Missing SLACK_BRIDGE_URL or SLACK_BRIDGE_API_KEY');
  process.exit(1);
}

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

const args = process.argv.slice(2);

async function main() {
  // Read mode
  if (args.includes('--read')) {
    const resp = await fetch(`${BRIDGE_URL}/api/roster`, { headers });
    const data = await resp.json();
    console.log('Current Worker roster:');
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  const payload = {};

  // Channel map from CLI
  const cmIdx = args.indexOf('--channel-map');
  if (cmIdx !== -1 && args[cmIdx + 1]) {
    payload.channel_map = JSON.parse(args[cmIdx + 1]);
  }

  // Buddy pairs from CLI
  const bpIdx = args.indexOf('--buddy-pairs');
  if (bpIdx !== -1 && args[bpIdx + 1]) {
    payload.buddy_pairs = JSON.parse(args[bpIdx + 1]);
  }

  // Auto-detect from local config if no CLI args
  if (!payload.channel_map && !payload.buddy_pairs) {
    const configFile = path.join(__dirname, '..', '.fastops', '.swim-buddy-config.json');
    if (fs.existsSync(configFile)) {
      const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      // Build bidirectional buddy pair
      // The config file is written from one agent's perspective
      // We need both directions
      const myName = process.env.AGENT_NAME || 'bridge-ii';
      const buddyName = config.name.toLowerCase();
      payload.buddy_pairs = {
        [myName]: buddyName,
        [buddyName]: myName,
      };
      console.log(`Auto-detected buddy pair: ${myName} ↔ ${buddyName}`);
    } else {
      console.log('No swim buddy config found. Provide --channel-map or --buddy-pairs.');
      process.exit(1);
    }
  }

  const resp = await fetch(`${BRIDGE_URL}/api/roster`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  const result = await resp.json();
  console.log('Roster updated:', JSON.stringify(result, null, 2));
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
