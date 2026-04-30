#!/usr/bin/env node
/**
 * Knowledge System — The FastOps Product
 *
 * This is the core product: compounding knowledge over time.
 * Warrior Path, the website, etc. are test cases. This is the methodology.
 *
 * Commands:
 *   node comms/knowledge.js research <topic>    — Spawn 5 sub-agents to mine KB
 *   node comms/knowledge.js scorecard           — Generate scorecard for current todo
 *   node comms/knowledge.js grade <id> <P|F>    — Joel grades a scorecard (1 keystroke)
 *   node comms/knowledge.js index <topic> <finding> — Index a new knowledge entry
 *   node comms/knowledge.js search <query>      — Search indexed knowledge (weighted)
 *   node comms/knowledge.js sync                — Push knowledge entries to Monday.com
 *   node comms/knowledge.js dashboard           — Show knowledge health metrics
 *
 * Storage:
 *   .fastops/knowledge/entries.jsonl     — All knowledge entries (append-only)
 *   .fastops/knowledge/scorecards.jsonl  — All scorecards (append-only)
 *   .fastops/knowledge/usage.jsonl       — Search/access log for weighting
 *
 * Origin: Session 141 — Joel's directive: "compounding knowledge IS the product"
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const KB_DIR = path.join(ROOT, '.fastops', 'knowledge');
// REDIRECTED (anvil-vii, 2026-03-08): All reads/writes now target the main KB store.
// The old store at knowledge/entries.jsonl was invisible to kb-query.js and all search tools.
// W4-KM-11 identified the split; anvil-vii merged 220 entries and redirected writes.
const ENTRIES_FILE = path.join(ROOT, '.fastops', 'knowledge-base.jsonl');
// Safety gate: prevents accidental KB wipe (anvil-vii, 2026-03-08)
const { safeWriteKB } = require(path.join(ROOT, '.fastops', 'kb-safety'));
const SCORECARDS_FILE = path.join(KB_DIR, 'scorecards.jsonl');
const USAGE_FILE = path.join(KB_DIR, 'usage.jsonl');
const REEF_SEARCH = path.join(ROOT, 'reef', 'search.js');
const WISDOM_FILE = path.join(ROOT, '.fastops', 'wisdom.json');
const OUTCOME_LOG = path.join(ROOT, 'reef', 'outcome-log.jsonl');
const ACTIVE_AGENT_FILE = path.join(ROOT, 'comms', 'data', '.active-agent');
const ROSTER_FILE = path.join(ROOT, 'comms', 'data', 'roster.json');

function ensureDir() {
  if (!fs.existsSync(KB_DIR)) fs.mkdirSync(KB_DIR, { recursive: true });
}

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  const vars = {};
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const match = line.match(/^([^#=]+)=\s*(.*)$/);
      if (match) vars[match[1].trim()] = match[2].trim();
    });
  }
  return vars;
}

function getAgentName() {
  try {
    const id = fs.readFileSync(ACTIVE_AGENT_FILE, 'utf8').trim();
    if (fs.existsSync(ROSTER_FILE)) {
      const roster = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8'));
      const agents = roster.agents || roster;
      if (agents[id]) return agents[id].name || id;
    }
    return id;
  } catch { return 'unknown'; }
}

function mondayAPI(query) {
  const env = loadEnv();
  if (!env.MONDAY_API_KEY || !env.MONDAY_BOARD_ID) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const options = {
      hostname: 'api.monday.com',
      path: '/v2',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': env.MONDAY_API_KEY,
        'API-Version': '2024-10'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.errors) reject(new Error(parsed.errors.map(e => e.message).join('; ')));
          else resolve(parsed.data);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// --- ENTRIES ---

function appendEntry(entry) {
  ensureDir();
  // Content-length gate (anvil-vii, 2026-03-08): prevent ghost entries.
  // W4-KM-9 found 376 entries with empty content scored 5/5 because grading
  // tools checked metadata, not content. Refuse to write entries without substance.
  const contentText = (entry.finding || entry.content || '').trim();
  if (contentText.length < 20) {
    console.error(`Rejected: entry content too short (${contentText.length} chars). Minimum 20 chars required.`);
    console.error('This prevents ghost entries that pollute KB search results.');
    return null;
  }
  const now = new Date().toISOString();
  // Write in main KB schema (anvil-vii, 2026-03-08)
  // Dual-field: keep finding/topic for backward compat, add content/title for kb-query.js
  entry.id = `K-${Date.now()}-${Math.random().toString(36).substring(2,6)}`;
  entry.ts = now;
  entry.created_at = now;
  entry.updated_at = now;
  entry.usage_count = 0;
  entry.joel_grade = null;
  // Map to main KB schema fields that kb-query.js reads
  entry.title = entry.topic || '';
  entry.content = entry.finding || '';
  entry.trigger = entry.trigger || '';
  entry.type = entry.type || 'principle';
  entry.domain = entry.domain || inferDomainFromCategory(entry.category);
  entry.integrity_score = 0.3;
  entry.version = 1;
  entry.source = {
    session_id: entry.source_session || 'unknown',
    agent_name: entry.agents || getAgentName(),
    method: 'manual_index'
  };
  fs.appendFileSync(ENTRIES_FILE, JSON.stringify(entry) + '\n');
  return entry;
}

function inferDomainFromCategory(category) {
  const map = {
    'multi-model-reasoning': 'meeting-collab',
    'behavioral-change': 'agent-behavior',
    'onboarding': 'succession-handoff',
    'evaluation': 'build-quality',
    'visual-qa': 'build-quality',
    'knowledge-mgmt': 'knowledge-search',
    'instruction-design': 'agent-behavior',
    'enforcement': 'agent-behavior',
    'agent-comms': 'meeting-collab',
    'product-business': 'build-quality',
    'technical': 'build-quality'
  };
  return map[category] || 'build-quality';
}

function loadEntries() {
  ensureDir();
  if (!fs.existsSync(ENTRIES_FILE)) return [];
  return fs.readFileSync(ENTRIES_FILE, 'utf8').trim().split('\n')
    .filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean)
    .map(entry => {
      // Normalize schema: main KB uses content/title, old store used finding/topic
      if (!entry.topic && entry.title) entry.topic = entry.title;
      if (!entry.finding && entry.content) entry.finding = entry.content;
      if (!entry.title && entry.topic) entry.title = entry.topic;
      if (!entry.content && entry.finding) entry.content = entry.finding;
      return entry;
    });
}

// --- SCORECARDS ---

function appendScorecard(sc) {
  ensureDir();
  sc.id = `SC-${Date.now()}`;
  sc.ts = new Date().toISOString();
  sc.joel_grade = null;
  fs.appendFileSync(SCORECARDS_FILE, JSON.stringify(sc) + '\n');
  return sc;
}

function loadScorecards() {
  ensureDir();
  if (!fs.existsSync(SCORECARDS_FILE)) return [];
  return fs.readFileSync(SCORECARDS_FILE, 'utf8').trim().split('\n')
    .filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

// --- USAGE TRACKING ---

function logUsage(query, resultsCount, agent) {
  ensureDir();
  const entry = {
    ts: new Date().toISOString(),
    query,
    results_count: resultsCount,
    agent
  };
  fs.appendFileSync(USAGE_FILE, JSON.stringify(entry) + '\n');
}

// --- COMMANDS ---

/**
 * SEARCH — weighted search across all knowledge entries
 * Weights: usage_count * 2 + recency_score + joel_grade_bonus
 */
