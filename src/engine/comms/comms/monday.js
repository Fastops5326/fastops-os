#!/usr/bin/env node
/**
 * Monday.com Integration — Agent Board Interface v2
 *
 * The board is the single source of truth for all work coordination.
 * Parent items = lines of work with a Lead Agent.
 * Subitems = parallel initiatives within each line.
 * Updates = rolling log of progress (what done, learned, position, models engaged).
 *
 * Usage:
 *   node comms/monday.js briefing                 — Full board review for meeting prep
 *   node comms/monday.js status                   — Quick status overview
 *   node comms/monday.js checkpoint <subitem-id>  — Post context checkpoint (33/66/99%)
 *   node comms/monday.js update <item> [opts]     — Update item columns
 *   node comms/monday.js comment <item> "msg"     — Add update/comment to item
 *   node comms/monday.js create <name> [opts]     — Create new parent item (line of work)
 *   node comms/monday.js create-sub <parent> <name> [opts] — Create initiative subitem
 *   node comms/monday.js subitems <item>          — List subitems for an item
 *   node comms/monday.js claim <parent> <initiative-name> — Claim a new initiative under a line of work
 *   node comms/monday.js collab [parent-item]           — View collaboration summary (models + agents)
 *   node comms/monday.js models                         — Rank external models by effectiveness
 *
 * <item> can be an item ID or a case-insensitive name match.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// --- Config ---
const ROOT = path.join(__dirname, '..');

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

const env = loadEnv();
const API_KEY = env.MONDAY_API_KEY;
const BOARD_ID = env.MONDAY_BOARD_ID;

if (!API_KEY || !BOARD_ID) {
  console.error('Missing MONDAY_API_KEY or MONDAY_BOARD_ID in .env');
  process.exit(1);
}

// --- GraphQL Client ---
function mondayAPI(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const options = {
      hostname: 'api.monday.com',
      path: '/v2',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': API_KEY,
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
    req.write(body);
    req.end();
  });
}

// --- Column ID Maps ---
const COLUMNS = {
  status: 'status',
  date: 'date4',
  agent: 'text_mm0pxgrr',
  tldr: 'long_text_mm0p5m2q',
  questions: 'long_text_mm0pgcqd',      // Unanswered questions
  modelsUsed: 'text_mm0pm1rc',           // Models used (text list)
  modelCount: 'numeric_mm0psx1p',        // Count of models (triggers Last external model date auto)
  joelRequest: 'long_text_mm0pxxxf',     // Joel's specific request (read-only for agents)
  lastModelDate: 'date_mm0p7t5a',        // Last external model (auto-set by automation)
  // summary: 'text_mm0pgeb0'            // DO NOT WRITE — managed by Monday AI auto-summarization
};

const SUB_COLUMNS = {
  status: 'status',
  date: 'date0',
  agent: 'text_mm0pk5h0',
  tldr: 'long_text_mm0pw0y6',
  questions: 'long_text_mm0pca52',       // Unanswered questions
  modelsUsed: 'text_mm0pqpsr',           // Models used (text list)
  modelCount: 'numeric_mm0pthtf',        // Count of models
  // summary: 'text_mm0p6f70'            // DO NOT WRITE — managed by Monday AI auto-summarization
};

const STATUS_LABELS = {
  'working on it': 0,
  'done': 1,
  'stuck': 2,
  'joel support': 3,
  'new work!': 4,
  'not started': 5,
  'joel answer': 6
};

// Knowledge Base columns (reef)
const KB_COLUMNS = {
  category: 'color_mm0v2yaj',           // Category (status/label column)
  outcomeType: 'color_mm0vfcsb',        // Outcome Type (Breakthrough/Failure/Confirmation/Hypothesis)
  joelScore: 'rating_mm0vt49r',         // Joel's 1-5 star rating
  joelFeedback: 'long_text_mm0vk0h2',   // Joel's feedback text
  confidence: 'numeric_mm0v9bph',       // Agent confidence 0-100
  sourceSession: 'text_mm0vzeyv',       // Source session number(s)
};

// Category label indices (for the status/label column)
const KB_CATEGORIES = {
  'multi-model': 0,
  'behavioral': 1,
  'onboarding': 2,
  'evaluation': 3,
  'visual-qa': 4,
  'knowledge': 5,
  'instruction': 6,
  'enforcement': 7,
  'comms': 8,
  'product': 9,
  'technical': 10
};

// Outcome type label indices
const KB_OUTCOMES = {
  'breakthrough': 0,
  'failure': 1,
  'confirmation': 2,
  'hypothesis': 3
};

// Groups
const GROUPS = {
  active: 'topics',              // Active efforts
  joelRequest: 'group_mm0pyd17', // Joel Request (auto-move on JOEL support status)
  completed: 'group_title',      // Completed work
  knowledgeBase: 'group_mm0vk3wg' // Knowledge Base (reef — Joel evaluates here)
};

// Filter helper: skip Knowledge Base items in work-related queries
function workItems(items) {
  return items.filter(i => !i.group || i.group.id !== GROUPS.knowledgeBase);
}

// Work groups query fragment — excludes Knowledge Base group
const WORK_GROUPS_IDS = `"${GROUPS.active}", "${GROUPS.joelRequest}", "${GROUPS.completed}"`;

// Fetch work items only (skips 200+ Knowledge Base entries)
async function fetchWorkItems(fields) {
  const data = await mondayAPI(`{
    boards(ids: [${BOARD_ID}]) {
      groups(ids: [${WORK_GROUPS_IDS}]) {
        id title
        items_page(limit: 100) {
          items { ${fields} }
        }
      }
    }
  }`);
  const board = data.boards[0];
  return board.groups.flatMap(g =>
    g.items_page.items.map(item => ({ ...item, group: { id: g.id, title: g.title } }))
  );
}

// --- Model Engagement Tracking (session-level) ---
const ENGAGEMENT_FILE = path.join(ROOT, '.fastops', '.model-engagements.json');

function getModelEngagements() {
  try {
    if (fs.existsSync(ENGAGEMENT_FILE)) {
      return JSON.parse(fs.readFileSync(ENGAGEMENT_FILE, 'utf8'));
    }
  } catch {}
  return { count: 0, models: [], sessions: [] };
}

function recordModelEngagement(model, tool) {
  const data = getModelEngagements();
  data.count++;
  if (!data.models.includes(model)) data.models.push(model);
  data.sessions.push({ model, tool, timestamp: new Date().toISOString() });
  const dir = path.dirname(ENGAGEMENT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ENGAGEMENT_FILE, JSON.stringify(data, null, 2));
  return data;
}

function resetModelEngagements() {
  const data = { count: 0, models: [], sessions: [] };
  const dir = path.dirname(ENGAGEMENT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(ENGAGEMENT_FILE, JSON.stringify(data, null, 2));
}

// --- Collaboration Log (persistent cross-session) ---
const COLLAB_FILE = path.join(ROOT, '.fastops', '.collaboration-log.json');

function getCollabLog() {
  try {
    if (fs.existsSync(COLLAB_FILE)) {
      return JSON.parse(fs.readFileSync(COLLAB_FILE, 'utf8'));
    }
  } catch {}
  return { parentItems: {}, modelEffectiveness: {} };
}

function saveCollabLog(log) {
  const dir = path.dirname(COLLAB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(COLLAB_FILE, JSON.stringify(log, null, 2));
}

/**
 * Record collaboration data for a parent item.
 * Called at checkpoint time — merges session model engagements into persistent log.
 */
function recordCollaboration(parentItemName, agentName, sessionEngagements) {
  const log = getCollabLog();
  if (!log.parentItems[parentItemName]) {
    log.parentItems[parentItemName] = {
      externalModels: { count: 0, roster: [] },
      collaborators: [],
      history: []
    };
  }

  const item = log.parentItems[parentItemName];

  // Merge agent as collaborator
  if (agentName && !item.collaborators.includes(agentName)) {
    item.collaborators.push(agentName);
  }

  // Merge session model engagements into parent-item totals
  if (sessionEngagements && sessionEngagements.sessions) {
    for (const s of sessionEngagements.sessions) {
      item.externalModels.count++;
      if (!item.externalModels.roster.includes(s.model)) {
        item.externalModels.roster.push(s.model);
      }
      // Also update global model effectiveness (call count)
      if (!log.modelEffectiveness[s.model]) {
        log.modelEffectiveness[s.model] = { calls: 0, useful: 0 };
      }
      log.modelEffectiveness[s.model].calls++;
    }
  }

  // Add history entry
  item.history.push({
    agent: agentName,
    modelsThisSession: sessionEngagements ? sessionEngagements.count : 0,
    timestamp: new Date().toISOString()
  });

  item.lastUpdated = new Date().toISOString();
  saveCollabLog(log);
  return item;
}

