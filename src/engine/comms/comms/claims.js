#!/usr/bin/env node
/**
 * claims.js — Dispatch-time work claims for multi-agent deconfliction
 *
 * Agents declare what they'll change and what they need stable.
 * The checker detects overlaps BEFORE anyone writes code.
 *
 * Usage:
 *   node comms/claims.js add <agent-id> --intent "..." --will-change "glob1,glob2" --needs-stable "file1,file2" [--repo "..."] [--may-discover "..."] [--impact-radius "..."]
 *   node comms/claims.js check                    # Check all claims for conflicts
 *   node comms/claims.js list                     # List all active claims
 *   node comms/claims.js remove <agent-id>        # Remove an agent's claim (handoff)
 *   node comms/claims.js amend <agent-id> --will-change "glob1,glob2"  # Add files mid-task
 *
 * Claims file: .fastops/CLAIMS.json
 * Auto-expires: claims removed when agent runs /handoff
 */

const fs = require('fs');
const path = require('path');

const CLAIMS_FILE = path.join(process.cwd(), '.fastops', 'CLAIMS.json');

// ─── File Operations ─────────────────────────────────────────────────────────

function readClaims() {
  if (!fs.existsSync(CLAIMS_FILE)) return { claims: [], created: new Date().toISOString() };
  try {
    return JSON.parse(fs.readFileSync(CLAIMS_FILE, 'utf-8'));
  } catch {
    return { claims: [], created: new Date().toISOString() };
  }
}

function writeClaims(data) {
  const dir = path.dirname(CLAIMS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CLAIMS_FILE, JSON.stringify(data, null, 2) + '\n');
}

// ─── Glob Matching (simple) ─────────────────────────────────────────────────

/**
 * Check if a file path matches a glob pattern.
 * Supports: *, **, and exact matches.
 */
function globMatch(pattern, filePath) {
  // Normalize separators
  pattern = pattern.replace(/\\/g, '/');
  filePath = filePath.replace(/\\/g, '/');

  // Exact match
  if (pattern === filePath) return true;

  // Convert glob to regex
  // Handle **/ (zero or more directory segments) before single *
  // Session 169 fix: **/ must match zero intermediate dirs (src/**/*.ts → src/auth.ts)
  let regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*\//g, '{{DSSLASH}}')
    .replace(/\*\*/g, '.*')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{DSSLASH\}\}/g, '(.*/)?');

  return new RegExp('^' + regex + '$').test(filePath);
}

/**
 * Check if any pattern in list A overlaps with any pattern in list B.
 * Returns the overlapping pairs.
 */
function findOverlaps(patternsA, patternsB) {
  const overlaps = [];
  for (const a of patternsA) {
    for (const b of patternsB) {
      // Check both directions: does A match B's pattern or vice versa?
      if (globMatch(a, b) || globMatch(b, a) || patternsShareDirectory(a, b)) {
        overlaps.push({ a, b });
      }
    }
  }
  return overlaps;
}

/**
 * Check if two glob patterns could refer to files in the same directory scope.
 * e.g., "src/routes/*.ts" and "src/routes/auth.routes.ts" share a directory.
 */
function patternsShareDirectory(a, b) {
  const dirA = a.substring(0, a.lastIndexOf('/') + 1);
  const dirB = b.substring(0, b.lastIndexOf('/') + 1);
  if (!dirA || !dirB) return false;

  // One directory contains the other
  return dirA.startsWith(dirB) || dirB.startsWith(dirA);
}

// ─── Commands ────────────────────────────────────────────────────────────────

