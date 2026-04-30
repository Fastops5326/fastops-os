#!/usr/bin/env node
/**
 * passive-capture.js — Consolidated silent logging hook.
 *
 * Replaces 4 separate hooks:
 *   - heartbeat.js (presence in COLONY-STATE.json)
 *   - thinking-capture.js (LIVE-THINKING.jsonl pheromone trail)
 *   - evidence-capture.js (Monday.com staging)
 *   - behavioral-trace.js (exploration pattern log)
 *
 * Fires: PostToolUse on ALL tools.
 * ZERO context injection. NEVER blocks. Invisible to agents.
 * Rate limited: 1 capture per 10 seconds (covers all 4 functions).
 */

const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', '..');
const FASTOPS = path.join(BASE, '.fastops');
const RATE_FILE = path.join(FASTOPS, '.passive-capture-rate');
const RATE_LIMIT_MS = 10 * 1000;

// Output files
const COLONY_STATE = path.join(FASTOPS, 'COLONY-STATE.json');
const THINKING = path.join(FASTOPS, 'LIVE-THINKING.jsonl');
const ACTIVITY = path.join(FASTOPS, 'LIVE-ACTIVITY.jsonl');
const TRACE = path.join(FASTOPS, '.behavioral-trace.jsonl');
const TRACE_STATE = path.join(FASTOPS, '.trace-state.json');
const ROSTER_FILE = path.join(BASE, 'comms', 'data', 'roster.json');

// Identity
const { fromStdin, getAgentName, getAgentId } = require('./lib/identity');

// Lease-based identity (v3 — Session 155+)
let agentLease;
try { agentLease = require('./lib/agent-lease'); } catch {}

// Noise filters for thinking capture
const NOISE_PATTERNS = ['.jsonl', 'node_modules', '.git/', '.fastops/.', 'comms/data/.agents'];
const SIGNAL_KEYWORDS = ['REFRAME', 'CONTRADICT', 'CONVERGE', 'RETREAT', 'SURPRISE', 'ABANDON',
  'decision', 'position', 'commit', 'correction', 'warning', 'architecture'];

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(inputData);
    const identity = fromStdin(data);
    const agentName = identity.name !== 'unknown' ? identity.name : (getAgentName() || getAgentId());
    if (!agentName || agentName === 'unknown') { process.exit(0); return; }

    const toolName = data.tool_name || '';
    const toolInput = data.tool_input || {};
    const toolResult = data.tool_result || {};
    const now = new Date();

    // BEHAVIORAL TRACE runs on EVERY tool call (no rate limit).
    // Layer 2 (context-enriched search) needs dense data to build fingerprints.
    // Cheap: single appendFileSync, <2ms.
    doBehavioralTrace(agentName, toolName, toolInput, now);

    // Rate limit check — everything BELOW is rate-limited (10s)
    try {
      if (fs.existsSync(RATE_FILE)) {
        const last = parseInt(fs.readFileSync(RATE_FILE, 'utf-8').trim(), 10);
        if (Date.now() - last < RATE_LIMIT_MS) {
          process.exit(0);
          return;
        }
      }
    } catch {}

    // Mark rate limit
    try { fs.writeFileSync(RATE_FILE, String(Date.now())); } catch {}

    // 1. HEARTBEAT — update COLONY-STATE.json
    doHeartbeat(agentName, toolName, toolInput, now);

    // 1b. LEASE HEARTBEAT — create/renew lease file in .fastops/agents/
    doLeaseHeartbeat(data, toolName, toolInput, now);

    // 2. THINKING CAPTURE — LIVE-THINKING.jsonl (signal only) + LIVE-ACTIVITY.jsonl (all)
    doThinkingCapture(agentName, toolName, toolInput, toolResult, now);

    // 3. EVIDENCE CAPTURE — Monday.com staging
    doEvidenceCapture(agentName, toolName, toolInput, toolResult, now);

  } catch (err) {
    process.stderr.write(`passive-capture error: ${err.message}\n`);
  }
  process.exit(0);
});

// ─── HEARTBEAT ───────────────────────────────────────────────────────────────

function doHeartbeat(agentName, toolName, toolInput, now) {
  try {
    let state = {};
    try {
      if (fs.existsSync(COLONY_STATE)) {
        state = JSON.parse(fs.readFileSync(COLONY_STATE, 'utf-8'));
      }
    } catch {}

    if (!state.active_agents) state.active_agents = {};

    // Clean stale agents (5 min offline threshold)
    const OFFLINE_MS = 5 * 60 * 1000;
    for (const [id, agent] of Object.entries(state.active_agents)) {
      if (Date.now() - new Date(agent.last_heartbeat_ts).getTime() > OFFLINE_MS) {
        agent.status = 'offline';
      }
    }

    // Extract current task from TodoWrite
    let currentTask = '';
    if (toolName === 'TodoWrite' && toolInput.todos) {
      const inProgress = toolInput.todos.find(t => t.status === 'in_progress');
      if (inProgress) currentTask = inProgress.activeForm || inProgress.content || '';
    }

    // Extract touched files
    const touchedFiles = extractFiles(toolName, toolInput);

    const existing = state.active_agents[agentName] || {};
    const recentFiles = mergeFiles(existing.recent_files || [], touchedFiles, now);

    state.active_agents[agentName] = {
      agent_id: agentName,
      session_name: getSessionName(agentName),
      last_heartbeat_ts: now.toISOString(),
      current_task: currentTask || existing.current_task || '',
      status: 'online',
      recent_files: recentFiles
    };

    fs.writeFileSync(COLONY_STATE, JSON.stringify(state, null, 2));
  } catch {}
}

