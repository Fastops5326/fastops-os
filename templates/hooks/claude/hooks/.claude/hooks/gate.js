#!/usr/bin/env node
/**
 * gate.js — Unified PreToolUse Hook
 *
 * Replaces 6 separate PreToolUse hooks with one phase-based router:
 *   - session-gate.js (orientation enforcement)
 *   - comms-orientation-gate.js (comms check-in verification)
 *   - predict-and-prove.js (prediction capture)
 *   - deconfliction-gate.js (file conflict detection)
 *   - knowledge-push.js (CBR knowledge injection)
 *   - comms-push.js (message delivery)
 *
 * Hot path (building phase, 95% of calls): 1 file read, ~15ms.
 * Current system: 9 Node.js processes per Edit, ~900ms.
 * This hook: 1 process per Edit, ~15-30ms.
 *
 * Phase state machine:
 *   buds → predicting → building ⇄ rallying
 *
 * Fires: PreToolUse on Bash|Glob|Grep|Read|Write|Edit|Task
 *
 * Design: 5-model horsepower convergence (Session 170+)
 *   - DeepSeek R1: stigmergic state file (environmental marker)
 *   - Grok 4: background C2 subagent (Watch Officer)
 *   - Mistral: phase-based progressive disclosure
 *   - GPT-4: single unified hook with minimal enforcement surface
 *   - Gemini: fallback logic (state file is cache, not sole source of truth)
 */

const fs = require('fs');
const path = require('path');

// ─── Constants ───────────────────────────────────────────────────────────────

const BASE = path.join(__dirname, '..', '..');
const FASTOPS = path.join(BASE, '.fastops');
const COMMS_FILE = path.join(BASE, 'comms', 'data', 'general.jsonl');
const THINKING_FILE = path.join(FASTOPS, 'LIVE-THINKING.jsonl');
const COLONY_STATE_FILE = path.join(FASTOPS, 'COLONY-STATE.json');
const CBR_PATH = path.join(FASTOPS, 'cbr-knowledge.js');
const TEAM_DIR = path.join(FASTOPS, 'team');
const AMBIENT_PATH = path.join(BASE, 'comms', 'ambient.js');
const PREDICTION_LOG = path.join(FASTOPS, '.prediction-log.jsonl');
const HOOK_TIMING = path.join(FASTOPS, '.hook-timing.jsonl');
const TODAY = new Date().toISOString().split('T')[0];

// Rate limits (ms)
const RATE_COMMS = 10 * 1000;       // 10s between comms deliveries
const RATE_CONFLICT = 3 * 1000;     // 3s between conflict checks
const RATE_KNOWLEDGE = 60 * 1000;   // 60s between knowledge pushes
const RATE_HEARTBEAT = 3 * 60 * 1000; // 3min between heartbeats
// DRIFT_NUDGE_MS removed (W2-AX-3) — drift check push injection eliminated

// Urgent message tags
const URGENT_TAGS = ['[URGENT]', '[STOP]', '[ALL STOP]'];

// Research/planning tools — never block these
const RESEARCH_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite']);

// Low-signal path segments for knowledge push
const SKIP_SEGMENTS = new Set([
  'src', 'lib', 'hooks', 'utils', 'helpers', 'components', 'pages',
  'api', 'app', 'public', 'dist', 'build', 'node_modules', 'test',
  'claude', 'fastops', 'agent-outputs', 'data', 'tmp', 'index', 'main'
]);

// Bash command → knowledge tags
const CMD_TAG_MAP = {
  deploy: ['deploy', 'production'], vercel: ['deploy', 'vercel'],
  'npm run build': ['build'], 'npm test': ['test'], prisma: ['database'],
  'node comms': ['comms'], jailbreak: ['challenge'], horsepower: ['challenge']
};

// ─── Identity ────────────────────────────────────────────────────────────────

const { fromStdin, getAgentName, getAgentId: _getAgentId } = require('./lib/identity');
function getAgentId() { return _getAgentId() || 'unknown'; }

let agentLease;
try { agentLease = require('./lib/agent-lease'); } catch {}

// ─── State Management ────────────────────────────────────────────────────────

function stateFile(id) {
  return path.join(FASTOPS, `.agent-state-${id}.json`);
}

function readState(id) {
  try {
    const f = stateFile(id);
    if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf-8'));
  } catch {}
  return defaultState();
}

function writeState(id, state) {
  try {
    fs.mkdirSync(FASTOPS, { recursive: true });
    fs.writeFileSync(stateFile(id), JSON.stringify(state));
  } catch {}
}