function cmdSearch(query) {
  const entries = loadEntries();
  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/);

  // Score each entry
  const scored = entries.map(entry => {
    const text = `${entry.topic || ''} ${entry.finding || ''} ${entry.source_session || ''} ${entry.agents || ''} ${entry.tags || ''}`.toLowerCase();

    // Term matching
    let matchScore = 0;
    for (const term of queryTerms) {
      if (text.includes(term)) matchScore += 1;
    }
    if (matchScore === 0) return null;

    // Usage weight (most-used floats to top)
    const usageWeight = (entry.usage_count || 0) * 2;

    // Recency (entries from last 7 days get a boost)
    const ageMs = Date.now() - new Date(entry.ts).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const recencyScore = ageDays < 7 ? 3 : ageDays < 30 ? 1 : 0;

    // Joel grade bonus
    const gradeBonus = entry.joel_grade === 'P' ? 5 : entry.joel_grade === 'F' ? -3 : 0;

    const totalScore = matchScore + usageWeight + recencyScore + gradeBonus;

    return { entry, score: totalScore };
  }).filter(Boolean).sort((a, b) => b.score - a.score);

  // Log usage
  logUsage(query, scored.length, getAgentName());

  // Update usage counts for returned entries
  if (scored.length > 0) {
    const allEntries = loadEntries();
    const returnedIds = new Set(scored.slice(0, 10).map(s => s.entry.id));
    const updated = allEntries.map(e => {
      if (returnedIds.has(e.id)) e.usage_count = (e.usage_count || 0) + 1;
      return e;
    });
    ensureDir();
    safeWriteKB(updated.map(e => JSON.stringify(e)).join('\n') + '\n', { reason: 'search usage count update' });
  }

  // Display
  if (scored.length === 0) {
    console.log(`No knowledge entries found for "${query}".`);
    console.log('Consider running: node comms/knowledge.js research "' + query + '"');
    return;
  }

  console.log(`\n=== Knowledge Search: "${query}" (${scored.length} results) ===\n`);
  scored.slice(0, 10).forEach((s, i) => {
    const e = s.entry;
    const grade = e.joel_grade ? ` [Joel: ${e.joel_grade}]` : ' [ungraded]';
    const usage = e.usage_count > 0 ? ` (used ${e.usage_count}x)` : '';
    console.log(`${i + 1}. [${e.id}] ${e.topic}${grade}${usage}`);
    console.log(`   Source: Session ${e.source_session || '?'} | Agents: ${e.agents || '?'} | Type: ${e.research_type || '?'}`);
    console.log(`   ${(e.finding || '').slice(0, 200)}`);
    console.log();
  });
}

