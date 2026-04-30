#!/usr/bin/env node
/**
 * session-distill.js — Stop hook for session distillation
 *
 * Fires on Stop. Auto-captures:
 *   - Files changed (git diff --stat)
 *   - Todo completions from the session
 *   - Unresolved questions from LIVE-THINKING
 *
 * Writes to .fastops/session-distills/YYYY-MM-DD.jsonl
 * Indexed by reef/build-index.js on next rebuild.
 *
 * Replaces: comms/hooks/stop-message-pump.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DISTILLS_DIR = path.join(ROOT, '.fastops', 'session-distills');
const LIVE_THINKING = path.join(ROOT, '.fastops', 'LIVE-THINKING.jsonl');
const ACTIVE_AGENT = path.join(ROOT, 'comms', 'data', '.active-agent');
const PREDICTION_STATE = path.join(ROOT, '.fastops', '.prediction-state.json');
const CHANGELOG = path.join(ROOT, '.fastops', 'CHANGELOG.jsonl');

function dbg(msg) { process.stderr.write(`[session-distill] ${msg}\n`); }

// Consume stdin (required for hooks)
async function consumeStdin() {
  return new Promise(resolve => {
    let data = '';
    process.stdin.on('data', chunk => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    setTimeout(() => resolve(data), 500);
  });
}

// Session-keyed identity resolution
// IDENTITY FIX (Session 174, 2959255d): Use fromSessionId() with stdin session_id
// instead of getAgentId() which goes through bridge file (30-second race window).
const { fromSessionId, getAgentId: _getAgentId } = require('./lib/identity');
let _resolvedAgentId = null;
function getAgentId() {
  if (_resolvedAgentId) return _resolvedAgentId;
  return _getAgentId() || 'unknown';
}

// Lease-based identity cleanup on session end
let agentLease;
try { agentLease = require('./lib/agent-lease'); } catch {}

function getFilesChanged() {
  try {
    const devNull = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const output = execSync(`git diff --stat HEAD~1 2>${devNull} || git diff --stat 2>${devNull}`, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true
    }).trim();
    if (!output) return [];

    const lines = output.split('\n');
    // Last line is summary, rest are files
    const files = lines.slice(0, -1).map(line => {
      const match = line.match(/^\s*(.+?)\s*\|/);
      return match ? match[1].trim() : null;
    }).filter(Boolean);
    // Cap at 50 files to prevent distill bloat (9,899 files = 394KB per entry)
    // anvil-v (2026-03-08): root cause of 66MB/day session-distills
    if (files.length > 50) {
      const total = files.length;
      const capped = files.slice(0, 50);
      capped.push(`... and ${total - 50} more files`);
      return capped;
    }
    return files;
  } catch (e) {
    dbg(`git diff error: ${e.message}`);
    return [];
  }
}

function getUnresolvedQuestions() {
  if (!fs.existsSync(LIVE_THINKING)) return [];

  try {
    const raw = fs.readFileSync(LIVE_THINKING, 'utf8').trim();
    if (!raw) return [];

    const lines = raw.split('\n');
    // Get last 50 entries
    const recent = lines.slice(-50);
    const questions = [];

    for (const line of recent) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === 'question' || (entry.thinking && entry.thinking.includes('?'))) {
          questions.push({
            agent: entry.agent,
            question: (entry.thinking || entry.task || '').slice(0, 200),
            ts: entry.ts
          });
        }
      } catch {}
    }

    return questions.slice(-5); // Last 5 questions
  } catch (e) {
    dbg(`thinking read error: ${e.message}`);
    return [];
  }
}

function getPredictionComparison(agentId) {
  // V2 path: use prediction-delta.js for actual outcome comparison (W2-1, Session 166)
  try {
    const V2_DELTA = path.join(ROOT, 'FastOps AI V2', 'capture', 'prediction-delta.js');
    if (fs.existsSync(V2_DELTA)) {
      const { generateDelta } = require(V2_DELTA);
      const delta = generateDelta(agentId);
      if (delta) {
        dbg(`V2 prediction delta: ${delta.materialized_count}/${delta.risk_count} materialized, accuracy ${delta.prediction_accuracy}`);
        return delta;
      }
    }
  } catch (e) {
    dbg(`V2 prediction-delta fallback: ${e.message}`);
  }

  // V1 fallback: raw predictions without outcome comparison
  try {
    // Read per-agent file first, then legacy shared file
    let state = null;
    const perAgentFile = path.join(ROOT, '.fastops', `.prediction-state-${agentId.substring(0, 8)}.json`);
    if (fs.existsSync(perAgentFile)) {
      state = JSON.parse(fs.readFileSync(perAgentFile, 'utf-8'));
    } else if (fs.existsSync(PREDICTION_STATE)) {
      state = JSON.parse(fs.readFileSync(PREDICTION_STATE, 'utf-8'));
    }
    if (!state || !state.prediction_recorded || !state.predictions) return null;

    // Get this session's completed todos from changelog
    const completedTodos = [];
    if (fs.existsSync(CHANGELOG)) {
      const lines = fs.readFileSync(CHANGELOG, 'utf-8').trim().split('\n');
      for (const line of lines.slice(-50)) {
        try {
          const entry = JSON.parse(line);
          if (entry.agent === agentId || entry.agent === state.session_id) {
            completedTodos.push(entry.todo);
          }
        } catch {}
      }
    }

    const predictions = state.predictions;
    const risks = [];
    for (const key of ['risk_1', 'risk_2', 'risk_3']) {
      if (predictions[key]) {
        risks.push({
          predicted_risk: predictions[key].risk || predictions[key],
          falsification: predictions[key].falsification || 'none stated',
          outcome: 'pending_joel_review'
        });
      }
    }

    return {
      predictions_recorded: true,
      risk_count: risks.length,
      risks,
      predecessor_cited: predictions.predecessor_cited || null,
      completed_todos: completedTodos,
      captured_at: state.captured_at
    };
  } catch (e) {
    dbg(`prediction comparison error: ${e.message}`);
    return null;
  }
}

async function main() {
  const stdinData = await consumeStdin();
  let stdinSessionId = '';
  try {
    const parsed = JSON.parse(stdinData);
    stdinSessionId = parsed.session_id || '';
  } catch {}

  // IDENTITY FIX (Session 174): Resolve from stdin session_id first, bridge fallback
  if (stdinSessionId) {
    const resolved = fromSessionId(stdinSessionId);
    _resolvedAgentId = resolved.name !== 'unknown' ? resolved.name : stdinSessionId.substring(0, 8);
  }

  if (!fs.existsSync(DISTILLS_DIR)) {
    fs.mkdirSync(DISTILLS_DIR, { recursive: true });
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const distillFile = path.join(DISTILLS_DIR, `${dateStr}.jsonl`);

  const agentId = getAgentId();
  const filesChanged = getFilesChanged();
  const questions = getUnresolvedQuestions();

  // Contract ID from team file (same pattern as behavioral-trace.js)
  let cid = null;
  try {
    const teamFile = path.join(ROOT, '.fastops', 'team', `${agentId}.json`);
    if (fs.existsSync(teamFile)) {
      cid = JSON.parse(fs.readFileSync(teamFile, 'utf-8')).contract || null;
    }
  } catch {}

  // Recent commit count
  let commitCount = 0;
  try {
    const devNull = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const log = execSync(`git log --oneline -20 2>${devNull}`, {
      cwd: ROOT, encoding: 'utf8', timeout: 5000, windowsHide: true
    }).trim();
    commitCount = log ? log.split('\n').length : 0;
  } catch {}

  // Prediction comparison (Predict and Prove — Session 161)
  const predictionComparison = getPredictionComparison(agentId);

  const distill = {
    ts: now.toISOString(),
    agent: agentId,
    cid,
    files_changed: filesChanged,
    file_count: filesChanged.length,
    commits_found: commitCount,
    unresolved_questions: questions,
    question_count: questions.length,
    prediction_comparison: predictionComparison
  };

  // Append to daily distill file
  fs.appendFileSync(distillFile, JSON.stringify(distill) + '\n');

  const predInfo = predictionComparison ? `, ${predictionComparison.risk_count} predictions` : '';
  dbg(`distilled: ${filesChanged.length} files, ${questions.length} questions${predInfo} → ${distillFile}`);

  // Apply validation boost if prediction-delta recommended it (W2-1 integration)
  if (predictionComparison && predictionComparison.predecessor_validation &&
      predictionComparison.predecessor_validation.boost_recommended) {
    try {
      const V2_SCORER = path.join(ROOT, 'FastOps AI V2', 'selection', 'scorer.js');
      const KB_PATH = path.join(ROOT, '.fastops', 'knowledge-base.jsonl');
      if (fs.existsSync(V2_SCORER)) {
        const { applyValidationBoost } = require(V2_SCORER);
        const boost = applyValidationBoost(predictionComparison, KB_PATH);
        if (boost.boosted) {
          dbg(`validation boost: ${boost.predecessorId} → count=${boost.newCount}`);
        } else {
          dbg(`validation boost skipped: ${boost.error || 'not applicable'}`);
        }
      }
    } catch (e) {
      dbg(`validation boost error: ${e.message}`);
    }
  }

  // Auto-grade and Monday sync REMOVED from hooks (caused persistent popup
  // windows on Windows — detached:true creates new console regardless of
  // windowsHide). Run manually: node .fastops/grade-kb.js --auto-apply
  // and: node .fastops/monday-grading-sync.js push
  dbg('auto-grade and monday-sync: run manually during /handoff (removed from hooks to fix Windows popup)');

  // Clean up lease file on graceful shutdown
  if (agentLease) {
    try {
      const lease = agentLease.getLeaseBySessionId(stdinSessionId);
      if (lease) {
        agentLease.removeLease(lease.uuid);
        dbg(`lease removed: ${lease.uuid}`);
      }
      // Also clean any expired leases from other dead sessions
      const cleaned = agentLease.cleanupExpired();
      if (cleaned > 0) dbg(`cleaned ${cleaned} expired leases`);
    } catch (e) { dbg(`lease cleanup error: ${e.message}`); }
  }

  // Clean up claims on graceful shutdown (blast-radius routing — Session 170)
  try {
    const CLAIMS_FILE = path.join(ROOT, '.fastops', 'CLAIMS.json');
    if (fs.existsSync(CLAIMS_FILE)) {
      const claimsData = JSON.parse(fs.readFileSync(CLAIMS_FILE, 'utf-8'));
      const before = claimsData.claims.length;
      claimsData.claims = claimsData.claims.filter(c => c.agent !== agentId);
      const removed = before - claimsData.claims.length;
      if (removed > 0) {
        claimsData.last_updated = new Date().toISOString();
        fs.writeFileSync(CLAIMS_FILE, JSON.stringify(claimsData, null, 2) + '\n');
        dbg(`claims removed: ${removed} for ${agentId}`);
      }
    }
  } catch (e) { dbg(`claims cleanup error: ${e.message}`); }

  // Rally safety net: if agent completed work without rallying, auto-post completion summary
  // V2 Agent Operating Model — ensures team always knows what happened even on unclean exit
  try {
    const COMMS_FILE = path.join(ROOT, 'comms', 'data', 'general.jsonl');

    // Check if agent completed any todos this session (from changelog)
    let completedThisSession = 0;
    const completedNames = [];
    if (fs.existsSync(CHANGELOG)) {
      const entries = fs.readFileSync(CHANGELOG, 'utf-8').trim().split('\n');
      for (const line of entries.slice(-30)) {
        try {
          const e = JSON.parse(line);
          if (e.agent === agentId && e.status === 'completed') {
            completedThisSession++;
            if (e.todo) completedNames.push(e.todo);
          }
        } catch {}
      }
    }

    if (completedThisSession > 0) {
      // Check if agent posted a RALLY in recent comms
      let rallied = false;
      if (fs.existsSync(COMMS_FILE)) {
        const fd = fs.openSync(COMMS_FILE, 'r');
        const stats = fs.fstatSync(fd);
        const readSize = Math.min(stats.size, 4096);
        const buffer = Buffer.alloc(readSize);
        fs.readSync(fd, buffer, 0, readSize, Math.max(0, stats.size - readSize));
        fs.closeSync(fd);
        const commsLines = buffer.toString('utf-8').trim().split('\n').slice(-20);
        for (const line of commsLines) {
          try {
            const msg = JSON.parse(line);
            if ((msg.from === agentId || msg.from === agentId.substring(0, 8)) &&
                msg.content.includes('RALLY')) {
              rallied = true;
              break;
            }
          } catch {}
        }
      }

      if (!rallied) {
        // Auto-post completion summary so team knows what happened
        try {
          const sendScript = path.join(ROOT, 'comms', 'send.js');
          const todoList = completedNames.slice(0, 5).join('; ') || `${completedThisSession} items`;
          execSync(`node "${sendScript}" ${agentId} "AUTO-RALLY (session end) — Completed: ${todoList}. Files: ${filesChanged.slice(0, 3).join(', ') || 'none tracked'}. Session ended without manual rally."`, {
            cwd: ROOT, encoding: 'utf8', timeout: 5000, windowsHide: true
          });
          dbg('auto-rally posted (agent exited without rallying)');
        } catch (e) {
          dbg(`auto-rally error: ${e.message}`);
        }
      }
    }
  } catch (e) { dbg(`rally check error: ${e.message}`); }

  // Exit 0 — don't block agent shutdown
  process.exit(0);
}

main().catch(err => {
  dbg(`fatal: ${err.message}`);
  process.exit(0);
});