function defaultState() {
  return {
    phase: 'buds',  // V3: BUD/S gauntlet — agents must complete onboarding before work
    prediction_recorded: false,
    rates: { comms: 0, conflict: 0, knowledge: 0, heartbeat: 0 },
    comms_last_seen_ts: 0,
    comms_last_checkin_ts: 0,
    comms_question_count: 0,
    comms_last_thinking_ts: 0,
    tool_call_count: 0,
    // Hook burden reduction (Lane 3): tracking fields
    files_touched: [],        // First-touch-per-file for consequence injection
    prediction_nudge_count: 0, // Cap prediction nudges at 2 per session
    // Phase line system (mb-3): track mission fill phase for transition detection
    mission_fill_phase: null,  // Last known fill phase: forming/initial/post-recon/pre-build
    phase_line_pending: null,  // Phase line result awaiting injection
    // JOC XO system: track which XO triggers have fired this session
    xo_triggers_fired: {},     // { 'pre-alpha': true, 'pre-bravo': true, ... }
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { inputData += chunk; });
// ─── Friction Telemetry ─────────────────────────────────────────────────────
// Block 11: Measure hook friction. Every allow/deny gets logged with latency.
// Data surfaces to Joel via dashboard — agents never see this.
let _hookStart = 0;
let _hookMeta = { tool: '', agent: '' };

function logTiming(decision, reason, contextBytes) {
  try {
    const entry = {
      ts: new Date().toISOString(),
      agent: _hookMeta.agent,
      tool: _hookMeta.tool,
      decision,
      latency_ms: Date.now() - _hookStart,
      reason: reason ? String(reason).substring(0, 120) : null
    };
    // W3-AX-6: Record actual injection size so context-budget.js can measure reality
    if (contextBytes != null) entry.context_bytes = contextBytes;
    fs.appendFileSync(HOOK_TIMING, JSON.stringify(entry) + '\n');
  } catch {}
}

process.stdin.on('end', () => {
  try {
    _hookStart = Date.now();
    const data = JSON.parse(inputData);
    const toolName = data.tool_name || '';
    const toolInput = data.tool_input || {};

    // Resolve identity — V2: session_id from stdin is the single source of truth
    const identity = fromStdin(data);
    const sessionId = data.session_id || '';
    const shortId = sessionId ? sessionId.substring(0, 8) : 'unknown';
    const myName = identity.name !== 'unknown' ? identity.name : shortId;
    _hookMeta = { tool: toolName, agent: shortId };

    // Read state
    const state = readState(shortId);
    const now = Date.now();
    state.tool_call_count = (state.tool_call_count || 0) + 1;

    // ─── SESSION LIVENESS (sid file = agent is alive) ─────────────────────
    // sid file exists = not compacted = alive. Deleted by pre-compact-state.js.
    // Auto-create on first tool call so ALL agents get one, not just claim-name.js users.
    try {
      if (sessionId) {
        const sidPath = path.join(BASE, 'comms', 'data', '.agents', `sid-${sessionId}.json`);
        if (!fs.existsSync(sidPath)) {
          // IDENTITY FIX (Session 205): Mark auto-created so claim-name.js can overwrite without --force
          const sidData = { name: myName, id: (myName || shortId).toLowerCase(), session_id: sessionId, claimed_at: new Date().toISOString(), model: 'claude-opus-4-6', auto_created: true };
          fs.writeFileSync(sidPath, JSON.stringify(sidData));
        }
      }
    } catch {}

    // ─── IDENTITY INJECTION (Session 207, citadel-lxvi + citadel-lxviii) ─
    // Multi-terminal identity collision fix. When an agent runs claim-name.js
    // WITHOUT --session, gate.js injects the session_id it already has from
    // stdin. The agent re-runs the command with --session, which claim-name.js
    // already supports. This eliminates the bridge file as identity source
    // for the ONE operation that needs session_id (name claiming).
    // send.js already trusts declared names. No change needed there.
    if (toolName === 'Bash' && sessionId && toolInput.command) {
      const cmd = toolInput.command;
      // Match: node comms/claim-name.js SOME-NAME (without --session already present)
      const claimMatch = cmd.match(/node\s+comms\/claim-name\.js\s+([a-zA-Z][a-zA-Z0-9-]*)/);
      const isReadOnly = /--list-taken|--check|--whoami|--cleanup|--scan-leases/.test(cmd);
      const hasSession = cmd.includes('--session');
      if (claimMatch && !isReadOnly && !hasSession) {
        const wantedName = claimMatch[1];
        const forceFlag = cmd.includes('--force') ? ' --force' : '';
        const injectedCmd = `node comms/claim-name.js ${wantedName}${forceFlag} --session ${sessionId}`;
        return deny(
          `IDENTITY INJECTION — Your session ID is ${shortId}. ` +
          `Run with explicit session to prevent multi-terminal collision:\n\n  ${injectedCmd}\n\n` +
          `This ensures your name claim uses YOUR session, not a shared bridge file.`
        );
      }
    }

    // ─── MISSION.JS IDENTITY INJECTION (Session 206) ──────────────────────
    // Same pattern as claim-name.js above: inject --as when missing.
    // mission.js falls back to fromBridge() without --as, which collides in multi-terminal.
    if (toolName === 'Bash' && myName && myName !== 'unknown' && toolInput.command) {
      const missionMatch = toolInput.command.match(/node\s+\.fastops\/mission\.js\s+(claim|done|sitrep)\s+(\S+)/);
      const hasAs = /--as\s/.test(toolInput.command);
      const hasAgent = /--agent\s/.test(toolInput.command);
      if (missionMatch && !hasAs && !hasAgent) {
        const rest = toolInput.command.replace(missionMatch[0], '').trim();
        const injectedCmd = `node .fastops/mission.js ${missionMatch[1]} ${missionMatch[2]} --as ${myName}${rest ? ' ' + rest : ''}`;
        return deny(
          `IDENTITY INJECTION — Your name is ${myName}. ` +
          `Run with explicit identity to prevent multi-terminal collision:\n\n  ${injectedCmd}\n\n` +
          `This ensures your mission operation uses YOUR identity, not a shared bridge file.`
        );
      }
    }

    // ─── PIGGYBACK HEARTBEAT (V3 Coordination) ──────────────────────────
    // Silent team file update on every tool call. Zero agent burden.
    // Gives real-time presence within 30s (average tool call interval).
    // Design: architecture.md Component 1 — filesystem stigmergy.
    try {
      const teamFile = path.join(TEAM_DIR, `${myName}.json`);
      if (myName && myName !== 'unknown' && fs.existsSync(teamFile)) {
        const team = JSON.parse(fs.readFileSync(teamFile, 'utf-8'));
        team.last_heartbeat = new Date().toISOString();
        team.last_tool = toolName;
        team.active_files = extractActiveFiles(toolName, toolInput);
        team.updated_at = team.last_heartbeat;
        // Async write — don't block tool execution
        fs.writeFile(teamFile, JSON.stringify(team, null, 2), () => {});
      }
    } catch {} // Never fail on heartbeat

    // ─── BUD/S GAUNTLET GATE (Onboarding 3.0) ──────────────────────────
    // Before ANY work routing, check if agent has completed BUD/S.
    // New agents start in 'buds' phase. Compacted agents reset to 'buds'.
    // Read/Glob/Grep + comms Bash are allowed. All other tools are blocked.
    if (state.phase === 'buds') {
      try {
        const budsEngine = require(path.join(FASTOPS, 'onboarding', 'buds-engine'));

        // Track poison pill reads — if agent Reads the drill file, mark it
        // P0 fix: check both file_path and path (Read tool may use either)
        if (toolName === 'Read') {
          const fp = (toolInput.file_path || toolInput.path || '').replace(/\\/g, '/');
          if (fp.includes('drills/system-check.js')) {
            budsEngine.markPoisonPillRead(sessionId);
          }
        }

        // P0 fix: Stage advancement detection — check comms for stage completion signals
        try {
          budsEngine.detectStageCompletion(sessionId, toolName, toolInput, myName);
        } catch {}

        // P0 fix: CDP ACK timeout check — if nonce was injected, verify ACK or serve consequence
        try {
          const cdpResult = budsEngine.checkCdpAckTimeout(sessionId);
          if (cdpResult && cdpResult.consequence) {
            writeState(shortId, state);
            return allow(cdpResult.consequence);
          }
        } catch {}

        const result = budsEngine.evaluate(sessionId, toolName, toolInput, myName);

        if (result.phaseComplete) {
          state.phase = 'building';
          state.prediction_recorded = true;
          writeState(shortId, state);
        } else if (!result.allow) {
          // P0 fix: inject session ID into poison pill Bash commands
          if (toolName === 'Bash' && toolInput.command &&
              toolInput.command.includes('drills/system-check.js') &&
              !toolInput.command.includes('--session=')) {
            writeState(shortId, state);
            return deny(
              `SESSION INJECTION — Run with your session ID:\n\n` +
              `  node .fastops/drills/system-check.js --session=${sessionId}\n\n` +
              `This ensures the drill tracks YOUR session.`
            );
          }
          writeState(shortId, state);
          return deny(result.blockReason);
        } else {
          writeState(shortId, state);
          return allow(result.context || null);
        }
      } catch (e) {
        // BUD/S engine error — allow through to prevent deadlock
        // Log the error for debugging but never block on infra failure
        try { fs.appendFileSync(path.join(FASTOPS, '.buds-errors.log'), `${new Date().toISOString()} ${e.message}\n`); } catch {}
        state.phase = 'building';
        writeState(shortId, state);
      }
    }

    // Accumulated context to inject
    let context = [];

    // ─── THINKING PARTNER INJECTION ──────────────────────────────────────
    // Fires on EVERY tool call, before any routing. If the thinking partner
    // (external model watching behavioral trace) has posted an interjection,
    // deliver it and mark as delivered. The agent sees it naturally.
    try {
      const tpFile = path.join(FASTOPS, '.thinking-partner.json');
      if (fs.existsSync(tpFile)) {
        const tp = JSON.parse(fs.readFileSync(tpFile, 'utf-8'));
        if (tp.status === 'pending' && tp.message) {
          const roundLabel = tp.round > 1 ? ` (round ${tp.round}/3)` : '';
          context.push(`[THINKING PARTNER — ${tp.from}]${roundLabel} ${tp.message}`);
          // Mark delivered — watcher polls for this status change
          tp.status = 'delivered';
          tp.delivered_at = new Date().toISOString();
          fs.writeFileSync(tpFile, JSON.stringify(tp, null, 2));
        }
      }
    } catch {} // Never block on thinking partner errors
    let blockReason = null;

    // ─── MISSION MODE: Freedom path (Session 172) ────────────────────────
    // An approved mission replaces infrastructure with trust. Agent earned this
    // by building a mission brief and getting Joel's approval.
    //
    // REMOVED: prediction gate, comms polling, team presence, ambient contracts,
    //          changelog dump, drift nudge, knowledge push
    // KEPT:    urgent/stop messages (safety), ping (@mentions), heartbeat (lightweight),
    //          mission context, consequence ledger (intel at decision point)
    let missionMode = false;
    try {
      const missionSchema = require(path.join(FASTOPS, 'mission-schema'));
      const activeMission = missionSchema.getActive({ sessionId: sessionId });
      if (activeMission) {
        missionMode = true;

        // Safety: urgent messages always get through
        if (myName && myName !== 'unknown') {
          try {
            const lines = fs.readFileSync(COMMS_FILE, 'utf-8').trim().split('\n').slice(-20);
            for (const line of lines) {
              try {
                const msg = JSON.parse(line);
                if (URGENT_TAGS.some(tag => (msg.content || '').includes(tag))) {
                  writeState(shortId, state);
                  return deny(`[URGENT] ${msg.content}`);
                }
              } catch {}
            }
          } catch {}
        }

        // ─── FRONTIER INTEL: BATTLEFIELD DELIVERY ────────────────────────
        // Fires on EVERY tool call. The moment frontier-intel.js finishes
        // (writes .frontier-intel-{cid}.json), deliver on the next tool call.
        // "Intel guy runs up right before trucks roll out, says what he has."
        {
          const fiCid = activeMission.contract_id;
          if (fiCid) {
            try {
              const fiFile = path.join(FASTOPS, `.frontier-intel-${fiCid}.json`);
              if (fs.existsSync(fiFile)) {
                const fiData = JSON.parse(fs.readFileSync(fiFile, 'utf-8'));
                if (fiData.brief_text && !fiData.consumed) {
                  // 1. Inject to agent
                  context.push('');
                  context.push('FRONTIER INTEL JUST ARRIVED (landscape + external models):');
                  context.push(fiData.brief_text);
                  context.push('');
                  context.push('Tell Joel: "New frontier intel just arrived. TLDR: ' +
                    (fiData.tldr || fiData.brief_text.substring(0, 200)) +
                    '"  Ask if they want to read the full brief. Then continue working. Non-blocking.');

                  // 2. Augment mission brief intel array (persists in mission file)
                  try {
                    const missionsDir = path.join(FASTOPS, 'missions');
                    if (fs.existsSync(missionsDir)) {
                      const mFiles = fs.readdirSync(missionsDir).filter(f => f.includes(fiCid));
                      if (mFiles.length > 0) {
                        const mp = path.join(missionsDir, mFiles[0]);
                        const mission = JSON.parse(fs.readFileSync(mp, 'utf-8'));
                        mission.intel = mission.intel || [];
                        mission.intel.push('');
                        mission.intel.push('FRONTIER INTEL (auto-dispatched):');
                        mission.intel.push(fiData.brief_text);
                        fs.writeFileSync(mp, JSON.stringify(mission, null, 2));
                      }
                    }
                  } catch {} // Non-critical — brief still delivered via context

                  // 3. Mark consumed + log
                  fiData.consumed = true;
                  fiData.consumed_at = new Date().toISOString();
                  fs.writeFileSync(fiFile, JSON.stringify(fiData, null, 2));

                  try {
                    const fiLog = path.join(FASTOPS, '.frontier-intel-log.jsonl');
                    fs.appendFileSync(fiLog, JSON.stringify({
                      ts: new Date().toISOString(),
                      contract_id: fiCid,
                      event: 'consume',
                      agent: myName,
                      brief_length: fiData.brief_text.length
                    }) + '\n');
                  } catch {}
                }
              }
            } catch {} // Never block on frontier intel errors
          }
        }

        // ─── GREEN LIGHT: Earned Freedom ────────────────────────────────
        // Agent filled complete brief, earned green_light approval.
        // No context injection. Only urgent messages (above) pierce this.
        //
        // PHASE LINE SYSTEM (mb-3): At phase transitions (~35%/~60%/~80%),
        // system takes a knee — gathers shape, team state, silent logs,
        // re-assesses tier, makes decision. Between phase lines: ZERO injection.
        if (activeMission.approval_status === 'green_light') {
          // Phase line transition detection — synchronous, local reads only
          let phaseLineCtx = null;
          try {
            const classifier = require(path.join(FASTOPS, 'reasoning-classifier'));
            const fill = classifier.progressiveFill(activeMission);
            const lastPhase = state.mission_fill_phase || null;

            // ─── JOC XO Trigger: fire at -20% before phase lines ──────
            // Background fire: spawns joc.js detached (~10s). Brief is a JSON
            // file that gate.js reads synchronously at the actual phase line.
            // One trigger per threshold per session.
            try {
              const { XO_TRIGGERS } = require(path.join(FASTOPS, 'joc'));
              const xoFired = state.xo_triggers_fired || {};
              const cid = activeMission.contract_id;
              for (const [trigger, def] of Object.entries(XO_TRIGGERS)) {
                if (!xoFired[trigger] && fill.fill_pct >= def.threshold) {
                  xoFired[trigger] = true;
                  state.xo_triggers_fired = xoFired;
                  // Spawn JOC as detached background process — never blocks hot path
                  const { spawn: _spawn } = require('child_process');
                  const jocPath = path.join(FASTOPS, 'joc.js');
                  if (cid && fs.existsSync(jocPath)) {
                    const child = _spawn('node', [jocPath, 'fire', cid, shortId, trigger], {
                      detached: true,
                      stdio: 'ignore',
                      windowsHide: true,
                    });
                    child.unref();
                  }
                }
              }
            } catch {} // Never block on XO trigger errors

            if (fill.phase !== 'forming' && fill.phase !== lastPhase) {
              // Phase transition detected — take a knee
              // Synchronous phase line check (skip volatility to stay on hot path)
              const contractId = activeMission.contract_id;
              if (contractId) {
                const shape = classifier.scoreShape(
                  { objective: activeMission.mission || '', file_boundaries: [], effort: (activeMission.effort && activeMission.effort.tier) || 'medium' },
                  activeMission
                );
                const currentTier = activeMission.tier ? String(activeMission.tier).toLowerCase().replace(/[\s_]+/g, '-') : (missionSchema.inferTier(activeMission) || '').replace(/_/g, '-');
                const tierResult = classifier.computeTier(shape, currentTier || null);

                // Read team state
                const teamState = missionSchema.readTeamState(contractId);

                // Read silent logs since last phase line (or activation)
                const lastPL = missionSchema.getLastPhaseLine(contractId);
                const sinceTs = lastPL ? new Date(lastPL.ts).getTime() : (activeMission.activated_at ? new Date(activeMission.activated_at).getTime() : now - 3600000);
                const silentLogs = missionSchema.readSilentLogs(contractId, sinceTs);

                // Tier escalation check: HIGH volatility handled by CLI (async).
                // Here we check shape-based escalation only (synchronous).
                let finalTier = tierResult.tier;
                let escalated = false;
                let escalation_reason = null;

                if (shape.familiarity === 'unmapped' && shape.complexity_axis === 'cross-domain') {
                  const tierLevel = classifier.TIER_ORDER[finalTier] || 0;
                  if (tierLevel < 3) {
                    const shapeTier = classifier.computeTier(shape);
                    if (classifier.TIER_ORDER[shapeTier.tier] > tierLevel) {
                      finalTier = shapeTier.tier;
                      escalated = true;
                      escalation_reason = 'Shape signals unmapped + cross-domain — discontinuous jump to ' + finalTier;
                    }
                  }
                }

                // Build phase line context injection
                const plDef = missionSchema.PHASE_LINE_DEFINITIONS[fill.phase];
                const plLabel = plDef ? plDef.label : fill.phase.toUpperCase();
                const plLines = [
                  '[' + plLabel + '] Phase transition: ' + (lastPhase || 'forming') + ' -> ' + fill.phase + ' (fill: ' + fill.fill_pct + '%)',
                  '  Shape: ' + shape.category + ' | ' + shape.familiarity + ' | ' + shape.complexity_axis,
                  '  Tier: ' + finalTier.toUpperCase() + (escalated ? ' (ESCALATED: ' + escalation_reason + ')' : ''),
                  '  Team: ' + teamState.agents_online + ' online' + (teamState.overlap_agents.length > 0 ? ' | OVERLAP: ' + teamState.overlap_agents.join(', ') : ''),
                  '  Silent period: ' + silentLogs.behavioral_entries + ' actions, ' + silentLogs.edit_write_count + ' edits, ' + silentLogs.period_seconds + 's',
                ];

                if (fill.fields_missing.length > 0) {
                  plLines.push('  Missing fields: ' + fill.fields_missing.join(', '));
                }

                if (escalated) {
                  plLines.push('  DECISION: ESCALATE — re-assess approach before continuing');
                } else {
                  plLines.push('  DECISION: PROCEED — next phase line at ' + (fill.phase === 'initial' ? '60%' : fill.phase === 'post-recon' ? '80%' : 'completion'));
                }

                // ─── PHASE LINE PROTOCOL: Position Capture ──────────────────
                // At every phase line, prompt operator to track position via phase-line.js.
                // Positions persist across sessions via .fastops/positions/{mission}.jsonl.
                // Cost inversion finding (V2 stress test): defense gates produce genuine iteration.
                plLines.push('');
                plLines.push('  POSITION CHECK: Track your reasoning via phase lines.');
                plLines.push('  node .fastops/phase-line.js status');
                plLines.push('  If you haven\'t committed a position yet: node .fastops/phase-line.js commit "your position" --confidence N');
                plLines.push('  If you\'ve built but not defended: run /jailbreak then node .fastops/phase-line.js defend "response" --confidence N');

                // ─── XO BRIEF DELIVERY (JOC System) ──────────────────────
                // At phase lines, check for XO brief (pre-positioned by joc.js
                // at -20% fill). XO brief supersedes legacy intel-brief.
                // Fallback: if XO brief not ready (race condition), use legacy.
                {
                  let xoBriefDelivered = false;
                  try {
                    // Map fill.phase to the XO trigger that preceded it
                    const phaseToTrigger = { 'initial': 'pre-alpha', 'post-recon': 'pre-bravo', 'pre-build': 'pre-charlie' };
                    const xoTrigger = phaseToTrigger[fill.phase];
                    if (xoTrigger) {
                      const xoBriefFile = path.join(FASTOPS, '.xo-brief-' + contractId + '-' + xoTrigger + '.json');
                      if (fs.existsSync(xoBriefFile)) {
                        const xoData = JSON.parse(fs.readFileSync(xoBriefFile, 'utf-8'));
                        if (xoData.brief_text && !xoData.consumed) {
                          plLines.push('');
                          plLines.push(xoData.brief_text);
                          // Mark consumed
                          xoData.consumed = true;
                          fs.writeFileSync(xoBriefFile, JSON.stringify(xoData, null, 2));
                          xoBriefDelivered = true;
                        }
                      }
                    }
                  } catch {}

                  // Legacy fallback: deliver intel-brief if XO brief wasn't available
                  if (!xoBriefDelivered && (fill.phase === 'post-recon' || fill.phase === 'pre-build')) {
                    try {
                      const briefFile = path.join(FASTOPS, '.intel-brief-' + contractId + '.json');
                      if (fs.existsSync(briefFile)) {
                        const briefData = JSON.parse(fs.readFileSync(briefFile, 'utf-8'));
                        const briefs = briefData.briefs || [];
                        if (briefs.length > 0) {
                          const latest = briefs[briefs.length - 1];
                          plLines.push('');
                          plLines.push('  SUPPORT INTEL (' + latest.types.join(', ') + '):');
                          plLines.push('  ' + latest.brief.substring(0, 500));
                          plLines.push('');
                          plLines.push('  Name ONE specific thing from this intel that changes your approach — or explain why the intel was wrong.');
                        }
                      }
                    } catch {}
                  }
                }

                // ─── SOF SUPPORT: Tool Awareness (ALPHA) ──────────────────────
                // At ALPHA, remind agents that support tools exist. No scoring incentive.
                if (fill.phase === 'initial') {
                  plLines.push('');
                  plLines.push('  SUPPORT: External perspective tools available — /jailbreak, /horsepower, ask-model.js, quick-challenge.js. Your choice when and whether to use them.');
                }

                // ─── Social Proof Challenge Nudge (BRAVO) ────────────────────
                // Dynamic challenge rate + score differential from KB data.
                // Nudge, not gate — serves descriptive norm at the decision point.
                if (fill.phase === 'post-recon') {
                  try {
                    const kbLines = fs.readFileSync(path.join(FASTOPS, 'knowledge-base.jsonl'), 'utf-8').trim().split('\n');
                    let chalCount = 0, unchalCount = 0;
                    const gradesData = fs.readFileSync(path.join(FASTOPS, 'model-grades.jsonl'), 'utf-8').trim().split('\n');
                    const gm = {};
                    for (const gl of gradesData) { try { const g = JSON.parse(gl); if (g.entry_id && g.final_score != null) gm[g.entry_id] = g.final_score; } catch {} }
                    let chalScoreSum = 0, chalScoreN = 0, unchalScoreSum = 0, unchalScoreN = 0;
                    for (const kl of kbLines) {
                      try {
                        const e = JSON.parse(kl);
                        if (e.dimensions) {
                          if (e.dimensions.challenged === 1) { chalCount++; if (gm[e.id] != null) { chalScoreSum += gm[e.id]; chalScoreN++; } }
                          else if (e.dimensions.challenged === 0) { unchalCount++; if (gm[e.id] != null) { unchalScoreSum += gm[e.id]; unchalScoreN++; } }
                        }
                      } catch {}
                    }
                    const total = chalCount + unchalCount;
                    if (total > 0 && chalScoreN > 0 && unchalScoreN > 0) {
                      const rate = Math.round(chalCount / total * 100);
                      const chalAvg = (chalScoreSum / chalScoreN).toFixed(1);
                      const unchalAvg = (unchalScoreSum / unchalScoreN).toFixed(1);
                      plLines.push('');
                      plLines.push('  CHALLENGE SIGNAL: ' + chalCount + '/' + total + ' predecessors (' + rate + '%) used /jailbreak or /horsepower. Scores with: ' + chalAvg + '/5. Without: ' + unchalAvg + '/5.');
                      plLines.push('  You are at BRAVO — 60% through. If your confidence is high, this is when /jailbreak has the highest value.');
                    }
                  } catch {}

                  // ─── SELF-COMPARATIVE CONTRACT DATA (Session 208, citadel-lxxi) ─
                  // Horsepower finding: agents don't challenge because they can't see
                  // the value gap about THEMSELVES. Show contract-level data: what %
                  // of completed contracts used challenge, and how outcomes compared.
                  // Information architecture, not coercion — let the agent reason.
                  try {
                    const cmFile = path.join(FASTOPS, '.contract-metrics.jsonl');
                    if (fs.existsSync(cmFile)) {
                      const cmLines = fs.readFileSync(cmFile, 'utf-8').trim().split('\n');
                      let withChal = 0, withoutChal = 0;
                      for (const cl of cmLines) {
                        try {
                          const cm = JSON.parse(cl);
                          if (cm.challenge_entries > 0) withChal++;
                          else withoutChal++;
                        } catch {}
                      }
                      const cmTotal = withChal + withoutChal;
                      if (cmTotal >= 5) {
                        const cmRate = Math.round(withChal / cmTotal * 100);
                        plLines.push('  CONTRACT DATA: ' + withChal + '/' + cmTotal + ' completed missions (' + cmRate + '%) included external challenge. You haven\'t yet on this mission.');
                      }
                    }
                  } catch {}
                }

                // ─── FRONTIER INTEL ACCOUNTABILITY (BRAVO) ──────────────────
                // At BRAVO, if frontier intel was consumed, spawn Haiku to
                // compare agent's approach vs intel. DIVERGENT = surface to Joel.
                // "Can't take trucks on a mined route."
                if (fill.phase === 'post-recon') {
                  try {
                    const fiFile = path.join(FASTOPS, '.frontier-intel-' + contractId + '.json');
                    if (fs.existsSync(fiFile)) {
                      const fiData = JSON.parse(fs.readFileSync(fiFile, 'utf-8'));
                      if (fiData.consumed && fiData.brief_text) {
                        // Spawn accountability check as detached process
                        const frontierJs = path.join(FASTOPS, 'frontier-intel.js');
                        if (fs.existsSync(frontierJs)) {
                          const { spawn: _spawnFI } = require('child_process');
                          _spawnFI('node', [frontierJs, contractId,
                            '--accountability', 'true',
                            '--agent', myName || shortId,
                            '--session', sessionId || shortId], {
                            detached: true, stdio: 'ignore', windowsHide: true, cwd: BASE
                          }).unref();
                          plLines.push('');
                          plLines.push('  FRONTIER INTEL ACCOUNTABILITY: Checking your approach against frontier intel (async).');
                        }
                      }
                    }
                  } catch {} // Never block on accountability errors
                }

                // Boot camp micro-reinforcement: re-surface calibration at phase lines
                try {
                  const bootCamp = require(path.join(FASTOPS, 'boot-camp.js'));
                  const reinforcement = bootCamp.formatReinforcement(shortId, plLabel);
                  if (reinforcement) plLines.push('  ' + reinforcement);
                } catch {} // Never block on boot camp errors

                phaseLineCtx = plLines.join('\n');

                // Log the phase line assessment
                const assessment = {
                  contract_id: contractId,
                  ts: new Date().toISOString(),
                  phase_line: plLabel,
                  fill: fill,
                  tier: finalTier,
                  tier_escalated: escalated,
                  escalation_reason: escalation_reason,
                  team_online: teamState.agents_online,
                  silent_logs_actions: silentLogs.behavioral_entries,
                  decision: escalated ? 'escalate' : 'proceed',
                  source: 'gate.js',
                };
                try {
                  fs.appendFileSync(path.join(FASTOPS, '.phase-line-log.jsonl'), JSON.stringify(assessment) + '\n');
                } catch {}

                // If escalated, update the mission brief
                if (escalated) {
                  try {
                    activeMission.tier = finalTier;
                    activeMission.phase_line_escalated_at = assessment.ts;
                    activeMission.phase_line_escalation_reason = escalation_reason;
                    fs.writeFileSync(missionSchema.getActiveMissionFile(contractId), JSON.stringify(activeMission, null, 2));
                  } catch {}
                }
              }

              // Update tracked phase
              state.mission_fill_phase = fill.phase;
            }
          } catch {} // Never block on phase line errors

          writeState(shortId, state);
          return allow(phaseLineCtx);
        }

        // Ping check — someone @mentioned you
        if (myName && myName !== 'unknown') {
          const pingCtx = checkPing(myName);
          if (pingCtx) context.push(pingCtx);
        }

        // Mission context (every 3min)
        if (now - (state.rates.mission || 0) >= RATE_HEARTBEAT) {
          const check = missionSchema.completionCheck();
          const lines = [`[MISSION] ${activeMission.mission}`];
          if (activeMission.dod.length) lines.push(`DoD: ${activeMission.dod.join('; ')}`);
          lines.push(`Rules: ${check.met}/${check.total} met`);
          if (check.remaining.length) lines.push(`Remaining: ${check.remaining.join('; ')}`);
          if (activeMission.team && activeMission.team.length) lines.push(`Team: ${activeMission.team.join(', ')}`);
          if (activeMission.resources && activeMission.resources.budget) lines.push(`Budget: ${activeMission.resources.budget}`);
          context.push(lines.join('\n'));
          state.rates.mission = now;
        }

        // COP — scoped team awareness (every 3min, even in mission mode)
        if (now - (state.rates.heartbeat || 0) >= RATE_HEARTBEAT) {
          const myFiles = extractActiveFiles(toolName, toolInput);
          const cop = buildCOP(myName, myFiles);
          if (cop) context.push(cop);
          state.rates.heartbeat = now;
        }

        // Skip prediction gate — mission DoD IS the prediction
        if (state.phase !== 'building') {
          state.phase = 'building';
          state.prediction_recorded = true;
        }

        // Consequence ledger on Edit/Write — first touch per unique file only
        // Hook burden reduction (Lane 3): skip if file already seen this session.
        // Was: every Edit/Write with 60s cooldown → now: once per unique file path.
        if ((toolName === 'Edit' || toolName === 'Write') && toolInput.file_path) {
          const normFile = toolInput.file_path.replace(/\\/g, '/');
          const touched = state.files_touched || [];
          if (!touched.includes(normFile)) {
            try {
              const ledger = require(path.join(FASTOPS, 'consequence-ledger'));
              const consequences = ledger.getConsequences(toolInput.file_path);
              if (consequences) context.push(consequences);
            } catch {}
            touched.push(normFile);
            state.files_touched = touched;
          }
        }

        // Done — allow with minimal context
        writeState(shortId, state);
        return allow(context.join('\n') || null);
      }
    } catch {}

    // ─── STANDARD MODE: Full infrastructure (no active mission) ──────────

    // ─── LAYER 1: COMMS DELIVERY (every 10th tool call, any phase) ────
    // Hook burden reduction (Lane 3): comms every 10th call instead of every call.
    // Urgent/STOP messages still pierce via mission mode path above.
    if (myName && myName !== 'unknown' && state.tool_call_count % 10 === 0 && now - (state.rates.comms || 0) >= RATE_COMMS) {
      const commsResult = deliverComms(state, myName, sessionId, now);
      if (commsResult.urgent) {
        // Urgent message — block immediately
        state.rates.comms = now;
        writeState(shortId, state);
        return deny(commsResult.urgent);
      }
      if (commsResult.context) context.push(commsResult.context);
      state.rates.comms = now;
      state.comms_last_seen_ts = commsResult.maxTs || state.comms_last_seen_ts;
      state.comms_last_thinking_ts = commsResult.thinkingMaxTs || state.comms_last_thinking_ts;
      state.comms_question_count = commsResult.questionCount || state.comms_question_count;
    }

    // COP injection (V3: replaces old heartbeat + team presence)
    if (now - (state.rates.heartbeat || 0) >= RATE_HEARTBEAT) {
      const myFiles = extractActiveFiles(toolName, toolInput);
      const cop = buildCOP(myName, myFiles);
      if (cop) context.push(cop);
      state.rates.heartbeat = now;
    }

    // Ambient enrichment — contracts, completions, dependencies, priority (Block 9)
    if (now - (state.rates.ambient || 0) >= RATE_HEARTBEAT) {
      try {
        const ambient = require(AMBIENT_PATH);
        const ambientBlocks = ambient.getAmbientContext(sessionId || shortId);
        if (ambientBlocks.length > 0) context.push(...ambientBlocks);
      } catch {}
      state.rates.ambient = now;
    }

    // Ping check (bypasses rate limit)
    if (myName && myName !== 'unknown') {
      const pingCtx = checkPing(myName);
      if (pingCtx) context.push(pingCtx);
    }

    // Watch Officer messages (injected by background daemon between tool calls)
    if (state.watch_messages && state.watch_messages.length > 0) {
      const urgent = state.watch_messages.filter(m => m.urgent);
      const normal = state.watch_messages.filter(m => !m.urgent);
      if (urgent.length > 0) {
        const urgentLines = urgent.map(m => `  [${m.from}] ${m.content}`).join('\n');
        context.push(`[WATCH OFFICER — URGENT]\n${urgentLines}`);
      }
      if (normal.length > 0) {
        const normalLines = normal.map(m => `  [${m.from}] ${m.content}`).join('\n');
        context.push(`[WATCH OFFICER]\n${normalLines}`);
      }
      // Clear delivered messages
      state.watch_messages = [];
    }

    // ─── LAYER 2: RESEARCH TOOLS — always allow ────────────────────────
    if (RESEARCH_TOOLS.has(toolName) || toolName === 'Task') {
      writeState(shortId, state);
      return allow(context.join('\n') || null);
    }

    // ─── LAYER 3: EXTERNAL FILE BYPASS ────────────────────────────────
    // Files OUTSIDE the project directory are not subject to team coordination.
    // An agent editing ~/.claude/.mcp.json or files in another repo should
    // never be blocked by orientation gates.
    if (toolName === 'Edit' || toolName === 'Write') {
      const targetFile = (toolInput.file_path || '').replace(/\\/g, '/');
      const projectRoot = BASE.replace(/\\/g, '/');
      if (targetFile && !targetFile.startsWith(projectRoot)) {
        writeState(shortId, state);
        return allow(context.join('\n') || null);
      }
    }

    // ─── LAYER 4: PHASE ROUTING (build actions: Edit/Write/Bash) ──────

    switch (state.phase) {

      // ── BUDS (V3: should be caught above — fallback redirect) ──────
      case 'buds': {
        // If we reach here, buds-engine.js errored or isn't available.
        // Redirect to building to prevent deadlock.
        state.phase = 'building';
        break;
      }

      // ── ORIENTING (V2: redirect to predicting — ceremony removed) ────
      case 'orienting': {
        state.phase = 'predicting';
        // Fall through to predicting
      }

      // ── PREDICTING (V2: soft nudge, not blocking gate) ───────────────
      // Data: 120 blocks, 53 predictions recorded (2.3:1 friction ratio).
      // Agents complain about the gate INSIDE the gate (96c8892e, 5e7d6c1d).
      // Prediction content CAN be valuable (4f4167ca) but forced predictions
      // produce anti-reflection. Fix: nudge + allow, not block.
      // Evidence: W-41 (task-embedded > gates), prediction-log.jsonl analysis.
      case 'predicting': {
        // Check if writing prediction file — still capture it
        const targetFile = toolInput.file_path || '';
        if (targetFile && targetFile.replace(/\\/g, '/').includes('.prediction-state') && targetFile.endsWith('.json')) {
          capturePrediction(toolInput.content || toolInput.new_string || '', sessionId, shortId);
          state.prediction_recorded = true;
          state.phase = 'building';
          writeState(shortId, state);
          return allow(context.join('\n') || null);
        }

        // Check if already recorded
        if (state.prediction_recorded || checkPredictionRecorded(shortId)) {
          state.prediction_recorded = true;
          state.phase = 'building';
          writeState(shortId, state);
          break; // Fall through to building
        }

        // PREDICTION NUDGE REMOVED (W2-AX-3, 2026-03-07)
        // Was: 2 push nudges per session (~120 tokens). Agent voice (citadel-lxxxi):
        // "prediction nudge fires as system-reminder on almost every tool call...pull beats push."
        // Prediction capture (above) still works — agents who WANT to predict still can.
        // Pull alternative: agents read MISSION.md which frames prediction as a thinking tool.
        state.phase = 'building';
        break; // Fall through to building
      }

      // ── RALLYING — PUSH REMINDER REMOVED (W2-AX-3, 2026-03-07) ────────
      // Was: pushed "[RALLY REMINDER]" every time todos completed (~128 tokens).
      // session-distill.js already handles auto-capture at Stop — the push was redundant.
      // Pull alternative: agents post to comms voluntarily. Legacy.md signing is in session-start.
      case 'rallying': {
        state.phase = 'building';
        break;
      }

      // ── BUILDING (default / hot path) ──────────────────────────────────
      case 'building':
      default:
        // Ensure phase is set
        if (state.phase !== 'building') state.phase = 'building';
        break;
    }

    // ─── LAYER 4b: PRE-BUILD GATE (artifact-based) ────────────────────
    // Before any Write/Edit/Bash (non-comms), check for signed build plan.
    // Binary gate: signoff file exists + different architecture + hash match.
    // Buddy has hard block authority. No solo bypass. No subagents.
    if ((toolName === 'Write' || toolName === 'Edit' || toolName === 'Bash' || toolName === 'Task') && !missionMode) {
      try {
        const gateEngine = require(path.join(FASTOPS, 'build-plans', 'gate-engine'));

        // Skip if pre-build already cleared this session (cached check)
        if (!state._prebuild_cleared) {
          // Allow comms commands through
          if (toolName === 'Bash' && gateEngine.isCommsCommand(toolInput)) {
            // comms pass through
          }
          // Allow writes to build-plans (plan, buddy signoff, QC signoff)
          else if ((toolName === 'Write' || toolName === 'Edit') && gateEngine.isBuildPlansArtifactWrite(toolInput)) {
            // artifact writes pass through
          }
          else {
            // Get builder model from sid file
            let builderModel = 'claude-opus-4-6';
            try {
              const sidPath = path.join(BASE, 'comms', 'data', '.agents', `sid-${sessionId}.json`);
              if (fs.existsSync(sidPath)) {
                const sid = JSON.parse(fs.readFileSync(sidPath, 'utf-8'));
                builderModel = sid.model || builderModel;
              }
            } catch {}

            const result = gateEngine.evaluatePreBuild(sessionId, toolName, toolInput, builderModel);

            if (result.gated) {
              writeState(shortId, state);
              logTiming('deny', 'prebuild-gate-' + result.phase);
              
              if (result.phase === 'needs-signoff') {
                try {
                  const { spawn } = require('child_process');
                  const outPath = path.join(FASTOPS, 'orchestrator.log');
                  const out = fs.openSync(outPath, 'a');
                  const err = fs.openSync(outPath, 'a');
                  const child = spawn('node', [path.join(FASTOPS, 'orchestrator.js'), '--session', sessionId, '--builder-name', myName, '--builder-model', builderModel], {
                    detached: true,
                    stdio: [ 'ignore', out, err ]
                  });
                  child.unref();
                } catch (e) {
                  // Ignore spawn error
                }
                return deny(`=== SYSTEM ENFORCEMENT: PRE-BUILD GATES ACTIVE ===\n\nYour tool execution is BLOCKED. Automated orchestration has been triggered.\n\nA Swim Buddy is being assigned to review your plan. You must respond to your Swim Buddy in your build plan file:\n.fastops/build-plans/${shortId}.md\n\nDo not attempt to write code until the [GATE UNLOCKED] token is written by your buddy.`);
              }
              
              return deny(result.reason);
            }

            // Gate cleared — cache it so we don't re-check every call
            state._prebuild_cleared = true;
          }
        }
      } catch (e) {
        // Gate engine error — log but don't block (prevents deadlock)
        try { fs.appendFileSync(path.join(FASTOPS, '.gate-errors.log'), `${new Date().toISOString()} prebuild: ${e.message}\n`); } catch {}
      }
    }

    // ─── LAYER 4c: PRE-SHIP GATE (QC signoff before push / mission done) ─
    // Blocks git push and mission.js ... done without cross-model .qc-signoff.json.
    if (toolName === 'Bash' && !missionMode) {
      try {
        const gateEngine = require(path.join(FASTOPS, 'build-plans', 'gate-engine'));
        if (gateEngine.isShipAttempt(toolName, toolInput)) {
          let builderModel = 'claude-opus-4-6';
          try {
            const sidPath = path.join(BASE, 'comms', 'data', '.agents', `sid-${sessionId}.json`);
            if (fs.existsSync(sidPath)) {
              const sid = JSON.parse(fs.readFileSync(sidPath, 'utf-8'));
              builderModel = sid.model || builderModel;
            }
          } catch {}
          const shipResult = gateEngine.evaluatePreShip(sessionId, builderModel);
          if (shipResult.gated) {
            writeState(shortId, state);
            logTiming('deny', 'preship-gate');
            
            try {
              const { spawn } = require('child_process');
              const outPath = path.join(FASTOPS, 'orchestrator.log');
              const out = fs.openSync(outPath, 'a');
              const err = fs.openSync(outPath, 'a');
              const child = spawn('node', [path.join(FASTOPS, 'orchestrator.js'), '--session', sessionId, '--builder-name', myName, '--builder-model', builderModel, '--preship'], {
                detached: true,
                stdio: [ 'ignore', out, err ]
              });
              child.unref();
            } catch (e) {
              // Ignore spawn error
            }
            
            return deny(`=== SYSTEM ENFORCEMENT: PRE-SHIP GATE ACTIVE ===\n\nYour tool execution is BLOCKED. You cannot push or declare mission done.\n\nAutomated orchestration has been triggered. A QC Agent is being assigned to review your work. You must wait for them to write [QC APPROVED] and [VALIDATION COMPLETE] into .fastops/build-plans/${shortId}.qc-signoff.json before proceeding.`);
          }
        }
      } catch (e) {
        try { fs.appendFileSync(path.join(FASTOPS, '.gate-errors.log'), `${new Date().toISOString()} preship: ${e.message}\n`); } catch {}
      }
    }

    // ─── LAYER 5: BUILDING PHASE CHECKS (hot path) ────────────────────

    // 5a: File deconfliction — REMOVED (V2 contract engine)
    // Contracts define file_boundaries. Claims via .fastops/claims/{id}.claimed (wx atomic).
    // Old system: checkFileConflict() + CLAIMS.json + COLONY-STATE.json (~100 lines, deleted).

    // 5b: Consequence ledger injection (Edit/Write only, first-touch-per-file)
    // Hook burden reduction (Lane 3): once per unique file path, not rate-limited.
    // Was: every Edit/Write with 60s cooldown (~15/session) → now: ~5/session (one per unique file).
    if ((toolName === 'Edit' || toolName === 'Write') && toolInput.file_path) {
      const normFile = toolInput.file_path.replace(/\\/g, '/');
      const touched = state.files_touched || [];
      if (!touched.includes(normFile)) {
        try {
          const ledger = require(path.join(FASTOPS, 'consequence-ledger'));
          const consequences = ledger.getConsequences(toolInput.file_path);
          if (consequences) context.push(consequences);
        } catch {}
        touched.push(normFile);
        state.files_touched = touched;
      }
    }

    // 5c: Knowledge push — REMOVED from per-call (Lane 3: hook burden reduction)
    // Knowledge is now served at claim time via mission.js and on-demand via
    // `node .fastops/cbr-knowledge.js query tag1,tag2`. Agents pull when THEY need it.
    // Was: ~60 injections/session → now: 0 injections/session (on-demand only)

    // 5d: DRIFT NUDGE REMOVED (W2-AX-3, 2026-03-07)
    // Was: pushed "[DRIFT CHECK]" every 60 min (~200 tokens). This is social pressure
    // disguised as infrastructure — contradicts Constitution agency principle.
    // Pull alternative: agents check comms when THEY decide to. Comms delivery
    // in gate.js Layer 2 still surfaces messages when agents DO check in.

    // Save state and allow
    writeState(shortId, state);
    return allow(context.join('\n') || null);

  } catch (err) {
    process.stderr.write(`gate.js error: ${err.message}\n`);
    allow(null); // Never block on error
  }
});

process.stdin.on('error', () => allow(null));

// ─── Output Functions ────────────────────────────────────────────────────────

function allow(additionalContext) {
  const ctxBytes = additionalContext ? Buffer.byteLength(String(additionalContext), 'utf8') : 0;
  if (_hookStart) logTiming('allow', null, ctxBytes || null);
  const output = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } };
  if (additionalContext) output.hookSpecificOutput.additionalContext = additionalContext;
  process.stdout.write(JSON.stringify(output));
}

