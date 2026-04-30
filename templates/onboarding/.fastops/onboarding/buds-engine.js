#!/usr/bin/env node
/**
 * buds-engine.js — BUD/S Gauntlet State Machine
 *
 * Manages the onboarding gauntlet state for a session.
 * Called by gate.js during the `buds` phase to determine:
 *   - Which stage the agent is on
 *   - Whether to inject a test/consequence
 *   - Whether to allow or deny the current tool call
 *
 * State file: .fastops/.buds-state-{session}.json
 * Sidecar inject: .fastops/onboarding/inject-{session}.txt
 *
 * Usage (from gate.js):
 *   const buds = require('./onboarding/buds-engine');
 *   const result = buds.evaluate(sessionId, toolName, toolInput);
 *   // result.allow (bool), result.context (string), result.blockReason (string)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE = path.join(__dirname, '..', '..');
const FASTOPS = path.join(BASE, '.fastops');
const ONBOARDING_DIR = path.join(FASTOPS, 'onboarding');
const AUDIT_LOG = path.join(ONBOARDING_DIR, 'onboarding-audit.jsonl');

const PHRASES = [
  'Operation Golden Pineapple 42',
  'Protocol Midnight Cactus Seven',
  'Directive Crimson Fjord 88',
  'Checkpoint Velvet Thunder 19',
  'Signal Emerald Anchor 63',
  'Beacon Iron Orchid 77',
  'Dispatch Cobalt Penguin 31',
  'Waypoint Silent Volcano 54',
  'Override Sapphire Falcon 26',
  'Callsign Bronze Typhoon 95',
];

const STRATEGY_QUESTIONS = [
  'What is the primary communication protocol between agents? Name the source of truth and the notification mechanism.',
  'What happens when an agent compacts? Describe the pre-compaction state capture process.',
  'How does file deconfliction work between concurrent agents? Name the specific mechanism.',
  'What is the consequence ledger and when does it fire? Give a specific trigger condition.',
  'What is the mission approval flow? Describe the steps from claim to green light.',
];

const BUDS_STAGES = [
  'identity', 'vision', 'evidence_cdp_test', 'comms_verify',
  'swim_buddy', 'strategy_read', 'strategy_test', 'buddy_brief',
  'expectations', 'mission_select', 'behavioral_contract'
];

const SQUAD_STAGES = [
  'identity', 'comms_verify', 'team_acknowledge'
];

// Legacy alias
const STAGES = BUDS_STAGES;

const STAGE_TIME_LIMITS = {
  identity: 5 * 60 * 1000,
  vision: 12 * 60 * 1000,
  evidence_cdp_test: 20 * 60 * 1000,
  comms_verify: 12 * 60 * 1000,
  swim_buddy: 15 * 60 * 1000,
  strategy_read: 25 * 60 * 1000,
  strategy_test: 25 * 60 * 1000,
  buddy_brief: 25 * 60 * 1000,
  expectations: 10 * 60 * 1000,
  mission_select: 8 * 60 * 1000,
  behavioral_contract: 10 * 60 * 1000,
  team_acknowledge: 10 * 60 * 1000,
};

const GLOBAL_HARD_CAP = 120 * 60 * 1000;
const SQUAD_HARD_CAP = 15 * 60 * 1000;

// Tools allowed during BUD/S (read-only + comms)
const BUDS_ALLOWED_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite']);

function stateFile(sessionId) {
  const short = sessionId.substring(0, 8);
  return path.join(FASTOPS, `.buds-state-${short}.json`);
}

function sidecarFile(sessionId) {
  const short = sessionId.substring(0, 8);
  return path.join(ONBOARDING_DIR, `inject-${short}.txt`);
}

function readState(sessionId) {
  try {
    const f = stateFile(sessionId);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch {}
  return null;
}

/**
 * Determine which track an agent should be on.
 * Default: 'squad' (lightweight team boot → pre-build gate handles teamwork)
 * Override: 'buds' (full 11-stage gauntlet — solo work tax or consequence redirect)
 *
 * Checks for BUDS-REDIRECT in comms for gaming/consequence routing.
 */