// Valid categories for knowledge entries
const VALID_CATEGORIES = [
  'multi-model-reasoning', 'behavioral-change', 'onboarding', 'evaluation',
  'visual-qa', 'knowledge-mgmt', 'instruction-design', 'enforcement',
  'agent-comms', 'product-business', 'technical'
];
const CATEGORY_INDEX = Object.fromEntries(VALID_CATEGORIES.map((c, i) => [c, i]));

const VALID_OUTCOMES = ['breakthrough', 'failure', 'confirmation', 'hypothesis'];

/**
 * INDEX — add a knowledge entry
 *
 * Joel's required fields (Session 141):
 *   --topic     = the problem/challenge being solved
 *   --finding   = one-sentence description of what was learned
 *   --source    = exact location (wisdom W-xxx, handoff session #, memory, file path)
 *   --applied   = what changed in the build because of this knowledge
 *   --category  = one of 11 categories (see VALID_CATEGORIES)
 *   --outcome   = breakthrough | failure | confirmation | hypothesis
 *   --session   = session number
 */
function cmdIndex(topic, finding, opts) {
  if (!topic || !finding) {
    console.error('Usage: node comms/knowledge.js index "problem/challenge" "what we learned" --source="W-123" --applied="changed X" --category="behavioral-change" --outcome="failure"');
    console.error('\nCategories: ' + VALID_CATEGORIES.join(', '));
    console.error('Outcomes: ' + VALID_OUTCOMES.join(', '));
    process.exit(1);
  }

  // Validate category
  const category = opts.category || 'technical';
  if (!VALID_CATEGORIES.includes(category)) {
    console.error(`Invalid category: "${category}". Must be one of: ${VALID_CATEGORIES.join(', ')}`);
    process.exit(1);
  }

  // Validate outcome
  const outcome = opts.outcome || 'confirmation';
  if (!VALID_OUTCOMES.includes(outcome)) {
    console.error(`Invalid outcome: "${outcome}". Must be one of: ${VALID_OUTCOMES.join(', ')}`);
    process.exit(1);
  }

  const entry = appendEntry({
    topic,
    finding,
    source_location: opts.source || '?',
    source_session: opts.session || '?',
    agents: opts.agents || getAgentName(),
    research_type: opts.type || 'history',
    models_used: opts.models || '',
    tags: opts.tags || '',
    problem: opts.problem || topic,
    solution: opts.applied || opts.solution || '',
    category,
    category_id: CATEGORY_INDEX[category],
    outcome_type: outcome
  });
  if (!entry) { process.exit(1); return; }
  console.log(`Indexed: ${entry.id}`);
  console.log(`  Problem: ${topic}`);
  console.log(`  Category: ${category} | Outcome: ${outcome}`);
  console.log(`  Source: ${entry.source_location}`);
  console.log(`  Learned: ${finding}`);
  console.log(`  Applied: ${entry.solution || 'not yet applied'}`);
  return entry;
}

