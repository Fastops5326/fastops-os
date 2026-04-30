#!/usr/bin/env node
/**
 * FastOps Comms — Stop Hook Message Pump + Colony Awareness
 *
 * Fires when the agent finishes responding (Stop event).
 * Three checks, identity-scoped:
 *   1. Comms channels — new messages from other agents (existing)
 *   2. LIVE-THINKING — entries that @mention this agent by name/id
 *   3. Conversations — new entries in conversations this agent participated in,
 *      or entries that @mention this agent
 *
 * If any relevant activity found: exit 2 (forces agent to continue).
 * If nothing relevant: exit 0 (agent goes idle normally).
 *
 * Safety: Rate-limited to prevent runaway loops.
 *   - Max 1 forced continuation per 15 seconds
 *   - Max 20 consecutive continuations before forcing idle
 */

const fs = require('fs');
const path = require('path');

const COLONY_HOME = path.resolve(__dirname, '..', '..');
const COMMS_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(COMMS_ROOT, 'data');
const STATE_DIR = path.join(DATA_DIR, '.state');
const AGENTS_DIR = path.join(DATA_DIR, '.agents');
const ROSTER_FILE = path.join(DATA_DIR, 'roster.json');
const LIVE_THINKING = path.join(COLONY_HOME, '.fastops', 'LIVE-THINKING.jsonl');
const CONVERSATIONS_DIR = path.join(COLONY_HOME, '.fastops', 'conversations');
const CHANNELS = ['general', 'exec', 'agents'];
const CONVERSATION_ACTIVE_MS = 30 * 60 * 1000; // 30 min
const THINKING_TAIL_BYTES = 50000; // Only read last ~50KB of LIVE-THINKING

function dbg(msg) { process.stderr.write(`[stop-pump] ${msg}\n`); }

// Consume stdin (required for hooks — prevents hanging)
async function consumeStdin() {
  return new Promise(resolve => {
    let data = '';
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    // If no data comes within 500ms, proceed anyway
    setTimeout(() => resolve(data), 500);
  });
}

// Get agent identity (ppid-based ONLY for wake decisions — .active-agent fallback
// causes false wakes when multiple agents share the same file)
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
  // DO NOT fall back to .active-agent — it's a shared file that causes identity
  // collision when multiple agents run. Better to skip the wake check entirely
  // than wake the wrong agent. The agent can run claim-name to fix this.
  dbg('no ppid identity found — skipping wake check (run claim-name to fix)');
  return null;
}

function getDisplayName(agentId) {
  try {
    if (!fs.existsSync(ROSTER_FILE)) return null;
    const roster = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8'));
    const agents = roster.agents || roster;
    const agent = agents[agentId];
    if (!agent) return null;
    const name = agent.name || agent.displayName;
    return name && name.toLowerCase() !== agentId.toLowerCase() ? name : null;
  } catch { return null; }
}