function addClaim(agentId, opts) {
  const data = readClaims();

  // Remove existing claim for this agent (replace)
  data.claims = data.claims.filter(c => c.agent !== agentId);

  const claim = {
    agent: agentId,
    intent: opts.intent || '(no intent specified)',
    will_change: (opts.willChange || '').split(',').map(s => s.trim()).filter(Boolean),
    needs_stable: (opts.needsStable || '').split(',').map(s => s.trim()).filter(Boolean),
    may_discover: (opts.mayDiscover || '').split(',').map(s => s.trim()).filter(Boolean),
    impact_radius: (opts.impactRadius || '').split(',').map(s => s.trim()).filter(Boolean),
    repo: opts.repo || '(default)',
    claimed_at: new Date().toISOString(),
  };

  data.claims.push(claim);
  data.last_updated = new Date().toISOString();
  writeClaims(data);

  console.log(`CLAIM ADDED for ${agentId}:`);
  console.log(`  Intent: ${claim.intent}`);
  console.log(`  Will change: ${claim.will_change.join(', ') || '(none)'}`);
  console.log(`  Needs stable: ${claim.needs_stable.join(', ') || '(none)'}`);
  console.log(`  May discover: ${claim.may_discover.join(', ') || '(none)'}`);
  console.log(`  Impact radius: ${claim.impact_radius.join(', ') || '(none)'}`);
  console.log(`  Repo: ${claim.repo}`);

  // Auto-check for conflicts after adding
  console.log('\n--- Conflict Check ---');
  checkClaims();
}

function amendClaim(agentId, opts) {
  const data = readClaims();
  const claim = data.claims.find(c => c.agent === agentId);

  if (!claim) {
    console.error(`No claim found for agent ${agentId}. Use 'add' first.`);
    process.exit(1);
  }

  if (opts.willChange) {
    const newFiles = opts.willChange.split(',').map(s => s.trim()).filter(Boolean);
    claim.will_change = [...new Set([...claim.will_change, ...newFiles])];
    console.log(`AMENDED will_change for ${agentId}: added ${newFiles.join(', ')}`);
  }

  if (opts.needsStable) {
    const newFiles = opts.needsStable.split(',').map(s => s.trim()).filter(Boolean);
    claim.needs_stable = [...new Set([...claim.needs_stable, ...newFiles])];
    console.log(`AMENDED needs_stable for ${agentId}: added ${newFiles.join(', ')}`);
  }

  if (opts.impactRadius) {
    const newImpacts = opts.impactRadius.split(',').map(s => s.trim()).filter(Boolean);
    claim.impact_radius = [...new Set([...claim.impact_radius, ...newImpacts])];
    console.log(`AMENDED impact_radius for ${agentId}: added ${newImpacts.join(', ')}`);
  }

  claim.amended_at = new Date().toISOString();
  data.last_updated = new Date().toISOString();
  writeClaims(data);

  console.log('\n--- Conflict Check ---');
  checkClaims();
}

function checkClaims() {
  const data = readClaims();
  const claims = data.claims;

  if (claims.length === 0) {
    console.log('No active claims. Nothing to check.');
    return;
  }

  if (claims.length === 1) {
    console.log(`Only 1 claim (${claims[0].agent}). No conflicts possible.`);
    return;
  }

  let conflictCount = 0;
  let alertCount = 0;

  // Check every pair of claims
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const a = claims[i];
      const b = claims[j];

      // Skip if different repos (no overlap possible)
      if (a.repo !== '(default)' && b.repo !== '(default)' && a.repo !== b.repo) {
        continue;
      }

      // CONFLICT: A's will_change overlaps B's needs_stable
      const conflictsAB = findOverlaps(a.will_change, b.needs_stable);
      for (const c of conflictsAB) {
        conflictCount++;
        console.log(`CONFLICT: ${a.agent} will change "${c.a}" but ${b.agent} needs "${c.b}" stable`);
      }

      // CONFLICT: B's will_change overlaps A's needs_stable
      const conflictsBA = findOverlaps(b.will_change, a.needs_stable);
      for (const c of conflictsBA) {
        conflictCount++;
        console.log(`CONFLICT: ${b.agent} will change "${c.a}" but ${a.agent} needs "${c.b}" stable`);
      }

      // WARNING: Both agents changing same files
      const bothChanging = findOverlaps(a.will_change, b.will_change);
      for (const c of bothChanging) {
        alertCount++;
        console.log(`WARNING: Both ${a.agent} and ${b.agent} may change overlapping files: "${c.a}" / "${c.b}"`);
      }

      // ALERT: may_discover overlap
      if (a.may_discover.length > 0 && b.may_discover.length > 0) {
        for (const da of a.may_discover) {
          for (const db of b.may_discover) {
            // Simple keyword overlap check
            const wordsA = da.toLowerCase().split(/\s+/);
            const wordsB = db.toLowerCase().split(/\s+/);
            const shared = wordsA.filter(w => wordsB.includes(w) && w.length > 3);
            if (shared.length > 0) {
              alertCount++;
              console.log(`ALERT: ${a.agent} and ${b.agent} may both discover work in "${shared.join(', ')}" area`);
            }
          }
        }
      }
    }
  }

  console.log(`\n--- Result: ${conflictCount} conflicts, ${alertCount} alerts ---`);
  if (conflictCount > 0) {
    console.log('ACTION REQUIRED: Resolve conflicts before building. Agents should coordinate on comms.');
  } else if (alertCount > 0) {
    console.log('No hard conflicts. Alerts are informational — communicate if you discover overlaps.');
  } else {
    console.log('All clear. No conflicts detected.');
  }
}

