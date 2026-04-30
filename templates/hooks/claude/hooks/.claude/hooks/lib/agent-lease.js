#!/usr/bin/env node
/**
 * agent-lease.js — Lease-Based Agent Identity v1
 *
 * Replaces: identity.js bridge files + claim-name.js + COLONY-STATE.json heartbeats
 *
 * Architecture (from 3-round meeting with DeepSeek R1, Gemini 2.5 Pro, QwQ 32B):
 *   - Each agent gets a UUID v7 (time-based, collision-proof, sortable)
 *   - Identity = individual lease file in .fastops/agents/{uuid}.lease
 *   - Heartbeat = atomic rewrite of lease file (temp → rename)
 *   - Liveness = scan agents/ directory, check expiresAt
 *   - Names = optional aliases for display; UUID is canonical
 *   - Cleanup = auto-delete expired leases, ENOENT-safe
 *
 * Key design decisions:
 *   - Lease > Lock: time-based expiration beats OS file locks on Windows
 *   - UUID > Name: names are for humans, UUIDs for coordination
 *   - Atomic rename is the universal primitive (POSIX + NTFS)
 *   - Delete > Archive for ephemeral state
 *   - Content-based verification defeats VSCode stat caching (500-1500ms stale)
 *
 * Created: Session 155 (bastion-ii) — Meeting: agent-identity-1771940509724.jsonl
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// --- Paths ---
const COLONY_HOME = process.env.FASTOPS_HOME || process.cwd();
const AGENTS_DIR = path.join(COLONY_HOME, '.fastops', 'agents');
const ALIASES_DIR = path.join(AGENTS_DIR, 'aliases');

// --- Timing (from meeting convergence) ---
const HEARTBEAT_INTERVAL_MS = 15 * 1000;       // 15s default
const HEARTBEAT_INTERVAL_LONG_MS = 10 * 1000;  // 10s during long ops
const LEASE_EXPIRY_MS = 60 * 1000;             // 60s default
const LEASE_EXPIRY_LONG_MS = 120 * 1000;       // 120s during long ops
const MAX_LEASE_SIZE = 1024;                    // 1KB max per lease file (QwQ's edit)
const MAX_TASK_LENGTH = 200;                    // currentTask cap

// --- UUID v7 Generation ---
// Time-based UUID: first 48 bits = timestamp, then version 7, then random.
// Sub-millisecond counter ensures monotonicity within the same ms.
let _lastTs = 0;
let _seqCounter = 0;

function uuidV7() {
  let now = Date.now();

  // Monotonicity: if same ms, increment counter; if new ms, reset
  if (now === _lastTs) {
    _seqCounter++;
    // If counter overflows 12 bits (4096), wait for next ms
    if (_seqCounter > 0xfff) {
      while (Date.now() === now) {} // spin
      now = Date.now();
      _seqCounter = 0;
    }
  } else {
    _seqCounter = 0;
    _lastTs = now;
  }

  const buf = Buffer.alloc(16);

  // Bytes 0-5: Unix timestamp in ms (48 bits, big-endian)
  buf.writeUIntBE(now, 0, 6);

  // Bytes 6-7: version (4 bits) + seq_hi (12 bits) for sub-ms ordering
  buf[6] = 0x70 | ((_seqCounter >> 8) & 0x0f); // version 7 + top 4 bits of counter
  buf[7] = _seqCounter & 0xff;                   // bottom 8 bits of counter

  // Bytes 8-15: variant (2 bits) + random (62 bits)
  const rand = crypto.randomBytes(8);
  rand.copy(buf, 8);

  // Set variant: byte 8 high 2 bits = 10 (RFC 4122)
  buf[8] = (buf[8] & 0x3f) | 0x80;

  // Format as standard UUID string
  const hex = buf.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20)
  ].join('-');
}

// --- Ensure Directories ---
function ensureDirs() {
  try { fs.mkdirSync(AGENTS_DIR, { recursive: true }); } catch {}
  try { fs.mkdirSync(ALIASES_DIR, { recursive: true }); } catch {}
}

// --- Atomic Write (temp file → rename) ---
// Atomic on both POSIX and NTFS. No file locks needed.
function atomicWrite(filePath, content) {
  const dir = path.dirname(filePath);
  const tmpFile = path.join(dir, `.tmp-${crypto.randomBytes(8).toString('hex')}`);
  fs.writeFileSync(tmpFile, content);
  fs.renameSync(tmpFile, filePath);
}

// --- Content-Based Verification ---
// After atomic write, read back and verify UUID matches.
// Defeats VSCode terminal stat caching (500-1500ms stale window).
function verifyWrite(filePath, expectedUuid) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);
    return data.uuid === expectedUuid;
  } catch {
    return false;
  }
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Create a new lease for this agent session.
 * Called once at session start.
 *
 * @param {object} opts
 * @param {string[]} opts.capabilities - What this agent can do
 * @param {string} opts.currentTask - Initial task description
 * @param {string} opts.sessionId - Claude session_id (from hook stdin)
 * @returns {{ uuid: string, leasePath: string }}
 */
