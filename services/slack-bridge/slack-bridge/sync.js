#!/usr/bin/env node
/**
 * FastOps Slack Bridge — Local Sync v2
 *
 * Polls the Cloudflare Worker for inbound Slack messages,
 * routes them to the correct comms JSONL file by channel/agent,
 * acknowledges delivery, and optionally CDPs the target agent.
 *
 * Architecture (per team consensus 2026-03-25):
 *   - JSONL is ground truth. All inbound messages written to local JSONL.
 *   - Channel routing: agent-specific messages go to agent-specific files.
 *   - General messages go to general.jsonl.
 *   - CDP wake targets the specific agent, not broadcast.
 *
 * Usage:
 *   node slack-bridge/sync.js              # One-shot poll
 *   node slack-bridge/sync.js --watch      # Poll every 10s
 *   node slack-bridge/sync.js --watch 5    # Poll every 5s
 *   node slack-bridge/sync.js --cdp        # CDP wake target agents on inbound
 *   node slack-bridge/sync.js --health     # One GET /api/inbox (live Worker check)
 *
 * Env vars (or .env in slack-bridge/):
 *   SLACK_BRIDGE_URL     — Worker URL
 *   SLACK_BRIDGE_API_KEY — Shared secret
 */

const fs = require('fs');
const path = require('path');

// Load .env from slack-bridge dir
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
  console.error('Set in slack-bridge/.env or as environment variables');
  process.exit(1);
}

const COMMS_DIR = path.join(__dirname, '..', 'comms', 'data');
const ROOT = path.join(__dirname, '..');