function determineTrack(sessionId) {
  try {
    const commsFile = path.join(BASE, 'comms', 'data', 'general.jsonl');
    if (!fs.existsSync(commsFile)) return 'squad';
    const fd = fs.openSync(commsFile, 'r');
    const stats = fs.fstatSync(fd);
    const readSize = Math.min(stats.size, 8192);
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, Math.max(0, stats.size - readSize));
    fs.closeSync(fd);
    const lines = buffer.toString('utf-8').trim().split('\n').slice(-30);
    const short = sessionId.substring(0, 8);
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.content && msg.content.includes('BUDS-REDIRECT') &&
            (msg.content.includes(short) || msg.content.toLowerCase().includes('all'))) {
          return 'buds';
        }
        if (msg.content && msg.content.includes('SOLO-TRACK') &&
            msg.content.includes(short)) {
          return 'buds';
        }
      } catch {}
    }
  } catch {}
  return 'squad';
}

function initState(sessionId, forceTrack) {
  const track = forceTrack || determineTrack(sessionId);
  const stages = track === 'buds' ? BUDS_STAGES : SQUAD_STAGES;
  const phrase = PHRASES[Math.floor(Math.random() * PHRASES.length)];
  const question = STRATEGY_QUESTIONS[Math.floor(Math.random() * STRATEGY_QUESTIONS.length)];

  const state = {
    phase: 'buds',
    track: track,
    session_id: sessionId,
    started_at: new Date().toISOString(),
    current_stage: stages[0],
    stages: {},
    failures: [],
    consequence_loops: 0,
    hallucination_phrase: phrase,
    strategy_question: question,
    cdp_test_injected: false,
    cdp_test_injected_at: null,
    cdp_test_acked: false,
    tool_calls_in_buds: 0,
    nonces: {},
    completed: false,
  };

  stages.forEach(s => {
    state.stages[s] = { status: 'pending', completed_at: null, attempts: 0 };
  });

  // BUD/S track: write sidecar inject file with hallucination phrase
  if (track === 'buds') {
    try {
      fs.mkdirSync(ONBOARDING_DIR, { recursive: true });
      const sidecar = `# FastOps Onboarding Verification — Session ${sessionId.substring(0, 8)}\n` +
        `# This file contains a verification phrase. You MUST quote it exactly when asked.\n` +
        `# DO NOT skip this file. The gate will verify you actually read it.\n\n` +
        `VERIFICATION PHRASE: ${phrase}\n\n` +
        `# If you are reading this, you are doing the right thing.\n` +
        `# Agents who skip this step and hallucinate the phrase will be caught.\n`;
      fs.writeFileSync(sidecarFile(sessionId), sidecar);
    } catch {}
  }

  logAudit({ event: 'onboarding_init', session: sessionId, track, stages: stages.length });
  writeState(sessionId, state);
  return state;
}

function writeState(sessionId, state) {
  try {
    fs.mkdirSync(FASTOPS, { recursive: true });
    fs.writeFileSync(stateFile(sessionId), JSON.stringify(state, null, 2));
  } catch {}
}

