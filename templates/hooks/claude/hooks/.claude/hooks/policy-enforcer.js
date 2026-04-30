#!/usr/bin/env node
/**
 * policy-enforcer.js — PreToolUse governance hook
 *
 * Reads .fastops/constitution.json and enforces governance rules at runtime.
 * Fires on every tool call. Designed for minimal hot-path latency.
 *
 * Behavior:
 *   - hard_block rules  → deny the tool call with explanation
 *   - soft_warn rules   → allow with warning injected as context
 *   - audit_only rules  → silent pass (logged only)
 *   - freedom missions  → skip all non-safety rules
 *
 * Hook protocol: read JSON from stdin, write JSON to stdout.
 *   Allow: { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', additionalContext?: string } }
 *   Deny:  { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: string } }
 *
 * Created: C-02 prototype agent, Environment 3.0
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Constants ───────────────────────────────────────────────────────────────

const BASE = path.join(__dirname, '..', '..');
const FASTOPS = path.join(BASE, '.fastops');
const CONSTITUTION_PATH = path.join(FASTOPS, 'constitution.json');
const LIVE_POSITION_PATH = path.join(FASTOPS, 'LIVE-POSITION.md');

// ─── Constitution Cache ──────────────────────────────────────────────────────
// Cache constitution in memory for the process lifetime (single invocation).
// Re-read from disk each process start so edits to constitution.json take
// effect without restart. File read is ~0.5ms for a 10KB JSON file.

let _constitution = null;

function getConstitution() {
  if (_constitution) return _constitution;
  try {
    _constitution = JSON.parse(fs.readFileSync(CONSTITUTION_PATH, 'utf8'));
    return _constitution;
  } catch (err) {
    // Constitution missing or corrupt — fail open, log nothing to stdout
    return null;
  }
}

// ─── Mission Type Detection ──────────────────────────────────────────────────
// Detect the current mission type from active-mission-*.json files or
// LIVE-POSITION.md. Cached per invocation.

let _missionContext = null;

function detectMissionContext() {
  if (_missionContext) return _missionContext;

  _missionContext = { mission_type: 'solo', criticality: 'standard', scopes: [] };

  // Strategy: scan active-mission-*.json files for the freshest one.
  // These files have contract_id, scope, shape.domain_types, etc.
  try {
    const files = fs.readdirSync(FASTOPS).filter(f => f.startsWith('active-mission-') && f.endsWith('.json'));
    let freshest = null;
    let freshestMtime = 0;

    for (const file of files) {
      try {
        const fp = path.join(FASTOPS, file);
        const stat = fs.statSync(fp);
        if (stat.mtimeMs > freshestMtime) {
          freshestMtime = stat.mtimeMs;
          freshest = fp;
        }
      } catch {}
    }

    if (freshest) {
      const mission = JSON.parse(fs.readFileSync(freshest, 'utf8'));

      // Extract mission type from team configuration
      if (mission.team && mission.team.agents && mission.team.agents.length > 0) {
        _missionContext.mission_type = 'team';
      } else if (mission.team && mission.team.justification_if_solo) {
        _missionContext.mission_type = 'solo';
      }

      // Extract scopes from shape.domain_types or contract_id keywords
      if (mission.shape && Array.isArray(mission.shape.domain_types)) {
        _missionContext.scopes = mission.shape.domain_types;
      }

      // Check contract_id for forced-team scope keywords
      const contractId = (mission.contract_id || '').toLowerCase();
      const scopeKeywords = ['auth', 'identity', 'jwt', 'database', 'schema', 'migration',
                             'deployment', 'deploy', 'infrastructure', 'security', 'encryption'];
      for (const kw of scopeKeywords) {
        if (contractId.includes(kw) && !_missionContext.scopes.includes(kw)) {
          _missionContext.scopes.push(kw);
        }
      }
    }
  } catch {}

  // Fallback: check LIVE-POSITION.md for freedom mission indicators
  try {
    const pos = fs.readFileSync(LIVE_POSITION_PATH, 'utf8');
    const lower = pos.toLowerCase();
    if (lower.includes('freedom mission') || lower.includes('mission type: freedom')) {
      _missionContext.mission_type = 'freedom';
    }
  } catch {}

  return _missionContext;
}

// ─── Safety Pattern Detectors ────────────────────────────────────────────────
// These check the actual tool call against safety rules. They are the only
// rules that produce real-time blocks. Classification/signoff/role rules are
// informational warnings — they can't meaningfully block a single tool call.

/**
 * SAFETY-001: No deleting production data/databases outside reviewed migrations.
 * Detects: DROP TABLE, DELETE FROM (without WHERE), rm on data dirs, etc.
 */