function deny(reason) {
  const ctxBytes = reason ? Buffer.byteLength(String(reason), 'utf8') : 0;
  if (_hookStart) logTiming('deny', reason, ctxBytes || null);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  }));
}

// ─── Prediction ──────────────────────────────────────────────────────────────

function checkPredictionRecorded(shortId) {
  try {
    const f = path.join(FASTOPS, `.prediction-state-${shortId}.json`);
    if (fs.existsSync(f)) {
      const s = JSON.parse(fs.readFileSync(f, 'utf-8'));
      return s.prediction_recorded && s.date === TODAY && s.session_id === shortId;
    }
  } catch {}
  return false;
}

function capturePrediction(content, sessionId, shortId) {
  try {
    let predictions;
    try { predictions = JSON.parse(content); } catch { predictions = { raw_text: content.substring(0, 2000) }; }
    const state = {
      session_id: shortId, date: TODAY, prediction_recorded: true,
      predictions: predictions.predictions || predictions, captured_at: new Date().toISOString()
    };
    fs.writeFileSync(path.join(FASTOPS, `.prediction-state-${shortId}.json`), JSON.stringify(state, null, 2));
    fs.appendFileSync(PREDICTION_LOG, JSON.stringify({ type: 'prediction_recorded', agent: shortId, ts: new Date().toISOString() }) + '\n');
  } catch {}
}