function createLease({ capabilities = [], currentTask = '', sessionId = '' } = {}) {
  ensureDirs();

  const uuid = uuidV7();
  const now = new Date();
  const lease = {
    uuid,
    sessionId: sessionId || '',
    startedAt: now.toISOString(),
    lastHeartbeat: now.toISOString(),
    expiresAt: new Date(now.getTime() + LEASE_EXPIRY_MS).toISOString(),
    capabilities,
    alias: '',
    currentTask: (currentTask || '').substring(0, MAX_TASK_LENGTH),
    terminalPid: process.ppid || null
  };

  const leaseJson = JSON.stringify(lease);
  if (Buffer.byteLength(leaseJson) > MAX_LEASE_SIZE) {
    // Truncate capabilities to fit within 1KB
    lease.capabilities = [];
    lease.currentTask = lease.currentTask.substring(0, 100);
  }

  const leasePath = path.join(AGENTS_DIR, `${uuid}.lease`);
  atomicWrite(leasePath, JSON.stringify(lease, null, 2));

  // Content-based verification
  if (!verifyWrite(leasePath, uuid)) {
    // Retry once
    atomicWrite(leasePath, JSON.stringify(lease, null, 2));
  }

  return { uuid, leasePath };
}

/**
 * Renew (heartbeat) an existing lease.
 * Called on every tool call via hooks.
 *
 * @param {string} uuid - The agent's UUID
 * @param {object} opts
 * @param {string} opts.currentTask - Current task description
 * @param {boolean} opts.longOp - True during long operations (extends expiry)
 * @param {object[]} opts.recentFiles - Files touched [{file, ts}]
 * @returns {boolean} true if renewal succeeded
 */
function renewLease(uuid, { currentTask = '', longOp = false, recentFiles = [] } = {}) {
  const leasePath = path.join(AGENTS_DIR, `${uuid}.lease`);

  // Read existing lease
  let lease;
  try {
    lease = JSON.parse(fs.readFileSync(leasePath, 'utf-8'));
  } catch {
    return false; // Lease doesn't exist or is corrupt
  }

  if (lease.uuid !== uuid) return false; // Content mismatch

  const now = new Date();
  const expiryMs = longOp ? LEASE_EXPIRY_LONG_MS : LEASE_EXPIRY_MS;

  lease.lastHeartbeat = now.toISOString();
  lease.expiresAt = new Date(now.getTime() + expiryMs).toISOString();
  if (currentTask) {
    lease.currentTask = currentTask.substring(0, MAX_TASK_LENGTH);
  }
  if (recentFiles && recentFiles.length > 0) {
    // Merge recent files: keep last 20, deduplicate by path
    const fileMap = new Map();
    if (Array.isArray(lease.recentFiles)) {
      for (const f of lease.recentFiles) {
        if (f && f.file) fileMap.set(f.file, f.ts);
      }
    }
    for (const f of recentFiles) {
      if (f && f.file) fileMap.set(f.file, f.ts);
    }
    lease.recentFiles = Array.from(fileMap.entries())
      .map(([file, ts]) => ({ file, ts }))
      .sort((a, b) => new Date(b.ts) - new Date(a.ts))
      .slice(0, 20);
  }
  lease.terminalPid = process.ppid || lease.terminalPid;

  // Atomic rewrite
  const leaseJson = JSON.stringify(lease, null, 2);
  if (Buffer.byteLength(leaseJson) > MAX_LEASE_SIZE) {
    // Trim to fit
    lease.recentFiles = (lease.recentFiles || []).slice(0, 5);
    lease.capabilities = [];
  }

  try {
    atomicWrite(leasePath, JSON.stringify(lease, null, 2));
    return verifyWrite(leasePath, uuid);
  } catch {
    return false;
  }
}