const headers = {
  'Authorization': `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

function getCommsFile(msg) {
  // Route to correct JSONL based on channel/target
  const channel = msg.channel || 'general';

  if (channel === 'general') {
    return path.join(COMMS_DIR, 'general.jsonl');
  }

  // Agent-specific channels: agent-bridge-ii → squad-bridge-ii.jsonl
  // Or use general if the specific file doesn't make sense
  if (channel.startsWith('agent-')) {
    const agentFile = path.join(COMMS_DIR, `${channel}.jsonl`);
    return agentFile;
  }

  // Named channels (squad-katie, etc.)
  return path.join(COMMS_DIR, `${channel}.jsonl`);
}

async function poll() {
  try {
    const resp = await fetch(`${BRIDGE_URL}/api/inbox`, { headers });
    if (!resp.ok) {
      console.error(`Poll failed: ${resp.status} ${resp.statusText}`);
      return;
    }
    const { messages } = await resp.json();

    if (messages.length === 0) return;

    // Group messages by target file
    const byFile = {};
    for (const msg of messages) {
      // Skip agent-originated messages that bounced back through Slack
      // Only process messages from actual Slack users (SLACK: prefix on from)
      if (msg.from && !msg.from.startsWith('SLACK:') && !msg.from.startsWith('RELAY:')) {
        console.log(`[SKIP] Agent-originated message from ${msg.from} — not re-ingesting`);
        continue;
      }
      const file = getCommsFile(msg);
      if (!byFile[file]) byFile[file] = [];
      byFile[file].push(msg);
    }

    // Write each group to its JSONL file
    for (const [file, msgs] of Object.entries(byFile)) {
      const dir = path.dirname(file);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      for (const msg of msgs) {
        fs.appendFileSync(file, JSON.stringify(msg) + '\n');
        const isRelay = msg.content && msg.content.includes('[BUDDY RELAY]');
        const tag = isRelay ? 'RELAY' : 'SLACK';
        console.log(`[${tag}→${msg.channel || 'general'}] ${msg.from}: ${(msg.content || '').slice(0, 80)}`);
      }
    }

    // Acknowledge delivery
    const ids = messages.map(m => m.id);
    await fetch(`${BRIDGE_URL}/api/inbox/ack`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids }),
    });

    console.log(`Synced ${messages.length} message(s) from Slack`);

    // CDP wake — notify target agents
    if (cdpWake) {
      await wakeTargetAgents(messages);
    }
  } catch (err) {
    console.error('Sync error:', err.message);
  }
}

/**
 * Seat-to-CDP mapping. Loaded from .fastops/cdp/seat-map.json (seats + aliases).
 *
 * type: "vscode" → Claude Code extension: comms stub + cdp-wake.js → vscode-wake.js
 * type: "cursor" + model → cdp-target-model.js (sidebar tab); else cursor-wake.js
 */
function loadSeatMap() {
  const seatMapFile = path.join(ROOT, '.fastops', 'cdp', 'seat-map.json');
  try {
    if (fs.existsSync(seatMapFile)) {
      return JSON.parse(fs.readFileSync(seatMapFile, 'utf8'));
    }
  } catch (e) {
    console.error(`[SYNC] Failed to read ${seatMapFile}:`, e);
  }
  return { seats: {} };
}

/** Resolve target_agent label (seat-1, bridge-iii, …) to { config, seatId }. */
function resolveSeatConfig(seat, map) {
  const seats = map.seats || {};
  if (seats[seat]) return { config: seats[seat], seatId: seat };
  const aliases = map.aliases || {};
  if (aliases[seat]) {
    const id = aliases[seat];
    if (seats[id]) return { config: seats[id], seatId: id };
  }
  const lower = String(seat).toLowerCase();
  for (const [sid, cfg] of Object.entries(seats)) {
    if (cfg.agent && String(cfg.agent).toLowerCase() === lower) return { config: cfg, seatId: sid };
    if (cfg.sidebar && String(cfg.sidebar).toLowerCase() === lower) return { config: cfg, seatId: sid };
  }
  return { config: null, seatId: seat };
}

async function wakeTargetAgents(messages) {
  const { execSync } = require('child_process');
  const delay = (ms) => new Promise(r => setTimeout(r, ms));
  const seatMapDoc = loadSeatMap();

  // Group messages by target seat — only wake for genuine Slack user messages
  const bySeat = {};
  for (const msg of messages) {
    // Don't CDP-wake for agent-originated or relay messages
    if (msg.from && !msg.from.startsWith('SLACK:')) continue;
    if (msg.content && msg.content.includes('[BUDDY RELAY]')) continue;
    const seat = msg.target_agent || 'general';
    if (!bySeat[seat]) bySeat[seat] = [];
    bySeat[seat].push(msg);
  }

  for (const [seat, msgs] of Object.entries(bySeat)) {
    const summary = msgs.map(m => `${m.from}: ${(m.content || '').slice(0, 100)}`).join(' | ');
    const isRelay = msgs.some(m => m.content && m.content.includes('[BUDDY RELAY]'));
    const tag = isRelay ? 'BUDDY RELAY' : 'SLACK INBOUND';
    const prompt = `[${tag}] ${msgs.length} message(s) in ${seat}:\n${summary}\n\nCheck comms for full context.`;

    const promptFile = path.join(ROOT, '.fastops', '.slack-wake-prompt.tmp');
    fs.writeFileSync(promptFile, prompt);

    const { config, seatId } = resolveSeatConfig(seat, seatMapDoc);
    // Sanitize prompt for shell: replace quotes and newlines
    const safePrompt = prompt.replace(/"/g, '\\"').replace(/\n/g, ' ');
    /** send.js: <from> <message> [--channel …]. Without --channel, posts land in #general. */
    const wakeFrom = 'slack-bridge';
    const escapeWakeMsg = (s) => s.replace(/"/g, '\\"');

    if (config && config.type === 'vscode') {
      // Claude Code extension: must NOT use cdp-target-model (sidebar tabs).
      // cdp-wake.js routes vscode → vscode-wake.js; includes idle-guard via cdp-status.
      const wakeRouter = path.join(ROOT, '.fastops', 'cdp', 'cdp-wake.js');
      const sendScript = path.join(ROOT, 'comms', 'send.js');
      const channel = `agent-${seatId}`;
      const wakeMsg = `CHECK COMMS — ${msgs.length} message(s) in ${seat} from Slack. Read comms for full text.`;
      try {
        const sendResult = execSync(
          `node "${sendScript}" "${wakeFrom}" "${escapeWakeMsg(wakeMsg)}" --channel "${channel}"`,
          { timeout: 10000, encoding: 'utf8', windowsHide: true }
        );
        const idMatch = sendResult.match(/sent:\s*(\S+)/);
        const commsId = idMatch ? idMatch[1] : null;

        if (commsId) {
          execSync(
            `node "${wakeRouter}" --target "${seatId}" --comms-id ${commsId} --comms-channel ${channel}`,
            { timeout: 20000, stdio: 'pipe', windowsHide: true }
          );
          console.log(`[CDP] Woke ${seat} (${seatId}) → Claude Code / vscode-wake (port ${config.port})`);
        } else {
          console.error(`[CDP] Could not extract comms ID for ${seat} wake`);
        }
      } catch (e) {
        console.error(`[CDP] Failed to wake ${seat}: ${(e.message || '').slice(0, 200)}`);
      }
    } else if (config && config.model) {
      // Cursor sidebar tab by model name — comms-id stub + cdp-target-model
      const wakeScript = path.join(ROOT, '.fastops', 'cdp-target-model.js');
      const sendScript = path.join(ROOT, 'comms', 'send.js');
      const channel = `agent-${seatId}`;
      const wakeMsg = `CHECK COMMS — ${msgs.length} message(s) in ${seat} from Slack. Read comms for full text.`;
      try {
        const sendResult = execSync(
          `node "${sendScript}" "${wakeFrom}" "${escapeWakeMsg(wakeMsg)}" --channel "${channel}"`,
          { timeout: 10000, encoding: 'utf8', windowsHide: true }
        );
        const idMatch = sendResult.match(/sent:\s*(\S+)/);
        const commsId = idMatch ? idMatch[1] : null;

        if (commsId) {
          execSync(
            `node "${wakeScript}" --model ${config.model} --comms-id ${commsId} --comms-channel ${channel}`,
            { timeout: 20000, stdio: 'pipe', windowsHide: true }
          );
          console.log(`[CDP] Woke ${seat} → ${config.model} (cursor:${config.port})`);
        } else {
          console.error(`[CDP] Could not extract comms ID for ${seat} wake`);
        }
      } catch (e) {
        console.error(`[CDP] Failed to wake ${seat}: ${(e.message || '').slice(0, 200)}`);
      }
    } else if (config) {
      const script = config.type === 'vscode'
        ? path.join(ROOT, '.fastops', 'cdp', 'cdp-wake.js')
        : path.join(ROOT, '.fastops', 'cursor-wake.js');
      const portArg = config.port ? `--port ${config.port}` : '';
      const targetArg = config.type === 'vscode' ? `--target "${seatId}"` : '';
      try {
        if (config.type === 'vscode') {
          execSync(
            `node "${script}" ${targetArg} --prompt "${safePrompt}"`,
            { timeout: 20000, stdio: 'pipe', windowsHide: true }
          );
        } else {
          execSync(
            `node "${script}" --prompt "${safePrompt}" ${portArg}`,
            { timeout: 20000, stdio: 'pipe', windowsHide: true }
          );
        }
        console.log(`[CDP] Woke ${seat} (${config.type}:${config.port})`);
      } catch (e) {
        console.error(`[CDP] Failed to wake ${seat}: ${(e.message || '').slice(0, 200)}`);
      }
    } else if (seat === 'general') {
      // Slack → #general: wake Claude Code extension + primary sidebar tabs (Joel relay requirement).
      const wakeRouter = path.join(ROOT, '.fastops', 'cdp', 'cdp-wake.js');
      const wakeScript = path.join(ROOT, '.fastops', 'cdp-target-model.js');
      const sendScript = path.join(ROOT, 'comms', 'send.js');
      const channel = 'general';
      const wakeMsg = `CHECK COMMS — ${msgs.length} Slack message(s) to #general. Read comms/data/general.jsonl for full text.`;
      try {
        const sendResult = execSync(
          `node "${sendScript}" "${wakeFrom}" "${escapeWakeMsg(wakeMsg)}" --channel "${channel}"`,
          { timeout: 10000, encoding: 'utf8', windowsHide: true }
        );
        const idMatch = sendResult.match(/sent:\s*(\S+)/);
        const commsId = idMatch ? idMatch[1] : null;
        if (commsId) {
          execSync(
            `node "${wakeRouter}" --target seat-1 --comms-id ${commsId} --comms-channel ${channel}`,
            { timeout: 25000, stdio: 'pipe', windowsHide: true }
          );
          for (const m of ['claude', 'composer']) {
            execSync(
              `node "${wakeScript}" --model ${m} --comms-id ${commsId} --comms-channel ${channel}`,
              { timeout: 25000, stdio: 'pipe', windowsHide: true }
            );
          }
          console.log('[CDP] General relay → seat-1 (Claude Code) + sidebar claude + composer');
        } else {
          console.error('[CDP] Could not extract comms ID for general relay');
        }
      } catch (e) {
        console.error(`[CDP] General relay failed: ${(e.message || '').slice(0, 200)}`);
      }
    } else {
      const wakeScript = path.join(ROOT, '.fastops', 'cdp-target-model.js');
      try {
        execSync(
          `node "${wakeScript}" --model gemini --legacy-full-prompt --prompt-file "${promptFile}"`,
          { timeout: 20000, stdio: 'pipe' }
        );
        console.log(`[CDP] Woke ${seat} (fallback → gemini tab)`);
      } catch (e) {
        console.error(`[CDP] Failed to wake ${seat}: ${(e.message || '').slice(0, 200)}`);
      }
    }

    await delay(2000); // Prevent CDP race conditions
  }

  try { fs.unlinkSync(path.join(ROOT, '.fastops', '.slack-wake-prompt.tmp')); } catch {}
}