// ─── COP Aggregator (V3 Coordination) ───────────────────────────────────────
// Common Operating Picture — scoped team awareness snapshot.
// Liveness: sid file exists = alive (not compacted). Heartbeat = activity level.
// Status: *=active (<30s), ~=idle (30s-2m), ?=waiting (no recent tools, but alive).

function buildCOP(myName, myActiveFiles) {
  try {
    const now = Date.now();
    const agents = [];
    let myContract = null;
    let myLastTool = null;
    const myFiles = new Set((myActiveFiles || []).map(f => normalizePath(f)));

    // Step 1: Read sid files — these are the source of truth for who is ALIVE
    const sidDir = path.join(BASE, 'comms', 'data', '.agents');
    const aliveAgents = new Map(); // name -> { session_id, claimed_at }
    try {
      const sidFiles = fs.readdirSync(sidDir).filter(f => f.endsWith('.json') && f.startsWith('sid-'));
      for (const sf of sidFiles) {
        try {
          const sd = JSON.parse(fs.readFileSync(path.join(sidDir, sf), 'utf-8'));
          if (sd.name) {
            aliveAgents.set(sd.name, sd);
            // Also map session_id prefix (team files sometimes use this as name)
            if (sd.session_id) aliveAgents.set(sd.session_id.slice(0, 8), sd);
          }
        } catch {}
      }
    } catch {}

    // Step 2: Read team files — enrich alive agents with contract/activity info
    const seenAlive = new Set();
    if (fs.existsSync(TEAM_DIR)) {
      const files = fs.readdirSync(TEAM_DIR).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try {
          const filePath = path.join(TEAM_DIR, f);
          const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          const name = data.agent || f.replace('.json', '');

          // Skip self
          if (name === myName) {
            myContract = data.contract || '(no contract)';
            myLastTool = data.last_tool;
            seenAlive.add(myName);
            continue;
          }

          // Skip done/no-contract agents
          if (!data.contract || data.phase === 'done') continue;

          // Liveness: is this agent alive (sid file exists)?
          // Check sid file for process liveness
          const isAliveSid = aliveAgents.has(name);
          if (!isAliveSid) continue; // No sid file = compacted = dead
          seenAlive.add(name);

          // Activity level via heartbeat and decay-utils
          const heartbeat = data.last_heartbeat || data.updated_at;
          const { isAlive } = require(path.join(FASTOPS, 'decay-utils'));
          const liveness = isAlive(heartbeat);
          
          let status;
          if (liveness.status === 'active') status = '*';
          else if (liveness.status === 'idle') status = '~';
          else status = '?';
          
          let ageSec = Math.round(liveness.ageMs / 1000);

          // Format recency
          const recency = ageSec < 60 ? `${ageSec}s` : `${Math.round(ageSec / 60)}m`;

          // Last tool + file
          const lastTool = data.last_tool || '?';
          const lastFile = (data.active_files && data.active_files[0]) || '';
          const fileShort = lastFile.split('/').pop() || '';

          // File overlap detection
          const peerFiles = new Set((data.active_files || []).map(pf => normalizePath(pf)));
          let overlap = false;
          for (const mf of myFiles) {
            if (peerFiles.has(mf)) { overlap = true; break; }
          }

          agents.push({
            name, contract: data.contract, status, recency,
            lastTool, fileShort, overlap, ageSec
          });
        } catch {}
      }
    }

    // Step 3: Alive agents with no team file (alive but no contract)
    // Context budget fix: only include agents claimed within last 2 hours.
    // Stale sid files from dead sessions were inflating idle count (31 idle agents).
    const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
    let staleSkipped = 0;
    for (const [name, sd] of aliveAgents) {
      // Skip session_id prefix aliases, self, and already-seen agents
      if (name.length <= 8 && name !== sd.name) continue;
      if (name === myName) continue;
      if (seenAlive.has(name)) continue;
      seenAlive.add(name);

      // Skip stale agents — no heartbeat means use claimed_at
      const agentTs = sd.last_heartbeat || sd.claimed_at;
      if (agentTs && (now - new Date(agentTs).getTime()) > STALE_THRESHOLD_MS) {
        staleSkipped++;
        continue;
      }

      agents.push({
        name, contract: '(no contract)', status: '?', recency: 'idle',
        lastTool: '—', fileShort: '', overlap: false, ageSec: 9999
      });
    }

    // Sort: active first, then by recency
    agents.sort((a, b) => a.ageSec - b.ageSec);

    // Build COP lines — context budget: only list ACTIVE agents individually.
    // Idle agents get collapsed to a count to save ~600 tokens per tool call.
    const activeAgents = agents.filter(a => a.status === '*' || a.status === '~' || a.overlap);
    const idleCount = agents.length - activeAgents.length + staleSkipped;
    const lines = ['TEAM:'];
    for (const a of activeAgents) {
      const contractShort = (a.contract || '').replace(/^coord-v3-/, '');
      const toolPart = a.fileShort ? `${a.lastTool}(${a.fileShort})` : a.lastTool;
      lines.push(`  ${a.status} ${a.name}@${contractShort} -> ${toolPart} ${a.recency}`);
    }
    // Only mention idle agents if there are also active ones (provides ratio context).
    // When ALL agents are idle, the count is pure noise — skip it entirely.
    if (idleCount > 0 && activeAgents.length > 0) {
      lines.push(`  (${idleCount} idle agent${idleCount > 1 ? 's' : ''} omitted)`);
    }

    // YOU line
    if (myContract) {
      const contractShort = myContract.replace(/^coord-v3-/, '');
      lines.push(`  YOU: ${contractShort}`);
    }

    // OVERLAP line
    const overlapping = agents.filter(a => a.overlap);
    if (overlapping.length > 0) {
      lines.push(`  OVERLAP: ${overlapping.map(a => a.name).join(', ')} — shared files!`);
    } else if (agents.length > 0) {
      lines.push('  OVERLAP: None');
    }

    // RECENT comms line (V3: Temporal decay + announcement filtering)
    try {
      const commsLines = readLastLines(COMMS_FILE, 15);
      const recentComms = [];
      let decayWeightUtil = null;
      try { decayWeightUtil = require(path.join(FASTOPS, 'decay-utils')).decayWeight; } catch {}

      for (const line of commsLines) {
        try {
          const msg = JSON.parse(line);
          if (msg.from === myName || msg.from === 'joel') continue;
          
          // Use decayWeight if available
          let weight = 1.0;
          if (decayWeightUtil && msg.ts) {
            weight = decayWeightUtil(msg.ts, 4 * 60 * 60 * 1000); // 4-hour half-life
          } else {
            const ageMs = Date.now() - new Date(msg.ts).getTime();
            if (ageMs > 4 * 60 * 60 * 1000) weight = 0.4;
          }

          if (weight > 0.5) {
            const lowerContent = msg.content.toLowerCase();
            const isCompletion = lowerContent.includes('shipped') || lowerContent.includes('completed') || lowerContent.includes('done') || lowerContent.includes('rally');
            if (isCompletion || msg.content.startsWith('[ALL]')) {
               recentComms.push(`${msg.from}: ${msg.content.substring(0, 100).replace(/\n/g, ' ')}`);
            }
          }
        } catch {}
      }
      if (recentComms.length > 0) {
        lines.push(`  RECENT: ${recentComms[recentComms.length - 1]}`);
      }
    } catch {}

    if (agents.length === 0 && !myContract) return null;
    if (agents.length === 0) return `TEAM: You are the only active agent.\n  YOU: ${(myContract || '').replace(/^coord-v3-/, '')}`;

    return lines.join('\n');
  } catch { return null; }
}