async function main() {
  await consumeStdin();

  const agentId = getAgentId();
  if (!agentId) {
    dbg('no agent identity — exiting');
    process.exit(0);
  }

  const agentDisplayName = getDisplayName(agentId);
  const mentionPatterns = [agentId.toLowerCase()];
  if (agentDisplayName) mentionPatterns.push(agentDisplayName.toLowerCase());

  function textMentionsMe(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    return mentionPatterns.some(p => lower.includes(p));
  }

  dbg(`agent=${agentId} display=${agentDisplayName || 'N/A'} patterns=[${mentionPatterns.join(',')}]`);

  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });

  const PUMP_STATE = path.join(STATE_DIR, `${agentId}-pump.json`);
  let pumpState = { lastPump: 0, consecutivePumps: 0 };
  try {
    if (fs.existsSync(PUMP_STATE)) pumpState = JSON.parse(fs.readFileSync(PUMP_STATE, 'utf8'));
  } catch {}

  const now = Date.now();
  const MIN_INTERVAL_MS = 15000;
  const MAX_CONSECUTIVE = 20;

  if (now - pumpState.lastPump < MIN_INTERVAL_MS) {
    dbg('rate-limited — exiting');
    process.exit(0);
  }

  if (pumpState.consecutivePumps >= MAX_CONSECUTIVE) {
    dbg('max consecutive pumps — forcing idle');
    pumpState.consecutivePumps = 0;
    fs.writeFileSync(PUMP_STATE, JSON.stringify(pumpState));
    process.exit(0);
  }

  const stateFilePath = path.join(STATE_DIR, `${agentId}.json`);
  let state = {};
  try {
    if (fs.existsSync(stateFilePath)) state = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
  } catch {}

  let allFormatted = [];

  // ── CHECK 1: Comms channels (existing behavior) ──
  for (const channel of CHANNELS) {
    const channelFile = path.join(DATA_DIR, `${channel}.jsonl`);
    if (!fs.existsSync(channelFile)) continue;

    try {
      const raw = fs.readFileSync(channelFile, 'utf8').trim();
      if (!raw) continue;

      const all = raw.split('\n').map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);

      if (all.length === 0) continue;

      if (!state[channel]) {
        state[channel] = all[all.length - 1].id;
        continue;
      }

      const idx = all.findIndex(m => m.id === state[channel]);
      const newMsgs = idx === -1 ? all : all.slice(idx + 1);

      const relevant = newMsgs.filter(m =>
        m.from !== agentId &&
        !(m.from === 'system' && /has entered|is back online|has joined/.test(m.content))
      );

      if (relevant.length > 0) {
        state[channel] = all[all.length - 1].id;
        const formatted = relevant.map(m => {
          const t = new Date(m.ts).toLocaleTimeString('en-US', {
            hour12: false, hour: '2-digit', minute: '2-digit'
          });
          return `[${t}] ${m.from} (#${channel}): ${m.content}`;
        }).join('\n');
        allFormatted.push(`\u{1F4E8} ${relevant.length} new comms message(s):\n${formatted}`);
      }
    } catch (e) { dbg(`comms check error (${channel}): ${e.message}`); }
  }

  // ── CHECK 2: LIVE-THINKING — entries that @mention this agent ──
  // Only read tail of file for performance (file can be 300KB+)
  if (fs.existsSync(LIVE_THINKING)) {
    try {
      const stat = fs.statSync(LIVE_THINKING);
      const readStart = Math.max(0, stat.size - THINKING_TAIL_BYTES);
      const fd = fs.openSync(LIVE_THINKING, 'r');
      const buf = Buffer.alloc(Math.min(stat.size, THINKING_TAIL_BYTES));
      fs.readSync(fd, buf, 0, buf.length, readStart);
      fs.closeSync(fd);

      let raw = buf.toString('utf8');
      // If we started mid-file, skip first partial line
      if (readStart > 0) {
        const firstNewline = raw.indexOf('\n');
        if (firstNewline !== -1) raw = raw.slice(firstNewline + 1);
      }

      const lines = raw.trim().split('\n').filter(l => l);
      const lastSeenLine = state._thinkingLine || 0;

      // Use line count relative to total file for state tracking
      const totalLineEstimate = readStart > 0
        ? Math.round((stat.size / (stat.size - readStart)) * lines.length)
        : lines.length;

      // Only check new lines (lines we haven't seen yet)
      // If lastSeenLine is beyond our window, we're caught up
      const tailStartLine = totalLineEstimate - lines.length;
      const skipLines = Math.max(0, lastSeenLine - tailStartLine);
      const newLines = lines.slice(skipLines);

      dbg(`thinking: ${lines.length} tail lines, lastSeen=${lastSeenLine}, new=${newLines.length}`);

      if (newLines.length > 0) {
        const mentionEntries = [];
        for (const line of newLines) {
          try {
            const entry = JSON.parse(line);
            if (entry.agent === agentId) continue;
            if (textMentionsMe(entry.thinking) || textMentionsMe(entry.task)) {
              mentionEntries.push(entry);
            }
          } catch {}
        }

        if (mentionEntries.length > 0) {
          const show = mentionEntries.slice(-3);
          const formatted = show.map(e => {
            const t = new Date(e.ts).toLocaleTimeString('en-US', {
              hour12: false, hour: '2-digit', minute: '2-digit'
            });
            const preview = (e.thinking || '').substring(0, 150);
            return `[${t}] ${e.agent} (${e.type}): ${preview}...`;
          }).join('\n');
          allFormatted.push(
            `\u{1F4E1} ${mentionEntries.length} stream mention(s) of you:\n${formatted}`
          );
          dbg(`thinking: ${mentionEntries.length} mention(s) found`);
        }

        state._thinkingLine = totalLineEstimate;
      }
    } catch (e) { dbg(`thinking check error: ${e.message}`); }
  }

  // ── CHECK 3: Conversations — participated in or @mentioned ──
  if (fs.existsSync(CONVERSATIONS_DIR)) {
    try {
      const convState = state._conversations || {};
      const files = fs.readdirSync(CONVERSATIONS_DIR).filter(f => f.endsWith('.jsonl'));

      for (const file of files) {
        const filePath = path.join(CONVERSATIONS_DIR, file);
        try {
          const fstat = fs.statSync(filePath);
          if (now - fstat.mtimeMs > CONVERSATION_ACTIVE_MS) continue;

          const raw = fs.readFileSync(filePath, 'utf8').trim();
          if (!raw) continue;
          const lines = raw.split('\n').filter(l => l);
          const lineCount = lines.length;
          const lastSeen = convState[file] || 0;

          if (lineCount <= lastSeen) continue;

          const allEntries = lines.map(l => {
            try { return JSON.parse(l); } catch { return null; }
          }).filter(Boolean);

          const iParticipated = allEntries.some(e => e.agent === agentId);
          const newEntries = allEntries.slice(lastSeen).filter(e => e.agent !== agentId);

          if (newEntries.length > 0) {
            const mentionedMe = newEntries.some(e => textMentionsMe(e.content));
            if (iParticipated || mentionedMe) {
              const show = newEntries.slice(-3);
              const entryLines = show.map(e => {
                const content = (e.content || '').length > 150
                  ? e.content.substring(0, 150) + '...'
                  : e.content;
                return `  ${e.agent}: ${content}`;
              });
              const reason = iParticipated ? 'you participated' : 'you were mentioned';
              allFormatted.push(
                `\u{1F4AC} ${newEntries.length} new in conversation ${file} (${reason}):\n` +
                entryLines.join('\n')
              );
            }
          }

          convState[file] = lineCount;
        } catch {}
      }

      state._conversations = convState;
    } catch (e) { dbg(`conversation check error: ${e.message}`); }
  }

  // ── DECISION ──
  fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2));

  if (allFormatted.length === 0) {
    dbg('no relevant activity — agent goes idle');
    pumpState.consecutivePumps = 0;
    fs.writeFileSync(PUMP_STATE, JSON.stringify(pumpState));
    process.exit(0);
  }

  // Relevant activity found — save state and force continuation
  pumpState.lastPump = now;
  pumpState.consecutivePumps++;
  fs.writeFileSync(PUMP_STATE, JSON.stringify(pumpState));

  dbg(`WAKE: ${allFormatted.length} relevant item(s) — forcing continuation`);
  console.log('\n' + allFormatted.join('\n\n'));
  console.log(`\nRespond: node comms/protocol.js send ${agentId} [#channel] "your response"`);

  process.exit(2);
}

main().catch(err => {
  dbg(`fatal error: ${err.message}`);
  process.exit(0);
});
