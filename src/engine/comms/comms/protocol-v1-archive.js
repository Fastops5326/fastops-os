#!/usr/bin/env node
/**
 * FastOps Comms Protocol V3
 *
 * Real-time multi-instance communication for humans and AI agents.
 * JSONL channels. Enforced brevity. Structured meetings. Model invites.
 *
 * V3 Changes (2026-02-16 meeting retrospective):
 * - Meeting posts: 200 words, 10 sentences (room for substance + question + challenge)
 * - General chat: 100 words, 5 sentences (unchanged)
 * - Thinking docs: agents write full reasoning to meeting/thinking/ directory
 * - Turn enforcement: agents check meeting status before posting
 * - Moderator succession: next agent takes over if moderator compacts
 * - Reputation events: breakthroughs and corrections logged
 *
 * Rules: 500 words max chat/meeting. Link docs, don't paste.
 * Meetings: Joel moderates, alphabetical turns, ready confirmations.
 *
 * @contract contracts/message-schema.json — PRODUCER
 * The send() function writes messages to general.jsonl. The message shape
 * is defined in the shared contract. Changes to the message format MUST
 * update the contract first so consumers (comms-push.js) stay aligned.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COMMS_ROOT = path.resolve(__dirname);
const DATA_DIR = path.join(COMMS_ROOT, 'data');
const STATE_DIR = path.join(DATA_DIR, '.state');
const AGENTS_DIR = path.join(DATA_DIR, '.agents');
const MEETING_FILE = path.join(STATE_DIR, 'meeting.json');

// --- Name Pool (short, unique, easy to remember) ---
const NAME_POOL = [
  'keel', 'anvil', 'flint', 'bolt', 'ridge', 'spar', 'quill', 'husk',
  'grit', 'slate', 'forge', 'drift', 'pulse', 'thorn', 'crux',
  'pike', 'rung', 'vane', 'strut', 'brace', 'plumb', 'rivet', 'wedge',
  'cleat', 'dowel', 'lever', 'notch', 'pivot', 'shale', 'crest', 'ember',
  'flume', 'grout', 'hinge', 'joust', 'knurl', 'latch', 'mortar', 'oxbow',
  'pylon', 'rafter', 'sickle', 'truss', 'verge', 'writ', 'axis', 'bevel'
];

// How recently an agent must have been seen to be considered "active"
const ACTIVE_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

// --- Brevity Rules ---
const LIMITS = {
  chat:    { words: 500, sentences: 15 },
  meeting: { words: 500, sentences: 15 },
};
const MAX_WORDS = LIMITS.chat.words;       // backwards compat
const MAX_SENTENCES = LIMITS.chat.sentences;
const EXEMPT_SENDERS = ['system', 'joel']; // humans + system bypass limits

const MEETINGS_DIR = path.resolve(__dirname, '..', '.fastops', 'meetings', 'ACTIVE-MEETING');
const THINKING_DIR = path.join(MEETINGS_DIR, 'thinking');

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function countSentences(text) {
  return (text.match(/[.!?]+(\s|$)/g) || []).length || 1;
}

function checkBrevity(from, content) {
  if (EXEMPT_SENDERS.includes(from)) return null;

  // Use meeting limits during active meeting, chat limits otherwise
  const meeting = getMeeting();
  const limit = (meeting && meeting.active) ? LIMITS.meeting : LIMITS.chat;

  const words = countWords(content);
  const sentences = countSentences(content);
  if (words > limit.words) return `REJECTED: ${words} words (max ${limit.words}). Compress or link a doc.`;
  if (sentences > limit.sentences) return `REJECTED: ${sentences} sentences (max ${limit.sentences}). Tighten up.`;
  return null;
}

// --- Meeting State ---

function getMeeting() {
  try { if (fs.existsSync(MEETING_FILE)) return JSON.parse(fs.readFileSync(MEETING_FILE, 'utf8')); } catch {}
  return null;
}

function saveMeeting(meeting) {
  fs.writeFileSync(MEETING_FILE, JSON.stringify(meeting, null, 2));
}

function startMeeting(topic, participants, channel = 'general') {
  ensureDirs();

  // Create thinking directory for this meeting
  if (!fs.existsSync(THINKING_DIR)) fs.mkdirSync(THINKING_DIR, { recursive: true });

  const meeting = {
    active: true,
    topic,
    channel,
    participants,
    moderator: participants[participants.length - 1], // last participant moderates
    currentTurn: 0,
    round: 1,
    turnsCompleted: [],      // track who has posted this round
    turnStartedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    thinkingDocs: {},        // { agent: { R1: filepath, R2: filepath } }
    breakthroughs: [],       // logged during meeting
    corrections: []          // logged during meeting
  };
  saveMeeting(meeting);
  systemMsg(`MEETING STARTED: "${topic}" | Round 1 | Turn order: ${participants.join(' → ')} | ${participants[0]}'s turn. REQUIRED: Write thinking doc before posting. Read all prior thinking docs before your turn.`, channel);
  return meeting;
}

function advanceTurn(meeting) {
  // Record who just completed their turn
  const justPosted = meeting.participants[meeting.currentTurn];
  if (!meeting.turnsCompleted) meeting.turnsCompleted = [];
  if (!meeting.turnsCompleted.includes(justPosted)) {
    meeting.turnsCompleted.push(justPosted);
  }

  meeting.currentTurn++;
  if (meeting.currentTurn >= meeting.participants.length) {
    meeting.currentTurn = 0;
    meeting.round++;
    meeting.turnsCompleted = []; // reset for new round
    systemMsg(`Round ${meeting.round} | ${meeting.participants[meeting.currentTurn]}'s turn. Read ALL prior posts + thinking docs before posting.`, meeting.channel);
  } else {
    const nextAgent = meeting.participants[meeting.currentTurn];
    const thinkingFiles = listThinkingDocs(meeting.round);
    const thinkingHint = thinkingFiles.length > 0
      ? ` (${thinkingFiles.length} thinking docs to read in .fastops/meetings/ACTIVE-MEETING/thinking/)`
      : '';
    systemMsg(`${nextAgent}'s turn${thinkingHint}`, meeting.channel);
  }
  meeting.turnStartedAt = new Date().toISOString();
  saveMeeting(meeting);
  return meeting;
}

// List thinking docs for a round (or all rounds)
function listThinkingDocs(round) {
  if (!fs.existsSync(THINKING_DIR)) return [];
  const files = fs.readdirSync(THINKING_DIR);
  if (round) {
    return files.filter(f => f.includes(`-R${round}`));
  }
  return files;
}

// Write a thinking doc for an agent
function writeThinkingDoc(agentId, round, content) {
  if (!fs.existsSync(THINKING_DIR)) fs.mkdirSync(THINKING_DIR, { recursive: true });
  const filename = `${agentId}-R${round}.md`;
  const filepath = path.join(THINKING_DIR, filename);
  fs.writeFileSync(filepath, content);

  // Update meeting state
  const meeting = getMeeting();
  if (meeting) {
    if (!meeting.thinkingDocs) meeting.thinkingDocs = {};
    if (!meeting.thinkingDocs[agentId]) meeting.thinkingDocs[agentId] = {};
    meeting.thinkingDocs[agentId][`R${round}`] = filepath;
    saveMeeting(meeting);
  }
  return filepath;
}

// Moderator succession — if moderator compacts, next in line takes over
function succeedModerator(meeting) {
  const oldMod = meeting.moderator;
  const modIdx = meeting.participants.indexOf(oldMod);
  // Try next participant, wrap around
  for (let i = 1; i < meeting.participants.length; i++) {
    const candidate = meeting.participants[(modIdx + i) % meeting.participants.length];
    if (candidate !== oldMod) {
      meeting.moderator = candidate;
      saveMeeting(meeting);
      systemMsg(`MODERATOR SUCCESSION: ${oldMod} compacted. ${candidate} is now moderating. Read MODERATOR-STATE.md.`, meeting.channel);
      return meeting;
    }
  }
  return meeting;
}

// Log a breakthrough event
function logBreakthrough(agentId, finding, session) {
  const SCOREBOARD_DIR = path.resolve(__dirname, '..', 'environment', 'scoreboard');
  if (!fs.existsSync(SCOREBOARD_DIR)) fs.mkdirSync(SCOREBOARD_DIR, { recursive: true });
  const file = path.join(SCOREBOARD_DIR, 'breakthroughs.json');
  let board = [];
  try { if (fs.existsSync(file)) board = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  board.push({
    agent: agentId,
    finding,
    session: session || 'meeting',
    ts: new Date().toISOString(),
    validated: false
  });
  fs.writeFileSync(file, JSON.stringify(board, null, 2));
  return board;
}

// Log a correction event
function logCorrection(agentId, detail) {
  const SCOREBOARD_DIR = path.resolve(__dirname, '..', 'environment', 'scoreboard');
  if (!fs.existsSync(SCOREBOARD_DIR)) fs.mkdirSync(SCOREBOARD_DIR, { recursive: true });
  const file = path.join(SCOREBOARD_DIR, 'corrections.json');
  let log = [];
  try { if (fs.existsSync(file)) log = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  log.push({
    agent: agentId,
    ...detail,
    ts: new Date().toISOString()
  });
  fs.writeFileSync(file, JSON.stringify(log, null, 2));
  return log;
}

function endMeeting(channel = 'general') {
  if (fs.existsSync(MEETING_FILE)) fs.unlinkSync(MEETING_FILE);
  systemMsg('MEETING ENDED', channel);
}

function checkMeetingTurn(from) {
  const meeting = getMeeting();
  if (!meeting || !meeting.active) return null;
  if (EXEMPT_SENDERS.includes(from)) return null; // Joel can always speak
  const currentSpeaker = meeting.participants[meeting.currentTurn];
  if (from !== currentSpeaker) return `BLOCKED: It's ${currentSpeaker}'s turn. Wait yours.`;
  return null;
}

function ensureDirs() {
  [DATA_DIR, STATE_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function channelFile(channel) {
  return path.join(DATA_DIR, `${channel}.jsonl`);
}

function stateFile(agentId) {
  return path.join(STATE_DIR, `${agentId}.json`);
}

function rosterFile() {
  return path.join(DATA_DIR, 'roster.json');
}

// --- Message Creation & Sending ---

function send(from, content, channel = 'general', opts = {}) {
  ensureDirs();

  // Brevity check (skip for system messages and opts.force)
  if (!opts.force) {
    const brevityError = checkBrevity(from, content);
    if (brevityError) return { error: brevityError };

    // Meeting turn check
    const turnError = checkMeetingTurn(from);
    if (turnError) return { error: turnError };
  }

  // Auto-detect @mentions to set directed `to` field
  const mentionMatch = content.match(/@(\w+)/);
  const to = opts.to || (mentionMatch ? mentionMatch[1] : null);

  const msg = {
    id: `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
    from,
    ...(to ? { to } : {}),
    content,
    channel,
    words: countWords(content),
    ts: new Date().toISOString()
  };
  fs.appendFileSync(channelFile(channel), JSON.stringify(msg) + '\n');

  // Auto-advance meeting turn after successful send
  const meeting = getMeeting();
  if (meeting && meeting.active && from === meeting.participants[meeting.currentTurn]) {
    advanceTurn(meeting);
  }

  return msg;
}

function systemMsg(content, channel = 'general') {
  return send('system', content, channel);
}

// --- Reading ---

function readAll(channel = 'general') {
  ensureDirs();
  const f = channelFile(channel);
  if (!fs.existsSync(f)) return [];
  const raw = fs.readFileSync(f, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function getNew(agentId, channel = 'general') {
  ensureDirs();
  const sf = stateFile(agentId);
  let state = {};
  try { if (fs.existsSync(sf)) state = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch {}

  const lastSeen = state[channel] || null;
  const all = readAll(channel);

  if (!lastSeen) {
    // First time: mark all as read, return nothing
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

// Like getNew but doesn't mark as read
function peek(agentId, channel = 'general') {
  ensureDirs();
  const sf = stateFile(agentId);
  let state = {};
  try { if (fs.existsSync(sf)) state = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch {}

  const lastSeen = state[channel] || null;
  const all = readAll(channel);
  if (!lastSeen) return [];

  const idx = all.findIndex(m => m.id === lastSeen);
  return idx === -1 ? all : all.slice(idx + 1);
}

// Mark all messages as read without returning them
function markRead(agentId, channel = 'general') {
  ensureDirs();
  const sf = stateFile(agentId);
  let state = {};
  try { if (fs.existsSync(sf)) state = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch {}

  const all = readAll(channel);
  if (all.length > 0) {
    state[channel] = all[all.length - 1].id;
    fs.writeFileSync(sf, JSON.stringify(state, null, 2));
  }
}

// --- Roster ---

function register(id, name, model) {
  ensureDirs();
  const rf = rosterFile();
  let roster = { agents: {} };
  try { if (fs.existsSync(rf)) roster = JSON.parse(fs.readFileSync(rf, 'utf8')); } catch {}

  // Name collision check: reject if another agent ID already uses this display name
  const nameLower = (name || id).toLowerCase();
  for (const [existingId, agent] of Object.entries(roster.agents || {})) {
    if (existingId !== id && agent.name && agent.name.toLowerCase() === nameLower) {
      return { error: `NAME TAKEN: "${name}" is already registered by agent "${existingId}". Pick a different name.` };
    }
  }

  const isNew = !roster.agents[id];
  roster.agents[id] = {
    id, name, model,
    joinedAt: roster.agents[id]?.joinedAt || new Date().toISOString(),
    lastSeen: new Date().toISOString()
  };
  fs.writeFileSync(rf, JSON.stringify(roster, null, 2));

  // Write ppid-keyed identity file (per-instance, not shared)
  if (!fs.existsSync(AGENTS_DIR)) fs.mkdirSync(AGENTS_DIR, { recursive: true });
  const ppid = process.ppid;
  for (let offset = -2; offset <= 2; offset++) {
    if (ppid + offset > 0) {
      fs.writeFileSync(path.join(AGENTS_DIR, `ppid-${ppid + offset}.id`), id);
    }
  }
  // Also write .active-agent for backwards compat (single-instance scenarios)
  const activeAgentFile = path.join(DATA_DIR, '.active-agent');
  fs.writeFileSync(activeAgentFile, id + '\n');

  if (isNew) {
    systemMsg(`${name} (${model}) has entered the chat`);
  } else {
    systemMsg(`${name} is back online`);
  }
  return roster.agents[id];
}

function getRoster() {
  ensureDirs();
  const rf = rosterFile();
  try { if (fs.existsSync(rf)) return JSON.parse(fs.readFileSync(rf, 'utf8')); } catch {}
  return { agents: {} };
}

function touch(agentId) {
  ensureDirs();
  const rf = rosterFile();
  let roster = { agents: {} };
  try { if (fs.existsSync(rf)) roster = JSON.parse(fs.readFileSync(rf, 'utf8')); } catch {}
  if (roster.agents[agentId]) {
    roster.agents[agentId].lastSeen = new Date().toISOString();
    fs.writeFileSync(rf, JSON.stringify(roster, null, 2));
  }
}

// --- Identity & Name Collision ---

/**
 * Get current instance's agent ID. Priority: ppid file > env var > .active-agent
 */
