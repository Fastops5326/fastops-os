#!/usr/bin/env node
/**
 * Knowledge Base Migration: 11 Abstract Categories → 8 Problem-Domain Groups
 *
 * What this does:
 *   1. Creates 8 new problem-domain groups on Monday.com
 *   2. Fetches all KB items from the old Knowledge Base group
 *   3. Maps each item to a new group based on content analysis
 *   4. Moves items to their new groups
 *   5. Reports results (does NOT delete the old group — that's manual after verification)
 *
 * Usage:
 *   node reef/migrate-kb-groups.js --dry-run     # Preview mapping without making changes
 *   node reef/migrate-kb-groups.js --execute      # Actually perform the migration
 *   node reef/migrate-kb-groups.js --report       # Just show current state
 *
 * Rate limiting: 100ms between API calls (~600/min, well within Monday.com limits)
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

// --- GraphQL Client (with retry) ---
function mondayAPI(query, retries = 3) {
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
      res.on('end', async () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.errors) {
            const msg = parsed.errors.map(e => e.message).join('; ');
            if (retries > 0 && (msg.includes('rate') || msg.includes('limit') || res.statusCode === 429)) {
              await sleep(2000);
              resolve(mondayAPI(query, retries - 1));
            } else {
              reject(new Error(msg));
            }
          } else {
            resolve(parsed.data);
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// --- The 8 Problem-Domain Groups ---
const NEW_GROUPS = [
  { name: 'KB: Deploy & Ship', key: 'deploy' },
  { name: 'KB: Visual QA', key: 'visual-qa' },
  { name: 'KB: Multi-Agent Coordination', key: 'coordination' },
  { name: 'KB: Agent Behavior', key: 'behavior' },
  { name: 'KB: Knowledge & Search', key: 'knowledge' },
  { name: 'KB: Meeting & Collaboration', key: 'meeting' },
  { name: 'KB: Build Quality', key: 'build-quality' },
  { name: 'KB: Succession & Handoff', key: 'succession' },
];

// --- Old category → New group mapping ---
// This is the initial mapping. Content analysis refines it.
const CATEGORY_TO_GROUP = {
  'multi-model': 'meeting',        // Multi-model → Meeting & Collaboration
  'behavioral': 'behavior',        // Behavioral → Agent Behavior
  'onboarding': 'succession',      // Onboarding → Succession & Handoff
  'evaluation': 'build-quality',   // Evaluation → Build Quality
  'visual-qa': 'visual-qa',        // Visual QA → Visual QA (direct)
  'knowledge': 'knowledge',        // Knowledge → Knowledge & Search
  'instruction': 'behavior',       // Instruction → Agent Behavior
  'enforcement': 'coordination',   // Enforcement → Multi-Agent Coordination
  'comms': 'coordination',         // Comms → Multi-Agent Coordination
  'product': 'build-quality',      // Product → Build Quality
  'technical': 'deploy',           // Technical → Deploy & Ship
};

// --- Content-based refinement keywords ---
const CONTENT_SIGNALS = {
  'deploy': ['deploy', 'vercel', 'build', 'ship', 'production', 'ssl', 'domain', 'git push', 'npm', 'cron'],
  'visual-qa': ['visual', 'screenshot', 'css', 'ui', 'playwright', 'layout', 'color', 'font', 'responsive', 'dark', 'text-navy', 'mockup'],
  'coordination': ['deconflict', 'collision', 'comms', 'identity', 'lease', 'colony', 'duplicate', 'parallel', 'team', 'terminal'],
  'behavior': ['helpfulness', 'permission', 'bias', 'frame', 'vocabulary', 'compliance', 'joel', 'asking', 'autonomous'],
  'knowledge': ['wisdom', 'reef', 'search', 'index', 'knowledge', 'retrieval', 'taxonomy', 'categoriz'],
  'meeting': ['meeting', 'conversation', 'round-robin', 'external model', 'deepseek', 'gemini', 'qwq', 'jailbreak', 'horsepower', 'council'],
  'build-quality': ['test', 'untested', 'solo', 'challenge', 'scope', 'over-engineer', 'quality', 'contract', 'methodology'],
  'succession': ['handoff', 'compaction', 'successor', 'predecessor', 'onboard', 'context loss', 'session start', 'wake-up', 'baton'],
};

/**
 * Classify an item into a problem-domain group based on content analysis.
 * Returns the group key.
 */