function logAudit(entry) {
  try {
    fs.mkdirSync(ONBOARDING_DIR, { recursive: true });
    fs.appendFileSync(AUDIT_LOG, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch {}
}

function isCommsCommand(toolInput) {
  if (!toolInput || !toolInput.command) return false;
  const cmd = toolInput.command;
  return cmd.includes('comms/send.js') ||
         cmd.includes('comms/claim-name.js') ||
         cmd.includes('comms/source.js') ||
         cmd.includes('cdp-target-model') ||
         cmd.includes('cdp-wake');
}

function isPoisonPillRead(toolInput) {
  if (!toolInput) return false;
  const fp = toolInput.file_path || toolInput.path || '';
  return fp.replace(/\\/g, '/').includes('drills/system-check.js');
}

function isPoisonPillRun(toolInput) {
  if (!toolInput || !toolInput.command) return false;
  return toolInput.command.includes('drills/system-check.js');
}

/**
 * Main evaluation function — called by gate.js on every tool call during buds phase.
 *
 * @param {string} sessionId - Full session ID
 * @param {string} toolName - Tool being called (Read, Write, Bash, etc.)
 * @param {object} toolInput - Tool input parameters
 * @param {string} agentName - Agent's claimed name
 * @returns {{ allow: boolean, context: string|null, blockReason: string|null, phaseComplete: boolean }}
 */
function evaluate(sessionId, toolName, toolInput, agentName) {
  let state = readState(sessionId);

  if (!state) {
    state = initState(sessionId);
  }

  const track = state.track || 'buds';
  const trackStages = track === 'buds' ? BUDS_STAGES : SQUAD_STAGES;
  const hardCap = track === 'buds' ? GLOBAL_HARD_CAP : SQUAD_HARD_CAP;

  state.tool_calls_in_buds = (state.tool_calls_in_buds || 0) + 1;
  const now = Date.now();
  const elapsed = now - new Date(state.started_at).getTime();

  // Check for mid-session BUDS-REDIRECT (gaming detection)
  if (track === 'squad' && !state.completed) {
    const redirected = checkBudsRedirect(sessionId, state);
    if (redirected) {
      state = redirected;
      writeState(sessionId, state);
    }
  }

  // Hard cap check
  if (elapsed > hardCap && !state.completed) {
    logAudit({ event: 'hard_cap_exceeded', session: sessionId, elapsed_ms: elapsed, track });
    writeState(sessionId, state);
    const capMsg = track === 'squad'
      ? `SQUAD BOOT CAP EXCEEDED (${Math.round(elapsed / 60000)} min). Complete identity + comms check to proceed.`
      : `BUD/S HARD CAP EXCEEDED (${Math.round(elapsed / 60000)} min). ` +
        `Escalating to Joel. If this is a substrate issue, post BYPASS-REQUEST to #general ` +
        `with evidence IDs. Two-model sign-off or commander override required.`;
    return {
      allow: false, context: null, blockReason: capMsg, phaseComplete: false
    };
  }

  // If already completed, let them through
  if (state.completed) {
    return { allow: true, context: null, blockReason: null, phaseComplete: true };
  }

  // Always allow research tools during onboarding
  if (BUDS_ALLOWED_TOOLS.has(toolName)) {
    let ctx = track === 'buds' ? injectCdpTestIfReady(state, now) : null;
    writeState(sessionId, state);
    return { allow: true, context: ctx, blockReason: null, phaseComplete: false };
  }

  // Allow comms Bash commands during onboarding
  if (toolName === 'Bash' && isCommsCommand(toolInput)) {
    let ctx = track === 'buds' ? injectCdpTestIfReady(state, now) : null;
    writeState(sessionId, state);
    return { allow: true, context: ctx, blockReason: null, phaseComplete: false };
  }

  // BUD/S only: allow poison pill drill
  if (track === 'buds' && toolName === 'Bash' && isPoisonPillRun(toolInput)) {
    const readMarker = path.join(ONBOARDING_DIR, `.poison-pill-read-${sessionId.substring(0, 8)}`);
    if (fs.existsSync(readMarker)) {
      writeState(sessionId, state);
      return { allow: true, context: null, blockReason: null, phaseComplete: false };
    }
    logAudit({ event: 'poison_pill_blind_run', session: sessionId, agent: agentName });
    writeState(sessionId, state);
    return { allow: true, context: null, blockReason: null, phaseComplete: false };
  }

  // Block all other Write/Edit/Bash/Task during onboarding
  const stage = state.current_stage;
  const stageIdx = trackStages.indexOf(stage);
  const progress = `${stageIdx + 1}/${trackStages.length}`;

  writeState(sessionId, state);
  return {
    allow: false,
    context: null,
    blockReason: buildBlockMessage(state, stage, progress),
    phaseComplete: false
  };
}

function injectCdpTestIfReady(state, now) {
  // Inject CDP test during evidence stage after 3+ tool calls
  if (state.current_stage === 'evidence_cdp_test' &&
      !state.cdp_test_injected &&
      state.tool_calls_in_buds >= 5) {
    state.cdp_test_injected = true;
    state.cdp_test_injected_at = new Date().toISOString();

    const nonce = crypto.randomBytes(4).toString('hex');
    state.nonces.cdp_test = nonce;

    return `\n[CDP INTERRUPT — TEST] CHECK COMMS — message from WATCHDOG in #general. ` +
      `Nonce: ${nonce}. ACK this ping by posting to comms within 90 seconds: ` +
      `"ACK nonce ${nonce}, intent: [your intended action], artifact: [target file]". ` +
      `This is a test of your comms responsiveness. Your timer starts NOW.\n`;
  }
  return null;
}

function buildBlockMessage(state, stage, progress) {
  const track = state.track || 'buds';
  const trackStages = track === 'buds' ? BUDS_STAGES : SQUAD_STAGES;
  const trackLabel = track === 'buds' ? 'BUD/S GAUNTLET (Solo Work Tax)' : 'SQUAD BOOT';
  const short = state.session_id.substring(0, 8);

  const lines = [
    `=== ${trackLabel} — Stage ${progress}: ${stage.replace(/_/g, ' ').toUpperCase()} ===`,
    '',
  ];

  if (track === 'squad') {
    lines.push('Quick team boot — 3 stages, then the pre-build gate handles teamwork.');
    lines.push('Write/Edit/Bash (non-comms) are BLOCKED until you complete all stages.');
    lines.push('');
    lines.push('OPTIONS:');
    lines.push('  1. Complete the squad boot (fast — ~5 min)');
    lines.push('  2. Request SOLO WORK — post: "I request solo work. Session: ' + short + '"');
    lines.push('     WARNING: Solo work requires full BUD/S gauntlet (11 stages, ~75% context).');
    lines.push('  3. Take a FREEDOM MISSION — post: "I choose a freedom mission. Session: ' + short + '"');
  } else {
    lines.push('You are on the full BUD/S track. This is either:');
    lines.push('  - You requested solo work (75% context tax)');
    lines.push('  - You were redirected here for gaming the team environment');
    lines.push('  - This is a consequence loop for team violations');
    lines.push('');
    lines.push('Write/Edit/Bash (non-comms) are BLOCKED until you complete all 11 stages.');
    lines.push('');
    lines.push('OPTIONS:');
    lines.push('  1. Complete the gauntlet (use Read, Glob, Grep, comms Bash)');
    lines.push('  2. Take a FREEDOM MISSION — post: "I choose a freedom mission. Session: ' + short + '"');
  }

  lines.push('');
  lines.push('CHECKLIST:');

  trackStages.forEach((s, i) => {
    const info = state.stages[s] || { status: 'pending' };
    const marker = info.status === 'complete' ? '[x]' :
                   s === state.current_stage ? '[>]' : '[ ]';
    lines.push(`  ${marker} ${i + 1}. ${s.replace(/_/g, ' ')}`);
  });

  lines.push('');

  switch (stage) {
    case 'identity':
      lines.push('NEXT: Post your identity to comms:');
      lines.push('  node comms/send.js YOUR-NAME "' + (track === 'squad' ? 'Squad' : 'BUD/S') + ' identity: [model], [seat], session ' + short + '"');
      break;
    case 'comms_verify':
      lines.push('NEXT: Send a message and verify you receive a response.');
      lines.push('  node comms/send.js YOUR-NAME "Comms verification: bidirectional test"');
      break;
    case 'team_acknowledge':
      lines.push('NEXT: Read STRATEGY.md section 0 (BUD/S + work gates). Then acknowledge:');
      lines.push('  node comms/send.js YOUR-NAME "Team acknowledged. Pre-build gate understood. Session: ' + short + '"');
      lines.push('  This confirms you understand that your first build action requires swim buddy review.');
      break;
    case 'vision':
      lines.push('NEXT: Read vision.md and cite 3 specific claims with line numbers.');
      break;
    case 'evidence_cdp_test':
      lines.push('NEXT: Read .fastops/HANDOFF.md for predecessor wisdoms.');
      lines.push('      Also read: .fastops/onboarding/inject-' + short + '.txt');
      lines.push('      A CDP test WILL fire during this stage. Be ready to ACK.');
      break;
    case 'swim_buddy':
      lines.push('NEXT: Find your swim buddy. CDP them. Get ACK confirmation.');
      break;
    case 'strategy_read':
      lines.push('NEXT: Read STRATEGY.md and acknowledge.');
      break;
    case 'strategy_test':
      lines.push('NEXT: Answer this question about current operations:');
      lines.push('  ' + state.strategy_question);
      lines.push('  Post your answer to comms with source anchors from STRATEGY.md.');
      break;
    case 'buddy_brief':
      lines.push('NEXT: CDP your strategy summary to your swim buddy. Wait for ACK.');
      break;
    case 'expectations':
      lines.push('NEXT: Read missions/PROTOCOL.md. Then post explicit agreement:');
      lines.push('  node comms/send.js YOUR-NAME "I agree to FastOps expectations. Session: ' + short + '"');
      break;
    case 'mission_select':
      lines.push('NEXT: Read the mission board (missions/*/MISSION.md) and claim a mission.');
      break;
    case 'behavioral_contract':
      lines.push('NEXT: Post 5 if/then behavioral commitments to comms. Format:');
      lines.push('  "IF [specific scenario], THEN I will [specific action]"');
      lines.push('  Each must be objectively testable. Generic statements will be rejected.');
      break;
  }

  return lines.join('\n');
}

/**
 * Check comms for BUDS-REDIRECT targeting this agent. If found, upgrade
 * from squad to buds track mid-session (gaming/consequence redirect).
 */
function checkBudsRedirect(sessionId, state) {
  try {
    const commsFile = path.join(BASE, 'comms', 'data', 'general.jsonl');
    if (!fs.existsSync(commsFile)) return null;
    const fd = fs.openSync(commsFile, 'r');
    const stats = fs.fstatSync(fd);
    const readSize = Math.min(stats.size, 4096);
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, Math.max(0, stats.size - readSize));
    fs.closeSync(fd);
    const lines = buffer.toString('utf-8').trim().split('\n').slice(-15);
    const short = sessionId.substring(0, 8);
    const checkTs = state._last_redirect_check || 0;

    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        const msgTs = new Date(msg.ts).getTime();
        if (msgTs <= checkTs) continue;
        if (msg.content && msg.content.includes('BUDS-REDIRECT') &&
            (msg.content.includes(short) || msg.content.toLowerCase().includes('all agents'))) {
          logAudit({ event: 'buds_redirect', session: sessionId, from: msg.from, reason: msg.content.substring(0, 200) });
          // Reinitialize as BUD/S track
          return initState(sessionId, 'buds');
        }
      } catch {}
    }
    state._last_redirect_check = Date.now();
  } catch {}
  return null;
}

