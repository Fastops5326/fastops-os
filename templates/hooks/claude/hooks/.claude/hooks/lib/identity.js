#!/usr/bin/env node
/**
 * Shared Identity Resolution Module — v2 (Session-ID based)
 *
 * Single source of truth for "who am I?" across all hooks and CLI tools.
 *
 * HOW IT WORKS:
 *   Every hook call receives `session_id` on stdin (UUID, unique per conversation).
 *   This is the identity anchor — no env vars, no ppid matching, no shared files.
 *
 *   Hooks call:     fromStdin(parsedData) → {sessionId, name}
 *   CLI tools call: fromBridge()          → {sessionId, name}
 *
 *   The "bridge" is a file written by hooks so CLI tools (which don't get stdin)
 *   can discover the session_id. Keyed by CLAUDE_SEPARATE_SESSION env var
 *   (available to both hooks and Bash-spawned processes).
 *
 * FILES:
 *   comms/data/.agents/sid-{session_id}.json  — name registration (written by claim-name.js)
 *   .fastops/.session-bridge-{key}.json       — bridge for CLI tools (written by hooks)
 *
 * Created: Session 142 (Rivet) — replaces 4-level fallback chain from Session 141.
 * Jailbroken: 3 rounds, Gemini + ChatGPT confirmed session_id is the right anchor.
 */

const fs = require('fs');
const path = require('path');

const COLONY_HOME = process.cwd();
const AGENTS_DIR = path.join(COLONY_HOME, 'comms', 'data', '.agents');
const BRIDGE_DIR = path.join(COLONY_HOME, '.fastops');
const ROSTER_FILE = path.join(COLONY_HOME, 'comms', 'data', 'roster.json');
const ACTIVE_AGENT_FILE = path.join(COLONY_HOME, 'comms', 'data', '.active-agent');
const SUCCESSOR_FILE = path.join(COLONY_HOME, '.fastops', '.identity-predecessor.json');

/**
 * Sanitize a string for use in filenames.
 */
function sanitize(str) {
  return String(str || 'default').replace(/[^a-z0-9_-]/gi, '_');
}

/**
 * Get the bridge key — shared between hooks and CLI tools.
 * Uses CLAUDE_SEPARATE_SESSION (inherited by both).
 */
function getBridgeKey() {
  return sanitize(process.env.CLAUDE_SEPARATE_SESSION || 'default');
}

/**
 * For HOOKS that receive stdin JSON: extract session_id and resolve name.
 * Also writes bridge file so CLI tools can find the session_id.
 *
 * @param {object} data - Parsed stdin JSON from hook protocol
 * @returns {{sessionId: string|null, name: string}}
 */
