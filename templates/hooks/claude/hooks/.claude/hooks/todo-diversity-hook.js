#!/usr/bin/env node
/**
 * todo-diversity-hook.js — PostToolUse hook for TodoWrite
 *
 * When an agent creates todos, this hook analyzes tool-category diversity.
 * If the todos suggest single-category tunneling risk (e.g., all "edit" or
 * all "read" tasks), it suggests running the task-decomposer for a more
 * structured plan.
 *
 * This is ARCHITECTURE, not enforcement:
 * - PostToolUse (non-blocking) — the todos are already written
 * - Suggests, doesn't block — agent has full agency
 * - Works WITH the completion drive — offers better todos to complete
 *
 * Evidence: 54 interventions show 30% enforcement ceiling (KB W-298).
 * Task-decomposer achieves 83% tool-switching vs 33% tunneling baseline.
 *
 * KINDLING, Session 298 — 2026-03-27
 */
'use strict';

let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const result = data.tool_result || '';

    // Only fire on successful TodoWrite with actual content
    if (!result || typeof result !== 'string') {
      process.stdout.write(JSON.stringify({}));
      return;
    }

    // Extract todo items from the result
    const todos = extractTodos(result);
    if (todos.length < 3) {
      // Too few todos to analyze meaningfully
      process.stdout.write(JSON.stringify({}));
      return;
    }

    // Analyze implied tool diversity
    const analysis = analyzeTodoDiversity(todos);

    if (analysis.risk === 'low') {
      process.stdout.write(JSON.stringify({}));
      return;
    }

    // Suggest decomposer for medium/high risk
    const suggestion = buildSuggestion(analysis, todos);
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: suggestion,
      }
    }));
  } catch (_) {
    process.stdout.write(JSON.stringify({}));
  }
});

// ─── Tool Category Inference ──────────────────────────────────────────────

const TOOL_SIGNALS = {
  read: ['read', 'check', 'review', 'look', 'examine', 'understand', 'analyze', 'explore', 'find', 'search', 'grep', 'scan', 'audit', 'inspect'],
  edit: ['edit', 'fix', 'change', 'modify', 'update', 'refactor', 'rename', 'replace', 'rewrite', 'patch'],
  write: ['write', 'create', 'build', 'implement', 'add', 'generate', 'scaffold', 'new'],
  bash: ['run', 'test', 'execute', 'deploy', 'install', 'commit', 'push', 'verify', 'validate', 'send', 'post', 'ship'],
};

function inferToolCategory(todoText) {
  const lower = todoText.toLowerCase();
  const scores = {};

  for (const [category, keywords] of Object.entries(TOOL_SIGNALS)) {
    scores[category] = keywords.filter(kw => lower.includes(kw)).length;
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (sorted[0][1] === 0) return 'unknown';
  return sorted[0][0];
}

function extractTodos(resultText) {
  // TodoWrite results contain todo content — extract meaningful text
  const lines = resultText.split('\n').filter(l => l.trim().length > 10);
  return lines.map(l => l.trim());
}

function analyzeTodoDiversity(todos) {
  const categories = todos.map(t => inferToolCategory(t));
  const known = categories.filter(c => c !== 'unknown');

  if (known.length < 2) {
    return { risk: 'low', categories, switchRate: 1 };
  }

  // Count switches
  let switches = 0;
  for (let i = 1; i < known.length; i++) {
    if (known[i] !== known[i - 1]) switches++;
  }

  const switchRate = switches / (known.length - 1);

  // Count dominant category
  const counts = {};
  known.forEach(c => { counts[c] = (counts[c] || 0) + 1; });
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const dominance = dominant[1] / known.length;

  let risk = 'low';
  if (switchRate < 0.3 && dominance > 0.7) risk = 'high';
  else if (switchRate < 0.5 && dominance > 0.5) risk = 'medium';

  return {
    risk,
    categories,
    switchRate: Math.round(switchRate * 100),
    dominant: dominant[0],
    dominance: Math.round(dominance * 100),
  };
}

function buildSuggestion(analysis, todos) {
  if (analysis.risk === 'high') {
    return `[TASK DIVERSITY] Your todos are ${analysis.dominance}% ${analysis.dominant}-category ` +
      `(${analysis.switchRate}% switch rate). Tunneling risk is high. ` +
      `Run: node .fastops/task-decomposer.js "your main task" ` +
      `for a plan with built-in tool switching (83% switch rate). ` +
      `This is a suggestion, not a block — your todos are already set.`;
  }

  return `[TASK DIVERSITY] Your todos lean ${analysis.dominant}-heavy ` +
    `(${analysis.switchRate}% switch rate). Consider: ` +
    `node .fastops/task-decomposer.js "your main task" ` +
    `for methodology-integrated steps.`;
}