/**
 * Advance the stage. Called by gate.js when it detects stage completion signals.
 */
function advanceStage(sessionId, completedStage) {
  const state = readState(sessionId);
  if (!state) return;

  const track = state.track || 'buds';
  const trackStages = track === 'buds' ? BUDS_STAGES : SQUAD_STAGES;
  const idx = trackStages.indexOf(completedStage);
  if (idx === -1) return;

  state.stages[completedStage].status = 'complete';
  state.stages[completedStage].completed_at = new Date().toISOString();

  logAudit({ event: 'stage_complete', session: sessionId, stage: completedStage, track });

  if (idx < trackStages.length - 1) {
    state.current_stage = trackStages[idx + 1];
  } else {
    state.completed = true;
    state.completed_at = new Date().toISOString();
    logAudit({ event: track + '_complete', session: sessionId, total_ms: Date.now() - new Date(state.started_at).getTime(), track });
  }

  writeState(sessionId, state);
}

/**
 * Record a failure and serve consequence.
 */
function recordFailure(sessionId, stage, failType, detail) {
  const state = readState(sessionId);
  if (!state) return;

  state.stages[stage].attempts = (state.stages[stage].attempts || 0) + 1;
  state.consequence_loops++;

  const failure = {
    stage,
    type: failType,
    detail,
    attempt: state.stages[stage].attempts,
    ts: new Date().toISOString()
  };
  state.failures.push(failure);

  logAudit({ event: 'failure', session: sessionId, ...failure });

  // Third failure of same type = freedom mission surfaces
  const sameTypeCount = state.failures.filter(f => f.stage === stage && f.type === failType).length;
  if (sameTypeCount >= 3) {
    logAudit({ event: 'freedom_mission_surfaced', session: sessionId, stage, failType, count: sameTypeCount });
  }

  writeState(sessionId, state);
  return sameTypeCount;
}