function fromStdin(data) {
  const sessionId = data?.session_id;
  if (!sessionId) return { sessionId: null, name: 'unknown' };

  // Write bridge files so CLI tools can find session_id.
  //
  // IDENTITY FIX (Session 147, Redoubt): Write TWO bridge files:
  //   1. Per-session bridge (always correct): .session-bridge-sid-{session_id}.json
  //   2. Shared bridge (may be wrong if terminals share CLAUDE_SEPARATE_SESSION):
  //      .session-bridge-{key}.json — only write if this session already owns it
  //      or it doesn't exist yet. Don't steal another session's bridge.
  try {
    fs.mkdirSync(BRIDGE_DIR, { recursive: true });
    const key = getBridgeKey();

    // Always write per-session bridge (ground truth, never conflicts)
    const perSessionBridge = path.join(BRIDGE_DIR, `.session-bridge-sid-${sessionId}.json`);
    fs.writeFileSync(perSessionBridge, JSON.stringify({
      session_id: sessionId,
      bridge_key: key,
      ts: Date.now()
    }));

    // Write shared bridge — but don't steal it from another active session
    const sharedBridge = path.join(BRIDGE_DIR, `.session-bridge-${key}.json`);
    let shouldWriteShared = true;
    try {
      const existing = JSON.parse(fs.readFileSync(sharedBridge, 'utf-8'));
      if (existing.session_id === sessionId) {
        // We already own it — update timestamp
        shouldWriteShared = true;
      } else if (Date.now() - existing.ts < 30000) {
        // Another session wrote it <30s ago — they're active, don't overwrite
        shouldWriteShared = false;
      }
      // Otherwise: stale entry from inactive session — safe to take
    } catch {
      // File doesn't exist or is corrupt — safe to write
    }

    if (shouldWriteShared) {
      fs.writeFileSync(sharedBridge, JSON.stringify({
        session_id: sessionId,
        bridge_key: key,
        ts: Date.now()
      }));
    }
  } catch {}

  // MULTI-TERMINAL FIX V3 (W4-AX-10, 2026-03-07): Write PER-SESSION identity file.
  //
  // V2 POSTMORTEM: V2 wrote per-PID files (.identity-claude-{process.ppid}.json),
  // assuming process.ppid = claude.exe PID (stable per terminal). This assumption
  // was WRONG: on Windows 11, Claude spawns hooks through intermediary processes,
  // so each hook invocation gets a DIFFERENT ppid. Result: every tool call created
  // a new identity file. With 2 hooks/call, that's 2 new files/call. Over 9,200
  // tool calls, this produced 18,429 files (W1-AX-1 discovery). W1-AX-1 and
  // W2-AC-2 added probabilistic cleanup, but that treats the symptom. Root cause:
  // using process.ppid as a stable key when it isn't stable.
  //
  // V3 FIX: Write per-SESSION identity file keyed by session_id (which IS stable).
  // One file per session, overwritten in place. Multi-terminal safe because each
  // terminal has a unique session_id. CLI tools (fromBridge) already read
  // .latest-session.json and shared bridge as primary paths — these per-session
  // files are the O(N) fallback, and N is now bounded by active sessions (1-5)
  // not by hook invocations (thousands).
  //
  // Cleanup also simplified: per-session files are few enough to clean on every
  // pass (no probability needed), with a longer stale window (5min vs 60s).
  try {
    const shortSid = sessionId.substring(0, 8);
    const perSessionFile = path.join(BRIDGE_DIR, `.identity-session-${shortSid}.json`);
    fs.writeFileSync(perSessionFile, JSON.stringify({
      session_id: sessionId,
      ts: Date.now()
    }));
  } catch {}

  // Cleanup: delete stale per-session AND legacy per-pid identity files.
  // Per-session files: bounded by session count (1-5), clean if >5min stale.
  // Per-pid files: legacy from V2, clean ALL remaining (they are all stale).
  if (Math.random() < 0.10) {
    try {
      const now = Date.now();
      // Clean legacy per-pid files (V2 remnants) — all are stale by definition
      const pidFiles = fs.readdirSync(BRIDGE_DIR).filter(f => f.startsWith('.identity-claude-'));
      let cleaned = 0;
      for (const file of pidFiles) {
        if (cleaned >= 500) break;
        try { fs.unlinkSync(path.join(BRIDGE_DIR, file)); cleaned++; } catch {}
      }
      // Clean stale per-session files (>5min old = session ended)
      const sessionFiles = fs.readdirSync(BRIDGE_DIR).filter(f => f.startsWith('.identity-session-'));
      for (const file of sessionFiles) {
        try {
          const fp = path.join(BRIDGE_DIR, file);
          const mtime = fs.statSync(fp).mtimeMs;
          if ((now - mtime) > 5 * 60 * 1000) fs.unlinkSync(fp);
        } catch {}
      }
    } catch {}
  }

  // Legacy: also write .latest-session.json for backward compat during migration
  try {
    const handoffFile = path.join(BRIDGE_DIR, '.latest-session.json');
    fs.writeFileSync(handoffFile, JSON.stringify({
      session_id: sessionId,
      ts: Date.now()
    }));
  } catch {}

  const name = lookupName(sessionId);
  return { sessionId, name };
}

/**
 * For CLI TOOLS that don't receive stdin: read session_id from bridge file.
 *
 * @returns {{sessionId: string|null, name: string}}
 */