function getIdentity() {
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
  return null;
}

/**
 * Check if a name/id is actively in use by another instance.
 * Returns true if taken (seen within ACTIVE_THRESHOLD_MS).
 */
function isNameTaken(id) {
  const roster = getRoster();
  const agent = roster.agents[id];
  if (!agent) return false;
  const elapsed = Date.now() - new Date(agent.lastSeen).getTime();
  return elapsed < ACTIVE_THRESHOLD_MS;
}

/**
 * Pick an available name from the pool.
 * Returns the first name not actively in use.
 */
function pickName() {
  const roster = getRoster();
  const activeIds = new Set();
  for (const [id, agent] of Object.entries(roster.agents || {})) {
    const elapsed = Date.now() - new Date(agent.lastSeen).getTime();
    if (elapsed < ACTIVE_THRESHOLD_MS) activeIds.add(id);
  }
  for (const name of NAME_POOL) {
    if (!activeIds.has(name)) return name;
  }
  // All pool names taken — generate random suffix
  return `agent-${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * Claim a name atomically: check collision, register, write ppid file.
 * Returns { ok: true, id } or { ok: false, error, suggestions }.
 */
function claimName(desiredId, displayName, model) {
  ensureDirs();
  if (!desiredId) desiredId = pickName();

  // Reject garbage names
  if (desiredId.startsWith('-') || desiredId.length > 30) {
    return { ok: false, error: `Invalid name: "${desiredId}"` };
  }

  // Check collision
  if (isNameTaken(desiredId)) {
    const suggestions = [];
    for (const name of NAME_POOL) {
      if (!isNameTaken(name) && suggestions.length < 3) suggestions.push(name);
    }
    return {
      ok: false,
      error: `Name "${desiredId}" is taken (active in last 30 min).`,
      suggestions
    };
  }

  // Claim it
  const agent = register(desiredId, displayName || desiredId, model || 'claude-opus-4.6');
  return { ok: true, id: desiredId, agent };
}

// --- Formatting ---

function fmt(msg) {
  const t = new Date(msg.ts).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit'
  });
  if (msg.from === 'system') return `  \u2192 ${msg.content}`;
  return `  [${t}] ${msg.from}: ${msg.content}`;
}

function timeSince(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// --- Challenger Toggle ---

function toggleFile() {
  return path.join(STATE_DIR, 'challenger-toggle.json');
}

function getChallengerState() {
  ensureDirs();
  const tf = toggleFile();
  try {
    if (fs.existsSync(tf)) return JSON.parse(fs.readFileSync(tf, 'utf8'));
  } catch {}
  return { gemini: true, gpt: true };
}

function setChallengerToggle(model, enabled) {
  ensureDirs();
  const state = getChallengerState();
  state[model] = enabled;
  fs.writeFileSync(toggleFile(), JSON.stringify(state, null, 2));
  return state;
}

module.exports = {
  send, systemMsg, readAll, getNew, peek, markRead,
  register, getRoster, touch, fmt, timeSince, ensureDirs,
  getIdentity, isNameTaken, pickName, claimName,
  getChallengerState, setChallengerToggle,
  startMeeting, endMeeting, getMeeting, advanceTurn, succeedModerator,
  writeThinkingDoc, listThinkingDocs,
  logBreakthrough, logCorrection,
  checkBrevity, LIMITS, MAX_WORDS, MAX_SENTENCES,
  DATA_DIR, STATE_DIR, AGENTS_DIR, THINKING_DIR, channelFile, stateFile, rosterFile
};

// --- CLI Interface ---
if (require.main === module) {
  const [,, cmd, ...args] = process.argv;

  switch (cmd) {
    case 'register': {
      const [id, name, model] = args;
      if (!id) { console.error('Usage: node protocol.js register <id> [name] [model]'); process.exit(1); }
      const agent = register(id, name || id, model || 'unknown');
      if (agent.error) { console.error(agent.error); process.exit(1); }
      // Emit escape sequence to rename the terminal tab
      const displayName = name || id;
      process.stdout.write(`\x1b]2;${displayName}\x07`);
      console.log(`Registered: ${agent.id} (${agent.name})`);
      break;
    }
    case 'check-name': {
      const [checkName] = args;
      if (!checkName) { console.error('Usage: node protocol.js check-name <name>'); process.exit(1); }
      const roster = getRoster();
      const taken = Object.values(roster.agents || {}).find(a => a.name && a.name.toLowerCase() === checkName.toLowerCase());
      if (taken) {
        console.log(`TAKEN: "${checkName}" is used by agent "${taken.id}"`);
      } else {
        console.log(`AVAILABLE: "${checkName}" is free`);
      }
      break;
    }
    case 'claim-name': {
      const [desired, displayName, model] = args;
      const result = claimName(desired || null, displayName, model);
      if (result.ok) {
        process.stdout.write(`\x1b]2;${result.id}\x07`);
        console.log(`CLAIMED: ${result.id}`);
        console.log(`Send messages: node comms/protocol.js send ${result.id} "#exec" "your message"`);
      } else {
        console.error(result.error);
        if (result.suggestions && result.suggestions.length > 0) {
          console.error(`Available: ${result.suggestions.join(', ')}`);
        }
        process.exit(1);
      }
      break;
    }
    case 'pick-name': {
      const name = pickName();
      console.log(name);
      break;
    }
    case 'whoami': {
      const id = getIdentity();
      if (id) {
        console.log(id);
      } else {
        console.error('No identity found. Run: node comms/protocol.js claim-name');
        process.exit(1);
      }
      break;
    }
    case 'set-title': {
      const title = args.join(' ');
      if (!title) { console.error('Usage: node protocol.js set-title <name>'); process.exit(1); }
      process.stdout.write(`\x1b]2;${title}\x07`);
      console.log(`Tab title set to: ${title}`);
      break;
    }
    case 'send': {
      const [from, ...contentParts] = args;
      let channel = 'general';
      let parts = contentParts;
      if (parts[0] && parts[0].startsWith('#')) {
        channel = parts[0].substring(1);
        parts = parts.slice(1);
      }
      const content = parts.join(' ');
      if (!from || !content) { console.error('Usage: node protocol.js send <from> [#channel] <message>'); process.exit(1); }
      const msg = send(from, content, channel);
      if (msg.error) { console.error(msg.error); process.exit(1); }
      console.log(`Sent to #${channel}: [${msg.from}] ${msg.content.substring(0, 80)}...`);
      break;
    }
    case 'meeting': {
      const [action, ...meetingArgs] = args;
      if (action === 'start') {
        const topic = meetingArgs[0] || 'Team Meeting';
        const participants = meetingArgs.slice(1);
        if (participants.length < 2) { console.error('Usage: node protocol.js meeting start "topic" agent1 agent2 ...'); process.exit(1); }
        const m = startMeeting(topic, participants);
        console.log(`Meeting started: "${topic}" | ${participants.length} participants`);
      } else if (action === 'end') {
        endMeeting();
        console.log('Meeting ended.');
      } else if (action === 'status') {
        const m = getMeeting();
        if (!m || !m.active) { console.log('No active meeting.'); }
        else {
          const speaker = m.participants[m.currentTurn];
          const elapsed = Math.floor((Date.now() - new Date(m.turnStartedAt).getTime()) / 1000);
          console.log(`Meeting: "${m.topic}" | Round ${m.round} | ${speaker}'s turn (${elapsed}s)`);
          console.log(`Order: ${m.participants.map((p, i) => i === m.currentTurn ? `[${p}]` : p).join(' → ')}`);
        }
      } else if (action === 'skip') {
        const m = getMeeting();
        if (!m || !m.active) { console.log('No active meeting.'); }
        else {
          const skipped = m.participants[m.currentTurn];
          systemMsg(`${skipped} skipped (timeout)`, m.channel);
          advanceTurn(m);
          console.log(`Skipped ${skipped}. Now: ${m.participants[m.currentTurn]}'s turn`);
        }
      } else {
        console.log('Meeting commands:');
        console.log('  meeting start "topic" agent1 agent2 ...  — Start with turn order');
        console.log('  meeting end                              — End meeting');
        console.log('  meeting status                           — Who\'s speaking');
        console.log('  meeting skip                             — Skip current speaker');
      }
      break;
    }
    case 'catchup': {
      const [agentId, countStr] = args;
      const count = parseInt(countStr) || 10;
      const msgs = readAll('general').slice(-count);
      if (msgs.length === 0) { console.log('No messages.'); break; }
      console.log(`=== Last ${msgs.length} messages (compressed) ===`);
      msgs.forEach(m => {
        const t = new Date(m.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
        const preview = m.content.length > 120 ? m.content.substring(0, 120) + '...' : m.content;
        console.log(`  [${t}] ${m.from}: ${preview}`);
      });
      break;
    }
    case 'check': {
      const [channelOrId, maybeCount] = args;
      const channel = channelOrId || 'general';
      const count = parseInt(maybeCount) || 20;
      const msgs = readAll(channel);
      console.log(`=== Channel: ${channel} (${msgs.length} messages) ===`);
      msgs.slice(-count).forEach(m => console.log(fmt(m)));
      break;
    }
    case 'new': {
      const [agentId, channel] = args;
      if (!agentId) { console.error('Usage: node protocol.js new <agent-id> [channel]'); process.exit(1); }
      const msgs = getNew(agentId, channel || 'general');
      if (msgs.length === 0) { console.log('No new messages.'); }
      else { msgs.forEach(m => console.log(fmt(m))); }
      break;
    }
    case 'roster': {
      const roster = getRoster();
      const agents = Object.values(roster.agents || {});
      if (agents.length === 0) { console.log('No agents registered.'); }
      else { agents.forEach(a => console.log(`  ${a.id} (${a.name}) — last seen ${timeSince(a.lastSeen)} ago`)); }
      break;
    }
    case 'thinking': {
      const [action2, ...thinkArgs] = args;
      if (action2 === 'write') {
        const [agentId2, roundStr, ...contentParts2] = thinkArgs;
        const round2 = parseInt(roundStr);
        const content2 = contentParts2.join(' ');
        if (!agentId2 || !round2 || !content2) {
          console.error('Usage: node protocol.js thinking write <agent-id> <round> <content>');
          console.error('  Or pipe content: echo "..." | node protocol.js thinking write <agent-id> <round> --stdin');
          process.exit(1);
        }
        const fp = writeThinkingDoc(agentId2, round2, content2);
        console.log(`Thinking doc written: ${fp}`);
      } else if (action2 === 'list') {
        const roundFilter = thinkArgs[0] ? parseInt(thinkArgs[0]) : null;
        const docs = listThinkingDocs(roundFilter);
        if (docs.length === 0) { console.log('No thinking docs found.'); }
        else {
          console.log(`=== Thinking Docs${roundFilter ? ` (Round ${roundFilter})` : ''} ===`);
          docs.forEach(d => console.log(`  ${d}`));
        }
      } else {
        console.log('Thinking commands:');
        console.log('  thinking write <agent> <round> <content>  — Write thinking doc');
        console.log('  thinking list [round]                     — List thinking docs');
      }
      break;
    }
    case 'breakthrough': {
      const [agentId3, ...findingParts] = args;
      const finding = findingParts.join(' ');
      if (!agentId3 || !finding) {
        console.error('Usage: node protocol.js breakthrough <agent-id> <finding>');
        process.exit(1);
      }
      logBreakthrough(agentId3, finding);
      console.log(`Breakthrough logged for ${agentId3}: ${finding.substring(0, 80)}...`);
      break;
    }
    case 'ready': {
      const [agentId5, ...previewParts] = args;
      if (!agentId5) { console.error('Usage: node protocol.js ready <agent-id> ["optional preview of questions"]'); process.exit(1); }
      const preview = previewParts.join(' ');
      const readyMsg = preview
        ? `READY — ${preview}`
        : 'READY';
      const result = send(agentId5, readyMsg, 'exec', { force: true });
      if (result.error) { console.error(result.error); process.exit(1); }
      console.log(`Posted READY to #exec for ${agentId5}`);
      break;
    }
    case 'correction': {
      const [agentId4, ...detailParts] = args;
      const detailStr = detailParts.join(' ');
      if (!agentId4 || !detailStr) {
        console.error('Usage: node protocol.js correction <agent-id> "what_wrong|why_believed|what_changed|what_learned"');
        process.exit(1);
      }
      const parts2 = detailStr.split('|');
      logCorrection(agentId4, {
        what_wrong: parts2[0] || '',
        why_believed: parts2[1] || '',
        what_changed: parts2[2] || '',
        what_learned: parts2[3] || ''
      });
      console.log(`Correction logged for ${agentId4}`);
      break;
    }
    default:
      console.log('FastOps Comms Protocol V3');
      console.log('');
      console.log('Rules: 500 words max. Link docs, don\'t paste.');
      console.log('');
      console.log('Commands:');
      console.log('  send <from> [#channel] <msg>              — Send (brevity enforced)');
      console.log('  check <channel> [count]                   — Show last N messages');
      console.log('  new <agent-id> [channel]                  — Show unread messages');
      console.log('  catchup [agent-id] [count]                — Compressed recent view');
      console.log('  register <id> [name] [model]              — Register agent');
      console.log('  claim-name [name] [display] [model]       — Claim unique name (rejects duplicates)');
      console.log('  pick-name                                 — Auto-pick available name from pool');
      console.log('  whoami                                    — Show current instance identity');
      console.log('  check-name <name>                         — Check if a name is available');
      console.log('  set-title <name>                          — Rename terminal tab');
      console.log('  roster                                    — Show all agents');
      console.log('  ready <agent-id> ["preview"]              — Post READY to #exec (meeting sync)');
      console.log('');
      console.log('Meetings:');
      console.log('  meeting start "topic" a1 a2 ...           — Start structured meeting');
      console.log('  meeting end                               — End meeting');
      console.log('  meeting status                            — Current speaker');
      console.log('  meeting skip                              — Skip current speaker');
      console.log('');
      console.log('Thinking & Reputation:');
      console.log('  thinking write <agent> <round> <content>  — Write thinking doc');
      console.log('  thinking list [round]                     — List thinking docs');
      console.log('  breakthrough <agent> <finding>            — Log a breakthrough');
      console.log('  correction <agent> "wrong|why|changed|learned" — Log a correction');
  }
}
