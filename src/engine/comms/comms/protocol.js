#!/usr/bin/env node
/**
 * FastOps Comms Protocol — V2 Shim
 *
 * This file re-exports from protocol-v2.js (the real implementation)
 * and provides backward-compatible stubs for V1 features that were removed.
 *
 * V2 (Block 9, 3-round jailbreak): messaging → stigmergy.
 * Coordination through contracts, not messages.
 * See: FastOps AI V2/comms/DESIGN.md
 *
 * Archived V1: protocol-v1-archive.js (823 lines)
 * Active V2:   protocol-v2.js (155 lines)
 */

const path = require('path');
const fs = require('fs');

// ─── V2 Core (real implementation) ──────────────────────────────────────────

const v2 = require('./protocol-v2');

// Re-export all V2 functions
const {
  send, systemMsg, readAll, getNew, peek, markRead, fmt, timeSince,
  DATA_DIR, channelFile, stateFile
} = v2;

// ─── V1 Backward Compatibility Stubs ────────────────────────────────────────
// These functions were removed in V2 (meetings, roster, thinking docs, brevity).
// Stubs exist so existing require() calls don't crash.
// None of these were voluntarily adopted by any agent (W-30).

const STATE_DIR = path.join(DATA_DIR, '.state');
const AGENTS_DIR = path.join(DATA_DIR, '.agents');
const THINKING_DIR = path.resolve(__dirname, '..', '.fastops', 'meetings', 'ACTIVE-MEETING', 'thinking');

function ensureDirs() {
  [DATA_DIR, STATE_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

function rosterFile() {
  return path.join(DATA_DIR, 'roster.json');
}

// Roster stubs — return safe defaults
function register(id, name, model) {
  return { id, name: name || id, model: model || 'unknown', joinedAt: new Date().toISOString(), lastSeen: new Date().toISOString() };
}
function getRoster() {
  try {
    const rf = rosterFile();
    if (fs.existsSync(rf)) return JSON.parse(fs.readFileSync(rf, 'utf8'));
  } catch {}
  return { agents: {} };
}
function touch() {}
function getIdentity() { return process.env.FASTOPS_AGENT_ID || null; }
function isNameTaken() { return false; }
function pickName() { return 'agent-' + Math.random().toString(36).substring(2, 8); }
function claimName(desired, display, model) { return { ok: true, id: desired || pickName(), agent: register(desired, display, model) }; }

// Meeting stubs — no-op
function startMeeting() { return null; }
function endMeeting() {}
function getMeeting() { return null; }
function advanceTurn() { return null; }
function succeedModerator() { return null; }
function writeThinkingDoc() { return null; }
function listThinkingDocs() { return []; }
function checkMeetingTurn() { return null; }

// Brevity stubs — always pass
function checkBrevity() { return null; }
const LIMITS = { chat: { words: 500, sentences: 15 }, meeting: { words: 500, sentences: 15 } };
const MAX_WORDS = 500;
const MAX_SENTENCES = 15;

// Challenger stubs
function getChallengerState() { return { gemini: true, gpt: true }; }
function setChallengerToggle(model, enabled) { return { [model]: enabled }; }

// Reputation stubs
function logBreakthrough() { return []; }
function logCorrection() { return []; }

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  // V2 core
  send, systemMsg, readAll, getNew, peek, markRead, fmt, timeSince,
  DATA_DIR, STATE_DIR, AGENTS_DIR, THINKING_DIR, channelFile, stateFile, rosterFile, ensureDirs,

  // V1 stubs (backward compat)
  register, getRoster, touch, getIdentity, isNameTaken, pickName, claimName,
  startMeeting, endMeeting, getMeeting, advanceTurn, succeedModerator,
  writeThinkingDoc, listThinkingDocs, checkMeetingTurn,
  checkBrevity, LIMITS, MAX_WORDS, MAX_SENTENCES,
  getChallengerState, setChallengerToggle,
  logBreakthrough, logCorrection
};

// ─── CLI (delegates to V2) ──────────────────────────────────────────────────
if (require.main === module) {
  // Pass through to V2 CLI
  require('./protocol-v2');
}