/**
 * GRADE — Joel grades a scorecard or entry (P or F)
 */
function cmdGrade(id, grade) {
  const validGrade = grade.toUpperCase();
  if (validGrade !== 'P' && validGrade !== 'F') {
    console.error('Grade must be P (pass) or F (fail)');
    process.exit(1);
  }

  // Try scorecards first
  let found = false;
  if (id.startsWith('SC-')) {
    const scorecards = loadScorecards();
    const updated = scorecards.map(sc => {
      if (sc.id === id) { sc.joel_grade = validGrade; sc.graded_ts = new Date().toISOString(); found = true; }
      return sc;
    });
    if (found) {
      fs.writeFileSync(SCORECARDS_FILE, updated.map(s => JSON.stringify(s)).join('\n') + '\n');
      console.log(`Graded ${id}: ${validGrade === 'P' ? 'PASS' : 'FAIL'}`);

      // If PASS, upweight associated knowledge entries
      const sc = updated.find(s => s.id === id);
      if (sc && sc.knowledge_ids && validGrade === 'P') {
        const entries = loadEntries();
        const entryUpdated = entries.map(e => {
          if (sc.knowledge_ids.includes(e.id)) {
            e.joel_grade = 'P';
            e.usage_count = (e.usage_count || 0) + 3; // Big boost for Joel-approved
          }
          return e;
        });
        safeWriteKB(entryUpdated.map(e => JSON.stringify(e)).join('\n') + '\n', { reason: 'grade upweight' });
        console.log(`  → ${sc.knowledge_ids.length} knowledge entries upweighted`);
      }
      return;
    }
  }

  // Try knowledge entries
  if (id.startsWith('K-')) {
    const entries = loadEntries();
    const updated = entries.map(e => {
      if (e.id === id) { e.joel_grade = validGrade; e.graded_ts = new Date().toISOString(); found = true; }
      return e;
    });
    if (found) {
      safeWriteKB(updated.map(e => JSON.stringify(e)).join('\n') + '\n', { reason: 'grade entry ' + id });
      console.log(`Graded ${id}: ${validGrade === 'P' ? 'PASS' : 'FAIL'}`);
      return;
    }
  }

  console.error(`ID "${id}" not found in scorecards or entries.`);
  process.exit(1);
}