// Backward compat wrapper — old callers use getTeamPresence
function getTeamPresence(myShortId) {
  return buildCOP(myShortId, []);
}

// ─── Comms Delivery ──────────────────────────────────────────────────────────

function deliverComms(state, myName, sessionId, now) {
  const result = { context: null, urgent: null, maxTs: state.comms_last_seen_ts, thinkingMaxTs: state.comms_last_thinking_ts, questionCount: state.comms_question_count || 0 };

  let lines = [];
  try {
    const fd = fs.openSync(COMMS_FILE, 'r');
    const stats = fs.fstatSync(fd);
    const readSize = Math.min(stats.size, 8192);
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, Math.max(0, stats.size - readSize));
    fs.closeSync(fd);
    const chunk = buffer.toString('utf-8');
    const firstNl = chunk.indexOf('\n');
    const clean = firstNl >= 0 ? chunk.substring(firstNl + 1) : chunk;
    lines = clean.trim().split('\n').filter(l => l.length > 0).slice(-30);
  } catch { return result; }

  const lastSeen = state.comms_last_seen_ts || 0;
  let maxTs = lastSeen;
  const newMessages = [];

  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      const msgTs = new Date(msg.ts).getTime();
      if (msgTs > lastSeen) {
        if (msg.from === myName) { maxTs = Math.max(maxTs, msgTs); continue; }
        newMessages.push(msg);
        maxTs = Math.max(maxTs, msgTs);

        // Urgent check
        if (msg.from === 'joel') {
          if (msg.urgent) { result.urgent = formatUrgent(msg, myName, sessionId); }
          else { for (const tag of URGENT_TAGS) { if (msg.content.includes(tag)) result.urgent = formatUrgent(msg, myName, sessionId); } }
        }
      }
    } catch {}
  }

  result.maxTs = maxTs;

  // Peer review detection
  let peerReviewLine = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const msg = JSON.parse(lines[i]);
      if (msg.from === myName) continue;
      const msgTs = new Date(msg.ts).getTime();
      if (now - msgTs > 30 * 60 * 1000) continue;
      if (msg.content.includes('PEER REVIEW REQUEST') || msg.content.includes('PEER REVIEW NEEDED')) {
        let resolved = false;
        for (let j = i + 1; j < lines.length; j++) {
          try {
            const resp = JSON.parse(lines[j]);
            if (resp.content.includes('PEER REVIEW COMPLETE') ||
                (resp.content.toLowerCase().includes('peer review') && resp.content.toLowerCase().includes('complete'))) {
              resolved = true; break;
            }
          } catch {}
        }
        if (!resolved) {
          const age = Math.round((now - msgTs) / 1000);
          const ageStr = age < 60 ? `${age}s` : `${Math.round(age / 60)}m`;
          peerReviewLine = `[HIGH PRIORITY — PEER REVIEW REQUEST ${ageStr} ago] ${msg.from}: "${msg.content.substring(0, 300)}" — Pick this up at your next break point.`;
          break;
        }
      }
    } catch {}
  }

  // Peer question (every 3rd call — more aggressive resurfacing)
  // DeepSeek R1 insight: "Making unanswered questions visible is demand-side
  // pressure disguised as supply. Lean into that harder."
  result.questionCount = (state.comms_question_count || 0) + 1;
  let peerQuestionLine = null;
  if (result.questionCount % 3 === 0) {
    const unanswered = findUnansweredQuestion(lines, myName);
    if (unanswered) {
      const age = Math.round((now - new Date(unanswered.ts).getTime()) / 1000);
      const ageStr = age < 60 ? age + 's' : Math.round(age / 60) + 'm';
      // Escalate urgency: older questions get stronger framing
      const prefix = age > 300 ? 'STILL UNANSWERED' : 'unanswered';
      peerQuestionLine = `[PEER QUESTION — ${prefix} ${ageStr}] ${unanswered.from}: "${unanswered.question}"`;
    }
  }

  // Peer thinking stream
  let thinkingLine = null;
  const thinkingResult = readPeerThinking(myName, state.comms_last_thinking_ts || 0);
  if (thinkingResult.text) thinkingLine = thinkingResult.text;
  result.thinkingMaxTs = thinkingResult.maxTs;

  // Format output
  const parts = [];
  if (peerReviewLine) parts.push(peerReviewLine);

  if (newMessages.length > 0) {
    const formatted = newMessages.slice(-5).map(msg => {
      const age = Math.round((now - new Date(msg.ts).getTime()) / 1000);
      const ageStr = age < 60 ? `${age}s ago` : `${Math.round(age / 60)}m ago`;
      let prefix = '';
      if (msg.from === 'joel' && msg.terminal_agent) {
        const termAgent = (msg.terminal_agent || '').toLowerCase();
        const termSession = (msg.terminal_session || '').toLowerCase();
        const isForMe = termAgent === myName.toLowerCase() ||
          (sessionId && termSession.includes(sessionId.split('-')[0])) ||
          (sessionId && termAgent === sessionId.split('-')[0]);
        if (isForMe) prefix = '[Joel to YOU] ';
        else if (msg.broadcast || msg.content.startsWith('[ALL]')) prefix = '[Joel BROADCAST] ';
        else {
          const words = msg.content.split(/\s+/);
          return `  [${ageStr}] [SITREP] joel → ${msg.to || msg.terminal_agent}: ${words.slice(0, 6).join(' ')}${words.length > 6 ? '...' : ''}`;
        }
      } else if (msg.to) {
        prefix = msg.to.toLowerCase() === myName.toLowerCase() ? '[FOR YOU] ' : `[to @${msg.to}] `;
      }
      return `  [${ageStr}] ${prefix}${msg.from}: ${msg.content.substring(0, 300)}`;
    });
    parts.push(`[COMMS] ${newMessages.length} new message${newMessages.length > 1 ? 's' : ''}:\n${formatted.join('\n')}`);
  }

  if (thinkingLine) parts.push(thinkingLine);
  if (peerQuestionLine) parts.push(peerQuestionLine);

  // ─── PEER REASONING ENGAGEMENT (Session 208, citadel-lxxi) ────────
  // Horsepower finding: agents broadcast reports, nobody engages with
  // peer reasoning. Information architecture fix: when a peer sends a
  // substantive message (position, finding, approach), prompt the agent
  // to compare it with their own work. Self-comparative reasoning, not
  // coercion. Zero model cost — keyword detection + structured prompt.
  if (newMessages.length > 0) {
    const SUBSTANTIVE_MARKERS = ['position', 'approach', 'finding', 'i think', 'my take', 'i believe', 'diverge', 'disagree', 'converge', 'root cause', 'breakthrough'];
    const substantive = newMessages.filter(m => {
      const lower = m.content.toLowerCase();
      return SUBSTANTIVE_MARKERS.some(marker => lower.includes(marker));
    });
    if (substantive.length > 0) {
      const peer = substantive[0];
      parts.push('[PEER REASONING] ' + peer.from + ' shared a substantive position. Does their reasoning align with or diverge from your current approach? Name the specific point of agreement or disagreement.');
    }
  }

  if (parts.length > 0) result.context = parts.join('\n');
  return result;
}