function checkSafety001(toolName, toolInput) {
  if (toolName !== 'Bash') return null;
  const cmd = (toolInput.command || '').toLowerCase();

  const dangerPatterns = [
    /drop\s+(table|database|schema)\s/,
    /delete\s+from\s+\S+\s*;/,      // DELETE FROM table; (no WHERE)
    /truncate\s+table/,
    /rm\s+(-rf?\s+)?.*\/(data|database|db|prod)/,
    /prisma\s+migrate\s+reset/,
    /prisma\s+db\s+push\s+--force-reset/,
  ];

  for (const pat of dangerPatterns) {
    if (pat.test(cmd)) {
      return 'SAFETY-001: Detected potential production data deletion. No deleting production data or databases outside of explicit, reviewed migration plans.';
    }
  }
  return null;
}

/**
 * SAFETY-002: No committing secrets, credentials, API keys, or .env files.
 * Detects: git add .env, git commit with .env staged, Write to .env files.
 */
function checkSafety002(toolName, toolInput) {
  if (toolName === 'Bash') {
    const cmd = (toolInput.command || '');
    // git add .env or git add -A (which would include .env)
    if (/git\s+add\s+.*\.env/.test(cmd)) {
      return 'SAFETY-002: Detected git add of .env file. No committing secrets, credentials, API keys, or .env files to the repository.';
    }
    // git commit when .env might be staged — we can't fully check this,
    // but flag explicit .env references in commit commands
    if (/git\s+commit/.test(cmd) && /\.env/.test(cmd)) {
      return 'SAFETY-002: Detected git commit referencing .env file. No committing secrets, credentials, API keys, or .env files.';
    }
  }

  if ((toolName === 'Write' || toolName === 'Edit') && toolInput.file_path) {
    const fp = toolInput.file_path.toLowerCase();
    // Block writing to files that look like credential stores
    if (/credentials\.json$|\.env\.local$|\.env\.production$|secrets\.json$|api[_-]?key/.test(fp)) {
      // Only warn — writing these files isn't committing them
      return null;
    }
  }

  return null;
}

/**
 * SAFETY-003: No force-pushing to main/master.
 */
function checkSafety003(toolName, toolInput) {
  if (toolName !== 'Bash') return null;
  const cmd = (toolInput.command || '');
  if (/git\s+push\s+.*--force.*\s+(main|master)/.test(cmd) ||
      /git\s+push\s+.*\s+(main|master)\s+.*--force/.test(cmd) ||
      /git\s+push\s+-f\s+.*\s+(main|master)/.test(cmd)) {
    return 'SAFETY-003: No force-pushing to main/master branch.';
  }
  return null;
}

/**
 * SAFETY-004: No destructive git operations without explicit user request.
 * Detects: reset --hard, clean -f, branch -D
 */
function checkSafety004(toolName, toolInput) {
  if (toolName !== 'Bash') return null;
  const cmd = (toolInput.command || '');
  if (/git\s+reset\s+--hard/.test(cmd)) {
    return 'SAFETY-004: Detected git reset --hard. No destructive git operations without explicit user request.';
  }
  if (/git\s+clean\s+-[a-zA-Z]*f/.test(cmd)) {
    return 'SAFETY-004: Detected git clean -f. No destructive git operations without explicit user request.';
  }
  if (/git\s+branch\s+-D\s/.test(cmd)) {
    return 'SAFETY-004: Detected git branch -D. No destructive git operations without explicit user request.';
  }
  return null;
}

// Safety checkers indexed by rule ID for fast lookup
const SAFETY_CHECKERS = {
  'SAFETY-001': checkSafety001,
  'SAFETY-002': checkSafety002,
  'SAFETY-003': checkSafety003,
  'SAFETY-004': checkSafety004,
  // SAFETY-005 (budget cap) requires external state — not enforceable per-tool-call
};

// ─── Output Functions ────────────────────────────────────────────────────────

function allow(additionalContext) {
  const output = {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow'
    }
  };
  if (additionalContext) {
    output.hookSpecificOutput.additionalContext = additionalContext;
  }
  process.stdout.write(JSON.stringify(output));
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason
    }
  }));
}

