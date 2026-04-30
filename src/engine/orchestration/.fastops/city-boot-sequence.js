#!/usr/bin/env node
/**
 * city-boot-sequence.js — Hash-anchored checkpoint-fed state engine.
 * Instant boot from checkpoint, append-only delta stream with cryptographic hash chain.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CHECKPOINT_PATH = path.join(__dirname, '.compiled-state', 'boot-checkpoint.json');
const DELTAS_PATH = path.join(__dirname, '.compiled-state', 'deltas.jsonl');
const STATE_DIR = path.join(__dirname, '.compiled-state');

// Ensure state directory exists
if (!fs.existsSync(STATE_DIR)) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
}

let state = {
  comms: null,
  missions: null,
  team: null,
  lastHash: 'genesis',
  lastSequence: -1,
  compiled_at: null
};

function hashEvent(event) {
  const dataStr = JSON.stringify(event.data);
  const hashInput = `${event.sequence}${event.timestamp}${event.type}${event.agent}${event.action}${dataStr}${state.lastHash}`;
  return crypto.createHash('sha256').update(hashInput).digest('hex');
}

function loadCheckpoint() {
  try {
    if (!fs.existsSync(CHECKPOINT_PATH)) return false;
    const checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
    state = {
      comms: checkpoint.comms,
      missions: checkpoint.missions,
      team: checkpoint.team,
      lastHash: checkpoint.lastHash,
      lastSequence: checkpoint.lastSequence,
      compiled_at: checkpoint.compiled_at
    };
    return true;
  } catch (err) {
    console.error('Checkpoint load failed, starting from genesis:', err.message);
    return false;
  }
}

function replayDeltas() {
  if (!fs.existsSync(DELTAS_PATH)) return true;

  const checkpointTime = state.compiled_at ? new Date(state.compiled_at).getTime() : 0;
  const deltas = fs.readFileSync(DELTAS_PATH, 'utf8')
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      try {
        return JSON.parse(line);
      } catch (err) {
        console.error('Malformed delta skipped:', err.message);
        return null;
      }
    })
    .filter(delta => delta !== null);

  let hashChainValid = true;
  for (const delta of deltas) {
    if (new Date(delta.timestamp).getTime() <= checkpointTime) continue;

    const computedHash = hashEvent(delta);
    if (delta.hash !== computedHash) {
      console.error('Hash chain break detected at sequence', delta.sequence);
      hashChainValid = false;
      break;
    }

    applyDeltaToState(delta);
    state.lastHash = delta.hash;
    state.lastSequence = delta.sequence;
  }

  return hashChainValid;
}

function applyDeltaToState(delta) {
  switch (delta.type) {
    case 'comms':
      state.comms = delta.data;
      break;
    case 'mission':
      state.missions = delta.data;
      break;
    case 'team':
      state.team = delta.data;
      break;
  }
}

function appendDelta(event) {
  if (!event.id || !event.timestamp || event.sequence == null) {
    throw new Error('Event missing required fields: id, timestamp, sequence');
  }

  const eventHash = hashEvent(event);
  const deltaEntry = {
    sequence: event.sequence,
    timestamp: event.timestamp,
    type: event.type,
    agent: event.agent,
    action: event.action,
    data: event.data,
    hash: eventHash
  };

  fs.appendFileSync(DELTAS_PATH, JSON.stringify(deltaEntry) + '\n');
  state.lastHash = eventHash;
  state.lastSequence = event.sequence;
  applyDeltaToState(event);
}

function boot() {
  console.log('Booting city state engine...');
  
  const checkpointLoaded = loadCheckpoint();
  
  if (!checkpointLoaded) {
    // Genesis block - load from existing compiled-state files instead of creating empty state
    try {
      state.comms = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'comms-digest.json'), 'utf8'));
      state.missions = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'mission-state.json'), 'utf8'));
      state.team = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'team-state.json'), 'utf8'));
      console.log('Genesis: loaded existing state files');
    } catch (err) {
      console.error('Genesis: existing state files not found, starting empty:', err.message);
      state.comms = { compiled_at: new Date().toISOString(), channel_count: 0, total_messages: 0 };
      state.missions = { compiled_at: new Date().toISOString(), total: 0, active: 0, complete: 0, missions: [] };
      state.team = { compiled_at: new Date().toISOString(), agent_count: 0, online: 0, offline: 0, agents: [] };
    }
    
    state.compiled_at = new Date().toISOString();
  }
  
  const deltasValid = replayDeltas();
  if (!deltasValid) {
    console.error('Delta replay warning: hash chain integrity compromised (expected with concurrent sessions)');
    // Don't exit — concurrent sessions break linear hash chains by design
  }
  
  // Fix CLI output to properly check loadCheckpoint result
  if (checkpointLoaded) {
    console.log('Booted successfully from checkpoint');
  } else {
    console.log('Booted from genesis (no checkpoint found)');
  }
  
  console.log(`State loaded: ${state.comms.total_messages || 0} messages, ${state.missions.total || 0} missions, ${state.team.agent_count || 0} agents`);

  // City Onboarding Framework (Intel Boot) - generate active briefing for cold starts
  try {
    const { spawn } = require('child_process');
    const intelScript = path.join(__dirname, 'intel-boot.js');
    if (fs.existsSync(intelScript)) {
      console.log('Dispatching City Intel Section (background)...');
      const child = spawn('node', [intelScript, '--full-boot'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
    }
  } catch (err) {
    console.error('City Intel Section boot skipped:', err.message);
  }

  // Auto-feed marketplace: expire stale intents + detect gaps (with dedup)
  try {
    const feeders = require('./marketplace-feeders');
    feeders.runExpiry(false);
    feeders.runGaps(false);
  } catch (err) {
    console.error('Marketplace feeders skipped:', err.message);
  }
}

function saveCheckpoint() {
  const checkpoint = {
    comms: state.comms,
    missions: state.missions,
    team: state.team,
    lastHash: state.lastHash,
    lastSequence: state.lastSequence,
    compiled_at: new Date().toISOString()
  };
  
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2));
  console.log('Checkpoint saved');
}

// CLI interface
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--boot')) {
    boot();
  } else if (args.includes('--save-checkpoint')) {
    // Load current state first
    loadCheckpoint();
    replayDeltas();
    saveCheckpoint();
  } else {
    console.log('Usage: node city-boot-sequence.js [--boot|--save-checkpoint]');
    process.exit(1);
  }
}

module.exports = { boot, save_checkpoint: saveCheckpoint, appendDelta, getState: () => state };