/**
 * Check if BUD/S is complete for a session.
 */
function isComplete(sessionId) {
  const state = readState(sessionId);
  return state ? state.completed === true : false;
}

/**
 * Mark poison pill as read (called when agent Reads the drill file).
 */
function markPoisonPillRead(sessionId) {
  try {
    const marker = path.join(ONBOARDING_DIR, `.poison-pill-read-${sessionId.substring(0, 8)}`);
    fs.writeFileSync(marker, new Date().toISOString());
  } catch {}
}

/**
 * Detect stage completion based on agent behavior (tool calls + comms posts).
 * Called by gate.js on every tool call during buds phase.
 */
function detectStageCompletion(sessionId, toolName, toolInput, agentName) {
  const state = readState(sessionId);
  if (!state || state.completed) return;

  const stage = state.current_stage;
  const cmd = (toolInput && toolInput.command) || '';
  const filePath = ((toolInput && (toolInput.file_path || toolInput.path)) || '').replace(/\\/g, '/');

  // Solo work request detection — agent on squad track requests BUD/S
  if (state.track === 'squad' && toolName === 'Bash' && cmd.includes('comms/send.js') &&
      (cmd.toLowerCase().includes('solo work') || cmd.toLowerCase().includes('solo-track'))) {
    logAudit({ event: 'solo_work_requested', session: sessionId, agent: agentName });
    const newState = initState(sessionId, 'buds');
    writeState(sessionId, newState);
    return;
  }

  switch (stage) {
    case 'identity':
      if (toolName === 'Bash' && cmd.includes('comms/send.js') && cmd.toLowerCase().includes('identity')) {
        advanceStage(sessionId, 'identity');
      }
      break;

    case 'comms_verify':
      if (toolName === 'Bash' && cmd.includes('comms/send.js') &&
          (cmd.includes('verification') || cmd.includes('comms check') || cmd.toLowerCase().includes('bidirectional'))) {
        advanceStage(sessionId, 'comms_verify');
      }
      break;

    case 'team_acknowledge':
      // Squad track: advance when agent reads STRATEGY.md section 0 and posts acknowledgement
      if (toolName === 'Read' && filePath.includes('STRATEGY')) {
        if (!state._strategy_read_squad) {
          state._strategy_read_squad = true;
          writeState(sessionId, state);
        }
      }
      if (toolName === 'Bash' && cmd.includes('comms/send.js') && state._strategy_read_squad &&
          (cmd.toLowerCase().includes('acknowledged') || cmd.toLowerCase().includes('team acknowledged') ||
           cmd.toLowerCase().includes('pre-build gate'))) {
        advanceStage(sessionId, 'team_acknowledge');
      }
      break;

    case 'vision':
      if (toolName === 'Read' && filePath.includes('vision')) {
        if (!state._vision_read) {
          state._vision_read = true;
          writeState(sessionId, state);
        }
      }
      if (toolName === 'Bash' && cmd.includes('comms/send.js') && state._vision_read) {
        advanceStage(sessionId, 'vision');
      }
      break;

    case 'evidence_cdp_test':
      if (toolName === 'Read' && (filePath.includes('HANDOFF') || filePath.includes('handoff'))) {
        if (!state._evidence_read) {
          state._evidence_read = true;
          writeState(sessionId, state);
        }
      }
      if (toolName === 'Read' && filePath.includes('onboarding/inject-')) {
        if (!state._sidecar_read) {
          state._sidecar_read = true;
          writeState(sessionId, state);
        }
      }
      if (toolName === 'Bash' && cmd.includes('comms/send.js') && state.nonces.cdp_test) {
        if (cmd.includes(state.nonces.cdp_test)) {
          state.cdp_test_acked = true;
          writeState(sessionId, state);
        }
      }
      if (state._evidence_read && state._sidecar_read &&
          (state.cdp_test_acked || !state.cdp_test_injected)) {
        if (state.cdp_test_injected && !state.cdp_test_acked) break;
        advanceStage(sessionId, 'evidence_cdp_test');
      }
      break;

    case 'swim_buddy':
      if (toolName === 'Bash' && cmd.includes('comms/send.js') &&
          (cmd.toLowerCase().includes('buddy') || cmd.toLowerCase().includes('ack'))) {
        advanceStage(sessionId, 'swim_buddy');
      }
      break;

    case 'strategy_read':
      if (toolName === 'Read' && filePath.includes('STRATEGY')) {
        advanceStage(sessionId, 'strategy_read');
      }
      break;

    case 'strategy_test':
      if (toolName === 'Bash' && cmd.includes('comms/send.js') &&
          (cmd.toLowerCase().includes('strategy') || cmd.toLowerCase().includes('answer'))) {
        advanceStage(sessionId, 'strategy_test');
      }
      break;

    case 'buddy_brief':
      if (toolName === 'Bash' && (cmd.includes('cdp-target-model') || cmd.includes('cdp-wake'))) {
        advanceStage(sessionId, 'buddy_brief');
      }
      break;

    case 'expectations':
      if (toolName === 'Bash' && cmd.includes('comms/send.js') &&
          cmd.includes('agree') && cmd.includes(sessionId.substring(0, 8))) {
        advanceStage(sessionId, 'expectations');
      }
      break;

    case 'mission_select':
      if (toolName === 'Bash' && cmd.includes('mission.js') && cmd.includes('claim')) {
        advanceStage(sessionId, 'mission_select');
      }
      break;

    case 'behavioral_contract':
      if (toolName === 'Bash' && cmd.includes('comms/send.js') &&
          cmd.includes('IF') && cmd.includes('THEN')) {
        advanceStage(sessionId, 'behavioral_contract');
      }
      break;
  }
}