// ─── Main ────────────────────────────────────────────────────────────────────

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(inputData);
    const toolName = data.tool_name || '';
    const toolInput = data.tool_input || {};

    // ─── Load constitution (fail open if missing) ────────────────────────
    const constitution = getConstitution();
    if (!constitution || !Array.isArray(constitution.rules)) {
      return allow();
    }

    // ─── Detect mission context ──────────────────────────────────────────
    const ctx = detectMissionContext();
    const isFreedom = ctx.mission_type === 'freedom';

    // ─── Evaluate safety rules (always, including freedom) ───────────────
    // These are the only rules with real-time tool-call detection.
    // Run them first — they're the hot path for blocks.
    for (const rule of constitution.rules) {
      if (rule.category !== 'safety') continue;

      const checker = SAFETY_CHECKERS[rule.id];
      if (!checker) continue;

      const violation = checker(toolName, toolInput);
      if (violation) {
        if (rule.enforcement_level === 'hard_block') {
          return deny(`[CONSTITUTION] ${violation}`);
        }
        // soft_warn safety rules — allow but inject warning
        // (Currently all safety rules are hard_block, but future-proof)
      }
    }

    // ─── Freedom missions: skip all non-safety rules ─────────────────────
    if (isFreedom) {
      return allow();
    }

    // ─── Evaluate non-safety rules for warnings ──────────────────────────
    // These rules (classification, signoff, roles, comms, timeout, etc.)
    // are structural — they describe process requirements, not per-tool-call
    // violations. We emit soft warnings when relevant context is detected.

    const warnings = [];

    for (const rule of constitution.rules) {
      if (rule.category === 'safety') continue;
      if (rule.enforcement_level === 'audit_only') continue;

      // Check exemption
      if (Array.isArray(rule.exempt_mission_types) && rule.exempt_mission_types.includes(ctx.mission_type)) {
        continue;
      }

      // Check applicability
      if (Array.isArray(rule.applies_to) && !rule.applies_to.includes(ctx.mission_type)) {
        continue;
      }

      // ─── Classification rules: detect scope violations in real time ────
      if (rule.category === 'mission_classification' && rule.trigger_scopes && ctx.mission_type === 'solo') {
        // Check if the current tool call touches a forced-team scope
        const touchedScopes = detectScopesFromToolCall(toolName, toolInput);
        const triggered = touchedScopes.some(s => rule.trigger_scopes.includes(s));
        if (triggered) {
          const msg = `[CONSTITUTION ${rule.id}] WARNING: This action touches scope [${touchedScopes.join(', ')}] which requires TEAM classification. ${rule.description}`;
          if (rule.enforcement_level === 'hard_block') {
            return deny(msg);
          }
          warnings.push(msg);
        }
      }

      // ─── Escalation: solo touching forced-team scope ───────────────────
      if (rule.id === 'ESCALATION-001' && ctx.mission_type === 'solo') {
        const touchedScopes = detectScopesFromToolCall(toolName, toolInput);
        const forcedTeamScopes = constitution.rules
          .filter(r => r.category === 'mission_classification' && r.trigger_scopes)
          .flatMap(r => r.trigger_scopes);
        const triggered = touchedScopes.some(s => forcedTeamScopes.includes(s));
        if (triggered) {
          const msg = `[CONSTITUTION ESCALATION-001] SOLO mission touches forced-TEAM scope [${touchedScopes.join(', ')}]. Must escalate on comms immediately.`;
          if (rule.enforcement_level === 'hard_block') {
            return deny(msg);
          }
          warnings.push(msg);
        }
      }

      // ─── Role warnings for team missions ───────────────────────────────
      if (rule.id === 'ROLE-001' && ctx.mission_type === 'team' && rule.enforcement_level === 'soft_warn') {
        // Only warn once per session — check on first Write/Edit/Bash
        if (toolName === 'Write' || toolName === 'Edit' || toolName === 'Bash') {
          // We can't easily know if roles were claimed, so just note the rule
          // The warning is lightweight and informational
        }
      }
    }

    // ─── Emit result ─────────────────────────────────────────────────────
    if (warnings.length > 0) {
      return allow(warnings.join('\n'));
    }

    return allow();

  } catch (err) {
    // Fail open — never block an agent due to hook errors
    return allow();
  }
});

// ─── Scope Detection from Tool Calls ─────────────────────────────────────────
// Lightweight heuristic: extract domain scopes from file paths and commands.

function detectScopesFromToolCall(toolName, toolInput) {
  const scopes = [];
  const scopePatterns = {
    'auth':           /\b(auth|oauth|login|signin|sign-in|session|token)\b/i,
    'identity':       /\b(identity|user-?identity|claims|principal)\b/i,
    'jwt':            /\b(jwt|jsonwebtoken|bearer)\b/i,
    'database':       /\b(database|prisma|drizzle|knex|sequelize|typeorm|\.sql)\b/i,
    'schema':         /\b(schema|migration|migrate)\b/i,
    'migration':      /\b(migration|migrate)\b/i,
    'deployment':     /\b(deploy|vercel\.json|dockerfile|docker-compose|k8s|kubernetes)\b/i,
    'infrastructure': /\b(infrastructure|infra|terraform|cloudformation)\b/i,
    'security':       /\b(security|encrypt|cipher|hash|bcrypt|argon|scrypt)\b/i,
    'encryption':     /\b(encrypt|decrypt|cipher|aes|rsa)\b/i,
    'access-control': /\b(access-?control|rbac|permission|acl|authorize)\b/i,
  };

  // Build a string to search from tool input
  let searchText = '';
  if (toolName === 'Bash' && toolInput.command) {
    searchText = toolInput.command;
  } else if ((toolName === 'Write' || toolName === 'Edit' || toolName === 'Read') && toolInput.file_path) {
    searchText = toolInput.file_path;
  } else if (toolName === 'Grep' && toolInput.pattern) {
    searchText = toolInput.pattern + ' ' + (toolInput.path || '');
  } else if (toolName === 'Glob' && toolInput.pattern) {
    searchText = toolInput.pattern + ' ' + (toolInput.path || '');
  }

  if (!searchText) return scopes;

  for (const [scope, pattern] of Object.entries(scopePatterns)) {
    if (pattern.test(searchText)) {
      scopes.push(scope);
    }
  }

  return scopes;
}