function classifyItem(item) {
  const name = (item.name || '').toLowerCase();
  const tldr = (item.tldr || '').toLowerCase();
  const text = name + ' ' + tldr;

  // Score each group by keyword matches
  const scores = {};
  for (const [group, keywords] of Object.entries(CONTENT_SIGNALS)) {
    scores[group] = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) scores[group] += 2;
      if (name.includes(kw)) scores[group] += 1; // Extra weight for title matches
    }
  }

  // Find the highest-scoring group
  const bestGroup = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];

  // If content analysis found a strong signal (score >= 3), use it
  if (bestGroup[1] >= 3) return bestGroup[0];

  // Otherwise fall back to category mapping
  const oldCat = (item.category || '').toLowerCase().replace(/\s+/g, '-');
  for (const [key, group] of Object.entries(CATEGORY_TO_GROUP)) {
    if (oldCat.includes(key)) return group;
  }

  // Default: knowledge (catch-all)
  return 'knowledge';
}

// --- Fetch all KB items ---
async function fetchAllKBItems() {
  const OLD_KB_GROUP = 'group_mm0vk3wg';
  const items = [];
  let cursor = null;

  while (true) {
    let query;
    if (!cursor) {
      query = `{
        boards(ids: [${BOARD_ID}]) {
          groups(ids: ["${OLD_KB_GROUP}"]) {
            items_page(limit: 100) {
              cursor
              items {
                id name
                column_values { id text value }
              }
            }
          }
        }
      }`;
    } else {
      query = `{
        next_items_page(limit: 100, cursor: ${JSON.stringify(cursor)}) {
          cursor
          items {
            id name
            column_values { id text value }
          }
        }
      }`;
    }

    const data = await mondayAPI(query);

    let pageItems, nextCursor;
    if (!cursor) {
      const group = data.boards[0].groups[0];
      pageItems = group.items_page.items;
      nextCursor = group.items_page.cursor;
    } else {
      pageItems = data.next_items_page.items;
      nextCursor = data.next_items_page.cursor;
    }

    // Extract useful fields
    for (const item of pageItems) {
      const cols = {};
      for (const cv of item.column_values) {
        cols[cv.id] = cv.text || '';
      }
      items.push({
        id: item.id,
        name: item.name,
        category: cols['color_mm0v2yaj'] || '',
        outcomeType: cols['color_mm0vfcsb'] || '',
        tldr: cols['long_text_mm0p5m2q'] || '',
        confidence: cols['numeric_mm0v9bph'] || '',
        sourceSession: cols['text_mm0vzeyv'] || '',
      });
    }

    if (!nextCursor || pageItems.length === 0) break;
    cursor = nextCursor;
  }

  return items;
}

// --- Create the 8 new groups ---
async function createNewGroups() {
  const groupIds = {};
  for (const g of NEW_GROUPS) {
    const data = await mondayAPI(`mutation {
      create_group(board_id: ${BOARD_ID}, group_name: ${JSON.stringify(g.name)}) {
        id
      }
    }`);
    groupIds[g.key] = data.create_group.id;
    console.log(`  Created group "${g.name}" → ${groupIds[g.key]}`);
    await sleep(200);
  }
  return groupIds;
}

// --- Move an item to a group ---
async function moveItemToGroup(itemId, groupId) {
  return mondayAPI(`mutation {
    move_item_to_group(item_id: ${itemId}, group_id: ${JSON.stringify(groupId)}) {
      id
    }
  }`);
}

// --- Find duplicates ---
function findDuplicates(items) {
  const nameMap = {};
  for (const item of items) {
    const key = item.name.toLowerCase().trim();
    if (!nameMap[key]) nameMap[key] = [];
    nameMap[key].push(item);
  }
  return Object.entries(nameMap)
    .filter(([_, items]) => items.length > 1)
    .map(([name, items]) => ({ name, items, count: items.length }));
}

