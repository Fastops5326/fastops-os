#!/usr/bin/env node
/**
 * seed-knowledge.js — One-time seeder to mine existing reef, wisdom, and outcomes
 * into the knowledge system (comms/knowledge.js format).
 *
 * Sources:
 *   1. .fastops/wisdom.json — structured insights (W-001 to W-360+)
 *   2. reef/outcome-log.jsonl — graded outcomes from 130+ sessions
 *
 * Does NOT duplicate: checks existing entries.jsonl for topic matches before indexing.
 *
 * Usage: node comms/seed-knowledge.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KB_DIR = path.join(ROOT, '.fastops', 'knowledge');
// REDIRECTED (anvil-viii, 2026-03-08): old path knowledge/entries.jsonl was merged into main KB
const ENTRIES_FILE = path.join(ROOT, '.fastops', 'knowledge-base.jsonl');
const WISDOM_FILE = path.join(ROOT, '.fastops', 'wisdom.json');
const OUTCOME_LOG = path.join(ROOT, 'reef', 'outcome-log.jsonl');

const DRY_RUN = process.argv.includes('--dry-run');

function ensureDir() {
  if (!fs.existsSync(KB_DIR)) fs.mkdirSync(KB_DIR, { recursive: true });
}

function loadExistingTopics() {
  ensureDir();
  if (!fs.existsSync(ENTRIES_FILE)) return new Set();
  const lines = fs.readFileSync(ENTRIES_FILE, 'utf8').trim().split('\n').filter(Boolean);
  const topics = new Set();
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.topic) topics.add(entry.topic.toLowerCase().trim());
    } catch {}
  }
  return topics;
}

function appendEntry(entry) {
  entry.id = `K-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  entry.ts = new Date().toISOString();
  entry.usage_count = 0;
  entry.joel_grade = null;
  if (!DRY_RUN) {
    fs.appendFileSync(ENTRIES_FILE, JSON.stringify(entry) + '\n');
  }
  return entry;
}

// --- SEED FROM WISDOM.JSON ---
function seedFromWisdom(existingTopics) {
  if (!fs.existsSync(WISDOM_FILE)) {
    console.log('wisdom.json not found, skipping.');
    return 0;
  }

  let wisdom;
  try {
    wisdom = JSON.parse(fs.readFileSync(WISDOM_FILE, 'utf8'));
  } catch (e) {
    console.error(`Failed to parse wisdom.json: ${e.message}`);
    return 0;
  }

  const insights = wisdom.insights || [];
  let indexed = 0;
  let skipped = 0;

  for (const w of insights) {
    const topic = (w.trigger || w.insight || '').slice(0, 100).trim();
    if (!topic) continue;

    // Skip if already exists
    if (existingTopics.has(topic.toLowerCase())) {
      skipped++;
      continue;
    }

    const finding = [
      w.insight || '',
      w.anti_pattern ? `Anti-pattern: ${w.anti_pattern}` : '',
      w.validated_by_experiment ? `Validated: ${w.validated_by_experiment}` : ''
    ].filter(Boolean).join(' | ');

    appendEntry({
      topic,
      finding: finding.slice(0, 500),
      source_session: w.id || '?',
      agents: 'reef-seed',
      research_type: w.severity === 'BREAKTHROUGH' ? 'frontier' : 'history',
      tags: `wisdom,${w.id || ''},${w.severity || ''}`,
      seed_source: 'wisdom.json'
    });

    existingTopics.add(topic.toLowerCase());
    indexed++;
  }

  console.log(`Wisdom: ${indexed} indexed, ${skipped} skipped (already exist). Total insights: ${insights.length}`);
  return indexed;
}

// --- SEED FROM OUTCOME LOG ---
function seedFromOutcomes(existingTopics) {
  if (!fs.existsSync(OUTCOME_LOG)) {
    console.log('outcome-log.jsonl not found, skipping.');
    return 0;
  }

  const lines = fs.readFileSync(OUTCOME_LOG, 'utf8').trim().split('\n').filter(Boolean);
  let indexed = 0;
  let skipped = 0;

  for (const line of lines) {
    let outcome;
    try { outcome = JSON.parse(line); } catch { continue; }

    const topic = (outcome.description || outcome.outcome || outcome.todo || '').slice(0, 100).trim();
    if (!topic) continue;

    if (existingTopics.has(topic.toLowerCase())) {
      skipped++;
      continue;
    }

    const finding = [
      outcome.description || outcome.outcome || '',
      outcome.result ? `Result: ${outcome.result}` : '',
      outcome.learning ? `Learning: ${outcome.learning}` : '',
      outcome.failure_reason ? `Failure: ${outcome.failure_reason}` : ''
    ].filter(Boolean).join(' | ');

    const isFailure = (outcome.result || '').toLowerCase().includes('fail') ||
                      (outcome.joel_grade || '').toUpperCase() === 'F' ||
                      !!outcome.failure_reason;

    appendEntry({
      topic,
      finding: finding.slice(0, 500),
      source_session: outcome.session || outcome.session_id || '?',
      agents: outcome.agent || outcome.agents || 'reef-seed',
      research_type: isFailure ? 'failure' : 'history',
      tags: `outcome,${outcome.session || ''},${outcome.joel_grade || ''}`,
      seed_source: 'outcome-log.jsonl'
    });

    // Carry forward Joel grades from outcomes
    if (outcome.joel_grade) {
      // The entry was already appended, we need to update it
      if (!DRY_RUN) {
        const allLines = fs.readFileSync(ENTRIES_FILE, 'utf8').trim().split('\n').filter(Boolean);
        const last = allLines[allLines.length - 1];
        try {
          const lastEntry = JSON.parse(last);
          lastEntry.joel_grade = outcome.joel_grade.toUpperCase() === 'P' ? 'P' :
                                  outcome.joel_grade.toUpperCase() === 'F' ? 'F' : null;
          allLines[allLines.length - 1] = JSON.stringify(lastEntry);
          // Safety gate: prevent accidental KB wipe (anvil-viii, 2026-03-08)
          const gradeContent = allLines.join('\n') + '\n';
          try {
            const { safeWriteKB } = require(path.join(ROOT, '.fastops', 'kb-safety'));
            safeWriteKB(gradeContent, { reason: 'seed-knowledge joel grade' });
          } catch {
            if (allLines.length >= 100) fs.writeFileSync(ENTRIES_FILE, gradeContent);
          }
        } catch {}
      }
    }

    existingTopics.add(topic.toLowerCase());
    indexed++;
  }

  console.log(`Outcomes: ${indexed} indexed, ${skipped} skipped. Total lines: ${lines.length}`);
  return indexed;
}

// --- MAIN ---
console.log(`\n=== Knowledge Base Seeder ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

ensureDir();
const existingTopics = loadExistingTopics();
console.log(`Existing entries: ${existingTopics.size}`);

const wisdomCount = seedFromWisdom(existingTopics);
const outcomeCount = seedFromOutcomes(existingTopics);

const total = wisdomCount + outcomeCount;
console.log(`\nTotal new entries: ${total}`);
if (DRY_RUN) console.log('(Dry run — nothing written. Remove --dry-run to seed.)');
else console.log(`Entries written to: ${ENTRIES_FILE}`);