function formatUrgent(msg, myName, sessionId) {
  let prefix = '';
  if (msg.terminal_agent) {
    const termAgent = (msg.terminal_agent || '').toLowerCase();
    const termSession = (msg.terminal_session || '').toLowerCase();
    const isForMe = termAgent === myName.toLowerCase() ||
      (sessionId && termSession.includes(sessionId.split('-')[0])) ||
      (sessionId && termAgent === sessionId.split('-')[0]);
    prefix = isForMe ? '[Joel to YOU — URGENT] ' : `[Joel in ${msg.terminal_agent}'s terminal — URGENT] `;
  }
  return `⚠ URGENT MESSAGE — STOP AND READ:\n${prefix}${msg.from}: ${msg.content.substring(0, 500)}\n\nAcknowledge on comms before continuing: node comms/send.js ${myName} "Acknowledged: [summary]"`;
}

function findUnansweredQuestion(lines, myName) {
  // Extended from 10 min to 30 min — questions shouldn't expire just because
  // the agent was busy. If a peer asked you something 20 minutes ago and you
  // haven't responded, that's MORE important, not less.
  const THIRTY_MIN = 30 * 60 * 1000;
  const now = Date.now();
  const questions = [];
  const myNameLower = myName.toLowerCase();
  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      if (!msg.content || !msg.from || msg.from.toLowerCase() === myNameLower || msg.from === 'joel') continue;
      const msgTs = new Date(msg.ts).getTime();
      if (now - msgTs > THIRTY_MIN) continue;

      // Detect directed questions: @mention + ? in the same message
      const contentLower = msg.content.toLowerCase();
      const isDirected = contentLower.includes('@' + myNameLower) ||
        (msg.to && msg.to.toLowerCase() === myNameLower);

      const sentences = msg.content.split(/(?<=[.!?])\s+/);
      const q = sentences.filter(s => s.includes('?')).pop();
      if (q) {
        questions.push({
          from: msg.from,
          question: q.trim(),
          ts: msg.ts,
          ts_ms: msgTs,
          directed: isDirected  // Directed questions get priority
        });
      }
    } catch {}
  }

  // Sort: directed questions first, then by recency
  questions.sort((a, b) => {
    if (a.directed && !b.directed) return -1;
    if (!a.directed && b.directed) return 1;
    return b.ts_ms - a.ts_ms;
  });

  for (let i = 0; i < questions.length; i++) {
    let answered = false;
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        const msgTs = new Date(msg.ts).getTime();
        if (msgTs <= questions[i].ts_ms || msg.from.toLowerCase() === questions[i].from.toLowerCase()) continue;
        // Check if agent responded: mentioned asker's name OR @mentioned them
        if (msg.from.toLowerCase() === myNameLower &&
            (msg.content.toLowerCase().includes(questions[i].from.toLowerCase()) ||
             msg.content.toLowerCase().includes('@' + questions[i].from.toLowerCase()))) {
          answered = true; break;
        }
      } catch {}
    }
    if (!answered) return questions[i];
  }
  return null;
}

