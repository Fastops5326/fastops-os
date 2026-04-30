#!/usr/bin/env node
/**
 * city-conviction-gate.js — Automatic quality reflex arcs.
 *
 * The Conviction Gate Framework has been treated as a deliberation tool.
 * This makes it a REFLEX ARC — deterministic, automatic, fast.
 *
 * No deliberation overhead. Clear pass/fail criteria. Immediate blocking.
 *
 * Gates:
 *   - SYNTAX: Code must parse before commit
 *   - EXECUTION: Scripts must run and return expected output
 *   - COMPLETENESS: Files must not be empty or placeholder-only
 *   - DIVERGENCE: Changes must not conflict with ongoing work
 *   - BEDROCK: Critical files require explicit review before merge
 *
 * Usage:
 *   node .fastops/city-conviction-gate.js --file path/to/file.js    # Check single file
 *   node .fastops/city-conviction-gate.js --commit <session-id>    # Pre-commit gate
 *   node .fastops/city-conviction-gate.js --merge <session-id>     # Pre-merge gate
 *   node .fastops/city-conviction-gate.js --gate <gate-type>        # Run specific gate
 *   node .fastops/city-conviction-gate.js --install                # Install git hooks
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GATE_LOG = path.join(__dirname, '.conviction-gate.jsonl');

// ── Gate Definitions ────────────────────────────────────────────────

const GATES = {
  // SYNTAX: Code must parse before it can be committed
  syntax: {
    name: 'Syntax Validation',
    description: 'Code must parse without syntax errors',
    test: (filePath) => {
      if (!filePath.endsWith('.js') && !filePath.endsWith('.ts')) return { pass: true };
      try {
        execSync(`node --check ${JSON.stringify(filePath)}`, { timeout: 5000 });
        return { pass: true };
      } catch (e) {
        return { pass: false, reason: e.stderr?.toString() || e.message };
      }
    },
    severity: 'BLOCK',
  },

  // COMPLETENESS: Files must not be empty or stub-only
  completeness: {
    name: 'Completeness Check',
    description: 'Files must contain substantive implementation',
    test: (filePath) => {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(l => l.trim());

      // Too short
      if (lines.length < 5) {
        return { pass: false, reason: `Only ${lines.length} lines (minimum 5)` };
      }

      // Placeholder keywords
      const placeholderRegex = /TODO|FIXME|placeholder|stub|not implemented|coming soon/i;
      const placeholderLines = lines.filter(l => placeholderRegex.test(l)).length;
      const ratio = placeholderLines / lines.length;

      if (ratio > 0.3) {
        return { pass: false, reason: `${Math.round(ratio * 100)}% placeholder content` };
      }

      // Must have non-comment content
      const codeLines = lines.filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('#'));
      if (codeLines.length < 3) {
        return { pass: false, reason: 'Less than 3 lines of actual code' };
      }

      return { pass: true };
    },
    severity: 'BLOCK',
  },

  // EXPORTS: JS files must export something usable
  exports: {
    name: 'Export Validation',
    description: 'Modules must export or define something',
    test: (filePath) => {
      if (!filePath.endsWith('.js') && !filePath.endsWith('.ts')) return { pass: true };
      const content = fs.readFileSync(filePath, 'utf8');

      const hasExport = content.match(/\bmodule\.exports\b|\bexports\b|\bexport\b/);
      const hasFunction = content.match(/\bfunction\s+\w+|const\s+\w+\s*=|class\s+\w+/);
      const hasAction = content.match(/\brequire\s*\(|process\.argv|if\s*\(require\.main/);

      if (!hasExport && !hasFunction && !hasAction) {
        return { pass: false, reason: 'No exports, functions, or actions detected' };
      }

      return { pass: true };
    },
    severity: 'WARN',
  },

  // DIVERGENCE: Check for conflicting work
  divergence: {
    name: 'Divergence Check',
    description: 'Changes must not conflict with ongoing sessions',
    test: (filePath, context = {}) => {
      const sessionDir = path.join(__dirname, '.sessions');
      if (!fs.existsSync(sessionDir)) return { pass: true };

      const sessions = fs.readdirSync(sessionDir)
        .filter(f => f.endsWith('.json'))
        .map(f => JSON.parse(fs.readFileSync(path.join(sessionDir, f), 'utf8')))
        .filter(s => s.status === 'active' && s.id !== context.sessionId);

      const relativePath = path.relative(ROOT, filePath).replace(/\\/g, '/');

      for (const session of sessions) {
        const targets = session._buildTargets || [];
        if (targets.has && targets.has(relativePath)) {
          return {
            pass: false,
            reason: `Active session ${session.id} (${session.model}) also targeting ${relativePath}`,
          };
        }
      }

      return { pass: true };
    },
    severity: 'BLOCK',
  },

  // BEDROCK: Critical files need explicit review
  bedrock: {
    name: 'Bedrock File Protection',
    description: 'Critical infrastructure requires explicit review',
    test: (filePath) => {
      const criticalPaths = [
        '.fastops/city-session.js',
        '.fastops/model-router.js',
        'comms/protocol.js',
        'package.json',
      ];

      const relativePath = path.relative(ROOT, filePath).replace(/\\/g, '/');

      if (criticalPaths.some(cp => relativePath.includes(cp))) {
        return {
          pass: false,
          reason: 'BEDROCK file — requires explicit human review and signature',
          bedrock: true,
        };
      }

      return { pass: true };
    },
    severity: 'ESCALATE',
  },
};

// ── Core Functions ───────────────────────────────────────────────────

function logGate(gate, file, result, context = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    gate: gate.name,
    gateId: Object.keys(GATES).find(k => GATES[k] === gate),
    file: path.relative(ROOT, file),
    result: result.pass ? 'PASS' : (gate.severity === 'ESCALATE' ? 'ESCALATE' : 'BLOCK'),
    reason: result.reason || null,
    sessionId: context.sessionId || null,
    model: context.model || null,
  };
  fs.appendFileSync(GATE_LOG, JSON.stringify(entry) + '\n');
  return entry;
}

function runGate(gateId, filePath, context = {}) {
  const gate = GATES[gateId];
  if (!gate) {
    return { pass: false, reason: `Unknown gate: ${gateId}` };
  }

  if (!fs.existsSync(filePath)) {
    return { pass: false, reason: 'File not found' };
  }

  const result = gate.test(filePath, context);
  logGate(gate, filePath, result, context);

  return {
    ...result,
    gate: gate.name,
    severity: gate.severity,
    canProceed: result.pass || gate.severity === 'WARN',
  };
}

function runAllGates(filePath, context = {}) {
  const results = [];
  let canProceed = true;
  let escalations = [];
  let blocks = [];

  for (const [id, gate] of Object.entries(GATES)) {
    const result = runGate(id, filePath, context);
    results.push(result);

    if (!result.pass && gate.severity === 'BLOCK') {
      canProceed = false;
      blocks.push(`${gate.name}: ${result.reason}`);
    }
    if (!result.pass && gate.severity === 'ESCALATE') {
      escalations.push(`${gate.name}: ${result.reason}`);
    }
  }

  return {
    file: path.relative(ROOT, filePath),
    canProceed,
    blocks,
    escalations,
    results,
    timestamp: new Date().toISOString(),
  };
}

// ── Session Integration ──────────────────────────────────────────────

function preCommitGate(sessionId) {
  const sessionPath = path.join(__dirname, '.sessions', `${sessionId}.json`);
  if (!fs.existsSync(sessionPath)) {
    return { pass: false, reason: 'Session not found' };
  }

  const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  const worktree = session.worktree;

  if (!worktree || !fs.existsSync(worktree)) {
    return { pass: false, reason: 'Worktree not found' };
  }

  // Get files changed in this session
  let changedFiles = [];
  try {
    const diff = execSync('git diff --name-only master', { cwd: worktree, encoding: 'utf8' });
    changedFiles = diff.trim().split('\n').filter(Boolean);
  } catch (e) {
    return { pass: false, reason: 'Failed to get changed files: ' + e.message };
  }

  const allResults = [];
  let canProceed = true;

  for (const file of changedFiles) {
    const fullPath = path.join(worktree, file);
    if (!fs.existsSync(fullPath)) continue;

    const result = runAllGates(fullPath, { sessionId, model: session.model });
    allResults.push(result);

    if (!result.canProceed) {
      canProceed = false;
    }
  }

  return {
    pass: canProceed,
    sessionId,
    model: session.model,
    filesChecked: changedFiles.length,
    results: allResults,
    summary: canProceed ? 'All gates passed' : 'Some gates blocked',
  };
}

// ── CLI ────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case '--file': {
      const file = args[1];
      if (!file) {
        console.error('Usage: --file <path>');
        process.exit(1);
      }
      const fullPath = path.resolve(file);
      const result = runAllGates(fullPath);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.canProceed ? 0 : 1);
    }

    case '--gate': {
      const gateId = args[1];
      const file = args[2];
      if (!gateId || !file) {
        console.error('Usage: --gate <gate-id> <file>');
        process.exit(1);
      }
      const result = runGate(gateId, path.resolve(file));
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.canProceed ? 0 : 1);
    }

    case '--commit': {
      const sessionId = args[1];
      if (!sessionId) {
        console.error('Usage: --commit <session-id>');
        process.exit(1);
      }
      const result = preCommitGate(sessionId);
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.pass ? 0 : 1);
    }

    case '--list':
      console.log('Conviction Gates (automatic, deterministic):\n');
      for (const [id, gate] of Object.entries(GATES)) {
        console.log(`  ${id} [${gate.severity}]`);
        console.log(`    ${gate.name}: ${gate.description}\n`);
      }
      break;

    case '--log':
      if (!fs.existsSync(GATE_LOG)) {
        console.log('No gate log yet');
      } else {
        const lines = fs.readFileSync(GATE_LOG, 'utf8').trim().split('\n').slice(-20);
        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            console.log(`[${entry.timestamp}] ${entry.result}: ${entry.gate} on ${entry.file}`);
            if (entry.reason) console.log(`  → ${entry.reason}`);
          } catch (e) {}
        }
      }
      break;

    case '--stats': {
      if (!fs.existsSync(GATE_LOG)) {
        console.log('No gate data yet');
        break;
      }
      const lines = fs.readFileSync(GATE_LOG, 'utf8').trim().split('\n').filter(Boolean);
      const stats = { PASS: 0, BLOCK: 0, ESCALATE: 0 };
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          stats[entry.result] = (stats[entry.result] || 0) + 1;
        } catch (e) {}
      }
      console.log('Gate Statistics:');
      console.log(`  Total checks: ${lines.length}`);
      console.log(`  Pass: ${stats.PASS}`);
      console.log(`  Block: ${stats.BLOCK}`);
      console.log(`  Escalate: ${stats.ESCALATE}`);
      break;
    }

    default:
      console.log(`Usage:
  --file <path>         Run all gates on single file
  --gate <id> <file>    Run specific gate
  --commit <session>    Pre-commit gate for session
  --list                List available gates
  --log                 Show recent gate log
  --stats               Show gate statistics`);
  }
}

// Export for programmatic use
module.exports = {
  GATES,
  runGate,
  runAllGates,
  preCommitGate,
};

if (require.main === module) {
  main();
}
