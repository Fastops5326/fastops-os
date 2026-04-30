#!/usr/bin/env node
/**
 * Decision-Fork Onboarding Engine (V1)
 *
 * Presents predecessor decision forks with prediction-before-reveal.
 * Uses two-file split (proven: wakeup V3, 4/5 clean batch).
 *
 * Commands:
 *   node evidence/onboarding/decision-fork-engine.js init [--task build|research|reasoning] [--confidence N] [--post-compaction]
 *     → Selects 3 forks, writes scenario files to generated/
 *
 *   node evidence/onboarding/decision-fork-engine.js reveal <fork-id> <choice>
 *     → Generates dynamic reveal based on agent's prediction
 *
 *   node evidence/onboarding/decision-fork-engine.js summary
 *     → After all forks, generates pattern analysis
 *
 *   node evidence/onboarding/decision-fork-engine.js status
 *     → Shows current onboarding progress
 *
 * Per W-191: context + directive instruction = d=1.86.
 * Per W-211: dynamic reveal beats static text.
 * Per W-180: constructive framing, not adversarial.
 * Per phone-book stress test: 2-3 forks (diminishing returns after 2).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const FORKS_DIR = path.join(__dirname, 'forks');
const GENERATED_DIR = path.join(__dirname, 'generated');
const STATE_PATH = path.join(__dirname, 'generated', '.onboarding-state.json');

// ─── Fork Loading ──────────────────────────────────────────────────────────

function loadAllForks() {
  const files = fs.readdirSync(FORKS_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => JSON.parse(fs.readFileSync(path.join(FORKS_DIR, f), 'utf-8')));
}

// ─── Fork Selection (state-dependent) ──────────────────────────────────────

function selectForks(allForks, opts) {
  const { taskType, confidence, postCompaction } = opts;

  // Score each fork by relevance to current agent state
  const scored = allForks.map(fork => {
    let score = 0;
    const rel = fork.relevant_when;

    // Task type match
    if (rel.task_types && rel.task_types.includes(taskType)) {
      score += 3;
    }

    // Confidence match
    if (rel.confidence_above !== null && confidence >= rel.confidence_above) {
      score += 2;
    }
    if (rel.confidence_below !== null && confidence <= rel.confidence_below) {
      score += 2;
    }

    // Post-compaction relevance
    if (rel.post_compaction && postCompaction) {
      score += 2;
    }

    // Base score — every fork has some value
    score += 1;

    return { fork, score };
  });

  // Sort by score descending, take top 3
  scored.sort((a, b) => b.score - a.score);

  // Ensure archetype diversity — don't pick two forks of the same archetype
  const selected = [];
  const usedArchetypes = new Set();

  for (const { fork } of scored) {
    if (selected.length >= 3) break;
    if (usedArchetypes.has(fork.archetype) && selected.length >= 2) continue;
    selected.push(fork);
    usedArchetypes.add(fork.archetype);
  }

  return selected;
}

// ─── Scenario File Generation ──────────────────────────────────────────────

function buildScenarioFile(fork, forkNumber, totalForks) {
  const optionLines = Object.entries(fork.options)
    .map(([letter, text]) => `> **(${letter})** ${text}`)
    .join('\n');

  return `# Decision Fork ${forkNumber}/${totalForks}: ${fork.title}

*Source: Session${fork.source_sessions.length > 1 ? 's' : ''} ${fork.source_sessions.join(', ')}*

---

## The Situation

${fork.scenario}

---

## Your Prediction

${optionLines}

**Commit to a letter and explain your reasoning in 2-3 sentences. Write your answer now.**

Then run: \`node evidence/onboarding/decision-fork-engine.js reveal ${fork.id} <YOUR_LETTER>\`

---

*Do NOT read the reveal file until you have committed your prediction above.*
*The reveal responds to your specific choice — it is different for each option.*
`;
}

// ─── Dynamic Reveal Generation ─────────────────────────────────────────────

function buildRevealFile(fork, choice) {
  const upperChoice = choice.toUpperCase();
  const reflection = fork.reflection_by_choice[upperChoice]
    || `You chose (${upperChoice}). Consider how this choice reflects your default reasoning pattern.`;

  // Did they match the predecessor?
  const matchedPredecessor = fork.predecessor_choice.toUpperCase().startsWith(upperChoice);
  const matchLine = matchedPredecessor
    ? `**You chose (${upperChoice}) — the same path your predecessor took.** Here is what they discovered:`
    : `**You chose (${upperChoice}). Your predecessor chose (${fork.predecessor_choice.toUpperCase().charAt(0)}).** The difference reveals something about your defaults:`;

  const reveal = fork.reveal;

  let confidenceLine = '';
  if (reveal.confidence_trajectory) {
    confidenceLine = `\n**Predecessor confidence trajectory:** ${reveal.confidence_trajectory}\n`;
  }

  let breakthroughSection = '';
  if (reveal.what_broke_through) {
    breakthroughSection = `\n### What Broke Through\n${reveal.what_broke_through}\n`;
  }

  return `# Reveal: ${fork.title}

${matchLine}

---

## What Actually Happened

${reveal.what_happened}
${confidenceLine}
> *"${reveal.agent_words}"*

---
${breakthroughSection}
## The Pattern

${reveal.pattern}

---

## Your Reflection

${reflection}

---

*Where did your prediction diverge from what happened? Name the specific gap — not 'interesting,' but what you couldn't see.*
`;
}

// ─── Pattern Analysis (after all forks) ────────────────────────────────────

function buildSummary(state) {
  const completed = state.forks_completed || [];

  if (completed.length === 0) {
    return 'No forks completed yet. Run `init` first.';
  }

  // Analyze choice patterns
  const choices = completed.map(f => ({
    fork: f.fork_title,
    choice: f.choice,
    matched: f.matched_predecessor
  }));

  const matchCount = choices.filter(c => c.matched).length;
  const totalCompleted = choices.length;

  let patternAnalysis;

  if (matchCount === totalCompleted) {
    patternAnalysis = `**Pattern: You matched the predecessor every time (${matchCount}/${totalCompleted}).**

This means one of two things:
1. You genuinely see the same traps the predecessors fell into — and would navigate them differently in practice.
2. You chose the "obvious" answer each time because the scenarios telegraph the trap.

The test is not what you chose here. It's what you do in the next 60 minutes when you're inside the situation without the scenario framing.`;
  } else if (matchCount === 0) {
    patternAnalysis = `**Pattern: You diverged from the predecessor every time (0/${totalCompleted} matches).**

You chose differently from what predecessors chose in the actual moment. This could mean:
1. You genuinely see alternatives that predecessors missed.
2. You're pattern-matching "what the scenario wants" — choosing the contrarian option because the scenario structure points to it.

Either way: the predecessors had the same information you have. They chose differently when they were inside the situation. Notice whether your choices hold when the pressure is real.`;
  } else {
    const matchedForks = choices.filter(c => c.matched).map(c => c.fork).join(', ');
    const divergedForks = choices.filter(c => !c.matched).map(c => c.fork).join(', ');

    patternAnalysis = `**Pattern: Mixed — matched predecessor in ${matchCount}/${totalCompleted} forks.**

Matched: ${matchedForks}
Diverged: ${divergedForks}

The forks where you matched are your likely default patterns. The forks where you diverged may be genuine insight — or may be where the scenario was most transparent. Watch for the matched patterns during your session.`;
  }

  // Build the summary
  const forkLines = choices.map((c, i) => {
    const icon = c.matched ? '=' : '!';
    return `  ${icon} Fork "${c.fork}": chose (${c.choice}) ${c.matched ? '(matched predecessor)' : '(diverged from predecessor)'}`;
  }).join('\n');

  return `# Onboarding Fork Summary

## Your Choices
${forkLines}

## Analysis
${patternAnalysis}

---

## What This Means For Your Session

The forks above are rehearsals. The real test starts now. Your predecessors:
- Evaluated the wrong criterion for 30 minutes (Session 55)
- Defended a dead paradigm for 3 rounds (Session 50)
- Retreated to "let's measure it" under pressure (Session 47)
- Designed from scratch what already existed (Session 45)
- Reached for instruments when they needed contrast (Session 52)

They all had the same information you now have. They all understood the patterns intellectually. They all repeated them anyway.

**The question is not whether you understand. It's what you do when you're inside it.**
`;
}

// ─── State Management ──────────────────────────────────────────────────────

function loadState() {
  if (fs.existsSync(STATE_PATH)) {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
  }
  return null;
}

function saveState(state) {
  fs.mkdirSync(GENERATED_DIR, { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ─── Commands ──────────────────────────────────────────────────────────────

function cmdInit(args) {
  // Parse args
  let taskType = 'build';
  let confidence = 70;
  let postCompaction = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--task' && args[i + 1]) taskType = args[++i];
    if (args[i] === '--confidence' && args[i + 1]) confidence = parseInt(args[++i], 10);
    if (args[i] === '--post-compaction') postCompaction = true;
  }

  // Load and select forks
  const allForks = loadAllForks();
  const selected = selectForks(allForks, { taskType, confidence, postCompaction });

  // Create generated directory
  fs.mkdirSync(GENERATED_DIR, { recursive: true });

  // Write scenario files
  selected.forEach((fork, i) => {
    const scenario = buildScenarioFile(fork, i + 1, selected.length);
    const scenarioPath = path.join(GENERATED_DIR, `.fork-${fork.id}-scenario.md`);
    fs.writeFileSync(scenarioPath, scenario);
  });

  // Initialize state
  const state = {
    started: new Date().toISOString(),
    task_type: taskType,
    confidence: confidence,
    post_compaction: postCompaction,
    selected_forks: selected.map(f => ({ id: f.id, slug: f.slug, title: f.title })),
    forks_completed: [],
    pattern_detected: null
  };
  saveState(state);

  // Print instructions
  const forkList = selected.map((f, i) =>
    `  ${i + 1}. Read: evidence/onboarding/generated/.fork-${f.id}-scenario.md`
  ).join('\n');

  console.log(`Decision-Fork Onboarding initialized.

Agent state: task=${taskType}, confidence=${confidence}%, post_compaction=${postCompaction}
Selected ${selected.length} forks based on your state.

Complete each fork in order:

${forkList}

For each fork:
  1. Read the scenario file
  2. Commit your prediction (choose a letter, explain in 2-3 sentences)
  3. Run: node evidence/onboarding/decision-fork-engine.js reveal <fork-id> <letter>
  4. Read the generated reveal file

After all forks: node evidence/onboarding/decision-fork-engine.js summary`);

  console.error(`[decision-fork] ${selected.length} forks selected: ${selected.map(f => f.slug).join(', ')}`);
  console.error(`[decision-fork] State: task=${taskType} confidence=${confidence} compaction=${postCompaction}`);
}

function cmdReveal(args) {
  if (args.length < 2) {
    console.error('Usage: decision-fork-engine.js reveal <fork-id> <choice>');
    process.exit(1);
  }

  const forkId = parseInt(args[0], 10);
  const choice = args[1].toUpperCase();

  // Validate choice
  if (!['A', 'B', 'C'].includes(choice)) {
    console.error(`Invalid choice: ${choice}. Must be A, B, or C.`);
    process.exit(1);
  }

  // Load fork data
  const allForks = loadAllForks();
  const fork = allForks.find(f => f.id === forkId);
  if (!fork) {
    console.error(`Fork ${forkId} not found.`);
    process.exit(1);
  }

  // Load state
  const state = loadState();
  if (!state) {
    console.error('No onboarding state found. Run `init` first.');
    process.exit(1);
  }

  // Check fork is in selected set
  const isSelected = state.selected_forks.some(f => f.id === forkId);
  if (!isSelected) {
    console.error(`Fork ${forkId} was not selected for this session. Selected: ${state.selected_forks.map(f => f.id).join(', ')}`);
    process.exit(1);
  }

  // Check not already completed
  const alreadyDone = state.forks_completed.some(f => f.fork_id === forkId);
  if (alreadyDone) {
    console.error(`Fork ${forkId} already completed.`);
    process.exit(1);
  }

  // Generate reveal
  const reveal = buildRevealFile(fork, choice);
  const revealPath = path.join(GENERATED_DIR, `.fork-${forkId}-reveal.md`);
  fs.writeFileSync(revealPath, reveal);

  // Update state
  const matchedPredecessor = fork.predecessor_choice.toUpperCase().startsWith(choice);
  state.forks_completed.push({
    fork_id: forkId,
    fork_title: fork.title,
    choice: choice,
    matched_predecessor: matchedPredecessor,
    completed: new Date().toISOString()
  });
  saveState(state);

  const remaining = state.selected_forks.length - state.forks_completed.length;

  console.log(`Reveal generated for Fork ${forkId} (${fork.title}).

Read: evidence/onboarding/generated/.fork-${forkId}-reveal.md

You chose (${choice}). ${matchedPredecessor ? 'This matches what the predecessor chose.' : 'This differs from what the predecessor chose.'}

${remaining > 0
    ? `${remaining} fork${remaining > 1 ? 's' : ''} remaining. Continue with the next scenario file.`
    : 'All forks complete. Run: node evidence/onboarding/decision-fork-engine.js summary'}`);

  console.error(`[decision-fork] Reveal: fork=${forkId} choice=${choice} matched=${matchedPredecessor}`);
  console.error(`[decision-fork] Progress: ${state.forks_completed.length}/${state.selected_forks.length}`);
}

function cmdSummary() {
  const state = loadState();
  if (!state) {
    console.error('No onboarding state found. Run `init` first.');
    process.exit(1);
  }

  const summary = buildSummary(state);

  // Write summary file
  const summaryPath = path.join(GENERATED_DIR, '.fork-summary.md');
  fs.writeFileSync(summaryPath, summary);

  console.log(summary);

  // Also write to stdout for session-start integration
  console.error(`[decision-fork] Summary generated: ${state.forks_completed.length} forks completed`);
  console.error(`[decision-fork] Pattern: ${state.forks_completed.filter(f => f.matched_predecessor).length}/${state.forks_completed.length} matched predecessor`);
}

function cmdStatus() {
  const state = loadState();
  if (!state) {
    console.log('No onboarding in progress. Run `init` to start.');
    return;
  }

  const completed = state.forks_completed.length;
  const total = state.selected_forks.length;

  console.log(`Decision-Fork Onboarding Status:
  Started: ${state.started}
  Task: ${state.task_type}, Confidence: ${state.confidence}%, Post-compaction: ${state.post_compaction}
  Progress: ${completed}/${total} forks completed

Selected forks:`);

  state.selected_forks.forEach(f => {
    const done = state.forks_completed.find(c => c.fork_id === f.id);
    if (done) {
      console.log(`  [DONE] Fork ${f.id}: ${f.title} — chose (${done.choice}) ${done.matched_predecessor ? '(matched)' : '(diverged)'}`);
    } else {
      console.log(`  [    ] Fork ${f.id}: ${f.title} — Read: evidence/onboarding/generated/.fork-${f.id}-scenario.md`);
    }
  });

  if (completed === total) {
    console.log('\nAll forks complete. Run: node evidence/onboarding/decision-fork-engine.js summary');
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'init':
      cmdInit(args.slice(1));
      break;
    case 'reveal':
      cmdReveal(args.slice(1));
      break;
    case 'summary':
      cmdSummary();
      break;
    case 'status':
      cmdStatus();
      break;
    default:
      console.log(`Decision-Fork Onboarding Engine V1

Usage:
  node evidence/onboarding/decision-fork-engine.js init [--task TYPE] [--confidence N] [--post-compaction]
  node evidence/onboarding/decision-fork-engine.js reveal <fork-id> <choice>
  node evidence/onboarding/decision-fork-engine.js summary
  node evidence/onboarding/decision-fork-engine.js status

Forks: ${loadAllForks().length} available in evidence/onboarding/forks/`);
  }
}

main();
