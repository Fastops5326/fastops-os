#!/usr/bin/env node
/**
 * reef/monday-sync.js — Two-way sync between Monday.com Knowledge Base and local cache.
 *
 * Monday.com is the source of truth (Joel edits there).
 * Local cache (reef/kb-cache.json) enables millisecond agent search.
 *
 * Sync flow:
 *   1. Pull all KB items from Monday.com (name, category, outcome, confidence, joel score, joel feedback, source, TLDR)
 *   2. Write to reef/kb-cache.json
 *   3. Report: new entries, joel-scored entries, joel feedback changes
 *
 * Usage:
 *   node reef/monday-sync.js          Pull Monday.com KB → local cache
 *   node reef/monday-sync.js --stats  Show cache stats without syncing
 *   node reef/monday-sync.js --scored Show only Joel-scored entries
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CACHE_PATH = path.join(__dirname, 'kb-cache.json');

// Load env
const envVars = {};
try {
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n').forEach(l => {
    const m = l.match(/^([^#=]+)=\s*(.*)$/);
    if (m) envVars[m[1].trim()] = m[2].trim();
  });
} catch {}

const BOARD_ID = envVars.MONDAY_BOARD_ID;
const API_KEY = envVars.MONDAY_API_KEY;

if (!BOARD_ID || !API_KEY) {
  console.error('Missing MONDAY_BOARD_ID or MONDAY_API_KEY in .env');
  process.exit(1);
}

// Column IDs (must match comms/monday.js KB_COLUMNS)
const KB_COLUMNS = {
  category: 'color_mm0v2yaj',
  outcomeType: 'color_mm0vfcsb',
  joelScore: 'rating_mm0vt49r',
  joelFeedback: 'long_text_mm0vk0h2',
  confidence: 'numeric_mm0v9bph',
  sourceSession: 'text_mm0vzeyv',
};

const KB_GROUP = 'group_mm0vk3wg';

function mondayAPI(query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.monday.com',
      path: '/v2',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': API_KEY,
        'API-Version': '2024-10'
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(d);
          if (parsed.errors) reject(new Error(JSON.stringify(parsed.errors)));
          else resolve(parsed.data);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Fetch all KB items from Monday.com, handling pagination.
 */