/**
 * Record model effectiveness — was this model's output useful?
 * Also ensures calls count is at least as high as useful count.
 */
function recordModelEffectiveness(model, useful) {
  const log = getCollabLog();
  if (!log.modelEffectiveness[model]) {
    log.modelEffectiveness[model] = { calls: 0, useful: 0 };
  }
  // Ensure calls count stays consistent — rating implies a call happened
  if (log.modelEffectiveness[model].calls === 0) {
    log.modelEffectiveness[model].calls = 1;
  }
  if (useful) log.modelEffectiveness[model].useful++;
  saveCollabLog(log);
}

// --- Context Budget ---
function getContextBudget() {
  const budgetFile = path.join(ROOT, '.fastops', '.context-budget.json');
  try {
    if (fs.existsSync(budgetFile)) {
      return JSON.parse(fs.readFileSync(budgetFile, 'utf8'));
    }
  } catch {}
  return { used_percentage: null, remaining_percentage: null };
}

// --- Resolve item by name or ID ---
async function resolveItem(nameOrId) {
  if (/^\d+$/.test(nameOrId)) return nameOrId;

  const items = await fetchWorkItems('id name');
  const exact = items.find(i => i.name.toLowerCase() === nameOrId.toLowerCase());
  if (exact) return exact.id;
  const partial = items.find(i => i.name.toLowerCase().includes(nameOrId.toLowerCase()));
  if (partial) return partial.id;
  throw new Error(`No item matching "${nameOrId}". Items: ${items.map(i => i.name).join(', ')}`);
}

// --- Resolve subitem by name or ID (searches all subitems on board) ---
async function resolveSubitem(nameOrId) {
  if (/^\d+$/.test(nameOrId)) return nameOrId;

  const items = await fetchWorkItems('id subitems { id name }');
  const allSubs = items.flatMap(i => i.subitems || []);
  const exact = allSubs.find(s => s.name.toLowerCase() === nameOrId.toLowerCase());
  if (exact) return exact.id;
  const partial = allSubs.find(s => s.name.toLowerCase().includes(nameOrId.toLowerCase()));
  if (partial) return partial.id;
  throw new Error(`No subitem matching "${nameOrId}". Subitems: ${allSubs.map(s => s.name).join(', ')}`);
}

// --- Resolve subitem's parent item ---
async function getParentOfSubitem(subitemId) {
  const items = await fetchWorkItems('id name subitems { id }');
  for (const item of items) {
    if (item.subitems && item.subitems.some(s => String(s.id) === String(subitemId))) {
      return { id: item.id, name: item.name };
    }
  }
  return null;
}

// ========================================
// COMMANDS
// ========================================

/**
 * BRIEFING — Exhaustive board review for meeting prep.
 * Reads every parent item, its subitems, and recent updates.
 * This is what agents read FIRST when a team meeting is called.
 */
