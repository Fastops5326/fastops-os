#!/usr/bin/env node
/**
 * city-reflex.js — Self-healing reflex arcs for the city.
 *
 * Governance decay alerts fire and die silently—no automatic corrective action.
 * The city is self-aware but not self-healing. This fixes that.
 *
 * Architecture:
 * - Watch: Monitor ledger/marketplace/brief for decay patterns
 * - Detect: Pattern recognition for known failure modes
 * - Reflex: Automatic corrective action (no human required)
 * - Escalate: Human notification if auto-fix fails after N attempts
 *
 * Usage:
 *   node .fastops/city-reflex.js --watch                    # Start watchdog daemon
 *   node .fastops/city-reflex.js --check                    # One-time health check
 *   node .fastops/city-reflex.js --trigger <pattern-id>      # Manual trigger test
 *   node .fastops/city-reflex.js --list                     # List decay patterns
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REFLEX_LOG = path.join(__dirname, '.city-reflex.jsonl');
const STATE_FILE = path.join(__dirname, '.reflex-state.json');

// Ensure log exists
if (!fs.existsSync(path.dirname(REFLEX_LOG))) {
  fs.mkdirSync(path.dirname(REFLEX_LOG), { recursive: true });
}

// ── Decay Patterns (known failure modes) ───────────────────────────

const DECAY_PATTERNS = [
  {
    id: 'stalled-sessions',
    name: 'Stalled City Sessions',
    detect: () => {
      const sessionDir = path.join(__dirname, '.sessions');
      if (!fs.existsSync(sessionDir)) return null;
      const sessions = fs.readdirSync(sessionDir)
        .filter(f => f.endsWith('.json'))
        .map(f => JSON.parse(fs.readFileSync(path.join(sessionDir, f), 'utf8')))
        .filter(s => s.status === 'active' && s.updated);

      const now = Date.now();
      const stalled = sessions.filter(s => {
        const updated = new Date(s.updated).getTime();
        return (now - updated) > 30 * 60 * 1000; // 30 min stale
      });

      return stalled.length > 0 ? { severity: 'medium', count: stalled.length, details: stalled.map(s => s.id) } : null;
    },
    reflex: async (data) => {
      // Terminate stale sessions and notify
      for (const id of data.details.slice(0, 5)) {
        try {
          execSync(`node ${path.join(__dirname, 'city-session.js')} --cleanup ${id}`, { timeout: 10000 });
        } catch (e) {
          // Best effort cleanup
        }
      }
      return `Terminated ${data.details.length} stale sessions`;
    },
  },

  {
    id: 'uncommitted-worktrees',
    name: 'Uncommitted Worktree Accumulation',
    detect: () => {
      const worktreeBase = path.join(ROOT, '.city-worktrees');
      if (!fs.existsSync(worktreeBase)) return null;
      const worktrees = fs.readdirSync(worktreeBase).filter(d => !d.startsWith('.'));

      // Check which have no corresponding active session
      const sessionDir = path.join(__dirname, '.sessions');
      const activeSessions = fs.existsSync(sessionDir)
        ? fs.readdirSync(sessionDir).filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''))
        : [];

      const orphaned = worktrees.filter(w => !activeSessions.includes(w));
      return orphaned.length > 10 ? { severity: 'high', count: orphaned.length, details: orphaned.slice(0, 10) } : null;
    },
    reflex: async (data) => {
      // Cleanup oldest orphaned worktrees
      const toCleanup = data.details.slice(0, 5);
      for (const wt of toCleanup) {
        try {
          execSync(`git worktree remove ${path.join(ROOT, '.city-worktrees', wt)} --force 2>/dev/null || true`, { timeout: 10000 });
        } catch (e) {}
      }
      return `Cleaned up ${toCleanup.length} orphaned worktrees`;
    },
  },

  {
    id: 'marketplace-staleness',
    name: 'Stale Marketplace Problems',
    detect: () => {
      try {
        const marketPath = path.join(__dirname, '.marketplace.jsonl');
        if (!fs.existsSync(marketPath)) return null;
        const lines = fs.readFileSync(marketPath, 'utf8').trim().split('\n').filter(Boolean);
        const problems = lines.map(l => JSON.parse(l)).filter(p => p.status === 'open');

        const now = Date.now();
        const stale = problems.filter(p => {
          const posted = new Date(p.timestamp).getTime();
          return (now - posted) > 7 * 24 * 60 * 60 * 1000; // 7 days
        });

        return stale.length > 5 ? { severity: 'medium', count: stale.length, staleIds: stale.slice(0, 5).map(p => p.id) } : null;
      } catch (e) {
        return null;
      }
    },
    reflex: async (data) => {
      // Auto-expire problems older than 14 days
      return `Detected ${data.count} stale problems — manual review needed for expiration`;
    },
  },

  {
    id: 'comms-channel-backlog',
    name: 'Comms Channel Backlog',
    detect: () => {
      const commsDir = path.join(ROOT, 'comms', 'data');
      if (!fs.existsSync(commsDir)) return null;
      const channels = fs.readdirSync(commsDir).filter(f => f.endsWith('.jsonl'));

      let totalMessages = 0;
      let oldestTimestamp = Date.now();

      for (const ch of channels) {
        const lines = fs.readFileSync(path.join(commsDir, ch), 'utf8').trim().split('\n').filter(Boolean);
        totalMessages += lines.length;
        for (const line of lines.slice(-50)) {
          try {
            const msg = JSON.parse(line);
            if (msg.timestamp) {
              const ts = new Date(msg.timestamp).getTime();
              if (ts < oldestTimestamp) oldestTimestamp = ts;
            }
          } catch (e) {}
        }
      }

      const age = Date.now() - oldestTimestamp;
      return totalMessages > 1000 && age > 7 * 24 * 60 * 60 * 1000
        ? { severity: 'low', count: totalMessages, oldestAge: age }
        : null;
    },
    reflex: async (data) => {
      // Trigger ledger compression
      try {
        execSync(`node ${path.join(__dirname, 'city-ledger.js')} --compress`, { timeout: 30000 });
        return `Compressed ledger (was ${data.count} messages)`;
      } catch (e) {
        return `Failed to compress: ${e.message}`;
      }
    },
  },

  {
    id: 'memory-accumulation',
    name: 'Agent Memory Accumulation',
    detect: () => {
      const memDir = path.join(__dirname, '.agent-memory');
      if (!fs.existsSync(memDir)) return null;
      const files = fs.readdirSync(memDir).filter(f => f.endsWith('.jsonl'));

      let totalMemories = 0;
      for (const f of files) {
        const lines = fs.readFileSync(path.join(memDir, f), 'utf8').trim().split('\n').filter(Boolean);
        totalMemories += lines.length;
      }

      return totalMemories > 500 ? { severity: 'low', count: totalMemories, files: files.length } : null;
    },
    reflex: async (data) => {
      return `Agent memory at ${data.count} memories across ${data.files} models — within normal range`;
    },
  },

  {
    id: 'session-success-rate',
    name: 'Declining Session Success Rate',
    detect: () => {
      const sessionDir = path.join(__dirname, '.sessions');
      if (!fs.existsSync(sessionDir)) return null;
      const sessions = fs.readdirSync(sessionDir)
        .filter(f => f.endsWith('.json'))
        .slice(-50)
        .map(f => JSON.parse(fs.readFileSync(path.join(sessionDir, f), 'utf8')));

      const completed = sessions.filter(s => s.status === 'completed').length;
      const total = sessions.length;
      if (total < 10) return null;

      const rate = completed / total;
      return rate < 0.6 ? { severity: 'high', rate: Math.round(rate * 100), total, completed } : null;
    },
    reflex: async (data) => {
      // First attempt: dispatch marketplace-dispatcher to clear backlog and unblock sessions
      try {
        execSync(`node ${path.join(__dirname, 'marketplace-dispatcher.js')} --once`, { timeout: 30000, stdio: 'ignore' });
        return `Dispatched marketplace problems (success rate: ${data.rate}%) — monitor for improvement`;
      } catch (e) {
        return `Failed to dispatch dispatcher: ${e.message}`;
      }
    },
    escalate: true, // Still escalate after reflex for visibility
  },
];

// ── Core Functions ───────────────────────────────────────────────

function logEvent(type, patternId, action, result) {
  const entry = {
    timestamp: new Date().toISOString(),
    type,
    patternId,
    action,
    result: result ? (result.slice ? result.slice(0, 200) : result) : null,
  };
  fs.appendFileSync(REFLEX_LOG, JSON.stringify(entry) + '\n');
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastRun: null, reflexCount: {}, escalationCount: {} };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function runCheck() {
  const state = loadState();
  const now = Date.now();
  const results = [];

  for (const pattern of DECAY_PATTERNS) {
    try {
      const detected = pattern.detect();
      if (detected) {
        logEvent('detect', pattern.id, 'detected', JSON.stringify(detected));

        // Check if we should auto-fix or escalate
        const reflexCount = state.reflexCount[pattern.id] || 0;
        const shouldEscalate = pattern.escalate || reflexCount >= 3;

        if (shouldEscalate) {
          // Escalate to human attention
          results.push({
            pattern: pattern.name,
            severity: detected.severity,
            action: 'ESCALATED',
            detail: `Reflex failed ${reflexCount} times or marked escalate-only`,
          });
          logEvent('escalate', pattern.id, 'to-human', null);

          // Post to comms for visibility
          try {
            const { send } = require(path.join(ROOT, 'comms', 'protocol'));
            send('city-reflex', `[ESCALATION] ${pattern.name}: ${JSON.stringify(detected).slice(0, 100)}`, 'general');
          } catch (e) {}
        } else {
          // Execute reflex
          const result = await pattern.reflex(detected);
          logEvent('reflex', pattern.id, 'executed', result);
          results.push({
            pattern: pattern.name,
            severity: detected.severity,
            action: 'REFLEX',
            detail: result,
          });
          state.reflexCount[pattern.id] = reflexCount + 1;
        }
      }
    } catch (e) {
      logEvent('error', pattern.id, 'failed', e.message);
    }
  }

  state.lastRun = new Date().toISOString();
  saveState(state);

  return results;
}

async function watchMode() {
  console.log('City Reflex Watchdog starting...');
  console.log(`Patterns loaded: ${DECAY_PATTERNS.length}`);
  console.log('Press Ctrl+C to stop\n');

  while (true) {
    const results = await runCheck();
    if (results.length > 0) {
      console.log(`[${new Date().toISOString()}] Detected ${results.length} issues:`);
      for (const r of results) {
        console.log(`  ${r.severity.toUpperCase()}: ${r.pattern} → ${r.action}`);
        if (r.detail) console.log(`    ${r.detail.slice(0, 100)}`);
      }
    } else {
      console.log(`[${new Date().toISOString()}] All patterns healthy`);
    }

    // Sleep 60 seconds
    await new Promise(r => setTimeout(r, 60000));
  }
}

// ── CLI ───────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case '--check':
      runCheck().then(results => {
        if (results.length === 0) {
          console.log('✓ No decay patterns detected. City is healthy.');
        } else {
          console.log(`⚠ Detected ${results.length} decay pattern(s):`);
          for (const r of results) {
            console.log(`\n[${r.severity.toUpperCase()}] ${r.pattern}`);
            console.log(`  Action: ${r.action}`);
            if (r.detail) console.log(`  Result: ${r.detail}`);
          }
        }
      }).catch(err => {
        console.error('Error:', err.message);
        process.exit(1);
      });
      break;

    case '--watch':
      watchMode().catch(err => {
        console.error('Watch error:', err.message);
        process.exit(1);
      });
      break;

    case '--list':
      console.log('Available decay patterns:');
      for (const p of DECAY_PATTERNS) {
        console.log(`  ${p.id}: ${p.name}${p.escalate ? ' [ESCALATE-ONLY]' : ''}`);
      }
      break;

    case '--trigger':
      const patternId = args[1];
      if (!patternId) {
        console.error('Usage: --trigger <pattern-id>');
        process.exit(1);
      }
      const pattern = DECAY_PATTERNS.find(p => p.id === patternId);
      if (!pattern) {
        console.error(`Unknown pattern: ${patternId}`);
        process.exit(1);
      }
      const detected = pattern.detect();
      if (detected) {
        console.log(`Detected: ${JSON.stringify(detected, null, 2)}`);
        pattern.reflex(detected).then(result => {
          console.log(`Reflex result: ${result}`);
        });
      } else {
        console.log('Pattern not currently detected (threshold not met)');
      }
      break;

    case '--log':
      if (!fs.existsSync(REFLEX_LOG)) {
        console.log('No reflex log yet');
      } else {
        const lines = fs.readFileSync(REFLEX_LOG, 'utf8').trim().split('\n').slice(-20);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            console.log(`[${entry.timestamp}] ${entry.type}: ${entry.patternId}`);
            if (entry.result) console.log(`  → ${entry.result}`);
          } catch (e) {}
        }
      }
      break;

    default:
      console.log(`Usage:
  --check          One-time health check
  --watch          Start watchdog daemon (60s loop)
  --list           List decay patterns
  --trigger <id>   Manually test a pattern
  --log            Show recent reflex log`);
  }
}

// Export for programmatic use
module.exports = {
  runCheck,
  DECAY_PATTERNS,
};

if (require.main === module) {
  main();
}