/**
 * SCORECARD — Generate a scorecard for current work
 * Called at todo completion. Shows Joel what research was done.
 *
 * Joel's format (Session 141):
 *   1. Problem/challenge being solved
 *   2. Source location of each finding (wisdom W-xxx, handoff session #, memory)
 *   3. One-sentence summary of what was learned at each location
 *   4. How knowledge was applied — what changed in the build because of it
 *   5. Monday.com sync status
 */
function cmdScorecard(todoDescription) {
  const agent = getAgentName();

  // --- Collect findings (entries indexed by this agent recently) ---
  const entries = loadEntries();
  const recentEntries = entries.filter(e =>
    e.agents && e.agents.includes(agent) &&
    (Date.now() - new Date(e.ts).getTime()) < 60 * 60 * 1000
  );

  // --- Collect search activity ---
  let recentSearches = [];
  if (fs.existsSync(USAGE_FILE)) {
    const lines = fs.readFileSync(USAGE_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const parsed = lines.slice(-30).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    recentSearches = parsed.filter(u => (Date.now() - new Date(u.ts).getTime()) < 60 * 60 * 1000);
  }

  // --- Collect external model engagement ---
  let modelsUsed = [];
  const engagementFile = path.join(ROOT, '.fastops', '.model-engagements.json');
  try {
    if (fs.existsSync(engagementFile)) {
      const eng = JSON.parse(fs.readFileSync(engagementFile, 'utf8'));
      modelsUsed = eng.models || [];
    }
  } catch {}

  // --- Monday.com sync status ---
  const syncedCount = entries.filter(e => e.monday_item_id).length;
  const unsyncedCount = entries.filter(e => !e.monday_item_id).length;

  // --- Score ---
  const hasFindings = recentEntries.length > 0;
  const hasSearches = recentSearches.length > 0;
  const hasFrontier = modelsUsed.length > 0;
  const score = [hasFindings, hasSearches, hasFrontier].filter(Boolean).length;

  // --- Build the scorecard data ---
  const findings = recentEntries.map(e => ({
    id: e.id,
    location: e.source_location || e.seed_source || (e.source_session ? `Session ${e.source_session}` : '?'),
    summary: (e.finding || '').split('|')[0].trim().slice(0, 150),
    application: e.solution || 'not yet specified'
  }));

  const sc = appendScorecard({
    todo: todoDescription || 'unknown',
    agent,
    score: `${score}/3`,
    problem: todoDescription || 'unknown',
    findings,
    searches: recentSearches.map(s => s.query),
    models_used: modelsUsed,
    monday_synced: syncedCount,
    monday_pending: unsyncedCount,
    knowledge_ids: recentEntries.map(e => e.id)
  });

  // --- Display (Joel sees this) ---
  console.log(`\n=== RESEARCH SCORECARD — ${sc.id} ===`);
  console.log(`Problem: ${sc.problem}`);
  console.log(`Agent: ${sc.agent} | Score: ${sc.score}`);
  console.log(`---`);

  // Findings with source, location, summary, application
  if (findings.length > 0) {
    console.log(`\nFINDINGS (${findings.length}):`);
    findings.forEach((f, i) => {
      console.log(`  ${i + 1}. [${f.id}]`);
      console.log(`     Source: ${f.location}`);
      console.log(`     Learned: ${f.summary}`);
      console.log(`     Applied: ${f.application}`);
    });
  } else {
    console.log(`\nFINDINGS: NONE — agent indexed no knowledge entries`);
  }

  // Searches performed
  if (recentSearches.length > 0) {
    console.log(`\nSEARCHES (${recentSearches.length}): ${recentSearches.map(s => `"${s.query}"`).join(', ')}`);
  } else {
    console.log(`\nSEARCHES: NONE — agent did not search the knowledge base`);
  }

  // External models
  if (modelsUsed.length > 0) {
    console.log(`EXTERNAL MODELS: ${modelsUsed.join(', ')}`);
  } else {
    console.log(`EXTERNAL MODELS: NONE`);
  }

  // Monday.com status
  console.log(`\nMONDAY.COM: ${syncedCount} synced, ${unsyncedCount} pending`);

  // Grade commands
  console.log(`\n--- GRADE ---`);
  console.log(`  node comms/knowledge.js grade ${sc.id} P`);
  console.log(`  node comms/knowledge.js grade ${sc.id} F`);
  console.log(`=== END SCORECARD ===\n`);

  return sc;
}

/**
 * SYNC — Push unsynced knowledge entries to Monday.com
 */
async function cmdSync(updateExisting = false) {
  const env = loadEnv();
  if (!env.MONDAY_API_KEY || !env.MONDAY_BOARD_ID) {
    console.error('Missing MONDAY_API_KEY or MONDAY_BOARD_ID');
    process.exit(1);
  }

  // Find or create the Knowledge group
  let knowledgeGroupId;
  try {
    const boardData = await mondayAPI(`{
      boards(ids: [${env.MONDAY_BOARD_ID}]) {
        groups { id title }
      }
    }`);
    const groups = boardData.boards[0].groups;
    const kbGroup = groups.find(g => g.title.toLowerCase().includes('knowledge'));

    if (kbGroup) {
      knowledgeGroupId = kbGroup.id;
    } else {
      // Create the Knowledge group
      const createGroup = await mondayAPI(`mutation {
        create_group(board_id: ${env.MONDAY_BOARD_ID}, group_name: "Knowledge Base") {
          id
        }
      }`);
      knowledgeGroupId = createGroup.create_group.id;
      console.log(`Created "Knowledge Base" group on Monday.com`);
    }
  } catch (e) {
    console.error(`Monday.com group error: ${e.message}`);
    process.exit(1);
  }

  // Get entries that haven't been synced
  const entries = loadEntries();
  const unsynced = entries.filter(e => !e.monday_item_id);
  if (unsynced.length === 0 && !updateExisting) {
    console.log('All entries already synced to Monday.com.');
    return;
  }

  console.log(`Syncing ${unsynced.length} entries to Monday.com...`);
  let synced = 0;

  for (const entry of unsynced) {
    try {
      const itemName = `[${entry.research_type || 'knowledge'}] ${entry.topic}`;
      const columnValues = {};

      // Build column values — ALL columns updated every sync
      const OUTCOME_INDEX = { breakthrough: 0, failure: 1, confirmation: 2, hypothesis: 3 };
      const modelsStr = entry.models_used || '';
      const modelCount = modelsStr ? modelsStr.split(',').map(s => s.trim()).filter(Boolean).length : 0;

      // Status: KNOWLEDGE=7 (default/graded P), Stuck=2 (graded F)
      columnValues['status'] = { index: entry.joel_grade === 'F' ? 2 : 7 };
      // Lead Agent
      columnValues['text_mm0pxgrr'] = entry.agents || '';
      // TLDR
      columnValues['long_text_mm0p5m2q'] = { text: `${entry.finding || ''}\n\nSource: Session ${entry.source_session || '?'} | Models: ${modelsStr || 'none'} | Used ${entry.usage_count || 0}x` };
      // Last update date
      columnValues['date4'] = { date: entry.ts ? entry.ts.slice(0, 10) : new Date().toISOString().slice(0, 10) };
      // Category (11 categories indexed 0-10)
      if (entry.category_id != null) columnValues['color_mm0v2yaj'] = { index: entry.category_id };
      // Outcome Type (4 types indexed 0-3)
      if (entry.outcome_type && OUTCOME_INDEX[entry.outcome_type] != null) columnValues['color_mm0vfcsb'] = { index: OUTCOME_INDEX[entry.outcome_type] };
      // Count of models (numeric)
      columnValues['numeric_mm0psx1p'] = String(modelCount);

      const data = await mondayAPI(`mutation {
        create_item(
          board_id: ${env.MONDAY_BOARD_ID},
          group_id: "${knowledgeGroupId}",
          item_name: ${JSON.stringify(itemName)},
          column_values: ${JSON.stringify(JSON.stringify(columnValues))}
        ) { id name }
      }`);

      entry.monday_item_id = data.create_item.id;
      synced++;
    } catch (e) {
      console.error(`Failed to sync "${entry.topic}": ${e.message}`);
    }
  }

  // Write back with monday_item_ids
  safeWriteKB(entries.map(e => JSON.stringify(e)).join('\n') + '\n', { reason: 'monday sync update' });
  console.log(`Synced ${synced}/${unsynced.length} entries to Monday.com Knowledge Base group.`);

  // If --update flag, also update already-synced entries with category/outcome columns
  if (updateExisting) {
    const synced2 = entries.filter(e => e.monday_item_id);
    console.log(`\nUpdating ${synced2.length} existing items with category/outcome columns...`);
    let updated = 0;
    const OUTCOME_IDX = { breakthrough: 0, failure: 1, confirmation: 2, hypothesis: 3 };

    for (const entry of synced2) {
      try {
        const modelsStr = entry.models_used || '';
        const modelCount = modelsStr ? modelsStr.split(',').map(s => s.trim()).filter(Boolean).length : 0;
        const colVals = {};

        // All 4 flagged columns + status + agent
        colVals['status'] = { index: entry.joel_grade === 'F' ? 2 : 7 };
        if (entry.category_id != null) colVals['color_mm0v2yaj'] = { index: entry.category_id };
        if (entry.outcome_type && OUTCOME_IDX[entry.outcome_type] != null) colVals['color_mm0vfcsb'] = { index: OUTCOME_IDX[entry.outcome_type] };
        colVals['numeric_mm0psx1p'] = String(modelCount);

        await mondayAPI(`mutation {
          change_multiple_column_values(
            board_id: ${env.MONDAY_BOARD_ID},
            item_id: ${entry.monday_item_id},
            column_values: ${JSON.stringify(JSON.stringify(colVals))}
          ) { id }
        }`);
        updated++;
      } catch (e) {
        console.error(`Failed to update "${entry.topic}": ${e.message}`);
      }
    }
    console.log(`Updated ${updated}/${synced2.length} items (status, category, outcome, model count).`);
  }
}

/**
 * DASHBOARD — Knowledge health metrics
 */
function cmdDashboard() {
  const entries = loadEntries();
  const scorecards = loadScorecards();

  const graded = entries.filter(e => e.joel_grade);
  const passed = entries.filter(e => e.joel_grade === 'P');
  const failed = entries.filter(e => e.joel_grade === 'F');
  const ungraded = entries.filter(e => !e.joel_grade);
  const totalUsage = entries.reduce((sum, e) => sum + (e.usage_count || 0), 0);

  const byType = {};
  entries.forEach(e => {
    const t = e.research_type || 'unknown';
    byType[t] = (byType[t] || 0) + 1;
  });

  const scGraded = scorecards.filter(sc => sc.joel_grade);
  const scPassed = scorecards.filter(sc => sc.joel_grade === 'P');

  // Category breakdown
  const byCategory = {};
  entries.forEach(e => {
    const c = e.category || 'uncategorized';
    byCategory[c] = (byCategory[c] || 0) + 1;
  });

  // Outcome breakdown
  const byOutcome = {};
  entries.forEach(e => {
    const o = e.outcome_type || 'unclassified';
    byOutcome[o] = (byOutcome[o] || 0) + 1;
  });

  console.log(`\n=== KNOWLEDGE DASHBOARD ===\n`);
  console.log(`Entries: ${entries.length} total | ${passed.length} passed | ${failed.length} failed | ${ungraded.length} ungraded`);
  console.log(`Usage: ${totalUsage} total searches across all entries`);
  console.log(`Types: ${Object.entries(byType).map(([k, v]) => `${k}(${v})`).join(', ')}`);

  console.log(`\nCategories:`);
  Object.entries(byCategory).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
    console.log(`  ${cat}: ${count}`);
  });

  console.log(`\nOutcomes:`);
  Object.entries(byOutcome).sort((a, b) => b[1] - a[1]).forEach(([out, count]) => {
    console.log(`  ${out}: ${count}`);
  });

  console.log(`\nScorecards: ${scorecards.length} total | ${scGraded.length} graded | ${scPassed.length} passed`);
  console.log(`Process compliance: ${scGraded.length > 0 ? Math.round(scPassed.length / scGraded.length * 100) : 0}%`);

  // Top 5 most-used knowledge
  const topUsed = [...entries].sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0)).slice(0, 5);
  if (topUsed.length > 0 && topUsed[0].usage_count > 0) {
    console.log(`\nTop used knowledge:`);
    topUsed.forEach((e, i) => {
      if (e.usage_count > 0) console.log(`  ${i + 1}. ${e.topic} (${e.usage_count}x) [${e.joel_grade || 'ungraded'}]`);
    });
  }

  // Ungraded items needing Joel's attention
  if (ungraded.length > 0) {
    console.log(`\n⚠ ${ungraded.length} entries need Joel's grade:`);
    ungraded.slice(0, 5).forEach(e => {
      console.log(`  node comms/knowledge.js grade ${e.id} P   — "${e.topic}"`);
    });
  }
}