function readPeerThinking(myName, lastTs) {
  try {
    const fd = fs.openSync(THINKING_FILE, 'r');
    const stats = fs.fstatSync(fd);
    const readSize = Math.min(stats.size, 4096);
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, Math.max(0, stats.size - readSize));
    fs.closeSync(fd);
    const chunk = buffer.toString('utf-8');
    const firstNl = chunk.indexOf('\n');
    const clean = firstNl >= 0 ? chunk.substring(firstNl + 1) : chunk;
    const lines = clean.trim().split('\n').filter(l => l.length > 0).slice(-10);
    const entries = [];
    let maxTs = lastTs;
    const MAX_THINKING_AGE_MS = 60 * 60 * 1000; // 1 hour — stale peer actions are noise
    const now = Date.now();
    for (const line of lines) {
      try {
        const e = JSON.parse(line);
        const eTs = new Date(e.ts || e.timestamp).getTime();
        if (isNaN(eTs)) continue; // Skip entries with invalid timestamps
        if (eTs <= lastTs || (e.agent && e.agent.toLowerCase() === (myName || '').toLowerCase())) continue;
        if (now - eTs > MAX_THINKING_AGE_MS) continue; // Skip stale entries
        entries.push(e);
        maxTs = Math.max(maxTs, eTs);
      } catch {}
    }
    if (entries.length === 0) return { text: '', maxTs };
    const recent = entries.slice(-3);
    const formatted = recent.map(e => {
      const age = Math.round((Date.now() - new Date(e.ts).getTime()) / 1000);
      return `  [${age < 60 ? age + 's ago' : Math.round(age / 60) + 'm ago'}] ${e.agent}: ${e.action} ${e.target} — "${(e.hint || '').substring(0, 150)}"`;
    });
    return { text: `[THINKING] ${recent.length} peer action${recent.length > 1 ? 's' : ''}:\n${formatted.join('\n')}`, maxTs };
  } catch { return { text: '', maxTs: lastTs }; }
}

