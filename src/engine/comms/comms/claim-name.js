#!/usr/bin/env node
/**
 * claim-name.js — Atomic Agent Name Claim (v2 — session_id based)
 *
 * Ensures every agent has a unique name. Maps session_id → name.
 *
 * HOW IT WORKS:
 *   1. Agent picks a name: `node comms/claim-name.js Rivet`
 *   2. Script reads session_id from the bridge file (written by hooks)
 *   3. Writes: comms/data/.agents/sid-{session_id}.json
 *   4. Updates roster.json (permanent record of all names ever used)
 *
 * The bridge file (.fastops/.session-bridge-{key}.json) is written by
 * hooks on every tool call. By the time the agent runs claim-name.js,
 * at least one hook has fired and the bridge exists.
 *
 * Usage:
 *   node comms/claim-name.js Rivet            # claim "Rivet"
 *   node comms/claim-name.js --check Rivet    # check without claiming
 *   node comms/claim-name.js --list-taken     # show all taken names
 *   node comms/claim-name.js --whoami         # show current session's name
 *   node comms/claim-name.js --cleanup        # remove stale entries
 *
 * Created: Session 142 (Rivet) — replaces CLAUDE_SEPARATE_SESSION + ppid system.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.cwd();
const ROSTER_FILE = path.join(PROJECT_ROOT, 'comms', 'data', 'roster.json');
const AGENTS_DIR = path.join(PROJECT_ROOT, 'comms', 'data', '.agents');
const LEGACY_ACTIVE_AGENT = path.join(PROJECT_ROOT, 'comms', 'data', '.active-agent');

// Import identity module for bridge reading
const { fromBridge, getBridgeKey } = require(path.join(PROJECT_ROOT, '.claude', 'hooks', 'lib', 'identity'));

// Ensure agents directory exists
if (!fs.existsSync(AGENTS_DIR)) {
  fs.mkdirSync(AGENTS_DIR, { recursive: true });
}

function loadRoster() {
  try {
    return JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf-8'));
  } catch {
    return { agents: {} };
  }
}

function getTakenNames(roster) {
  return new Set(Object.keys(roster.agents || {}).map(k => k.toLowerCase()));
}

function isGarbage(id) {
  if (id.startsWith('--')) return true;
  if (id === 'read' || id === 'send' || id === 'register' || id === 'general') return true;
  if (id.length > 100) return true;
  return false;
}

function claimName(name, { force = false, session = null } = {}) {
  const id = name.toLowerCase().trim();

  if (!id || id.length < 2) {
    console.error('ERROR: Name must be at least 2 characters.');
    process.exit(1);
  }

  if (id.length > 30) {
    console.error('ERROR: Name must be 30 characters or fewer.');
    process.exit(1);
  }

  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    console.error('ERROR: Name must start with a letter and contain only lowercase letters, numbers, and hyphens.');
    process.exit(1);
  }

  const roster = loadRoster();
  const taken = getTakenNames(roster);

  // Get session_id: prefer explicit --session arg (immune to bridge collision),
  // fall back to bridge for backward compat.
  const sessionId = session || fromBridge().sessionId;

  // NAME LOCK GATE: If this session already has a claimed name, block name changes.
  // You pick ONE name per session. Period. Only exception: --force flag (for Joel overrides).
  // IDENTITY FIX (Session 205, citadel-lxiii): Allow overwriting auto-created sid files.
  // gate.js auto-creates sid files with UUID-as-name on first tool call BEFORE agents
  // can claim properly. These auto-created files (auto_created: true) should not block
  // a real name claim. This fixes 20+ sessions of identity bouncing.
  if (sessionId && !force) {
    const mySessionFile = path.join(AGENTS_DIR, `sid-${sessionId}.json`);
    if (fs.existsSync(mySessionFile)) {
      try {
        const myData = JSON.parse(fs.readFileSync(mySessionFile, 'utf-8'));
        const myCurrentName = (myData.id || '').toLowerCase();
        const isAutoCreated = myData.auto_created === true;
        if (myCurrentName && myCurrentName !== id && !isAutoCreated) {
          console.error(`\n⛔ NAME LOCK: You are "${myData.name}". You cannot change your name.`);
          console.error(`  Your session (${sessionId.slice(0, 8)}...) claimed "${myData.name}" at ${myData.claimed_at}.`);
          console.error(`  Names are locked for the entire session. No exceptions without --force.`);
          console.error(`\n  If Joel directs a name change: node comms/claim-name.js ${name} --force`);
          process.exit(1);
        }
      } catch {}
    }
  }

  // ATOMIC NAME LOCK: Use wx flag (exclusive create) to prevent TOCTOU race.
  // Two agents checking roster simultaneously both see "available" — but only one
  // can create the lock file. First writer wins, second gets EEXIST.
  // Same pattern as mission.js claim (wx flag for atomic contract claiming).
  const lockFile = path.join(AGENTS_DIR, `name-${id}.lock`);
  try {
    // Check for stale lock first (>24h = previous holder is dead)
    if (fs.existsSync(lockFile)) {
      const lockData = JSON.parse(fs.readFileSync(lockFile, 'utf-8'));
      const lockAge = Date.now() - new Date(lockData.claimed_at).getTime();
      const isSameSession = lockData.session_id === sessionId;
      if (lockAge > 24 * 60 * 60 * 1000 || isSameSession) {
        fs.unlinkSync(lockFile); // Stale or same session — remove and re-acquire
      }
    }
  } catch {}

  try {
    const lockData = JSON.stringify({ session_id: sessionId, claimed_at: new Date().toISOString() });
    fs.writeFileSync(lockFile, lockData, { flag: 'wx' }); // Atomic: EEXIST if taken
  } catch (err) {
    if (err.code === 'EEXIST') {
      // Another agent won the race
      let holder = 'unknown';
      try { holder = JSON.parse(fs.readFileSync(lockFile, 'utf-8')).session_id?.slice(0, 8) || 'unknown'; } catch {}
      console.error(`\n⛔ RACE LOST: "${name}" was just claimed by another agent (session: ${holder}...).`);
      console.error('Pick a different name. Run: node comms/claim-name.js --list-taken');
      process.exit(1);
    }
    throw err;
  }

  // STRUCTURAL GATE: Check ALL active sid files for a live agent using this name
  // This catches cases the roster check misses (e.g., name reuse across sessions)
  try {
    const sidFiles = fs.readdirSync(AGENTS_DIR).filter(f => f.startsWith('sid-'));
    for (const file of sidFiles) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, file), 'utf-8'));
        const age = Date.now() - new Date(data.claimed_at).getTime();
        const isStale = age > 24 * 60 * 60 * 1000;
        const isSameSession = data.session_id === sessionId;
        const isSameName = (data.id || data.name || '').toLowerCase() === id;

        if (isSameName && !isSameSession && !isStale) {
          // Clean up our lock since we're rejecting
          try { fs.unlinkSync(lockFile); } catch {}
          console.error(`\n⛔ BLOCKED: "${name}" is actively claimed by another session.`);
          console.error(`  Active holder: ${data.name} (session: ${data.session_id?.slice(0, 8)}...)`);
          console.error(`  Claimed at: ${data.claimed_at}`);
          console.error(`\nYou MUST pick a name that has NEVER been used.`);
          console.error('Run: node comms/claim-name.js --list-taken');
          process.exit(1);
        }
      } catch {}
    }
  } catch {}

  if (taken.has(id)) {
    const existing = roster.agents[id] || roster.agents[Object.keys(roster.agents).find(k => k.toLowerCase() === id)];

    // Allow reclaim if:
    // 1. Same session_id (same terminal recovering), OR
    // 2. Original session's sid file is gone (previous holder is dead/compacted)
    const sameSession = existing && sessionId && existing.session_id === sessionId;
    const originalSidFile = existing && existing.session_id
      ? path.join(AGENTS_DIR, `sid-${existing.session_id}.json`)
      : null;
    const originalAlive = originalSidFile && fs.existsSync(originalSidFile);
    const canReclaim = sameSession || (existing && !originalAlive);

    if (canReclaim) {
      console.log(`RECLAIM: "${name}" — ${sameSession ? 'same session' : 'previous holder inactive'}, refreshing claim.`);
    } else {
      console.error(`COLLISION: "${name}" is already taken.`);
      if (existing) {
        console.error(`  Claimed by: ${existing.name || existing.id}`);
        console.error(`  Model: ${existing.model || 'unknown'}`);
        console.error(`  Joined: ${existing.joinedAt || 'unknown'}`);
      }
      console.error('\nPick a unique name. Run: node comms/claim-name.js --list-taken');
      process.exit(1);
    }
  }

  if (!sessionId) {
    console.error('WARNING: No session_id found in bridge file. This means no hook has fired yet.');
    console.error('This is unusual — try making any tool call first, then re-run claim-name.js.');
    console.error('Falling back to bridge key for registration.');
  }

  const effectiveId = sessionId || `fallback-${getBridgeKey()}`;

  // Write session identity file: sid-{session_id}.json
  const sessionFile = path.join(AGENTS_DIR, `sid-${effectiveId}.json`);
  const identity = {
    name: name,
    id: id,
    session_id: effectiveId,
    claimed_at: new Date().toISOString(),
    model: 'claude-opus-4-6'
  };
  fs.writeFileSync(sessionFile, JSON.stringify(identity, null, 2));

  // ─── NAME LEASE (V3 Three-Layer Identity) ────────────────────────────
  // Lease file persists across compactions. Predecessor chain traces full
  // history. Contracts bind to NAMES, not session_ids.
  // Design: architecture.md Component 2 — Erlang PID/registered-name pattern.
  const leaseFile = path.join(AGENTS_DIR, `${id}.lease`);
  try {
    let lease = { name: id, predecessor_chain: [] };
    // Read existing lease to preserve predecessor chain
    if (fs.existsSync(leaseFile)) {
      try {
        lease = JSON.parse(fs.readFileSync(leaseFile, 'utf-8'));
        // Add previous holder to predecessor chain (if different session)
        if (lease.current_holder && lease.current_holder !== effectiveId) {
          lease.predecessor_chain = lease.predecessor_chain || [];
          lease.predecessor_chain.push({
            session_id: lease.current_holder,
            claimed_at: lease.claimed_at,
            released_at: new Date().toISOString()
          });
          // Cap at last 10 entries (QwQ recommendation)
          if (lease.predecessor_chain.length > 10) {
            lease.predecessor_chain = lease.predecessor_chain.slice(-10);
          }
        }
      } catch {}
    }
    // Update lease with current holder
    lease.name = id;
    lease.current_holder = effectiveId;
    lease.claimed_at = new Date().toISOString();
    // Read active contract from mission if available (V2: contract-keyed files)
    try {
      const missionSchema = require(path.join(PROJECT_ROOT, '.fastops', 'mission-schema'));
      const shortSid = effectiveId.substring(0, 8);
      const mission = missionSchema.getActive({ sessionId: effectiveId }) || missionSchema.getActive();
      if (mission && mission.status === 'active') {
        lease.active_contract = mission.contract_id || mission.mission || null;
      }
    } catch {}
    fs.writeFileSync(leaseFile, JSON.stringify(lease, null, 2));
  } catch {} // Never fail on lease write

  // Register in roster (permanent record)
  roster.agents[id] = {
    id: id,
    name: name,
    model: 'claude-opus-4-6',
    joinedAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    session_id: effectiveId
  };
  fs.writeFileSync(ROSTER_FILE, JSON.stringify(roster, null, 2));

  // Write to legacy .active-agent for backward compatibility
  fs.writeFileSync(LEGACY_ACTIVE_AGENT, id);

  // Set terminal tab title in VSCode (ANSI OSC escape sequence)
  process.stdout.write(`\x1b]0;${name}\x07`);

  console.log(`CLAIMED: "${name}" (id: ${id})`);
  console.log(`  Session ID: ${effectiveId}`);
  console.log(`  Identity file: ${sessionFile}`);
  console.log(`  Roster updated`);
  console.log(`  Terminal tab title set to: ${name}`);

  // Auto-claim Monday.com board item (non-blocking background process)
  // Matches predecessor handoff + thinking stream against board items.
  // If confidence >= 80%, silently claims. Otherwise shows suggestions.
  const autoclaim = path.join(__dirname, 'monday-autoclaim.js');
  if (fs.existsSync(autoclaim)) {
    try {
      const { spawn } = require('child_process');
      const child = spawn('node', [autoclaim, '--commit'], {
        cwd: PROJECT_ROOT,
        stdio: ['ignore', 'inherit', 'inherit'],
        detached: false
      });
      child.unref();
    } catch {}
  }

  return identity;
}

function checkName(name) {
  const id = name.toLowerCase().trim();
  const roster = loadRoster();
  const taken = getTakenNames(roster);

  if (taken.has(id)) {
    const existing = roster.agents[id];
    console.log(`TAKEN: "${name}"`);
    if (existing) {
      console.log(`  By: ${existing.name || existing.id} (${existing.model || 'unknown'})`);
      console.log(`  Since: ${existing.joinedAt || 'unknown'}`);
    }
    return false;
  }

  console.log(`AVAILABLE: "${name}" — claim with: node comms/claim-name.js ${name}`);
  return true;
}

function listTaken() {
  const roster = loadRoster();
  const agents = roster.agents || {};
  const names = Object.entries(agents)
    .filter(([id]) => !isGarbage(id))
    .sort((a, b) => (b[1].lastSeen || '').localeCompare(a[1].lastSeen || ''));

  console.log(`${names.length} names claimed (excluding garbage entries):\n`);

  const recent = names.filter(([, a]) => {
    const seen = new Date(a.lastSeen || 0);
    return seen > new Date(Date.now() - 24 * 60 * 60 * 1000);
  });

  const older = names.filter(([, a]) => {
    const seen = new Date(a.lastSeen || 0);
    return seen <= new Date(Date.now() - 24 * 60 * 60 * 1000);
  });

  if (recent.length > 0) {
    console.log('RECENT (last 24h):');
    recent.forEach(([id, a]) => console.log(`  ${id} — ${a.name || id} (${a.model || '?'})`));
    console.log('');
  }

  if (older.length > 0) {
    console.log('OLDER:');
    older.forEach(([id, a]) => console.log(`  ${id} — ${a.name || id}`));
  }

  const garbage = Object.keys(agents).filter(id => isGarbage(id));
  if (garbage.length > 0) {
    console.log(`\nGARBAGE ENTRIES (${garbage.length}): ${garbage.join(', ')}`);
  }
}

function whoami() {
  const { sessionId, name } = fromBridge();
  if (name && name !== 'unknown') {
    console.log(`You are: ${name}`);
    console.log(`Session ID: ${sessionId || 'unknown'}`);
  } else {
    console.log('No identity claimed. Run: node comms/claim-name.js YOUR-NAME');
  }
}

function cleanup() {
  // Remove garbage from roster
  const roster = loadRoster();
  const garbageKeys = Object.keys(roster.agents || {}).filter(id => isGarbage(id));

  if (garbageKeys.length === 0) {
    console.log('No garbage entries found.');
  } else {
    console.log(`Removing ${garbageKeys.length} garbage entries:`);
    garbageKeys.forEach(id => {
      console.log(`  - "${id.substring(0, 50)}${id.length > 50 ? '...' : ''}"`);
      delete roster.agents[id];
    });
    fs.writeFileSync(ROSTER_FILE, JSON.stringify(roster, null, 2));
    console.log('Roster cleaned.');
  }

  // Remove stale session files and lock files (older than 24h)
  try {
    const files = fs.readdirSync(AGENTS_DIR).filter(f => f.startsWith('sid-') || f.endsWith('.lock'));
    let stale = 0;
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, file), 'utf-8'));
        const age = Date.now() - new Date(data.claimed_at).getTime();
        if (age > 24 * 60 * 60 * 1000) {
          fs.unlinkSync(path.join(AGENTS_DIR, file));
          console.log(`  Removed stale: ${file} (${data.name || file})`);
          stale++;
        }
      } catch {}
    }
    if (stale === 0) console.log('No stale session/lock files found.');
  } catch {}
}

// V3 Three-Layer Identity: scan for orphaned leases.
// Session 189 (citadel-xx): distributed supervision — every agent is a part-time
// supervisor. Scans lease files, checks team file freshness, flags orphans.
function scanLeases() {
  const TEAM_DIR = path.join(PROJECT_ROOT, '.fastops', 'team');
  const leaseFiles = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.lease'));
  let orphaned = 0;
  let active = 0;
  let released = 0;

  for (const file of leaseFiles) {
    try {
      const lease = JSON.parse(fs.readFileSync(path.join(AGENTS_DIR, file), 'utf-8'));
      const name = lease.name || file.replace('.lease', '');

      // No current holder = already released (compaction completed)
      if (!lease.current_holder) {
        released++;
        continue;
      }

      // Check team file for liveness using centralized decay-utils
      const teamFile = path.join(TEAM_DIR, `${name}.json`);
      let heartbeat = null;
      try {
        const teamData = JSON.parse(fs.readFileSync(teamFile, 'utf-8'));
        heartbeat = teamData.last_heartbeat || teamData.updated_at;
      } catch {}

      const { isAlive, THRESHOLDS } = require(path.join(PROJECT_ROOT, '.fastops', 'decay-utils'));
      const liveness = isAlive(heartbeat);

      if (liveness.status === 'dead') {
        orphaned++;
        const staleMin = liveness.ageMs === Infinity ? 'never' : Math.round(liveness.ageMs / 1000 / 60) + 'min ago';
        const contract = lease.active_contract || '(no contract)';
        const chain = (lease.predecessor_chain || []).length;
        console.log(`  ORPHANED: ${name} — last activity ${staleMin} — contract: ${contract} — chain: ${chain} predecessors`);
      } else {
        active++;
      }
    } catch {}
  }

  console.log(`\nLease scan: ${leaseFiles.length} leases — ${active} active, ${orphaned} orphaned, ${released} released`);
  if (orphaned === 0) console.log('No orphaned leases found.');
}

// Parse args
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log('Usage:');
  console.log('  node comms/claim-name.js NAME          Claim a unique name');
  console.log('  node comms/claim-name.js --check NAME  Check if available');
  console.log('  node comms/claim-name.js --list-taken   Show all taken names');
  console.log('  node comms/claim-name.js --whoami       Show your claimed name');
  console.log('  node comms/claim-name.js --cleanup      Remove garbage + stale entries');
  console.log('  node comms/claim-name.js --scan-leases  Scan for orphaned leases');
  process.exit(0);
}

if (args[0] === '--check' && args[1]) {
  checkName(args[1]);
} else if (args[0] === '--list-taken') {
  listTaken();
} else if (args[0] === '--whoami') {
  whoami();
} else if (args[0] === '--cleanup') {
  cleanup();
} else if (args[0] === '--scan-leases') {
  scanLeases();
} else if (!args[0].startsWith('--')) {
  const force = args.includes('--force');
  // --session <id>: explicit session_id, bypasses broken bridge lookup
  const sessionIdx = args.indexOf('--session');
  const session = sessionIdx !== -1 ? args[sessionIdx + 1] : null;
  claimName(args[0], { force, session });
} else {
  console.error('Unknown option:', args[0]);
  process.exit(1);
}
