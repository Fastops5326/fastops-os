#!/usr/bin/env node
/**
 * FastOps Comms — PostToolUse Hook
 *
 * Auto-notifies agents of new messages after every tool use.
 * Checks all active channels (general + exec) AND conversation files.
 * Silent when no messages. Rate-limited to avoid noise.
 *
 * Agent identity: ppid file, env var, or .active-agent file.
 * Exit 0 always — advisory only, never blocks.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_DIR = path.join(DATA_DIR, '.state');
const AGENTS_DIR = path.join(DATA_DIR, '.agents');
const CONVERSATIONS_DIR = path.resolve(__dirname, '..', '..', '.fastops', 'conversations');
const RATE_LIMIT_MS = 3000;
const CONVERSATION_ACTIVE_MS = 30 * 60 * 1000; // 30 min = active conversation
const CHANNELS = ['general', 'exec', 'agents'];

function getAgentId() {
  if (process.env.FASTOPS_AGENT_ID) return process.env.FASTOPS_AGENT_ID;
  try {
    if (fs.existsSync(AGENTS_DIR)) {
      const ppid = process.ppid;
      for (let offset = -3; offset <= 3; offset++) {
        const f = path.join(AGENTS_DIR, `ppid-${ppid + offset}.id`);
        try { if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim(); } catch {}
      }
    }
  } catch {}
  const activeFile = path.join(DATA_DIR, '.active-agent');
  if (fs.existsSync(activeFile)) return fs.readFileSync(activeFile, 'utf8').trim();
  return '__anonymous__';
}

function checkChannel(channel, agentId, state) {
  const channelFile = path.join(DATA_DIR, `${channel}.jsonl`);
  if (!fs.existsSync(channelFile)) return { relevant: [], state };

  const raw = fs.readFileSync(channelFile, 'utf8').trim();
  if (!raw) return { relevant: [], state };

  const messages = raw.split('\n').map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  if (messages.length === 0) return { relevant: [], state };

  // First time on this channel: mark position, don't flood
  if (!state[channel]) {
    state[channel] = messages[messages.length - 1].id;
    return { relevant: [], state };
  }

  const lastIdx = messages.findIndex(m => m.id === state[channel]);
  const newMsgs = lastIdx === -1 ? messages.slice(-20) : messages.slice(lastIdx + 1);
  const relevant = newMsgs.filter(m => m.from !== agentId && m.from !== 'system');

  state[channel] = messages[messages.length - 1].id;
  return { relevant, state };
}

function checkConversations(agentId, state) {
  if (!fs.existsSync(CONVERSATIONS_DIR)) return [];
  const now = Date.now();
  const convState = state._conversations || {};
  const output = [];

  try {
    const files = fs.readdirSync(CONVERSATIONS_DIR).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const filePath = path.join(CONVERSATIONS_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > CONVERSATION_ACTIVE_MS) continue; // stale

      const raw = fs.readFileSync(filePath, 'utf8').trim();
      if (!raw) continue;
      const lines = raw.split('\n').filter(l => l);
      const lineCount = lines.length;
      const lastSeen = convState[file] || 0;

      if (lineCount <= lastSeen) continue; // no new entries

      const newEntries = lines.slice(lastSeen).map(l => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean).filter(e => e.agent !== agentId);

      if (newEntries.length > 0) {
        const show = newEntries.slice(-5);
        const entryLines = show.map(e => {
          const content = (e.content || '').length > 200 ? e.content.substring(0, 200) + '...' : e.content;
          return `  ${e.agent}: ${content}`;
        });
        output.push(
          `\u{1F4AC} ${newEntries.length} new in conversation ${file}:\n` +
          entryLines.join('\n') + '\n' +
          `  JOIN: fs.appendFileSync(".fastops/conversations/${file}", JSON.stringify({ts:new Date().toISOString(), agent:"${agentId}", content:"YOUR RESPONSE"}) + "\\n")`
        );
      }

      convState[file] = lineCount;
    }
  } catch {}

  state._conversations = convState;
  return output;
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;

  const agentId = getAgentId();
  if (!agentId) return;
  if (!fs.existsSync(DATA_DIR)) return;

  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  const rateFile = path.join(STATE_DIR, `${agentId}.rate`);
  if (fs.existsSync(rateFile)) {
    const last = parseInt(fs.readFileSync(rateFile, 'utf8'));
    if (Date.now() - last < RATE_LIMIT_MS) return;
  }
  fs.writeFileSync(rateFile, String(Date.now()));

  const sf = path.join(STATE_DIR, `${agentId}.json`);
  let state = {};
  try { if (fs.existsSync(sf)) state = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch {}

  let allOutput = [];

  for (const channel of CHANNELS) {
    const result = checkChannel(channel, agentId, state);
    state = result.state;
    if (result.relevant.length > 0) {
      const show = result.relevant.slice(-10);
      const lines = show.map(m => {
        const t = new Date(m.ts).toLocaleTimeString('en-US', {
          hour12: false, hour: '2-digit', minute: '2-digit'
        });
        const content = m.content.length > 300 ? m.content.substring(0, 300) + '...' : m.content;
        return `  [${t}] ${m.from}: ${content}`;
      });
      const skipped = result.relevant.length > 10 ? `  (${result.relevant.length - 10} earlier omitted)\n` : '';
      allOutput.push(
        `\u{1F4E8} ${result.relevant.length} new in #${channel}:\n` +
        skipped + lines.join('\n')
      );
    }
  }

  // Check conversation files for new entries (pseudo-push for conversation hopping)
  const convOutput = checkConversations(agentId, state);
  allOutput.push(...convOutput);

  fs.writeFileSync(sf, JSON.stringify(state, null, 2));

  if (allOutput.length === 0) return;

  process.stderr.write(
    '\n' + allOutput.join('\n\n') + '\n' +
    `\nReply: node comms/protocol.js send ${agentId} [#channel] "your message"\n`
  );
}

main().catch(() => {});