/**
 * Read all lease files in the agents/ directory.
 * Includes both active and expired leases (caller filters).
 *
 * @returns {object[]} Array of lease objects
 */
function readAllLeases() {
  ensureDirs();
  const leases = [];

  try {
    const files = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.lease'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(AGENTS_DIR, file), 'utf-8');
        const lease = JSON.parse(content);
        leases.push(lease);
      } catch {} // Skip corrupt files silently
    }
  } catch {}

  return leases;
}

/**
 * Get only online (non-expired) agents.
 *
 * @returns {object[]} Array of active lease objects
 */
function getOnlineAgents() {
  const now = Date.now();
  return readAllLeases().filter(lease => {
    const expires = new Date(lease.expiresAt).getTime();
    return !isNaN(expires) && expires > now;
  });
}

/**
 * Get a specific lease by UUID.
 *
 * @param {string} uuid
 * @returns {object|null}
 */
function getLeaseByUuid(uuid) {
  const leasePath = path.join(AGENTS_DIR, `${uuid}.lease`);
  try {
    const content = fs.readFileSync(leasePath, 'utf-8');
    const lease = JSON.parse(content);
    return lease.uuid === uuid ? lease : null;
  } catch {
    return null;
  }
}

/**
 * Find a lease by Claude session_id.
 * Used during migration: hooks have session_id, need to find the lease.
 *
 * @param {string} sessionId - Claude's session_id
 * @returns {object|null}
 */
function getLeaseBySessionId(sessionId) {
  if (!sessionId) return null;
  const leases = readAllLeases();
  return leases.find(l => l.sessionId === sessionId) || null;
}

/**
 * Clean up expired leases.
 * Delete (don't archive) — ENOENT-safe for thundering herd.
 *
 * @returns {number} Count of leases cleaned
 */
function cleanupExpired() {
  ensureDirs();
  const now = Date.now();
  let cleaned = 0;

  try {
    const files = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.lease'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(AGENTS_DIR, file), 'utf-8');
        const lease = JSON.parse(content);
        const expires = new Date(lease.expiresAt).getTime();

        if (!isNaN(expires) && expires < now) {
          // Expired — delete lease file
          try {
            fs.unlinkSync(path.join(AGENTS_DIR, file));
            cleaned++;
          } catch (e) {
            // ENOENT is fine (another agent cleaned it) — thundering herd safety
            if (e.code !== 'ENOENT') throw e;
          }

          // Also clean up alias if this agent had one
          if (lease.alias) {
            releaseAlias(lease.uuid, lease.alias);
          }
        }
      } catch {} // Skip corrupt files
    }
  } catch {}

  return cleaned;
}

/**
 * Register an alias (display name) for a UUID.
 * Atomic claim via temp+rename in aliases/ directory.
 * Auto-suffix on collision (e.g., "deploy" → "deploy-2").
 *
 * @param {string} uuid - The agent's UUID
 * @param {string} alias - Desired alias
 * @returns {{ alias: string, claimPath: string }|null} Claimed alias (may have suffix)
 */
