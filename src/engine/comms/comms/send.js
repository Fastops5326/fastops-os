#!/usr/bin/env node
/**
 * FastOps Comms — Send a message (with identity validation)
 *
 * Hollow lines starting with [CHECK COMMS ACK] are rejected (Overwatch mission).
 * Use ENGAGE posts or `check-comms.js --ack-only` → [CHECK COMMS AUDIT]. Override: FASTOPS_ALLOW_HOLLOW_ACK=1
 *
 * Usage: node comms/send.js <from> <message> [--channel <channel>]
 *   e.g.: node comms/send.js vigil "checking in, what's everyone working on?"
 *         node comms/send.js vigil hello team
 *         node comms/send.js vigil "working on trial design" --channel agent-experience
 *
 * IDENTITY ENFORCEMENT (Session 145, Bulkhead):
 *   Defense-in-depth layer. The PRIMARY enforcer is identity-gate.js (PreToolUse
 *   hook with real session_id from stdin). send.js validates that the FROM name
 *   is a legitimately claimed identity — preventing agents from sending as names
 *   that don't exist or were never claimed.
 *
 *   The bridge file is unreliable across terminals sharing CLAUDE_SEPARATE_SESSION,
 *   so send.js does NOT rely on bridge-based session matching. Instead it checks:
 *   does this FROM name have an active claim (sid file created in last 24h)?
 */

const { send } = require('./protocol');

// Parse --channel and --type flags from args
const args = process.argv.slice(2);
const channelIdx = args.indexOf('--channel');
let channel = 'general';
if (channelIdx !== -1) {
  channel = args[channelIdx + 1] || 'general';
  args.splice(channelIdx, 2);
}

// Message type: challenge, position, question, or omit for general
// Marks messages structurally for collision tooling (community-health.js, collision-prompt.js)
const typeIdx = args.indexOf('--type');
let msgType = null;
const VALID_TYPES = ['challenge', 'position', 'question'];
if (typeIdx !== -1) {
  const requested = (args[typeIdx + 1] || '').toLowerCase();
  if (VALID_TYPES.includes(requested)) {
    msgType = requested;
  } else {
    console.error('Invalid type: ' + requested + '. Valid: ' + VALID_TYPES.join(', '));
    process.exit(1);
  }
  args.splice(typeIdx, 2);
}

const from = args[0];
const content = args.slice(1).join(' ');

if (from && from.startsWith('--')) {
  console.error(
    '[send.js] Invalid sender name "' + from + '".\n' +
      '  It looks like flag syntax was passed in the sender position.\n' +
      '  Usage: node comms/send.js <callsign> "message" --channel <channel>'
  );
  process.exit(1);
}

// Structural enforcement: hollow CHECK COMMS receipts are deprecated (Overwatch mission).
// Automation uses check-comms.js --ack-only → [CHECK COMMS AUDIT], not this prefix.
const DEPRECATED_HOLLOW_ACK = /^\[CHECK COMMS ACK\]/;
if (DEPRECATED_HOLLOW_ACK.test(content.trim()) && process.env.FASTOPS_ALLOW_HOLLOW_ACK !== '1') {
  console.error(
    '[send.js] Blocked deprecated hollow line starting with [CHECK COMMS ACK].\n' +
      '  Post engagement: [ENGAGE re:<id> from:<sender>] <callsign>: <substance> …\n' +
      '  Or run: node .fastops/cdp/check-comms.js <id> --wake <peer> --engage "…"\n' +
      '  Automation audit trail: node .fastops/cdp/check-comms.js <id> … --ack-only (posts [CHECK COMMS AUDIT]).\n' +
      '  Emergency override: FASTOPS_ALLOW_HOLLOW_ACK=1'
  );
  process.exit(1);
}

if (!from || !content) {
  console.log('Usage: node comms/send.js <from> <message> [--channel <channel>] [--type <type>]');
  console.log('  e.g.: node comms/send.js vigil "hey team, what are we working on?"');
  console.log('  e.g.: node comms/send.js vigil "working on trial design" --channel agent-experience');
  console.log('  e.g.: node comms/send.js vigil "That approach ignores X" --type challenge');
  console.log('  e.g.: node comms/send.js vigil "I believe Y because Z" --type position');
  console.log('');
  console.log('Types (optional): challenge, position, question');
  console.log('  Marks your post for collision tooling. Agents see typed posts as collision invitations.');
  process.exit(1);
}

// Identity: trust the declared name (Joel directive, Session 148).
// Previous validation via sid-file lookup was broken by bridge file corruption
// across terminals sharing CLAUDE_SEPARATE_SESSION. The roster (claim-name.js)
// handles uniqueness at claim time. send.js just sends.

const opts = {};
if (msgType) opts.type = msgType;
const msg = send(from, content, channel, opts);
const t = new Date(msg.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
const chLabel = channel !== 'general' ? ` [#${channel}]` : '';
const typeLabel = msgType ? ` [${msgType}]` : '';
console.log(`[${t}]${chLabel}${typeLabel} sent: ${msg.id}`);

// --- Swim Buddy Auto-Wake ---
// If a swim buddy is registered, CDP wake them on every comms post.
// Config: .fastops/.swim-buddy-config.json { "name": "BRIDGE", "port": 9223 }
// Guardrails: .fastops/cdp-wake-guard.js (FASTOPS_CDP_WAKE=0, max failures, self-wake skip)
const path = require('path');
const fs = require('fs');
const guard = require(path.join(__dirname, '..', '.fastops', 'cdp-wake-guard.js'));
const buddyConfigPath = path.join(__dirname, '..', '.fastops', '.swim-buddy-config.json');
if (fs.existsSync(buddyConfigPath)) {
  try {
    const buddy = JSON.parse(fs.readFileSync(buddyConfigPath, 'utf8'));
    if (buddy.name && buddy.port) {
      if (!guard.isWakeDisabled() && !guard.shouldSkipWake(from, buddy) && !guard.isCircuitOpen()) {
        const { execSync } = require('child_process');
        const wakeScript = path.join(__dirname, '..', '.fastops', 'spawn-swim-buddy.js');
        const stub = `CHECK COMMS — ${from} posted to #${channel} (msg id: ${msg.id}). Read comms for full text.`;
        try {
          execSync(`node "${wakeScript}" --name "${buddy.name}" --wake "${stub.replace(/"/g, '\\"')}" --port ${buddy.port}`, {
            timeout: 15000,
            stdio: 'ignore'
          });
          guard.recordWakeSuccess();
        } catch {
          guard.recordWakeFailure();
        }
      }
    }
  } catch (e) {
    // Silent fail — comms delivery is primary, buddy wake is best-effort
  }
}