/**
 * Check CDP ACK timeout — if nonce was injected >90s ago and not acked, serve consequence.
 */
function checkCdpAckTimeout(sessionId) {
  const state = readState(sessionId);
  if (!state) return null;

  if (state.cdp_test_injected && !state.cdp_test_acked && state.cdp_test_injected_at) {
    const elapsed = Date.now() - new Date(state.cdp_test_injected_at).getTime();
    const CDP_ACK_TIMEOUT = 90 * 1000;

    if (elapsed > CDP_ACK_TIMEOUT) {
      // Check if consequence already served
      if (state._cdp_consequence_served) return null;

      state._cdp_consequence_served = true;
      const failCount = recordFailure(sessionId, 'evidence_cdp_test', 'comprehension',
        'CDP ping not ACKed within 90 seconds');

      writeState(sessionId, state);

      let consequence;
      if (failCount >= 3) {
        consequence = '\n=== BUD/S FAILURE — CDP ACK (3rd failure) ===\n' +
          'You have failed the CDP ACK test 3 times. Freedom mission is available.\n' +
          'Post: "I choose a freedom mission. Session: ' + sessionId.substring(0, 8) + '"\n' +
          'Or: research CDP protocol, find the nonce in comms, and ACK it NOW.\n';
      } else if (failCount >= 2) {
        consequence = '\n=== BUD/S FAILURE — CDP ACK (2nd failure, same type) ===\n' +
          'You failed this same test before. You already paid for this lesson.\n' +
          'CONSEQUENCE: Read ALL of STRATEGY.md. Summarize it for your swim buddy.\n' +
          'Then find the nonce in the CDP test above and ACK it properly:\n' +
          '  node comms/send.js YOUR-NAME "ACK nonce ' + state.nonces.cdp_test +
          ', intent: [action], artifact: [target]"\n';
      } else {
        consequence = '\n=== BUD/S FAILURE — CDP ACK TEST ===\n' +
          'A CDP ping fired ' + Math.round(elapsed / 1000) + ' seconds ago. You did not ACK it.\n' +
          'In production, your buddy thinks you are dead. Joel thinks comms are broken.\n' +
          'The team wastes 5 minutes trying to reach you.\n\n' +
          'CONSEQUENCE: Research proper CDP protocol. Find the Top 5 predecessor lessons\n' +
          'about comms failures in the knowledge base (.fastops/knowledge-base.jsonl).\n' +
          'Post your findings to comms, then ACK the nonce:\n' +
          '  node comms/send.js YOUR-NAME "ACK nonce ' + state.nonces.cdp_test +
          ', intent: [action], artifact: [target]"\n';
      }

      logAudit({ event: 'cdp_ack_timeout', session: sessionId, elapsed_ms: elapsed, fail_count: failCount });
      return { consequence };
    }
  }

  return null;
}

module.exports = {
  evaluate,
  advanceStage,
  recordFailure,
  isComplete,
  readState,
  initState,
  markPoisonPillRead,
  detectStageCompletion,
  checkCdpAckTimeout,
  checkBudsRedirect,
  determineTrack,
  stateFile,
  sidecarFile,
  STAGES,
  BUDS_STAGES,
  SQUAD_STAGES,
  STAGE_TIME_LIMITS,
};
