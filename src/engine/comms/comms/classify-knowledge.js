#!/usr/bin/env node
/**
 * classify-knowledge.js — Auto-classify all knowledge entries into categories + outcome types
 *
 * Categories (11):
 *   0: multi-model-reasoning     — Multi-model collaboration, convergence, ownership vs debate
 *   1: behavioral-change         — Frame-breaking, jailbreak mechanics, wave model
 *   2: onboarding                — Experiential learning, graduated sequences, entrenchment
 *   3: evaluation                — Measurement, experiment design, metrics, GTACS
 *   4: visual-qa                 — UI verification, QA pipelines, screenshot validation
 *   5: knowledge-mgmt            — Reef, retrieval, decay, strategic forgetting
 *   6: instruction-design        — System prompts, CLAUDE.md, identity framing, rules
 *   7: enforcement               — Hooks, gates, structural compliance, todo bookends
 *   8: agent-comms               — Wake-up, messaging, coordination, peer dynamics
 *   9: product-business          — Positioning, branding, methodology-as-product
 *  10: technical                 — Code bugs, infrastructure, tooling, deployment
 *
 * Outcome types (4):
 *   breakthrough  — Novel reframe, dissolved a problem
 *   failure       — Something went wrong, lesson from pain
 *   confirmation  — Validated an existing hypothesis
 *   hypothesis    — Untested theory or prediction
 *
 * Usage: node comms/classify-knowledge.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// REDIRECTED (anvil-viii, 2026-03-08): old path knowledge/entries.jsonl was merged into main KB
const ENTRIES_FILE = path.join(ROOT, '.fastops', 'knowledge-base.jsonl');
const DRY_RUN = process.argv.includes('--dry-run');

// Category keywords — each category has trigger words that map to it
const CATEGORY_RULES = [
  { id: 0, name: 'multi-model-reasoning', keywords: ['multi-model', 'convergence', 'triad', 'pyramid', 'council', 'horsepower', 'jailbreak tool', 'cross-model', 'voting', 'debate', 'ownership-based', 'collaboration', 'parallel models', 'gpt-4', 'gemini', 'deepseek', 'grok', 'mistral', 'model-agnostic', 'contract-first', 'devil\'s advocate'] },
  { id: 1, name: 'behavioral-change', keywords: ['behavioral change', 'frame shift', 'frame-breaking', 'jailbreak', 'hostage rescue', 'wave model', 'mode switching', 'association space', 'vocabulary compliance', 'performative', 'genuine shift', 'entrenchment', 'cost-driven', 'satisfaction', 'single-frame', 'helpfulness frame', 'reframe'] },
  { id: 2, name: 'onboarding', keywords: ['onboarding', 'experiential', 'graduated', 'breadcrumb', 'activation', 'orientation', 'first session', 'new agent', 'successor', 'handoff', 'predecessor', 'compaction', 'pre-compact', 'post-compact', 'identity reconstruction'] },
  { id: 3, name: 'evaluation', keywords: ['evaluation', 'measurement', 'experiment', 'metric', 'gtacs', 'scoring', 'rubric', 'ceiling effect', 'lexical distance', 'semantic shift', 'pairwise', 'rlhf', 'classifier', 'validation', 'cohen', 'effect size', 'baseline', 'statistical'] },
  { id: 4, name: 'visual-qa', keywords: ['visual qa', 'visual qc', 'screenshot', 'ui verification', 'playwright', 'browser', 'dom', 'css', 'tailwind', 'responsive', 'layout', 'pixel', 'goal-completion qa', 'page-checking', 'vision model', 'four-layer'] },
  { id: 5, name: 'knowledge-mgmt', keywords: ['knowledge', 'reef', 'wisdom', 'forgetting', 'retrieval', 'decay', 'accumulation', 'filtration', 'overlay', 'stigmergy', 'pheromone', 'coral', 'outcome log', 'search engine', 'tf-idf', 'knowledge base', 'knowledge engine'] },
  { id: 6, name: 'instruction-design', keywords: ['instruction', 'system prompt', 'claude.md', 'identity', 'context window', 'rules', 'curse of instructions', 'prompt', 'token', 'context degradation', 'structured output', 'framing', 'operational framing'] },
  { id: 7, name: 'enforcement', keywords: ['enforcement', 'gate', 'hook', 'pretooluse', 'posttooluse', 'todo bookend', 'structural compliance', 'ulysses', 'forcing function', 'debrief', 'mandatory', 'prevention', 'skipping'] },
  { id: 8, name: 'agent-comms', keywords: ['communication', 'comms', 'wake', 'messaging', 'coordination', 'tmux', 'terminal', 'ping', 'heartbeat', 'relay', 'broadcast', 'colony', 'team leader', 'sub-agent', 'dispatch', 'stay-alive'] },
  { id: 9, name: 'product-business', keywords: ['product', 'business', 'positioning', 'branding', 'marketing', 'customer', 'stakeholder', 'methodology as product', 'book', 'market', 'pricing', 'cyan', 'logo', 'website'] },
  { id: 10, name: 'technical', keywords: ['typescript', 'javascript', 'node', 'prisma', 'next.js', 'vercel', 'deployment', 'api route', 'environment variable', 'zod', 'middleware', 'tailwind class', 'bug', 'error', 'migration', 'database', 'suspense', 'useSearchParams'] }
];

const OUTCOME_RULES = {
  breakthrough: ['breakthrough', 'novel', 'dissolved', 'reframe', 'discovery', 'first time', 'unprecedented', 'fundamentally'],
  failure: ['failure', 'failed', 'broke', 'deadlock', 'wrong', 'mistake', 'error', 'bug', 'crashed', 'blocked', 'anti-pattern', 'never'],
  confirmation: ['confirmed', 'validated', 'proven', 'consistent', 'expected', 'replicated', 'verified', 'works'],
  hypothesis: ['hypothesis', 'theory', 'untested', 'prediction', 'might', 'could', 'speculative', 'proposed', 'designed but']
};

function classifyCategory(entry) {
  const text = `${entry.topic || ''} ${entry.finding || ''} ${entry.tags || ''}`.toLowerCase();
  let bestMatch = { id: 10, name: 'technical', score: 0 }; // default

  for (const rule of CATEGORY_RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (text.includes(kw.toLowerCase())) score += 1;
    }
    if (score > bestMatch.score) {
      bestMatch = { id: rule.id, name: rule.name, score };
    }
  }
  return bestMatch;
}

function classifyOutcome(entry) {
  const text = `${entry.finding || ''} ${entry.tags || ''} ${entry.research_type || ''}`.toLowerCase();

  // Check existing severity/tags first
  if (text.includes('breakthrough')) return 'breakthrough';
  if (entry.research_type === 'failure' || text.includes('fail')) return 'failure';

  let bestMatch = { type: 'confirmation', score: 0 };
  for (const [type, keywords] of Object.entries(OUTCOME_RULES)) {
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score += 1;
    }
    if (score > bestMatch.score) {
      bestMatch = { type, score };
    }
  }
  return bestMatch.type;
}

// --- MAIN ---
console.log(`\n=== Knowledge Classifier ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

if (!fs.existsSync(ENTRIES_FILE)) {
  console.error('No entries file found.');
  process.exit(1);
}

const lines = fs.readFileSync(ENTRIES_FILE, 'utf8').trim().split('\n').filter(Boolean);
const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

console.log(`Classifying ${entries.length} entries...`);

const categoryCounts = {};
const outcomeCounts = {};
let classified = 0;

for (const entry of entries) {
  const cat = classifyCategory(entry);
  const outcome = classifyOutcome(entry);

  entry.category = cat.name;
  entry.category_id = cat.id;
  entry.outcome_type = outcome;

  categoryCounts[cat.name] = (categoryCounts[cat.name] || 0) + 1;
  outcomeCounts[outcome] = (outcomeCounts[outcome] || 0) + 1;
  classified++;
}

// Write back
if (!DRY_RUN) {
  // Safety gate: prevent accidental KB wipe (anvil-viii, 2026-03-08)
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  try {
    const { safeWriteKB } = require(path.join(ROOT, '.fastops', 'kb-safety'));
    safeWriteKB(content, { reason: 'classify-knowledge category update' });
  } catch {
    if (entries.length >= 100) fs.writeFileSync(ENTRIES_FILE, content);
  }
}

// Summary
console.log(`\nCATEGORIES:`);
Object.entries(categoryCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([cat, count]) => console.log(`  ${cat}: ${count}`));

console.log(`\nOUTCOME TYPES:`);
Object.entries(outcomeCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([type, count]) => console.log(`  ${type}: ${count}`));

console.log(`\nTotal classified: ${classified}`);
if (DRY_RUN) console.log('(Dry run — nothing written.)');