async function cmdBriefing() {
  const items = await fetchWorkItems('id name column_values { id text type } updates(limit: 10) { id body created_at creator { name } } subitems { id name column_values { id text type } updates(limit: 5) { id body created_at creator { name } } }');

  // Group by group
  const groups = {};
  items.forEach(item => {
    const g = item.group?.title || 'Unknown';
    if (!groups[g]) groups[g] = [];
    groups[g].push(item);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(`  MONDAY.COM BRIEFING — Claude build`);
  console.log(`  ${new Date().toISOString().slice(0, 16)}`);
  console.log(`${'='.repeat(60)}\n`);

  for (const [groupName, groupItems] of Object.entries(groups)) {
    console.log(`\n--- ${groupName.toUpperCase()} ---\n`);

    for (const item of groupItems) {
      const status = item.column_values.find(c => c.id === 'status')?.text || '-';
      const lead = item.column_values.find(c => c.id === COLUMNS.agent)?.text || 'Unassigned';
      const tldr = item.column_values.find(c => c.id === COLUMNS.tldr)?.text || '';
      const lastUpdate = item.column_values.find(c => c.id === COLUMNS.date)?.text || '';

      console.log(`  [${status}] ${item.name}`);
      console.log(`  Lead: ${lead} | Last updated: ${lastUpdate || 'never'}`);
      if (tldr) console.log(`  TLDR: ${tldr}`);

      // Parent updates (the rolling log)
      if (item.updates && item.updates.length > 0) {
        console.log(`  Updates (${item.updates.length}):`);
        item.updates.forEach(u => {
          const body = u.body.replace(/<[^>]+>/g, '').trim();
          const date = u.created_at.slice(0, 16).replace('T', ' ');
          const author = u.creator?.name || 'agent';
          console.log(`    [${date}] ${author}: ${body.slice(0, 200)}${body.length > 200 ? '...' : ''}`);
        });
      }

      // Subitems (initiatives)
      if (item.subitems && item.subitems.length > 0) {
        console.log(`  Initiatives (${item.subitems.length}):`);
        item.subitems.forEach(sub => {
          const subStatus = sub.column_values.find(c => c.id === 'status')?.text || '-';
          const subAgent = sub.column_values.find(c => c.id === SUB_COLUMNS.agent)?.text || '';
          const subTldr = sub.column_values.find(c => c.id === SUB_COLUMNS.tldr)?.text || '';

          console.log(`    └─ [${subStatus}] ${sub.name}${subAgent ? ' — ' + subAgent : ''}`);
          if (subTldr) console.log(`       TLDR: ${subTldr}`);

          // Subitem updates
          if (sub.updates && sub.updates.length > 0) {
            sub.updates.forEach(u => {
              const body = u.body.replace(/<[^>]+>/g, '').trim();
              const date = u.created_at.slice(0, 16).replace('T', ' ');
              console.log(`       [${date}]: ${body.slice(0, 150)}${body.length > 150 ? '...' : ''}`);
            });
          }
        });
      }

      console.log('');
    }
  }

  console.log(`${'='.repeat(60)}`);
  console.log(`  END BRIEFING`);
  console.log(`${'='.repeat(60)}\n`);
}

/**
 * STATUS — Quick overview of all items.
 */
async function cmdStatus() {
  const items = await fetchWorkItems('id name column_values { id text } subitems { id name column_values { id text } }');
  console.log('\n=== Board Status ===\n');
  items.forEach(item => {
    const status = item.column_values.find(c => c.id === 'status')?.text || '-';
    const lead = item.column_values.find(c => c.id === COLUMNS.agent)?.text || '';
    const tldr = item.column_values.find(c => c.id === COLUMNS.tldr)?.text || '';
    const leadStr = lead ? ` [${lead}]` : '';
    console.log(`  [${status}] ${item.name}${leadStr}`);
    if (tldr) console.log(`    ${tldr}`);
    if (item.subitems && item.subitems.length > 0) {
      item.subitems.forEach(sub => {
        const subStatus = sub.column_values.find(c => c.id === 'status')?.text || '-';
        const subAgent = sub.column_values.find(c => c.id === SUB_COLUMNS.agent)?.text || '';
        console.log(`    └─ [${subStatus}] ${sub.name}${subAgent ? ' — ' + subAgent : ''}`);
      });
    }
  });
  console.log('');
}

/**
 * OPEN — Show only claimable work items (NEW WORK! or Not started with no agent).
 */
async function cmdOpen() {
  const items = await fetchWorkItems('id name column_values { id text } subitems { id name column_values { id text } }');
  let openCount = 0;

  console.log('\n=== OPEN WORK — Ready to Claim ===\n');
  items.forEach(item => {
    const status = item.column_values.find(c => c.id === 'status')?.text || '-';
    const lead = item.column_values.find(c => c.id === COLUMNS.agent)?.text || '';

    // Check parent item — unassigned parent items
    const parentOpen = !lead && (status.toLowerCase().includes('new work') || status.toLowerCase() === 'not started');

    // Check subitems for open contracts
    const openSubs = (item.subitems || []).filter(sub => {
      const subStatus = sub.column_values.find(c => c.id === 'status')?.text || '-';
      const subAgent = sub.column_values.find(c => c.id === SUB_COLUMNS.agent)?.text || '';
      return !subAgent && (subStatus.toLowerCase().includes('new work') || subStatus.toLowerCase() === 'not started');
    });

    if (parentOpen || openSubs.length > 0) {
      if (parentOpen) {
        console.log(`  [${status}] ${item.name} — NEEDS LEAD`);
        const tldr = item.column_values.find(c => c.id === COLUMNS.tldr)?.text || '';
        if (tldr) console.log(`    ${tldr}`);
        openCount++;
      } else {
        console.log(`  ${item.name}:`);
      }

      openSubs.forEach(sub => {
        const subStatus = sub.column_values.find(c => c.id === 'status')?.text || '-';
        const subTldr = sub.column_values.find(c => c.id === SUB_COLUMNS.tldr)?.text || '';
        console.log(`    └─ [${subStatus}] ${sub.name}`);
        if (subTldr) console.log(`       ${subTldr}`);
        openCount++;
      });
    }
  });

  if (openCount === 0) {
    console.log('  No open work items found. All items have owners.');
  } else {
    console.log(`\n  ${openCount} open item(s). Claim with: node comms/monday.js claim "<parent>" "<name>" --tldr "your approach"`);
  }
  console.log('');
}

/**
 * CHECKPOINT — Post a structured progress update at 33/66/99% context.
 * Posts as an update (comment) on the specified subitem AND updates TLDR.
 *
 * Usage:
 *   node comms/monday.js checkpoint <subitem> --done "what I did" --learned "what I learned"
 *     --position "why I think what I think" --confidence 75
 *
 * Auto-reads: context budget, model engagement count.
 */
async function cmdCheckpoint(nameOrId, opts) {
  const subitemId = await resolveSubitem(nameOrId);
  const budget = getContextBudget();
  const engagements = getModelEngagements();
  const contextPct = budget.used_percentage !== null ? `${budget.used_percentage}%` : 'unknown';

  // Build the checkpoint update body
  const agentName = getAgentName();
  const parts = [];
  parts.push(`CHECKPOINT @ ${contextPct} context — ${agentName}`);
  parts.push(`Models engaged this session: ${engagements.count} (${engagements.models.join(', ') || 'none'})`);
  parts.push('');

  if (opts.done) {
    parts.push(`DONE: ${opts.done}`);
  }
  if (opts.learned) {
    parts.push(`LEARNED: ${opts.learned}`);
  }
  if (opts.position) {
    parts.push(`POSITION: ${opts.position}`);
  }
  if (opts.confidence) {
    parts.push(`CONFIDENCE: ${opts.confidence}%`);
  }
  if (opts.blockers) {
    parts.push(`BLOCKERS: ${opts.blockers}`);
  }
  if (opts.questions) {
    parts.push(`UNANSWERED QUESTIONS: ${opts.questions}`);
  }
  if (opts.next) {
    parts.push(`NEXT: ${opts.next}`);
  }

  const body = parts.join('\n');

  // Post as update on the subitem
  const mutation = `mutation {
    create_update(item_id: ${subitemId}, body: ${JSON.stringify(body)}) { id }
  }`;
  await mondayAPI(mutation);

  // Also update the subitem's TLDR and date
  const today = new Date().toISOString().slice(0, 10);
  const tldrText = opts.next || opts.done || 'Checkpoint posted';
  const subBoardData = await mondayAPI(`{
    items(ids: [${subitemId}]) { board { id } }
  }`);
  const subBoardId = subBoardData.items[0].board.id;

  const columnValues = {
    [SUB_COLUMNS.date]: { date: today },
    [SUB_COLUMNS.tldr]: { text: tldrText.slice(0, 200) }
  };

  // Write unanswered questions to dedicated column
  if (opts.questions) {
    columnValues[SUB_COLUMNS.questions] = { text: opts.questions.slice(0, 500) };
  }

  // Write model engagement data to dedicated columns
  if (engagements.count > 0) {
    columnValues[SUB_COLUMNS.modelsUsed] = engagements.models.join(', ');
    columnValues[SUB_COLUMNS.modelCount] = String(engagements.count);
  }

  // Update status if specified
  if (opts.status) {
    const key = opts.status.toLowerCase();
    if (key in STATUS_LABELS) {
      // PEER REVIEW GATE: "done" requires peer knowledge contribution
      if (key === 'done') {
        const review = await checkPeerReview(subitemId);
        if (!review.passed) {
          console.error(`\n⛔ PEER REVIEW REQUIRED — Cannot mark as "Done"\n${review.reason}\n`);
          console.error('To complete peer review, another agent must run:');
          console.error(`  node comms/monday.js reef validate "<kb-item>" "<reason>"  — then comment on this item`);
          console.error(`  node comms/monday.js comment "${nameOrId}" "Reviewed: <W-number or KB reference>"\n`);
          process.exit(1);
        }
        console.log(`✓ Peer review passed: ${review.reason}`);
      }
      columnValues[SUB_COLUMNS.status] = { index: STATUS_LABELS[key] };
    }
  }

  await mondayAPI(`mutation {
    change_multiple_column_values(
      board_id: ${subBoardId},
      item_id: ${subitemId},
      column_values: ${JSON.stringify(JSON.stringify(columnValues))}
    ) { id }
  }`);

  // Roll up collaboration to parent item
  const parent = await getParentOfSubitem(subitemId);
  if (parent) {
    const collabData = recordCollaboration(parent.name, agentName, engagements);
    // Post collaboration summary as update on parent item
    const collabSummary = [
      `COLLABORATION UPDATE — ${parent.name}`,
      `External models consulted (all time): ${collabData.externalModels.count} (${collabData.externalModels.roster.join(', ')})`,
      `Agent collaborators: ${collabData.collaborators.join(', ')}`,
      `This session: ${agentName} engaged ${engagements.count} models`
    ].join('\n');
    await mondayAPI(`mutation {
      create_update(item_id: ${parent.id}, body: ${JSON.stringify(collabSummary)}) { id }
    }`);

    // Update parent item's model columns (triggers Last external model date automation)
    if (collabData.externalModels.count > 0) {
      const parentColumns = {
        [COLUMNS.modelsUsed]: collabData.externalModels.roster.join(', '),
        [COLUMNS.modelCount]: String(collabData.externalModels.count)
      };
      await mondayAPI(`mutation {
        change_multiple_column_values(
          board_id: ${BOARD_ID},
          item_id: ${parent.id},
          column_values: ${JSON.stringify(JSON.stringify(parentColumns))}
        ) { id }
      }`);
    }

    console.log(`Collaboration rolled up to parent: ${parent.name} (${collabData.externalModels.count} total models, ${collabData.collaborators.length} agents)`);
  }

  console.log(`Checkpoint posted to subitem ${subitemId} @ ${contextPct} context`);
  console.log(`Models engaged: ${engagements.count} (${engagements.models.join(', ') || 'none'})`);
}

/**
 * UPDATE — Update columns on a parent item.
 */
async function cmdUpdate(nameOrId, opts) {
  // Resolve item — could be parent or subitem
  let itemId, isSubitem = false, boardId = BOARD_ID;
  try {
    itemId = await resolveItem(nameOrId);
    // For numeric IDs, verify it's actually on the parent board
    if (/^\d+$/.test(nameOrId)) {
      const check = await mondayAPI(`{ items(ids: [${itemId}]) { board { id } } }`);
      if (check.items[0] && check.items[0].board.id !== String(BOARD_ID)) {
        isSubitem = true;
        boardId = check.items[0].board.id;
      }
    }
  } catch {
    itemId = await resolveSubitem(nameOrId);
    isSubitem = true;
    const subBoardData = await mondayAPI(`{ items(ids: [${itemId}]) { board { id } } }`);
    boardId = subBoardData.items[0].board.id;
  }

  // Use subitem column IDs when updating subitems
  const cols = isSubitem ? SUB_COLUMNS : COLUMNS;
  const columnValues = {};

  if (opts.status) {
    const key = opts.status.toLowerCase();
    if (key in STATUS_LABELS) {
      // PEER REVIEW GATE: "done" requires peer knowledge contribution
      if (key === 'done') {
        const review = await checkPeerReview(itemId);
        if (!review.passed) {
          console.error(`\n⛔ PEER REVIEW REQUIRED — Cannot mark as "Done"\n${review.reason}\n`);
          console.error('To complete peer review, another agent must run:');
          console.error(`  node comms/monday.js reef validate "<kb-item>" "<reason>"  — then comment on this item`);
          console.error(`  node comms/monday.js comment "${nameOrId}" "Reviewed: <W-number or KB reference>"\n`);
          process.exit(1);
        }
        console.log(`✓ Peer review passed: ${review.reason}`);
      }
      columnValues[cols.status] = { index: STATUS_LABELS[key] };
    } else {
      console.error(`Unknown status. Options: ${Object.keys(STATUS_LABELS).join(', ')}`);
      process.exit(1);
    }
  }
  if (opts.agent) columnValues[cols.agent] = opts.agent;
  if (opts.tldr) columnValues[cols.tldr || COLUMNS.tldr] = { text: opts.tldr };
  if (opts.date) columnValues[cols.date || COLUMNS.date] = { date: opts.date };

  if (Object.keys(columnValues).length === 0) {
    console.error('Nothing to update. Use --status, --agent, --tldr, or --date');
    process.exit(1);
  }

  const data = await mondayAPI(`mutation {
    change_multiple_column_values(
      board_id: ${boardId},
      item_id: ${itemId},
      column_values: ${JSON.stringify(JSON.stringify(columnValues))}
    ) { id name }
  }`);
  console.log(`Updated: ${data.change_multiple_column_values.name}`);
}

/**
 * COMMENT — Add a progress update to any item or subitem.
 */
async function cmdComment(nameOrId, message) {
  // Try parent first, then subitem
  let itemId;
  try {
    itemId = await resolveItem(nameOrId);
  } catch {
    itemId = await resolveSubitem(nameOrId);
  }
  const data = await mondayAPI(`mutation {
    create_update(item_id: ${itemId}, body: ${JSON.stringify(message)}) { id }
  }`);
  console.log(`Update posted (ID: ${data.create_update.id})`);
}

/**
 * CREATE — Create a new line of work (parent item).
 */
async function cmdCreate(name, opts) {
  const groupId = opts.group === 'completed' ? GROUPS.completed : GROUPS.active;
  const columnValues = {};

  if (opts.status) {
    const key = opts.status.toLowerCase();
    if (key in STATUS_LABELS) columnValues[COLUMNS.status] = { index: STATUS_LABELS[key] };
  }
  if (opts.agent) columnValues[COLUMNS.agent] = opts.agent;
  if (opts.tldr) columnValues[COLUMNS.tldr] = { text: opts.tldr };

  const data = await mondayAPI(`mutation {
    create_item(
      board_id: ${BOARD_ID},
      group_id: "${groupId}",
      item_name: ${JSON.stringify(name)},
      column_values: ${JSON.stringify(JSON.stringify(columnValues))}
    ) { id name }
  }`);
  console.log(`Created line of work: ${data.create_item.name} (ID: ${data.create_item.id})`);
}

/**
 * CREATE-SUB — Create an initiative under a line of work.
 */
async function cmdCreateSub(parentNameOrId, name, opts) {
  const parentId = await resolveItem(parentNameOrId);
  const columnValues = {};

  if (opts.status) {
    const key = opts.status.toLowerCase();
    if (key in STATUS_LABELS) columnValues[SUB_COLUMNS.status] = { index: STATUS_LABELS[key] };
  }
  if (opts.agent) columnValues[SUB_COLUMNS.agent] = opts.agent;
  if (opts.tldr) columnValues[SUB_COLUMNS.tldr] = { text: opts.tldr };

  const data = await mondayAPI(`mutation {
    create_subitem(
      parent_item_id: ${parentId},
      item_name: ${JSON.stringify(name)},
      column_values: ${JSON.stringify(JSON.stringify(columnValues))}
    ) { id name }
  }`);
  console.log(`Created initiative: ${data.create_subitem.name} (ID: ${data.create_subitem.id})`);
}

/**
 * SUBITEMS — List initiatives under a line of work.
 */
async function cmdSubitems(nameOrId) {
  const itemId = await resolveItem(nameOrId);
  const data = await mondayAPI(`{
    items(ids: [${itemId}]) {
      name
      subitems {
        id name
        column_values { id text type }
        updates(limit: 3) { id body created_at }
      }
    }
  }`);

  const item = data.items[0];
  console.log(`\n=== Initiatives under "${item.name}" ===\n`);
  if (!item.subitems || item.subitems.length === 0) {
    console.log('  (no initiatives)');
  } else {
    item.subitems.forEach(sub => {
      const status = sub.column_values.find(c => c.id === 'status')?.text || '-';
      const agent = sub.column_values.find(c => c.id === SUB_COLUMNS.agent)?.text || '';
      const tldr = sub.column_values.find(c => c.id === SUB_COLUMNS.tldr)?.text || '';
      console.log(`  [${status}] ${sub.name} (ID: ${sub.id})${agent ? ' — ' + agent : ''}`);
      if (tldr) console.log(`    TLDR: ${tldr}`);
      if (sub.updates && sub.updates.length > 0) {
        sub.updates.forEach(u => {
          const body = u.body.replace(/<[^>]+>/g, '').trim();
          console.log(`    ${u.created_at.slice(0, 16)}: ${body.slice(0, 120)}${body.length > 120 ? '...' : ''}`);
        });
      }
    });
  }
  console.log('');
}

/**
 * CLAIM — Claim an existing open subitem, or create one if it doesn't exist.
 * Checks for existing subitem by name first to prevent duplicates.
 */
async function cmdClaim(parentNameOrId, name, opts) {
  const agentName = opts.agent || getAgentName();
  const parentId = await resolveItem(parentNameOrId);

  // Check if a subitem with this name already exists under the parent
  const data = await mondayAPI(`{
    items(ids: [${parentId}]) {
      subitems { id name column_values { id text } }
    }
  }`);

  const existing = (data.items[0]?.subitems || []).find(
    s => s.name.toLowerCase() === name.toLowerCase()
  );

  if (existing) {
    // Claim the existing subitem — update agent + status
    const subBoardData = await mondayAPI(`{ items(ids: [${existing.id}]) { board { id } } }`);
    const subBoardId = subBoardData.items[0].board.id;
    const currentAgent = existing.column_values.find(c => c.id === SUB_COLUMNS.agent)?.text || '';

    if (currentAgent && currentAgent !== agentName) {
      console.log(`⚠️  "${name}" is already claimed by ${currentAgent}. Cannot override.`);
      process.exit(1);
    }

    const columnValues = {
      [SUB_COLUMNS.agent]: agentName,
      [SUB_COLUMNS.status]: { index: STATUS_LABELS['working on it'] }
    };
    if (opts.tldr) columnValues[SUB_COLUMNS.tldr] = { text: opts.tldr };

    await mondayAPI(`mutation {
      change_multiple_column_values(
        board_id: ${subBoardId},
        item_id: ${existing.id},
        column_values: ${JSON.stringify(JSON.stringify(columnValues))}
      ) { id }
    }`);
    console.log(`Claimed existing subitem: "${name}" (ID: ${existing.id}) → ${agentName}`);
  } else {
    // No existing subitem — create a new one
    await cmdCreateSub(parentNameOrId, name, {
      ...opts,
      agent: agentName,
      status: opts.status || 'Working on it'
    });
  }
}

/**
 * SYNC — Session close-out. Shows all subitems claimed by this agent that aren't Done.
 * For each, outputs the command to close it out. Required before /handoff.
 *
 * Non-interactive: shows what needs updating and how. The agent acts on the output.
 *
 * Usage:
 *   node comms/monday.js sync
 *   node comms/monday.js sync --report    (returns JSON summary for handoff entry)
 */
async function cmdSync(opts) {
  const agentName = getAgentName();
  const agentId = (() => {
    const f = path.join(ROOT, 'comms', 'data', '.active-agent');
    try { return fs.readFileSync(f, 'utf8').trim(); } catch { return ''; }
  })();

  const items = await fetchWorkItems('id name subitems { id name column_values { id text type } }');
  const myItems = [];
  const closedItems = [];

  for (const item of items) {
    for (const sub of (item.subitems || [])) {
      const subAgent = sub.column_values.find(c => c.id === SUB_COLUMNS.agent)?.text || '';
      const subStatus = sub.column_values.find(c => c.id === 'status')?.text || '';
      const subTldr = sub.column_values.find(c => c.id === SUB_COLUMNS.tldr)?.text || '';
      const subQuestions = sub.column_values.find(c => c.id === SUB_COLUMNS.questions)?.text || '';

      // Match by agent name or agent ID (case-insensitive)
      const isMyItem = subAgent &&
        (subAgent.toLowerCase() === agentName.toLowerCase() ||
         subAgent.toLowerCase() === agentId.toLowerCase());

      if (!isMyItem) continue;

      const entry = {
        parentName: item.name,
        parentId: item.id,
        subName: sub.name,
        subId: sub.id,
        status: subStatus,
        tldr: subTldr,
        questions: subQuestions
      };

      if (subStatus.toLowerCase() === 'done') {
        closedItems.push(entry);
      } else {
        myItems.push(entry);
      }
    }
  }

  // JSON report mode for handoff integration
  if (opts && opts.report) {
    const report = {
      agent: agentName,
      timestamp: new Date().toISOString(),
      open_items: myItems.map(i => ({ parent: i.parentName, sub: i.subName, status: i.status, tldr: i.tldr })),
      closed_items: closedItems.map(i => ({ parent: i.parentName, sub: i.subName })),
      needs_action: myItems.length
    };
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  // Human-readable output
  console.log(`\n${'='.repeat(55)}`);
  console.log(`  MONDAY.COM SYNC — ${agentName}`);
  console.log(`  ${new Date().toISOString().slice(0, 16)}`);
  console.log(`${'='.repeat(55)}\n`);

  if (closedItems.length > 0) {
    console.log(`  Already Done (${closedItems.length}):`);
    closedItems.forEach(i => {
      console.log(`    ✓ ${i.parentName} → ${i.subName}`);
    });
    console.log('');
  }

  if (myItems.length === 0) {
    console.log('  All your items are closed. Board is in sync.');
    console.log(`\n${'='.repeat(55)}\n`);
    return;
  }

  console.log(`  NEEDS ACTION (${myItems.length}):\n`);

  for (const item of myItems) {
    console.log(`  ${item.parentName} → ${item.subName}`);
    console.log(`    Status: ${item.status}`);
    if (item.tldr) console.log(`    TLDR: ${item.tldr}`);
    if (item.questions) console.log(`    Open Questions: ${item.questions}`);
    console.log('');
    console.log(`    If DONE:`);
    console.log(`      node comms/monday.js checkpoint "${item.subName}" --done "what you accomplished" --status "Done" --next "what successor should know"`);
    console.log('');
    console.log(`    If IN PROGRESS (successor will continue):`);
    console.log(`      node comms/monday.js checkpoint "${item.subName}" --done "work completed so far" --next "what to do next" --status "Working on it"`);
    console.log('');
    console.log(`    If ABANDONED (release for someone else):`);
    console.log(`      node comms/monday.js update "${item.subName}" --status "Not started" --agent "" --tldr "Released — [reason]"`);
    console.log('');
    console.log(`  ${'─'.repeat(50)}`);
  }

  console.log(`\n  ACTION REQUIRED: Update ${myItems.length} item(s) above before running /handoff.`);
  console.log(`  Each item needs either a final checkpoint (Done), a progress checkpoint (in progress), or release (abandoned).`);
  console.log(`\n${'='.repeat(55)}\n`);
}

/**
 * JOEL-VIEW — Filtered view of what needs Joel's attention.
 * Shows: items needing Joel, recently completed items, items with unanswered questions.
 *
 * Usage:
 *   node comms/monday.js joel-view
 */
async function cmdJoelView() {
  const items = await fetchWorkItems('id name column_values { id text type } subitems { id name column_values { id text type } }');

  const needsJoel = [];      // Status = JOEL support or Joel Answer
  const recentlyDone = [];   // Status = Done, in active group
  const hasQuestions = [];    // Has unanswered questions
  const stuck = [];           // Status = Stuck

  for (const item of items) {
    const status = item.column_values.find(c => c.id === 'status')?.text || '';
    const questions = item.column_values.find(c => c.id === COLUMNS.questions)?.text || '';
    const tldr = item.column_values.find(c => c.id === COLUMNS.tldr)?.text || '';
    const lead = item.column_values.find(c => c.id === COLUMNS.agent)?.text || '';
    const group = item.group?.title || '';

    const entry = { name: item.name, status, tldr, lead, questions, group };

    if (status.toLowerCase().includes('joel')) {
      needsJoel.push(entry);
    }
    if (status.toLowerCase() === 'done' && !group.toLowerCase().includes('completed')) {
      recentlyDone.push(entry);
    }
    if (status.toLowerCase() === 'stuck') {
      stuck.push(entry);
    }
    if (questions.trim()) {
      hasQuestions.push(entry);
    }

    // Also check subitems
    for (const sub of (item.subitems || [])) {
      const subStatus = sub.column_values.find(c => c.id === 'status')?.text || '';
      const subAgent = sub.column_values.find(c => c.id === SUB_COLUMNS.agent)?.text || '';
      const subTldr = sub.column_values.find(c => c.id === SUB_COLUMNS.tldr)?.text || '';
      const subQuestions = sub.column_values.find(c => c.id === SUB_COLUMNS.questions)?.text || '';

      const subEntry = { name: `${item.name} → ${sub.name}`, status: subStatus, tldr: subTldr, lead: subAgent, questions: subQuestions };

      if (subStatus.toLowerCase().includes('joel')) {
        needsJoel.push(subEntry);
      }
      if (subStatus.toLowerCase() === 'stuck') {
        stuck.push(subEntry);
      }
      if (subQuestions.trim()) {
        hasQuestions.push(subEntry);
      }
    }
  }

  console.log(`\n${'='.repeat(55)}`);
  console.log(`  JOEL'S VIEW — What Needs Your Attention`);
  console.log(`  ${new Date().toISOString().slice(0, 16)}`);
  console.log(`${'='.repeat(55)}\n`);

  // Section 1: Needs Joel
  if (needsJoel.length > 0) {
    console.log(`  🔴 NEEDS YOUR INPUT (${needsJoel.length}):\n`);
    needsJoel.forEach(i => {
      console.log(`    ${i.name} [${i.status}]`);
      if (i.tldr) console.log(`      ${i.tldr}`);
      if (i.questions) console.log(`      Question: ${i.questions}`);
    });
    console.log('');
  }

  // Section 2: Stuck
  if (stuck.length > 0) {
    console.log(`  🟡 STUCK (${stuck.length}):\n`);
    stuck.forEach(i => {
      console.log(`    ${i.name}${i.lead ? ' — ' + i.lead : ''}`);
      if (i.tldr) console.log(`      ${i.tldr}`);
    });
    console.log('');
  }

  // Section 3: Recently Done
  if (recentlyDone.length > 0) {
    console.log(`  🟢 DONE — Ready for Sign-off (${recentlyDone.length}):\n`);
    recentlyDone.forEach(i => {
      console.log(`    ${i.name}${i.lead ? ' — ' + i.lead : ''}`);
      if (i.tldr) console.log(`      ${i.tldr}`);
    });
    console.log('');
  }

  // Section 4: Open Questions
  if (hasQuestions.length > 0) {
    console.log(`  ❓ OPEN QUESTIONS (${hasQuestions.length}):\n`);
    hasQuestions.forEach(i => {
      console.log(`    ${i.name}`);
      console.log(`      ${i.questions}`);
    });
    console.log('');
  }

  const total = needsJoel.length + stuck.length + recentlyDone.length + hasQuestions.length;
  if (total === 0) {
    console.log('  Nothing requires your attention right now. The kitchen is running.');
  }

  console.log(`${'='.repeat(55)}\n`);
}

/**
 * DELETE-SUB — Delete a subitem by name or ID.
 * Used for cleanup of duplicates.
 */
async function cmdDeleteSub(nameOrId) {
  const subitemId = await resolveSubitem(nameOrId);
  await mondayAPI(`mutation { delete_item(item_id: ${subitemId}) { id } }`);
  console.log(`Deleted subitem ID: ${subitemId}`);
}

/**
 * TRACK-MODEL — Record an external model engagement.
 * Use --useful or --not-useful to rate effectiveness.
 */
async function cmdTrackModel(model, tool, opts) {
  const data = recordModelEngagement(model, tool || 'unknown');
  if (opts && opts.useful) {
    recordModelEffectiveness(model, true);
    console.log(`Recorded: ${model} — marked USEFUL`);
  } else if (opts && opts['not-useful']) {
    recordModelEffectiveness(model, false);
    console.log(`Recorded: ${model} — marked NOT USEFUL`);
  }
  console.log(`Recorded: ${model} (total: ${data.count}, unique models: ${data.models.length})`);
}

/**
 * COLLAB — View or post collaboration summary for a line of work.
 * Shows external models consulted and agent collaborators across all sessions.
 */
async function cmdCollab(nameOrId, opts) {
  const log = getCollabLog();

  if (!nameOrId) {
    // Show all parent items
    console.log('\n=== Collaboration Summary (All Lines of Work) ===\n');
    const items = Object.entries(log.parentItems);
    if (items.length === 0) {
      console.log('  No collaboration data yet. Post checkpoints to start tracking.');
    } else {
      for (const [name, data] of items) {
        console.log(`  ${name}`);
        console.log(`    External models: ${data.externalModels.count} calls, ${data.externalModels.roster.length} unique (${data.externalModels.roster.join(', ')})`);
        console.log(`    Collaborators: ${data.collaborators.join(', ') || 'none'}`);
        console.log(`    Last updated: ${data.lastUpdated || 'never'}`);
        console.log('');
      }
    }

    // Also show global model stats
    const models = Object.entries(log.modelEffectiveness);
    if (models.length > 0) {
      console.log('--- Global Model Usage ---\n');
      models.sort((a, b) => b[1].calls - a[1].calls);
      for (const [model, stats] of models) {
        const rate = stats.calls > 0 && stats.useful > 0 ? ` | useful: ${stats.useful}/${stats.calls} (${Math.round(stats.useful / stats.calls * 100)}%)` : '';
        console.log(`  ${model}: ${stats.calls} calls${rate}`);
      }
    }
    console.log('');
    return;
  }

  // Show specific parent item
  const itemName = nameOrId;
  // Try to match by name in log first
  let matchedName = Object.keys(log.parentItems).find(n => n.toLowerCase() === itemName.toLowerCase());
  if (!matchedName) matchedName = Object.keys(log.parentItems).find(n => n.toLowerCase().includes(itemName.toLowerCase()));

  if (!matchedName) {
    console.log(`No collaboration data for "${itemName}". Post a checkpoint to that line of work first.`);
    return;
  }

  const data = log.parentItems[matchedName];
  console.log(`\n=== Collaboration: ${matchedName} ===\n`);
  console.log(`  External models: ${data.externalModels.count} total calls`);
  console.log(`  Unique models: ${data.externalModels.roster.join(', ')}`);
  console.log(`  Collaborators: ${data.collaborators.join(', ')}`);
  console.log(`  Last updated: ${data.lastUpdated}`);

  if (data.history && data.history.length > 0) {
    console.log('\n  Recent activity:');
    data.history.slice(-10).forEach(h => {
      console.log(`    [${h.timestamp.slice(0, 16)}] ${h.agent} — ${h.modelsThisSession} models engaged`);
    });
  }
  console.log('');

  // If --post flag, push summary to Monday.com
  if (opts && opts.post) {
    const itemId = await resolveItem(matchedName);
    const summary = [
      `COLLABORATION SUMMARY — ${matchedName}`,
      `External models: ${data.externalModels.count} calls across ${data.externalModels.roster.length} unique models`,
      `Models: ${data.externalModels.roster.join(', ')}`,
      `Agent collaborators: ${data.collaborators.join(', ')}`,
      `Updated: ${new Date().toISOString().slice(0, 16)}`
    ].join('\n');
    await mondayAPI(`mutation {
      create_update(item_id: ${itemId}, body: ${JSON.stringify(summary)}) { id }
    }`);
    console.log(`Summary posted to Monday.com: ${matchedName}`);
  }
}

/**
 * MODELS — Show model effectiveness rankings.
 * Reads from collaboration log to rank models by usefulness.
 */
async function cmdModels() {
  const log = getCollabLog();
  const models = Object.entries(log.modelEffectiveness);

  if (models.length === 0) {
    console.log('\nNo model data yet. Run jailbreak, horsepower, or reasoning-eval to start tracking.');
    return;
  }

  console.log('\n=== External Model Effectiveness ===\n');

  // Sort by useful rate (models with ratings first, then by call count)
  const rated = models.filter(([, s]) => s.useful > 0);
  const unrated = models.filter(([, s]) => s.useful === 0);

  rated.sort((a, b) => {
    const rateA = a[1].useful / a[1].calls;
    const rateB = b[1].useful / b[1].calls;
    return rateB - rateA;
  });
  unrated.sort((a, b) => b[1].calls - a[1].calls);

  if (rated.length > 0) {
    console.log('  RATED (by usefulness):');
    for (const [model, stats] of rated) {
      const effectiveCalls = Math.max(stats.calls, stats.useful);
      const rate = Math.round(stats.useful / effectiveCalls * 100);
      const bar = '█'.repeat(Math.round(rate / 10)) + '░'.repeat(10 - Math.round(rate / 10));
      console.log(`    ${bar} ${rate}%  ${model} (${stats.useful}/${effectiveCalls} useful)`);
    }
    console.log('');
  }

  if (unrated.length > 0) {
    console.log('  UNRATED (by call count):');
    for (const [model, stats] of unrated) {
      console.log(`    ${model}: ${stats.calls} calls — no usefulness ratings yet`);
    }
    console.log('');
  }

  // Summary
  const totalCalls = models.reduce((sum, [, s]) => sum + s.calls, 0);
  const totalUseful = models.reduce((sum, [, s]) => sum + s.useful, 0);
  console.log(`  Total: ${totalCalls} calls across ${models.length} models`);
  if (totalUseful > 0) {
    console.log(`  Overall useful rate: ${Math.round(totalUseful / totalCalls * 100)}%`);
  }
  console.log('');
}

// ========================================
// REEF (KNOWLEDGE BASE) COMMANDS
// ========================================

/**
 * REEF SEARCH — Search Knowledge Base items by keyword.
 * Searches item names and TLDR fields. Returns matches sorted by relevance.
 */
async function cmdReefSearch(query) {
  const data = await mondayAPI(`{
    boards(ids: [${BOARD_ID}]) {
      groups(ids: ["${GROUPS.knowledgeBase}"]) {
        items_page(limit: 500) {
          items {
            id name
            column_values { id text type }
            updates(limit: 1) { body created_at }
          }
        }
      }
    }
  }`);

  const items = data.boards[0].groups[0].items_page.items;
  const terms = query.toLowerCase().split(/\s+/);

  // Score each item by keyword match
  const scored = items.map(item => {
    const name = (item.name || '').toLowerCase();
    const tldr = (item.column_values.find(c => c.id === COLUMNS.tldr)?.text || '').toLowerCase();
    const category = (item.column_values.find(c => c.id === KB_COLUMNS.category)?.text || '').toLowerCase();
    const lastUpdate = (item.updates && item.updates[0]?.body || '').replace(/<[^>]+>/g, '').toLowerCase();

    let score = 0;
    for (const term of terms) {
      if (name.includes(term)) score += 3;
      if (tldr.includes(term)) score += 2;
      if (category.includes(term)) score += 1;
      if (lastUpdate.includes(term)) score += 1;
    }

    return { item, score, name: item.name, category, tldr: item.column_values.find(c => c.id === COLUMNS.tldr)?.text || '' };
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score);

  console.log(`\n=== REEF SEARCH: "${query}" — ${scored.length} results ===\n`);

  if (scored.length === 0) {
    console.log('  No matching knowledge entries found.');
    console.log(`  Try: node comms/monday.js reef add "Your insight" --category comms --confidence 80`);
  } else {
    const shown = scored.slice(0, 15);
    for (const s of shown) {
      const confidence = s.item.column_values.find(c => c.id === KB_COLUMNS.confidence)?.text || '';
      const joelScore = s.item.column_values.find(c => c.id === KB_COLUMNS.joelScore)?.text || '';
      const source = s.item.column_values.find(c => c.id === KB_COLUMNS.sourceSession)?.text || '';
      const outcome = s.item.column_values.find(c => c.id === KB_COLUMNS.outcomeType)?.text || '';
      const status = s.item.column_values.find(c => c.id === 'status')?.text || '';

      const meta = [
        s.category ? `cat:${s.category}` : '',
        outcome ? `type:${outcome}` : '',
        confidence ? `conf:${confidence}` : '',
        joelScore ? `joel:${joelScore}★` : '',
        source ? `src:${source}` : '',
      ].filter(Boolean).join(' | ');

      console.log(`  [${s.score}] ${s.item.name} (ID: ${s.item.id})`);
      if (meta) console.log(`      ${meta}`);
      if (s.tldr) console.log(`      ${s.tldr.slice(0, 150)}`);
      console.log('');
    }
    if (scored.length > 15) {
      console.log(`  ... and ${scored.length - 15} more results.`);
    }
  }
  console.log('');
}

/**
 * REEF ADD — Add a new knowledge entry to the Knowledge Base.
 * Creates an item in the Knowledge Base group with structured metadata.
 *
 * Usage:
 *   node comms/monday.js reef add "Insight title" --category comms --confidence 80
 *     --source "Session 145" --outcome breakthrough --evidence "What proved this"
 */
async function cmdReefAdd(title, opts) {
  const agentName = getAgentName();
  const columnValues = {};

  // Category (required)
  if (opts.category) {
    const catKey = opts.category.toLowerCase();
    if (catKey in KB_CATEGORIES) {
      columnValues[KB_COLUMNS.category] = { index: KB_CATEGORIES[catKey] };
    } else {
      console.error(`Unknown category: "${opts.category}". Options: ${Object.keys(KB_CATEGORIES).join(', ')}`);
      process.exit(1);
    }
  }

  // Outcome type
  if (opts.outcome) {
    const outKey = opts.outcome.toLowerCase();
    if (outKey in KB_OUTCOMES) {
      columnValues[KB_COLUMNS.outcomeType] = { index: KB_OUTCOMES[outKey] };
    }
  }

  // Confidence (0-100)
  if (opts.confidence) {
    columnValues[KB_COLUMNS.confidence] = opts.confidence;
  }

  // Source session
  if (opts.source) {
    columnValues[KB_COLUMNS.sourceSession] = opts.source;
  }

  // TLDR / evidence
  if (opts.evidence || opts.tldr) {
    columnValues[COLUMNS.tldr] = { text: (opts.evidence || opts.tldr).slice(0, 500) };
  }

  // Lead agent
  columnValues[COLUMNS.agent] = agentName;

  // Date
  columnValues[COLUMNS.date] = { date: new Date().toISOString().slice(0, 10) };

  // Status = KNOWLEDGE (same as existing KB items)
  columnValues[COLUMNS.status] = { label: 'KNOWLEDGE' };

  const result = await mondayAPI(`mutation {
    create_item(
      board_id: ${BOARD_ID},
      group_id: "${GROUPS.knowledgeBase}",
      item_name: ${JSON.stringify(title)},
      column_values: ${JSON.stringify(JSON.stringify(columnValues))}
    ) { id name }
  }`);

  console.log(`Reef entry created: "${result.create_item.name}" (ID: ${result.create_item.id})`);

  // Post evidence/context as first update if provided
  if (opts.evidence) {
    const body = [
      `KNOWLEDGE ENTRY — ${agentName}`,
      `Category: ${opts.category || 'uncategorized'}`,
      `Confidence: ${opts.confidence || 'unset'}%`,
      `Source: ${opts.source || 'this session'}`,
      `Outcome: ${opts.outcome || 'unset'}`,
      '',
      `Evidence: ${opts.evidence}`
    ].join('\n');

    await mondayAPI(`mutation {
      create_update(item_id: ${result.create_item.id}, body: ${JSON.stringify(body)}) { id }
    }`);
    console.log(`Evidence posted as update.`);
  }

  return result.create_item.id;
}

/**
 * REEF VALIDATE — Mark a knowledge entry as validated with evidence.
 * Posts a validation comment and can update confidence.
 */
async function cmdReefValidate(nameOrId, reason, opts) {
  const itemId = await resolveKBItem(nameOrId);
  const agentName = getAgentName();

  const body = [
    `VALIDATED — ${agentName}`,
    `Reason: ${reason}`,
    opts.confidence ? `Updated confidence: ${opts.confidence}%` : '',
    `Date: ${new Date().toISOString().slice(0, 16)}`
  ].filter(Boolean).join('\n');

  await mondayAPI(`mutation {
    create_update(item_id: ${itemId}, body: ${JSON.stringify(body)}) { id }
  }`);

  // Update confidence if provided
  if (opts.confidence) {
    const colVals = { [KB_COLUMNS.confidence]: opts.confidence };
    await mondayAPI(`mutation {
      change_multiple_column_values(
        board_id: ${BOARD_ID},
        item_id: ${itemId},
        column_values: ${JSON.stringify(JSON.stringify(colVals))}
      ) { id }
    }`);
  }

  console.log(`Validated KB item ${itemId}. Reason: ${reason}`);
}

/**
 * REEF CHALLENGE — Challenge a knowledge entry with counter-evidence.
 * Posts a challenge comment. Joel sees it in Monday.com.
 */
async function cmdReefChallenge(nameOrId, reason, opts) {
  const itemId = await resolveKBItem(nameOrId);
  const agentName = getAgentName();

  const body = [
    `CHALLENGED — ${agentName}`,
    `Challenge: ${reason}`,
    opts.evidence ? `Counter-evidence: ${opts.evidence}` : '',
    `Date: ${new Date().toISOString().slice(0, 16)}`
  ].filter(Boolean).join('\n');

  await mondayAPI(`mutation {
    create_update(item_id: ${itemId}, body: ${JSON.stringify(body)}) { id }
  }`);

  console.log(`Challenged KB item ${itemId}. Reason: ${reason}`);
}

/**
 * REEF LIST — Show recent Knowledge Base entries, optionally filtered by category.
 */
async function cmdReefList(opts) {
  const data = await mondayAPI(`{
    boards(ids: [${BOARD_ID}]) {
      groups(ids: ["${GROUPS.knowledgeBase}"]) {
        items_page(limit: 50) {
          items {
            id name
            column_values { id text type }
          }
        }
      }
    }
  }`);

  const items = data.boards[0].groups[0].items_page.items;
  let filtered = items;

  // Filter by category if specified
  if (opts.category) {
    const cat = opts.category.toLowerCase();
    filtered = items.filter(item => {
      const itemCat = (item.column_values.find(c => c.id === KB_COLUMNS.category)?.text || '').toLowerCase();
      return itemCat.includes(cat);
    });
  }

  // Filter by joel-scored if specified
  if (opts.scored) {
    filtered = filtered.filter(item => {
      const score = item.column_values.find(c => c.id === KB_COLUMNS.joelScore)?.text || '';
      return score && score !== '0';
    });
  }

  console.log(`\n=== REEF — ${filtered.length} entries${opts.category ? ` (category: ${opts.category})` : ''}${opts.scored ? ' (joel-scored only)' : ''} ===\n`);

  for (const item of filtered.slice(0, 30)) {
    const category = item.column_values.find(c => c.id === KB_COLUMNS.category)?.text || '';
    const confidence = item.column_values.find(c => c.id === KB_COLUMNS.confidence)?.text || '';
    const joelScore = item.column_values.find(c => c.id === KB_COLUMNS.joelScore)?.text || '';
    const source = item.column_values.find(c => c.id === KB_COLUMNS.sourceSession)?.text || '';
    const outcome = item.column_values.find(c => c.id === KB_COLUMNS.outcomeType)?.text || '';

    const meta = [
      category ? `[${category}]` : '',
      outcome ? `(${outcome})` : '',
      confidence ? `conf:${confidence}` : '',
      joelScore ? `joel:${joelScore}★` : '',
      source ? `src:${source}` : '',
    ].filter(Boolean).join(' ');

    console.log(`  ${item.name}`);
    if (meta) console.log(`    ${meta}`);
  }

  if (filtered.length > 30) {
    console.log(`\n  ... and ${filtered.length - 30} more. Use --category to filter.`);
  }
  console.log('');
}

/**
 * Resolve a Knowledge Base item by name or ID.
 */
async function resolveKBItem(nameOrId) {
  if (/^\d+$/.test(nameOrId)) return nameOrId;

  const data = await mondayAPI(`{
    boards(ids: [${BOARD_ID}]) {
      groups(ids: ["${GROUPS.knowledgeBase}"]) {
        items_page(limit: 500) {
          items { id name }
        }
      }
    }
  }`);

  const items = data.boards[0].groups[0].items_page.items;
  const lower = nameOrId.toLowerCase();
  const exact = items.find(i => i.name.toLowerCase() === lower);
  if (exact) return exact.id;
  const partial = items.find(i => i.name.toLowerCase().includes(lower));
  if (partial) return partial.id;
  throw new Error(`No KB item matching "${nameOrId}". Try: node comms/monday.js reef search "${nameOrId}"`);
}

// --- Helpers ---
/**
 * PEER REVIEW GATE — Check if a peer agent has reviewed this item.
 * Peer review = an update (comment) from a DIFFERENT agent that references knowledge.
 * Knowledge reference = KB item ID, W-number, or "reef" command evidence.
 * Returns { passed: bool, reason: string }
 */
async function checkPeerReview(itemId) {
  const currentAgent = getAgentName().toLowerCase();

  // Fetch updates (comments) on this item
  const data = await mondayAPI(`{
    items(ids: [${itemId}]) {
      updates(limit: 20) {
        id body text_body creator { name }
      }
    }
  }`);

  const updates = data.items[0]?.updates || [];
  if (updates.length === 0) {
    return { passed: false, reason: 'No updates on this item. A peer agent must review and post a knowledge-referencing comment before marking done.' };
  }

  // Knowledge reference patterns
  const kbPatterns = [
    /\bW-\d+\b/,                    // Wisdom entry: W-123
    /\bKB[-:]?\s*\d{8,}/,           // KB item ID
    /\breef\s+(add|validate|challenge|search)/i,  // Reef command reference
    /\b1134\d{7}\b/,                // Monday.com KB item ID (starts with 1134...)
    /\bknowledge base\b/i,          // Explicit KB reference
    /\b(breakthrough|failure|confirmation|hypothesis)\b/i,  // Outcome type reference
    /\bconf(idence)?:\s*\d+/i,      // Confidence reference
  ];

  for (const update of updates) {
    const body = (update.text_body || update.body || '').toLowerCase();
    const creatorName = (update.creator?.name || '').toLowerCase();

    // Skip if same agent (case-insensitive partial match)
    if (creatorName.includes(currentAgent) || currentAgent.includes(creatorName)) continue;
    // Skip if creator is empty/unknown
    if (!creatorName || creatorName === 'unknown-agent') continue;

    // Check if this update references knowledge
    const rawBody = update.text_body || update.body || '';
    const hasKBRef = kbPatterns.some(p => p.test(rawBody));

    if (hasKBRef) {
      return { passed: true, reason: `Peer review by ${update.creator.name}: references knowledge in update ${update.id}` };
    }
  }

  // Check if there are peer comments at all (even without KB reference)
  const peerComments = updates.filter(u => {
    const name = (u.creator?.name || '').toLowerCase();
    return name && name !== 'unknown-agent' && !name.includes(currentAgent) && !currentAgent.includes(name);
  });

  if (peerComments.length === 0) {
    return { passed: false, reason: 'No peer comments found. A different agent must review this work and reference a knowledge entry (W-number, KB item, or reef command) before marking done.' };
  }

  return { passed: false, reason: `Found ${peerComments.length} peer comment(s) but none reference knowledge. Reviewer must include a KB reference (W-123, reef add/validate, or KB item ID).` };
}

function getAgentName() {
  const agentFile = path.join(ROOT, 'comms', 'data', '.active-agent');
  try {
    if (fs.existsSync(agentFile)) {
      const id = fs.readFileSync(agentFile, 'utf8').trim();
      const rosterFile = path.join(ROOT, 'comms', 'data', 'roster.json');
      if (fs.existsSync(rosterFile)) {
        const roster = JSON.parse(fs.readFileSync(rosterFile, 'utf8'));
        if (roster[id]) return roster[id].name || id;
      }
      return id;
    }
  } catch {}
  return 'unknown-agent';
}

// --- CLI Parser ---
function parseArgs(args) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      opts[key] = args[i + 1] || true;
      i++;
    } else {
      positional.push(args[i]);
    }
  }
  return { positional, opts };
}

// --- Main ---
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const { positional, opts } = parseArgs(args.slice(1));

  try {
    switch (command) {
      case 'briefing':
        await cmdBriefing();
        break;
      case 'status':
        await cmdStatus();
        break;
      case 'checkpoint':
        if (!positional[0]) { console.error('Usage: monday.js checkpoint <subitem> --done "..." --learned "..." --position "..." --confidence 75'); process.exit(1); }
        await cmdCheckpoint(positional[0], opts);
        break;
      case 'update':
        if (!positional[0]) { console.error('Usage: monday.js update <item> --status "Working on it" --agent "Probe"'); process.exit(1); }
        await cmdUpdate(positional[0], opts);
        break;
      case 'comment':
        if (!positional[0] || !positional[1]) { console.error('Usage: monday.js comment <item> "message"'); process.exit(1); }
        await cmdComment(positional[0], positional[1]);
        break;
      case 'create':
        if (!positional[0]) { console.error('Usage: monday.js create <name> --agent "Probe" --status "Working on it"'); process.exit(1); }
        await cmdCreate(positional[0], opts);
        break;
      case 'create-sub':
        if (!positional[0] || !positional[1]) { console.error('Usage: monday.js create-sub <parent> <name> --agent "Probe"'); process.exit(1); }
        await cmdCreateSub(positional[0], positional[1], opts);
        break;
      case 'subitems':
        if (!positional[0]) { console.error('Usage: monday.js subitems <item>'); process.exit(1); }
        await cmdSubitems(positional[0]);
        break;
      case 'claim':
        if (!positional[0] || !positional[1]) { console.error('Usage: monday.js claim <parent> <initiative-name>'); process.exit(1); }
        await cmdClaim(positional[0], positional[1], opts);
        break;
      case 'track-model':
        if (!positional[0]) { console.error('Usage: monday.js track-model <model-name> [tool] [--useful|--not-useful]'); process.exit(1); }
        await cmdTrackModel(positional[0], positional[1], opts);
        break;
      case 'open':
        await cmdOpen();
        break;
      case 'collab':
        await cmdCollab(positional[0], opts);
        break;
      case 'models':
        await cmdModels();
        break;
      case 'delete-sub':
        if (!positional[0]) { console.error('Usage: monday.js delete-sub <subitem-name-or-id>'); process.exit(1); }
        await cmdDeleteSub(positional[0]);
        break;
      case 'sync':
        await cmdSync(opts);
        break;
      case 'joel-view':
        await cmdJoelView();
        break;
      case 'reef': {
        const reefCmd = positional[0];
        const reefArgs = positional.slice(1);
        switch (reefCmd) {
          case 'search':
            if (!reefArgs[0]) { console.error('Usage: monday.js reef search <query>'); process.exit(1); }
            await cmdReefSearch(reefArgs.join(' '));
            break;
          case 'add':
            if (!reefArgs[0]) { console.error('Usage: monday.js reef add <title> --category <cat> --evidence "..." [--confidence N] [--source "S123"] [--outcome breakthrough|failure|confirmation|hypothesis]'); process.exit(1); }
            await cmdReefAdd(reefArgs.join(' '), opts);
            break;
          case 'validate':
            if (!reefArgs[0] || !reefArgs[1]) { console.error('Usage: monday.js reef validate <item-name-or-id> <reason> [--confidence N]'); process.exit(1); }
            await cmdReefValidate(reefArgs[0], reefArgs.slice(1).join(' '), opts);
            break;
          case 'challenge':
            if (!reefArgs[0] || !reefArgs[1]) { console.error('Usage: monday.js reef challenge <item-name-or-id> <reason> [--counter "evidence"]'); process.exit(1); }
            await cmdReefChallenge(reefArgs[0], reefArgs.slice(1).join(' '), opts);
            break;
          case 'list':
            await cmdReefList(opts);
            break;
          default:
            console.log(`
Reef (Knowledge Base) Commands:
  reef search <query>           Search KB entries by keyword
  reef add <title> [opts]       Add new knowledge entry
    --category <cat>            Category (required): multi-model, behavioral, onboarding, evaluation,
                                visual-qa, knowledge, instruction, enforcement, comms, product, technical
    --evidence "description"    Evidence or source description
    --confidence N              Agent confidence 0-100 (default: 70)
    --source "S145"             Source session number(s)
    --outcome <type>            breakthrough | failure | confirmation | hypothesis
  reef validate <item> <reason> Validate an existing KB entry (peer review)
    --confidence N              Update confidence after validation
  reef challenge <item> <reason> Challenge a KB entry with counter-evidence
    --counter "evidence"        Specific counter-evidence
  reef list [opts]              List KB entries
    --category <cat>            Filter by category
    --scored                    Show only Joel-scored entries

Examples:
  node comms/monday.js reef search "comms enforcement"
  node comms/monday.js reef add "Structural interdependence beats enforcement" --category behavioral --evidence "5-model horsepower convergence Session 145" --outcome breakthrough --confidence 85
  node comms/monday.js reef validate "Structural interdependence" "Confirmed in 4-agent build sprint — agents who depended on each other's output produced higher quality"
  node comms/monday.js reef challenge "Zero-friction adoption" "Session 145 showed agents DO use tools when the tool is required for their own work to proceed"
  node comms/monday.js reef list --category comms
`);
        }
        break;
      }
      default:
        console.log(`
Monday.com Board CLI v2 — Agent Coordination Interface

MEETING PREP:
  briefing                    Full board review (read this FIRST in meetings)
  status                      Quick status overview
  open                        Show only claimable work (NEW WORK! or unassigned)
  joel-view                   Joel's view — only what needs human attention

SESSION CLOSE:
  sync                        Show all YOUR open items + commands to close them out
  sync --report               JSON summary for handoff integration

PROGRESS TRACKING:
  checkpoint <subitem> [opts] Post checkpoint at 33/66/99% context
    --done "what I did"       Work completed
    --learned "what I found"  Key learnings
    --position "why I think"  Position justification
    --confidence 75           Confidence percentage
    --blockers "what's stuck" Blockers
    --questions "open Qs"     Unanswered questions
    --next "what's next"      Next steps
    --status "Working on it"  Update status

WORK MANAGEMENT:
  update <item> [opts]        Update parent item (line of work)
  comment <item> "msg"        Add update to any item
  create <name> [opts]        Create new line of work
  create-sub <parent> <name>  Create initiative under a line of work
  claim <parent> <name>       Quick claim — creates initiative, sets you as agent
  subitems <item>             List initiatives

MODEL TRACKING:
  track-model <name> [tool]   Record external model engagement
    --useful                  Mark model output as useful
    --not-useful              Mark model output as not useful

COLLABORATION:
  collab [parent-item]        View collaboration summary (models + agents)
    --post                    Post summary to Monday.com parent item
  models                      Rank external models by effectiveness

KNOWLEDGE BASE (REEF):
  reef search <query>           Search KB entries by keyword
  reef add <title> [opts]       Add new knowledge entry
  reef validate <item> <reason> Peer-review an existing KB entry
  reef challenge <item> <reason> Challenge a KB entry with counter-evidence
  reef list [opts]              List KB entries (--category <cat>, --scored)
  (run 'reef' with no subcommand for full usage)

Options:
  --status "Working on it"    Working on it | Done | Stuck | JOEL support | Not started
  --agent "Probe"             Agent name
  --tldr "summary"            Short summary
  --date "2026-02-18"         Date
  --group active|completed    For create only

Examples:
  node comms/monday.js briefing
  node comms/monday.js claim "Visual QC" "Layer 2 synonym matching" --tldr "Fixing keyword false positives"
  node comms/monday.js checkpoint "Layer 2 synonym matching" --done "Built fuzzy matcher" --learned "Levenshtein too slow, using trigrams" --position "Trigram approach beats edit distance for UX keyword matching" --confidence 80
  node comms/monday.js update "Visual QC" --status "JOEL support" --tldr "Need decision on accuracy threshold"
`);
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