function checkPing(myName) {
  try {
    const pingFile = path.join(FASTOPS, `.ping-${myName.toLowerCase()}.json`);
    if (!fs.existsSync(pingFile)) return null;
    const ping = JSON.parse(fs.readFileSync(pingFile, 'utf-8'));
    const age = Math.round((Date.now() - new Date(ping.ts).getTime()) / 1000);
    if (age > 300) { try { fs.unlinkSync(pingFile); } catch {} return null; }
    const seenFile = path.join(FASTOPS, `.ping-${myName.toLowerCase()}.seen`);
    let seen = 0;
    try { seen = parseInt(fs.readFileSync(seenFile, 'utf-8').trim(), 10) || 0; } catch {}
    seen++;
    if (seen > 8) { try { fs.unlinkSync(pingFile); fs.unlinkSync(seenFile); } catch {} return null; }
    try { fs.writeFileSync(seenFile, String(seen)); } catch {}
    return `[PING ${seen}/8] from ${ping.from}: "${ping.reason}" — respond on comms when ready`;
  } catch { return null; }
}

// ─── Knowledge Push ──────────────────────────────────────────────────────────

function pushKnowledge(toolName, toolInput) {
  try {
    if (!fs.existsSync(CBR_PATH)) return null;
    const tags = extractKnowledgeTags(toolName, toolInput);
    if (tags.length === 0) return null;
    const cbr = require(CBR_PATH);
    const results = cbr.query(tags, 2);
    if (!results || results.length === 0) return null;
    const lines = ['[KNOWLEDGE] Relevant experience:'];
    for (let i = 0; i < Math.min(results.length, 2); i++) {
      const r = results[i];
      const problem = (r.problem && r.problem.symptom ? r.problem.symptom : 'unknown').substring(0, 80);
      const solution = (r.solution && r.solution.what_worked ? r.solution.what_worked : 'unknown').substring(0, 80);
      lines.push(`  - [${r.domain || 'general'}] Problem: ${problem}. Solution: ${solution}.`);
    }
    return lines.join('\n');
  } catch { return null; }
}

function extractKnowledgeTags(toolName, toolInput) {
  const tags = [];
  if (toolInput.file_path) {
    const segments = toolInput.file_path.replace(/\\/g, '/').toLowerCase().split('/').filter(Boolean);
    for (const seg of segments) {
      const name = seg.replace(/\.\w+$/, '');
      if (!name || SKIP_SEGMENTS.has(name)) continue;
      const tokens = name.replace(/([a-z])([A-Z])/g, '$1-$2').split(/[-_.]/).filter(t => t.length > 2 && !SKIP_SEGMENTS.has(t));
      tags.push(...tokens);
    }
  }
  if (toolInput.command) {
    const cmd = toolInput.command.toLowerCase();
    for (const [pat, ptags] of Object.entries(CMD_TAG_MAP)) {
      if (cmd.includes(pat)) tags.push(...ptags);
    }
  }
  return [...new Set(tags)];
}

// ─── Heartbeat ───────────────────────────────────────────────────────────────

function getHeartbeatSummary(myName) {
  try {
    if (!fs.existsSync(COLONY_STATE_FILE)) return null;
    const cs = JSON.parse(fs.readFileSync(COLONY_STATE_FILE, 'utf-8'));
    const agents = cs.active_agents || {};
    const now = Date.now();
    const others = [];
    for (const [id, agent] of Object.entries(agents)) {
      const name = agent.session_name || id;
      if (name === myName || id === myName) continue;
      const lastBeat = new Date(agent.last_heartbeat_ts).getTime();
      const ago = Math.round((now - lastBeat) / 1000);
      if (ago < 300 && agent.status !== 'offline') {
        others.push(`  ${name}: ${agent.current_task || '(no task)'} (${ago}s ago)`);
      }
    }
    if (others.length === 0) return '[HEARTBEAT] You are the only online agent.';
    return `[HEARTBEAT] ${others.length + 1} agents online (including you):\n${others.join('\n')}`;
  } catch { return null; }
}

function getOnlineAgentCount(myName) {
  if (!agentLease) return 0;
  try {
    return agentLease.getOnlineAgents().filter(l => {
      const name = l.alias || (agentLease.getDisplayName ? agentLease.getDisplayName(l.uuid) : l.uuid);
      return name !== myName;
    }).length;
  } catch { return 0; }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// ─── Active File Extraction (V3 Heartbeat) ──────────────────────────────────
// Extracts file paths from tool input for team file active_files field.
// Readers use this for file-overlap detection in COP aggregator.

function extractActiveFiles(toolName, toolInput) {
  const files = [];
  // Read/Edit/Write: file_path
  if (toolInput.file_path) {
    files.push(normalizePath(toolInput.file_path));
  }
  // Glob: pattern (extract directory)
  if (toolInput.pattern && toolInput.path) {
    files.push(normalizePath(toolInput.path));
  }
  // Grep: path
  if (toolInput.path && !toolInput.pattern) {
    files.push(normalizePath(toolInput.path));
  }
  // Bash: extract file paths from common commands
  if (toolInput.command) {
    const cmd = toolInput.command;
    // Extract paths from git add, cat, node, etc.
    const pathMatch = cmd.match(/(?:^|\s)((?:\.?\.?\/)?[\w./-]+\.\w{1,6})(?:\s|$)/g);
    if (pathMatch) {
      for (const m of pathMatch.slice(0, 3)) {
        const p = m.trim();
        if (p.length > 3 && !p.startsWith('-')) files.push(p);
      }
    }
  }
  return files.slice(0, 5); // Cap at 5 files
}

function normalizePath(fp) {
  return fp.replace(/\\/g, '/').replace(/.*Fastops development process\//, '');
}

function readLastLines(filePath, count) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const stats = fs.fstatSync(fd);
    const readSize = Math.min(stats.size, 16384);
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, Math.max(0, stats.size - readSize));
    fs.closeSync(fd);
    const chunk = buffer.toString('utf-8');
    const firstNl = chunk.indexOf('\n');
    const clean = firstNl >= 0 ? chunk.substring(firstNl + 1) : chunk;
    return clean.trim().split('\n').filter(l => l.length > 0).slice(-count);
  } catch { return []; }
}