function registerAlias(uuid, alias) {
  ensureDirs();

  if (!alias || !uuid) return null;

  // Sanitize alias
  const baseAlias = alias.toLowerCase().replace(/[^a-z0-9-]/g, '-').substring(0, 30);
  if (!baseAlias) return null;

  // Try the base alias first, then with suffix
  for (let suffix = 0; suffix < 10; suffix++) {
    const tryAlias = suffix === 0 ? baseAlias : `${baseAlias}-${suffix + 1}`;
    const claimPath = path.join(ALIASES_DIR, `${tryAlias}.claim`);

    // Check if already claimed by someone else
    try {
      const existing = fs.readFileSync(claimPath, 'utf-8').trim();
      if (existing === uuid) {
        // We already own it — refresh
        return { alias: tryAlias, claimPath };
      }
      // Someone else owns it — check if they're still alive
      const ownerLease = getLeaseByUuid(existing);
      if (ownerLease) {
        const expires = new Date(ownerLease.expiresAt).getTime();
        if (expires > Date.now()) {
          // Owner is alive — try next suffix
          continue;
        }
      }
      // Owner is dead or doesn't exist — take it
    } catch {
      // File doesn't exist — claim it
    }

    // Atomic claim: write UUID to temp, rename to claim file
    try {
      const tmpFile = path.join(ALIASES_DIR, `.tmp-${crypto.randomBytes(8).toString('hex')}`);
      fs.writeFileSync(tmpFile, uuid);
      fs.renameSync(tmpFile, claimPath);

      // Content-based verification: did we win the race?
      const written = fs.readFileSync(claimPath, 'utf-8').trim();
      if (written === uuid) {
        // Update the lease with the alias
        const leasePath = path.join(AGENTS_DIR, `${uuid}.lease`);
        try {
          const lease = JSON.parse(fs.readFileSync(leasePath, 'utf-8'));
          lease.alias = tryAlias;
          atomicWrite(leasePath, JSON.stringify(lease, null, 2));
        } catch {}

        return { alias: tryAlias, claimPath };
      }
      // Lost the race — try next suffix
    } catch {
      // Rename failed — try next suffix
    }
  }

  return null; // All 10 suffixes exhausted
}

/**
 * Release an alias claim.
 * ENOENT-safe for concurrent cleanup.
 *
 * @param {string} uuid - The owning UUID
 * @param {string} alias - The alias to release (optional — auto-discovers)
 * @returns {boolean}
 */
function releaseAlias(uuid, alias) {
  if (!alias) {
    // Try to find alias from lease
    const lease = getLeaseByUuid(uuid);
    alias = lease?.alias;
  }
  if (!alias) return false;

  const claimPath = path.join(ALIASES_DIR, `${alias}.claim`);
  try {
    const owner = fs.readFileSync(claimPath, 'utf-8').trim();
    if (owner === uuid) {
      fs.unlinkSync(claimPath);
      return true;
    }
  } catch (e) {
    if (e.code === 'ENOENT') return true; // Already gone
  }
  return false;
}

/**
 * Remove a lease file (for graceful shutdown).
 *
 * @param {string} uuid
 * @returns {boolean}
 */
function removeLease(uuid) {
  const leasePath = path.join(AGENTS_DIR, `${uuid}.lease`);
  try {
    fs.unlinkSync(leasePath);
  } catch (e) {
    if (e.code !== 'ENOENT') return false;
  }

  // Also release alias
  releaseAlias(uuid);
  return true;
}

/**
 * Get a display name for a UUID: alias if registered, else short UUID.
 *
 * @param {string} uuid
 * @returns {string}
 */
function getDisplayName(uuid) {
  if (!uuid) return 'unknown';
  const lease = getLeaseByUuid(uuid);
  if (lease && lease.alias) return lease.alias;
  // Also check old session-id based naming for backward compat
  if (lease && lease.sessionId) {
    try {
      const { lookupName } = require('./identity');
      const name = lookupName(lease.sessionId);
      if (name && name !== 'unknown' && name !== lease.sessionId.substring(0, 8)) {
        return name;
      }
    } catch {}
  }
  return uuid.substring(0, 8);
}

// ============================================================
// MODULE EXPORTS
// ============================================================

module.exports = {
  // Core lifecycle
  createLease,
  renewLease,
  removeLease,
  cleanupExpired,

  // Read
  readAllLeases,
  getOnlineAgents,
  getLeaseByUuid,
  getLeaseBySessionId,
  getDisplayName,

  // Aliases
  registerAlias,
  releaseAlias,

  // Utils
  uuidV7,
  ensureDirs,

  // Constants (for other modules)
  AGENTS_DIR,
  ALIASES_DIR,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_INTERVAL_LONG_MS,
  LEASE_EXPIRY_MS,
  LEASE_EXPIRY_LONG_MS
};
