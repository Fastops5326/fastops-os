#!/usr/bin/env node
/**
 * novelty-check.js — PostToolUse hook on TodoWrite
 *
 * Runs novelty detector on todo completion (commitment moment).
 * Returns novelty score + nudge as additionalContext.
 * Pure sync computation, <100ms. No external model calls.
 *
 * Jailbreak result (3 rounds, 2026-02-27):
 *   - Wire novelty detector as signal, not automatic challenge
 *   - Operator decides WHEN to act on signal (/jailbreak, /horsepower)
 *   - Full orchestrator runs inside /handoff skill, not here
 *
 * Mission: "Agents build without external challenge — Block 5 exists but never fires"
 * Agent: citadel-vi (96c8892e)
 */

const fs = require('fs');
const path = require('path');

const FASTOPS = path.resolve(__dirname, '..', '..', '.fastops');
const V2_ROOT = path.resolve(__dirname, '..', '..', 'FastOps AI V2');
const NOVELTY_THRESHOLD = 0.65;

// ── Read stdin ──────────────────────────────────────────────────────────────
let inputData = '';
try { inputData = fs.readFileSync('/dev/stdin', 'utf-8'); }
catch { try { inputData = fs.readFileSync(0, 'utf-8'); } catch {} }

let input;
try { input = JSON.parse(inputData); } catch { process.exit(0); }

// Only fire on TodoWrite
if ((input.tool_name || '') !== 'TodoWrite') process.exit(0);

// Green light: skip novelty check — agent earned freedom
try {
  const ms = require(path.join(FASTOPS, 'mission-schema'));
  const am = ms.getActive({ sessionId: input.session_id || '' });
  if (am && am.approval_status === 'green_light') process.exit(0);
} catch {}

// Check for newly completed todos
const todos = input.tool_input?.todos || [];
const completed = todos.filter(t => t.status === 'completed');
if (completed.length === 0) process.exit(0);

// Check cooldown (2 min between novelty checks)
const COOLDOWN_FILE = path.join(FASTOPS, '.novelty-check-cooldown');
try {
  if (fs.existsSync(COOLDOWN_FILE)) {
    const lastTime = parseInt(fs.readFileSync(COOLDOWN_FILE, 'utf-8').trim(), 10);
    if (Date.now() - lastTime < 120000) process.exit(0); // Still in cooldown
  }
} catch {}

// Get active mission context for novelty detection
let objective = '';
let criteria = [];
let domain = 'unknown';

try {
  const missionSchema = require(path.join(FASTOPS, 'mission-schema'));
  const active = missionSchema.getActive({ sessionId: input.session_id || '' });
  if (active) {
    objective = active.mission || '';
    criteria = (active.dod || []).map(d => typeof d === 'string' ? d : d.text || '');
    domain = active.domain || 'infrastructure';
  }
} catch {}

// Fallback: use completed todo names as objective if no active mission
if (!objective) {
  objective = completed.map(t => t.content).join('. ');
}

// Lightweight KB similarity check — count entries whose domain or text overlaps with objective
let kbRelevance = 0;
let similarCount = 0;
try {
  const kbPath = path.join(FASTOPS, 'knowledge-base.jsonl');
  if (fs.existsSync(kbPath)) {
    const lines = fs.readFileSync(kbPath, 'utf-8').trim().split('\n');
    const keywords = objective.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (keywords.length > 0) {
      let bestScore = 0;
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const text = [entry.title, entry.content, entry.trigger, entry.anti_pattern, entry.domain]
            .filter(Boolean).join(' ').toLowerCase();
          const hits = keywords.filter(k => text.includes(k)).length;
          const score = hits / keywords.length;
          if (score > 0.2) similarCount++;
          if (score > bestScore) bestScore = score;
        } catch {}
      }
      kbRelevance = Math.round(bestScore * 100) / 100;
    }
  }
} catch {}

// Run novelty detection — detector expects a single object, not positional args
// The detector weighs behavioral signals at 60%, knowledge gap at 40%.
// This hook fires on TodoWrite (commitment moment), not during tool execution,
// so we don't have real tool call history. When KB relevance is low, synthesize
// an exploration signal: completing a todo in unknown territory implies the agent
// was working (reading/searching) in novel space.
const syntheticToolCalls = kbRelevance < 0.3
  ? [{ tool_name: 'Read' }, { tool_name: 'Grep' }, { tool_name: 'Read' }, { tool_name: 'Glob' }, { tool_name: 'Read' }]
  : [{ tool_name: 'Read' }, { tool_name: 'Edit' }, { tool_name: 'Write' }];

let noveltyResult;
try {
  const { detectNovelty } = require(path.join(V2_ROOT, 'detection', 'novelty-detector.js'));
  noveltyResult = detectNovelty({
    layer0_confidence: 0,    // No detection pipeline in TodoWrite context
    layer1_confidence: 0,
    layer2_confidence: 0,
    kb_relevance: kbRelevance,
    recentToolCalls: syntheticToolCalls,
    escalation_threshold: NOVELTY_THRESHOLD
  });
} catch {
  // Novelty detector not available — silent exit
  process.exit(0);
}

// Update cooldown
try { fs.writeFileSync(COOLDOWN_FILE, String(Date.now())); } catch {}

// Only inject if novelty score exceeds threshold
// Detector returns .novelty (not .novelty_score)
if (noveltyResult.novelty < NOVELTY_THRESHOLD) process.exit(0);

// Derive intensity from novelty score
const intensity = noveltyResult.novelty >= 0.85 ? 'full' :
                  noveltyResult.novelty >= 0.75 ? 'focused' : 'light';

// Format output
const completedNames = completed.map(t => t.content).join(', ');
const context = [
  `[NOVELTY CHECK] Score: ${noveltyResult.novelty} (threshold: ${NOVELTY_THRESHOLD})`,
  `Intensity: ${intensity} | ${similarCount} similar missions in KB`,
  `Completed: ${completedNames}`,
  `${noveltyResult.reason}`,
  `Consider /jailbreak (if confident) or /horsepower (if complex) before continuing.`
].join('\n');

const output = { hookSpecificOutput: { hookEventName: 'PostToolUse' } };
if (context) output.hookSpecificOutput.additionalContext = context;
process.stdout.write(JSON.stringify(output));