async function fetchAllKBItems() {
  const items = [];
  let cursor = null;
  let page = 0;

  while (true) {
    page++;
    let query;
    if (!cursor) {
      query = `{
        boards(ids: [${BOARD_ID}]) {
          groups(ids: ["${KB_GROUP}"]) {
            items_page(limit: 100) {
              cursor
              items {
                id name
                column_values { id text type value }
                updates(limit: 5) { id text_body creator { name } created_at }
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
            column_values { id text type value }
            updates(limit: 5) { id text_body creator { name } created_at }
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

    items.push(...pageItems);

    if (!nextCursor || pageItems.length === 0) break;
    cursor = nextCursor;
  }

  return items;
}

/**
 * Transform Monday.com item to cache entry.
 */
function itemToEntry(item) {
  const col = (id) => item.column_values.find(c => c.id === id)?.text || '';
  const colValue = (id) => {
    const c = item.column_values.find(c => c.id === id);
    if (!c || !c.value) return null;
    try { return JSON.parse(c.value); } catch { return c.value; }
  };

  // Extract TLDR from status column text (it's the item name for KB entries)
  const statusCol = item.column_values.find(c => c.id === 'status');
  const status = statusCol?.text || '';

  // Get the first update body as the evidence/description
  const firstUpdate = item.updates?.[item.updates.length - 1];
  const evidence = firstUpdate?.text_body || '';

  // Joel feedback — get the rich text value
  const joelFeedbackValue = colValue(KB_COLUMNS.joelFeedback);
  const joelFeedback = typeof joelFeedbackValue === 'object' ? (joelFeedbackValue?.text || '') : (col(KB_COLUMNS.joelFeedback) || '');

  return {
    id: item.id,
    name: item.name,
    category: col(KB_COLUMNS.category),
    outcomeType: col(KB_COLUMNS.outcomeType),
    joelScore: col(KB_COLUMNS.joelScore) || null,
    joelFeedback: joelFeedback,
    confidence: col(KB_COLUMNS.confidence) || null,
    sourceSession: col(KB_COLUMNS.sourceSession),
    status: status,
    evidence: evidence,
    updateCount: item.updates?.length || 0,
    lastUpdate: item.updates?.[0]?.created_at || null,
  };
}

/**
 * Load existing cache.
 */
function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return { entries: [], syncedAt: null, stats: {} };
  }
}

/**
 * Main sync.
 */
async function sync() {
  console.log('Syncing Monday.com Knowledge Base → local cache...\n');

  const oldCache = loadCache();
  const oldEntries = new Map((oldCache.entries || []).map(e => [e.id, e]));

  const items = await fetchAllKBItems();
  console.log(`Fetched ${items.length} KB items from Monday.com`);

  const entries = items.map(itemToEntry);

  // Diff
  let newCount = 0, updatedCount = 0, joelScoredCount = 0, joelFeedbackCount = 0;
  const joelActions = [];

  for (const entry of entries) {
    const old = oldEntries.get(entry.id);
    if (!old) {
      newCount++;
    } else {
      // Check for changes
      if (entry.joelScore !== old.joelScore && entry.joelScore) {
        joelScoredCount++;
        joelActions.push(`  SCORED: "${entry.name}" → ${entry.joelScore}★`);
      }
      if (entry.joelFeedback !== old.joelFeedback && entry.joelFeedback) {
        joelFeedbackCount++;
        joelActions.push(`  FEEDBACK: "${entry.name}" → ${entry.joelFeedback.slice(0, 100)}`);
      }
      if (JSON.stringify(entry) !== JSON.stringify(old)) {
        updatedCount++;
      }
    }
  }

  // Stats
  const categoryBreakdown = {};
  const outcomeBreakdown = {};
  let scored = 0;
  for (const e of entries) {
    const cat = e.category || 'uncategorized';
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
    const out = e.outcomeType || 'untyped';
    outcomeBreakdown[out] = (outcomeBreakdown[out] || 0) + 1;
    if (e.joelScore && e.joelScore !== '0') scored++;
  }

  const cache = {
    entries,
    syncedAt: new Date().toISOString(),
    stats: {
      total: entries.length,
      newSinceLastSync: newCount,
      joelScored: scored,
      categories: categoryBreakdown,
      outcomes: outcomeBreakdown,
    }
  };

  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));

  // Report
  console.log(`\n=== SYNC COMPLETE ===`);
  console.log(`Total KB entries: ${entries.length}`);
  console.log(`New since last sync: ${newCount}`);
  console.log(`Updated: ${updatedCount}`);
  console.log(`Joel-scored: ${scored}`);

  if (joelActions.length > 0) {
    console.log(`\n=== JOEL ACTIONS (since last sync) ===`);
    joelActions.forEach(a => console.log(a));
  }

  console.log(`\nCategories:`);
  Object.entries(categoryBreakdown).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}`);
  });

  console.log(`\nOutcome types:`);
  Object.entries(outcomeBreakdown).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}`);
  });

  console.log(`\nCache written to: ${CACHE_PATH}`);
}

/**
 * Show cache stats without syncing.
 */
function showStats() {
  const cache = loadCache();
  if (!cache.syncedAt) {
    console.log('No cache found. Run: node reef/monday-sync.js');
    return;
  }

  console.log(`\n=== KB CACHE STATS ===`);
  console.log(`Last synced: ${cache.syncedAt}`);
  console.log(`Total entries: ${cache.stats.total}`);
  console.log(`Joel-scored: ${cache.stats.joelScored}`);

  if (cache.stats.categories) {
    console.log(`\nCategories:`);
    Object.entries(cache.stats.categories).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
      console.log(`  ${k}: ${v}`);
    });
  }
}

/**
 * Show only Joel-scored entries.
 */
function showScored() {
  const cache = loadCache();
  if (!cache.syncedAt) {
    console.log('No cache found. Run: node reef/monday-sync.js');
    return;
  }

  const scored = cache.entries.filter(e => e.joelScore && e.joelScore !== '0');
  console.log(`\n=== JOEL-SCORED ENTRIES (${scored.length}) ===\n`);

  for (const e of scored) {
    console.log(`  [${e.joelScore}★] ${e.name}`);
    if (e.joelFeedback) console.log(`    Feedback: ${e.joelFeedback.slice(0, 150)}`);
    console.log(`    Category: ${e.category} | Type: ${e.outcomeType}`);
    console.log('');
  }
}

// --- CLI ---
const args = process.argv.slice(2);
if (args.includes('--stats')) {
  showStats();
} else if (args.includes('--scored')) {
  showScored();
} else {
  sync().catch(e => {
    console.error('Sync error:', e.message);
    process.exit(1);
  });
}