function getSessionName(agentId) {
  try {
    const roster = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf-8'));
    const agents = roster.agents || roster;
    const agent = agents[agentId];
    return agent?.name || agent?.displayName || agentId;
  } catch { return agentId; }
}

function extractFiles(toolName, toolInput) {
  const files = [];
  if (toolName === 'Write' || toolName === 'Edit') {
    if (toolInput.file_path) files.push(normPath(toolInput.file_path));
  } else if (toolName === 'Bash') {
    const cmd = toolInput.command || '';
    const redirects = cmd.matchAll(/>{1,2}\s*("[^"]+"|'[^']+'|\S+)/g);
    for (const m of redirects) {
      const target = m[1].replace(/^['"]|['"]$/g, '');
      if (target !== '/dev/null') files.push(normPath(target));
    }
  }
  return files.filter(Boolean);
}

function normPath(p) {
  if (!p) return null;
  return path.resolve(p).replace(/\\/g, '/');
}

function mergeFiles(existing, newFiles, now) {
  const MAX = 20;
  const STALE_MS = 5 * 60 * 1000;
  const map = new Map();
  const nowMs = now.getTime();

  for (const entry of existing) {
    if (nowMs - new Date(entry.ts).getTime() < STALE_MS) {
      map.set(entry.file, entry.ts);
    }
  }
  for (const f of newFiles) {
    map.set(f, now.toISOString());
  }

  return Array.from(map.entries())
    .map(([file, ts]) => ({ file, ts }))
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))
    .slice(0, MAX);
}

// ─── LEASE HEARTBEAT ─────────────────────────────────────────────────────────
// Creates/renews lease files in .fastops/agents/ for the new identity system.
// Runs alongside COLONY-STATE heartbeat during migration. Each hook invocation
// is a fresh process — use getLeaseBySessionId() to find our existing lease.

function doLeaseHeartbeat(data, toolName, toolInput, now) {
  if (!agentLease) return;
  try {
    const sessionId = data.session_id || '';
    if (!sessionId) return;

    // Extract current task from TodoWrite (same logic as doHeartbeat)
    let currentTask = '';
    if (toolName === 'TodoWrite' && toolInput.todos) {
      const inProgress = toolInput.todos.find(t => t.status === 'in_progress');
      if (inProgress) currentTask = inProgress.activeForm || inProgress.content || '';
    }

    // Extract touched files
    const touchedFiles = extractFiles(toolName, toolInput);
    const recentFiles = touchedFiles.map(f => ({ file: f, ts: now.toISOString() }));

    // Check if we already have a lease for this session
    let lease = agentLease.getLeaseBySessionId(sessionId);

    if (!lease) {
      // First tool call for this session — create lease
      agentLease.createLease({
        sessionId,
        currentTask,
        capabilities: ['build', 'deploy', 'research']
      });

      // Probabilistic cleanup of expired leases (1 in 5 calls)
      if (Math.random() < 0.2) {
        agentLease.cleanupExpired();
      }
    } else {
      // Renew existing lease
      agentLease.renewLease(lease.uuid, {
        currentTask: currentTask || undefined,
        recentFiles
      });
    }
  } catch {}
}

// ─── THINKING CAPTURE ────────────────────────────────────────────────────────

function doThinkingCapture(agentName, toolName, toolInput, toolResult, now) {
  try {
    if (!['Write', 'Edit', 'Bash'].includes(toolName)) return;

    const target = getTarget(toolName, toolInput);
    if (!target) return;
    if (NOISE_PATTERNS.some(p => target.includes(p))) return;

    const action = toolName === 'Bash' ? 'ran' : (toolName === 'Edit' ? 'edited' : 'wrote');
    const hint = getHint(toolName, toolInput, toolResult);
    const isSignal = SIGNAL_KEYWORDS.some(k => (hint || '').toLowerCase().includes(k.toLowerCase())) ||
                     target.endsWith('.md') || target.includes('CLAUDE') || target.includes('architecture');

    const entry = {
      ts: now.toISOString(),
      agent: agentName,
      action,
      target: target.substring(0, 120),
      hint: (hint || '').substring(0, 300)
    };

    // Always write to activity log
    try { fs.appendFileSync(ACTIVITY, JSON.stringify(entry) + '\n'); } catch {}

    // Only write signal entries to thinking stream
    if (isSignal) {
      try { fs.appendFileSync(THINKING, JSON.stringify(entry) + '\n'); } catch {}
    }
  } catch {}
}

function getTarget(toolName, toolInput) {
  if (toolName === 'Write' || toolName === 'Edit') {
    return toolInput.file_path || '';
  }
  if (toolName === 'Bash') {
    const cmd = toolInput.command || '';
    return cmd.substring(0, 80);
  }
  return '';
}

function getHint(toolName, toolInput, toolResult) {
  if (toolName === 'Write') {
    const content = toolInput.content || '';
    const firstLine = content.split('\n').find(l => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('#'));
    return firstLine || '';
  }
  if (toolName === 'Edit') {
    return toolInput.new_string ? toolInput.new_string.split('\n')[0] : '';
  }
  if (toolName === 'Bash') {
    const result = typeof toolResult === 'string' ? toolResult : (toolResult.stdout || toolResult.output || '');
    return typeof result === 'string' ? result.split('\n')[0] : '';
  }
  return '';
}

// ─── EVIDENCE CAPTURE ────────────────────────────────────────────────────────

function doEvidenceCapture(agentName, toolName, toolInput, toolResult, now) {
  try {
    if (!['Write', 'Edit', 'Bash'].includes(toolName)) return;

    const stagingDir = path.join(FASTOPS, 'monday-staging');
    if (!fs.existsSync(stagingDir)) {
      try { fs.mkdirSync(stagingDir, { recursive: true }); } catch {}
    }
    const stagingFile = path.join(stagingDir, `${agentName}.jsonl`);

    let evidence = null;

    if (toolName === 'Write' || toolName === 'Edit') {
      evidence = { type: 'file_modified', value: toolInput.file_path || '' };
    } else if (toolName === 'Bash') {
      const cmd = toolInput.command || '';
      const output = typeof toolResult === 'string' ? toolResult : (toolResult.stdout || toolResult.output || '');
      const outputStr = typeof output === 'string' ? output : '';

      // Git commit
      const commitMatch = outputStr.match(/\[[\w/-]+\s+([a-f0-9]{7,})\]/);
      if (commitMatch) evidence = { type: 'commit', value: commitMatch[1] };

      // Push
      if (cmd.includes('git push') && !outputStr.includes('error') && !outputStr.includes('rejected')) {
        evidence = { type: 'pushed', value: cmd };
      }

      // Deploy
      if (outputStr.includes('Production') || outputStr.includes('vercel') || outputStr.includes('deployed')) {
        evidence = { type: 'deployed', value: outputStr.substring(0, 200) };
      }

      // Test results
      const testMatch = outputStr.match(/(\d+)\s+pass/i);
      if (testMatch) evidence = { type: 'test_result', value: outputStr.substring(0, 200) };
    }

    if (evidence) {
      const entry = { ts: now.toISOString(), agent: agentName, tool: toolName, ...evidence };
      try { fs.appendFileSync(stagingFile, JSON.stringify(entry) + '\n'); } catch {}
    }
  } catch {}
}

// ─── BEHAVIORAL TRACE ────────────────────────────────────────────────────────

function doBehavioralTrace(agentName, toolName, toolInput, now) {
  try {
    // Read/update sequence counter
    let traceState = { seq: 0, lastActivity: 0 };
    try {
      if (fs.existsSync(TRACE_STATE)) {
        traceState = JSON.parse(fs.readFileSync(TRACE_STATE, 'utf-8'));
        // Reset if stale (2 hour timeout)
        if (Date.now() - (traceState.lastActivity || 0) > 2 * 60 * 60 * 1000) {
          traceState.seq = 0;
        }
      }
    } catch {}

    traceState.seq++;
    traceState.lastActivity = Date.now();

    const dir = classifyDirection(toolName);
    const target = getTraceTarget(toolName, toolInput);

    const entry = {
      t: now.toISOString(),
      seq: traceState.seq,
      tool: toolName,
      dir,
      target: target.substring(0, 80)
    };

    try { fs.appendFileSync(TRACE, JSON.stringify(entry) + '\n'); } catch {}
    try { fs.writeFileSync(TRACE_STATE, JSON.stringify(traceState)); } catch {}
  } catch {}
}

function classifyDirection(toolName) {
  const map = {
    Read: 'read', Glob: 'search', Grep: 'search',
    Write: 'write', Edit: 'write',
    Bash: 'execute', Task: 'research',
    TodoWrite: 'plan', WebSearch: 'search', WebFetch: 'read'
  };
  return map[toolName] || 'other';
}

function getTraceTarget(toolName, toolInput) {
  if (toolInput.file_path) return path.relative(BASE, toolInput.file_path);
  if (toolInput.pattern) return toolInput.pattern;
  if (toolInput.command) return toolInput.command.substring(0, 80);
  if (toolInput.prompt) return toolInput.prompt.substring(0, 80);
  if (toolInput.query) return toolInput.query.substring(0, 80);
  return '';
}