// --- Main ---
async function main() {
  const mode = process.argv[2] || '--report';

  console.log('=== Knowledge Base Migration: 11 Categories → 8 Problem Domains ===\n');

  // Fetch all items
  console.log('Fetching all KB items from Monday.com...');
  const items = await fetchAllKBItems();
  console.log(`Found ${items.length} items\n`);

  // Classify each item
  const assignments = {};
  for (const g of NEW_GROUPS) assignments[g.key] = [];

  for (const item of items) {
    const group = classifyItem(item);
    item.assignedGroup = group;
    assignments[group].push(item);
  }

  // Report
  console.log('--- GROUP ASSIGNMENT SUMMARY ---');
  for (const g of NEW_GROUPS) {
    const count = assignments[g.key].length;
    console.log(`  ${g.name}: ${count} items`);
  }
  console.log();

  // Find duplicates
  const dupes = findDuplicates(items);
  console.log(`--- DUPLICATES: ${dupes.length} duplicate names (${dupes.reduce((s, d) => s + d.count, 0)} items) ---`);
  if (mode === '--report' || mode === '--dry-run') {
    for (const d of dupes.slice(0, 20)) {
      console.log(`  "${d.name.slice(0, 80)}" (${d.count}x) — IDs: ${d.items.map(i => i.id).join(', ')}`);
    }
    if (dupes.length > 20) console.log(`  ... and ${dupes.length - 20} more`);
  }
  console.log();

  if (mode === '--report') {
    console.log('Use --dry-run to see detailed item assignments, or --execute to perform migration.');
    return;
  }

  if (mode === '--dry-run') {
    console.log('--- DRY RUN: Item Assignments ---');
    for (const g of NEW_GROUPS) {
      console.log(`\n=== ${g.name} (${assignments[g.key].length} items) ===`);
      for (const item of assignments[g.key].slice(0, 5)) {
        console.log(`  [${item.id}] ${item.name.slice(0, 80)}`);
        console.log(`    Old category: ${item.category} | Outcome: ${item.outcomeType}`);
      }
      if (assignments[g.key].length > 5) {
        console.log(`  ... and ${assignments[g.key].length - 5} more`);
      }
    }
    console.log('\nUse --execute to perform migration.');

    // Save full mapping to file for review
    const mappingFile = path.join(ROOT, '.agent-outputs', 'kb-migration-mapping.json');
    fs.writeFileSync(mappingFile, JSON.stringify(
      items.map(i => ({ id: i.id, name: i.name, oldCategory: i.category, newGroup: i.assignedGroup })),
      null, 2
    ));
    console.log(`Full mapping saved to ${mappingFile}`);
    return;
  }

  if (mode === '--execute') {
    console.log('--- EXECUTING MIGRATION ---\n');

    // Step 1: Create new groups
    console.log('Step 1: Creating 8 new groups...');
    const groupIds = await createNewGroups();
    console.log();

    // Save group IDs for reference
    const groupIdFile = path.join(ROOT, '.fastops', 'kb-group-ids.json');
    fs.writeFileSync(groupIdFile, JSON.stringify(groupIds, null, 2));
    console.log(`Group IDs saved to ${groupIdFile}\n`);

    // Step 2: Move items
    console.log(`Step 2: Moving ${items.length} items to new groups...`);
    let moved = 0;
    let errors = 0;
    for (const item of items) {
      const targetGroupId = groupIds[item.assignedGroup];
      if (!targetGroupId) {
        console.error(`  ERROR: No group ID for "${item.assignedGroup}" (item ${item.id})`);
        errors++;
        continue;
      }
      try {
        await moveItemToGroup(item.id, targetGroupId);
        moved++;
        if (moved % 50 === 0) console.log(`  Progress: ${moved}/${items.length} moved`);
        await sleep(100); // Rate limiting
      } catch (e) {
        console.error(`  ERROR moving item ${item.id}: ${e.message}`);
        errors++;
        await sleep(500); // Back off on error
      }
    }

    console.log(`\nMigration complete: ${moved} moved, ${errors} errors`);
    console.log('\nNOTE: Old "Knowledge Base" group NOT deleted. Verify in Monday.com, then delete manually.');
    console.log('After verification, update GROUPS.knowledgeBase references in:');
    console.log('  - comms/monday.js (6 references)');
    console.log('  - reef/monday-sync.js (KB_GROUP constant)');
  }
}

main().catch(e => {
  console.error('Migration failed:', e.message);
  process.exit(1);
});