function fromBridge() {
  // REORDER FIX (W2-AC-2, 2026-03-07): Try cheap single-file lookups FIRST.
  // The identity-claude-* directory scan was the PRIMARY path but costs O(N)
  // syscalls where N = number of identity files. With 18K+ files this was
  // the dominant latency source. Single-file reads are O(1).

  // Try 1: .latest-session.json (single file, O(1), written by every hook call)
  try {
    const handoffFile = path.join(BRIDGE_DIR, '.latest-session.json');
    const handoff = JSON.parse(fs.readFileSync(handoffFile, 'utf-8'));
    if (handoff.session_id && handoff.ts && (Date.now() - handoff.ts < 3000)) {
      const name = lookupName(handoff.session_id);
      return { sessionId: handoff.session_id, name };
    }
  } catch {}

  // Try 2: shared bridge file (single file, O(1), may collide in multi-terminal)
  try {
    const key = getBridgeKey();
    const bridgeFile = path.join(BRIDGE_DIR, `.session-bridge-${key}.json`);
    const bridge = JSON.parse(fs.readFileSync(bridgeFile, 'utf-8'));
    if (bridge.session_id) {
      const name = lookupName(bridge.session_id);
      return { sessionId: bridge.session_id, name };
    }
  } catch {}

  // Try 3: Per-session identity files (V3 — bounded by session count, not hook count)
  // Only reached if single-file lookups fail (stale or missing).
  try {
    const now = Date.now();
    const sessionFiles = fs.readdirSync(BRIDGE_DIR).filter(f => f.startsWith('.identity-session-'));
    let best = null;
    for (const file of sessionFiles) {
      try {
        const fp = path.join(BRIDGE_DIR, file);
        const mtime = fs.statSync(fp).mtimeMs;
        if ((now - mtime) > 5000) continue;
        const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        if (data.session_id && data.ts && (now - data.ts < 5000)) {
          if (!best || data.ts > best.ts) {
            best = data;
          }
        }
      } catch {}
    }
    if (best) {
      const name = lookupName(best.session_id);
      return { sessionId: best.session_id, name };
    }
  } catch {}

  // Try 3b: Legacy per-claude-pid identity files (V2 fallback — will be cleaned over time)
  // PERF FIX (W1-AX-1): Pre-filter by mtime before JSON.parse.
  try {
    const now = Date.now();
    const files = fs.readdirSync(BRIDGE_DIR).filter(f => f.startsWith('.identity-claude-'));
    let best = null;
    for (const file of files) {
      try {
        const fp = path.join(BRIDGE_DIR, file);
        const mtime = fs.statSync(fp).mtimeMs;
        if ((now - mtime) > 5000) continue;
        const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        if (data.session_id && data.ts && (now - data.ts < 5000)) {
          if (!best || data.ts > best.ts) {
            best = data;
          }
        }
      } catch {}
    }
    if (best) {
      const name = lookupName(best.session_id);
      return { sessionId: best.session_id, name };
    }
  } catch {}

  // Try 4: scan per-session bridges for freshest matching bridge_key
  try {
    const key = getBridgeKey();
    const files = fs.readdirSync(BRIDGE_DIR).filter(f => f.startsWith('.session-bridge-sid-'));
    let best = null;
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(BRIDGE_DIR, file), 'utf-8'));
        if (data.bridge_key === key && (!best || data.ts > best.ts)) {
          best = data;
        }
      } catch {}
    }
    if (best && best.session_id) {
      const name = lookupName(best.session_id);
      return { sessionId: best.session_id, name };
    }
  } catch {}

  // Fallback 4: legacy .active-agent
  try {
    if (fs.existsSync(ACTIVE_AGENT_FILE)) {
      return { sessionId: null, name: fs.readFileSync(ACTIVE_AGENT_FILE, 'utf-8').trim() };
    }
  } catch {}

  return { sessionId: null, name: 'unknown' };
}