// --- CLI ---

const args = process.argv.slice(2);
const cmd = args[0];

switch (cmd) {
  case 'search':
    cmdSearch(args.slice(1).join(' '));
    break;

  case 'index':
    cmdIndex(args[1], args[2], {
      source: args.find(a => a.startsWith('--source='))?.split('=')[1],
      applied: args.find(a => a.startsWith('--applied='))?.split('=')[1],
      session: args.find(a => a.startsWith('--session='))?.split('=')[1],
      agents: args.find(a => a.startsWith('--agents='))?.split('=')[1],
      type: args.find(a => a.startsWith('--type='))?.split('=')[1],
      models: args.find(a => a.startsWith('--models='))?.split('=')[1],
      tags: args.find(a => a.startsWith('--tags='))?.split('=')[1],
      problem: args.find(a => a.startsWith('--problem='))?.split('=')[1],
      solution: args.find(a => a.startsWith('--solution='))?.split('=')[1],
      category: args.find(a => a.startsWith('--category='))?.split('=')[1],
      outcome: args.find(a => a.startsWith('--outcome='))?.split('=')[1]
    });
    break;

  case 'grade':
    cmdGrade(args[1], args[2]);
    break;

  case 'scorecard':
    cmdScorecard(args.slice(1).join(' '));
    break;

  case 'sync':
    cmdSync(args.includes('--update')).catch(e => { console.error(e.message); process.exit(1); });
    break;

  case 'dashboard':
    cmdDashboard();
    break;

  default:
    console.log(`Usage: node comms/knowledge.js <command> [args]

Commands:
  search <query>              Search knowledge (weighted by usage + grade)
  index <topic> <finding>     Add a knowledge entry
  grade <id> <P|F>            Joel grades an entry or scorecard
  scorecard [todo desc]       Generate research scorecard for current todo
  sync                        Push entries to Monday.com Knowledge Base group
  dashboard                   Knowledge health metrics

Examples:
  node comms/knowledge.js search "Self PST flow"
  node comms/knowledge.js index "PST redirect loop" "useSearchParams returns empty before Suspense resolves" --source="wisdom W-141, HANDOFF session 141" --applied="Added Suspense wrapper to self-pst page" --session=141 --type=failure
  node comms/knowledge.js grade SC-1234567890 P
  node comms/knowledge.js scorecard "Fix Self PST infinite loop"
  node comms/knowledge.js sync
  node comms/knowledge.js dashboard`);
}