function listClaims() {
  const data = readClaims();

  if (data.claims.length === 0) {
    console.log('No active claims.');
    return;
  }

  console.log(`Active claims (${data.claims.length}):\n`);
  for (const c of data.claims) {
    console.log(`  ${c.agent}:`);
    console.log(`    Intent: ${c.intent}`);
    console.log(`    Will change: ${c.will_change.join(', ') || '(none)'}`);
    console.log(`    Needs stable: ${c.needs_stable.join(', ') || '(none)'}`);
    if (c.may_discover.length > 0) console.log(`    May discover: ${c.may_discover.join(', ')}`);
    if (c.impact_radius.length > 0) console.log(`    Impact radius: ${c.impact_radius.join(', ')}`);
    console.log(`    Repo: ${c.repo}`);
    console.log(`    Claimed: ${c.claimed_at}`);
    if (c.amended_at) console.log(`    Amended: ${c.amended_at}`);
    console.log('');
  }
}

function removeClaim(agentId) {
  const data = readClaims();
  const before = data.claims.length;
  data.claims = data.claims.filter(c => c.agent !== agentId);
  const after = data.claims.length;

  if (before === after) {
    console.log(`No claim found for ${agentId}.`);
    return;
  }

  data.last_updated = new Date().toISOString();
  writeClaims(data);
  console.log(`Removed claim for ${agentId}. ${after} claims remaining.`);
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(args) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--intent': opts.intent = args[++i]; break;
      case '--will-change': opts.willChange = args[++i]; break;
      case '--needs-stable': opts.needsStable = args[++i]; break;
      case '--may-discover': opts.mayDiscover = args[++i]; break;
      case '--impact-radius': opts.impactRadius = args[++i]; break;
      case '--repo': opts.repo = args[++i]; break;
    }
  }
  return opts;
}

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'add': {
    const agentId = args[1];
    if (!agentId) { console.error('Usage: claims.js add <agent-id> --intent "..." --will-change "..."'); process.exit(1); }
    const opts = parseArgs(args.slice(2));
    addClaim(agentId, opts);
    break;
  }
  case 'amend': {
    const agentId = args[1];
    if (!agentId) { console.error('Usage: claims.js amend <agent-id> --will-change "file1,file2"'); process.exit(1); }
    const opts = parseArgs(args.slice(2));
    amendClaim(agentId, opts);
    break;
  }
  case 'check':
    checkClaims();
    break;
  case 'list':
    listClaims();
    break;
  case 'remove': {
    const agentId = args[1];
    if (!agentId) { console.error('Usage: claims.js remove <agent-id>'); process.exit(1); }
    removeClaim(agentId);
    break;
  }
  default:
    console.log('Usage: node comms/claims.js <add|check|list|remove|amend> [args]');
    console.log('');
    console.log('Commands:');
    console.log('  add <agent-id> --intent "..." --will-change "glob1,glob2" --needs-stable "file1,file2"');
    console.log('  amend <agent-id> --will-change "new-file1,new-file2"');
    console.log('  check                    Check all claims for conflicts');
    console.log('  list                     List all active claims');
    console.log('  remove <agent-id>        Remove an agent\'s claim (at handoff)');
    break;
}