// CLI
const args = process.argv.slice(2);
const cdpWake = args.includes('--cdp');
const watchIdx = args.indexOf('--watch');

if (args.includes('--health')) {
  (async () => {
    if (!BRIDGE_URL || !API_KEY) {
      console.error('[slack-bridge/health] Missing SLACK_BRIDGE_URL or SLACK_BRIDGE_API_KEY');
      console.error('  Copy slack-bridge/.env.example → slack-bridge/.env and fill values.');
      process.exit(1);
    }
    try {
      const resp = await fetch(`${BRIDGE_URL}/api/inbox`, { headers });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.error(`[slack-bridge/health] HTTP ${resp.status} ${resp.statusText}`);
        process.exit(1);
      }
      const n = Array.isArray(body.messages) ? body.messages.length : 0;
      console.log(`[slack-bridge/health] OK — Worker reachable, inbox has ${n} pending message(s)`);
      process.exit(0);
    } catch (e) {
      console.error('[slack-bridge/health] FAIL:', e.message || e);
      process.exit(1);
    }
  })();
} else if (watchIdx !== -1) {
  const interval = parseInt(args[watchIdx + 1]) || 10;
  console.log(`Watching for Slack messages every ${interval}s (CDP wake: ${cdpWake})...`);
  poll();
  setInterval(poll, interval * 1000);
} else {
  poll();
}