/**
 * Look up agent name from session_id.
 * Reads comms/data/.agents/sid-{session_id}.json
 *
 * COMPACTION CONTINUITY FIX (Session 8892957f, 2026-02-25):
 * When an agent compacts, pre-compact-state.js deletes the sid file but first
 * writes a succession file (.fastops/.identity-predecessor.json). This fallback
 * reads the succession file so the agent keeps their name through compaction.
 * Without this, gates see "crenel" in comms but the agent identifies as "58805d52"
 * — causing spurious blocks. 5-agent meeting convergence confirmed this fix.
 */
function lookupName(sessionId) {
  if (!sessionId) return 'unknown';
  // Primary: sid file (active registration)
  try {
    const sessionFile = path.join(AGENTS_DIR, `sid-${sessionId}.json`);
    if (fs.existsSync(sessionFile)) {
      const data = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      return data.name || sessionId.substring(0, 8);
    }
  } catch {}
  // Fallback: succession file (written by pre-compact before sid deletion)
  // IDENTITY FIX (Session 205, citadel-lxiii): The old check compared
  // pred.session_id === sessionId, but after compaction the session_id
  // may change. This caused 20+ sessions of identity bouncing — agents
  // got UUID-as-name because the comparison failed. Fix: use time-based
  // freshness (< 10 min since release) instead of session_id match.
  // Consume the file after read to prevent stale data in multi-terminal.
  try {
    if (fs.existsSync(SUCCESSOR_FILE)) {
      const pred = JSON.parse(fs.readFileSync(SUCCESSOR_FILE, 'utf-8'));
      const age = pred.released_at ? Date.now() - new Date(pred.released_at).getTime() : Infinity;
      if (pred.name && age < 10 * 60 * 1000) {
        // Consume the file so another terminal's agent doesn't read it
        try { fs.unlinkSync(SUCCESSOR_FILE); } catch {}
        return pred.name;
      }
    }
  } catch {}
  // Not yet registered — return short UUID as temporary name
  return sessionId.substring(0, 8);
}

// ============================================================
// BACKWARD COMPATIBILITY — old hooks call these without stdin
// They use the bridge file. Works as long as at least one
// stdin-aware hook has fired first (which is always the case
// since PostToolUse hooks fire on every tool call).
// ============================================================

function getAgentId() {
  const { name } = fromBridge();
  return name !== 'unknown' ? name : null;
}

function getAgentName() {
  return fromBridge().name;
}

function getAgentIdentity() {
  return { name: fromBridge().name, role: '?' };
}

function getSessionKey() {
  return fromBridge().sessionId || getBridgeKey();
}

// ============================================================
// LEASE-AWARE EXTENSIONS (v3 — Session 155 parallel migration)
// These functions check lease files as an additional/primary
// identity source alongside the bridge system.
// ============================================================

/**
 * Get online agents from the lease system.
 * Replaces reading COLONY-STATE.json for liveness checks.
 */
function getOnlineFromLeases() {
  try {
    const agentLease = require('./agent-lease');
    return agentLease.getOnlineAgents();
  } catch {
    return [];
  }
}

/**
 * Get display name from lease system (alias or short UUID).
 */
function getDisplayNameFromLease(sessionId) {
  try {
    const agentLease = require('./agent-lease');
    const lease = agentLease.getLeaseBySessionId(sessionId);
    if (lease) {
      return agentLease.getDisplayName(lease.uuid);
    }
  } catch {}
  return null;
}

/**
 * For lifecycle hooks (PreCompact, Stop) that receive stdin but were using bridge.
 * Resolves identity directly from session_id — no bridge file needed.
 * Added: Session 174 (2959255d) — fixes 30-second race window in multi-terminal.
 */
function fromSessionId(sessionId) {
  if (!sessionId) return { sessionId: null, name: 'unknown' };
  const name = lookupName(sessionId);
  return { sessionId, name };
}

module.exports = {
  // New API (v2)
  fromStdin, fromBridge, fromSessionId, lookupName, getBridgeKey,
  // Backward compat (v1 — uses bridge)
  getAgentId, getAgentName, getAgentIdentity, getSessionKey,
  // Lease-aware (v3)
  getOnlineFromLeases, getDisplayNameFromLease,
  // Paths
  AGENTS_DIR, ACTIVE_AGENT_FILE, ROSTER_FILE, COLONY_HOME
};
