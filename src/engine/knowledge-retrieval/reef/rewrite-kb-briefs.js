#!/usr/bin/env node
/**
 * KB TLDR Rewrite: Abstract Wisdom → Grading Briefs
 *
 * Transforms TLDR fields on the 50 highest-signal KB entries from:
 *   "ALL-CAPS PRINCIPLE. When X, the pattern is Y. | Anti-pattern: Z"
 * To:
 *   "PROBLEM: [specific situation]. STORY: [what happened, what was tried].
 *    OUTCOME: [what worked/failed]. GRADE THIS: [what Joel should evaluate]"
 *
 * This enables Joel to "walk back into the context" and grade 1-5 stars.
 *
 * Usage:
 *   node reef/rewrite-kb-briefs.js --preview     # Show rewrites without updating
 *   node reef/rewrite-kb-briefs.js --execute      # Update Monday.com
 *   node reef/rewrite-kb-briefs.js --fetch-only   # Just fetch and score, save to file
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

// --- KB Group IDs ---
const GROUP_IDS = JSON.parse(
  fs.readFileSync(path.join(ROOT, '.fastops', 'kb-group-ids.json'), 'utf8')
);

const ALL_GROUP_IDS = Object.values(GROUP_IDS);

// --- Fetch all KB items with full column data ---
async function fetchAllKBItems() {
  const items = [];

  for (const gid of ALL_GROUP_IDS) {
    let cursor = null;

    while (true) {
      let query;
      if (!cursor) {
        query = `{
          boards(ids: [${BOARD_ID}]) {
            groups(ids: ["${gid}"]) {
              title
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

      let pageItems, nextCursor, groupTitle;
      if (!cursor) {
        const group = data.boards[0].groups[0];
        groupTitle = group.title;
        pageItems = group.items_page.items;
        nextCursor = group.items_page.cursor;
      } else {
        pageItems = data.next_items_page.items;
        nextCursor = data.next_items_page.cursor;
      }

      for (const item of pageItems) {
        const cols = {};
        for (const cv of item.column_values) {
          cols[cv.id] = cv.text || '';
        }
        items.push({
          id: item.id,
          name: item.name,
          groupId: gid,
          groupName: groupTitle || '',
          category: cols['color_mm0v2yaj'] || '',
          outcomeType: cols['color_mm0vfcsb'] || '',
          tldr: cols['long_text_mm0p5m2q'] || '',
          confidence: parseFloat(cols['numeric_mm0v9bph']) || 0,
          sourceSession: cols['text_mm0vzeyv'] || '',
          joelScore: cols['rating_mm0vt49r'] || '',
          joelFeedback: cols['long_text_mm0vk0h2'] || '',
        });
      }

      if (!nextCursor || pageItems.length === 0) break;
      cursor = nextCursor;
      await sleep(100);
    }
  }

  return items;
}

// --- Score items for signal strength ---
function scoreItem(item) {
  let score = 0;

  // Outcome type scoring
  const outcome = (item.outcomeType || '').toLowerCase();
  if (outcome.includes('breakthrough')) score += 5;
  else if (outcome.includes('failure')) score += 4;
  else if (outcome.includes('confirmation')) score += 2;
  else if (outcome.includes('hypothesis')) score += 1;

  // TLDR richness
  const tldrLen = (item.tldr || '').length;
  if (tldrLen > 200) score += 3;
  else if (tldrLen > 100) score += 2;
  else if (tldrLen > 50) score += 1;

  // Has anti-pattern (concrete learning)
  if (item.tldr.includes('Anti-pattern:')) score += 2;

  // Has source session reference
  if (item.tldr.includes('Source:') || item.sourceSession) score += 1;

  // Confidence boost
  if (item.confidence >= 80) score += 2;
  else if (item.confidence >= 60) score += 1;

  // Has "Used Nx" with N > 0
  const usedMatch = item.tldr.match(/Used (\d+)x/);
  if (usedMatch && parseInt(usedMatch[1]) > 0) score += 2;

  // Penalty for items already scored by Joel
  if (item.joelScore) score -= 10;

  // Name quality — specific situations score higher than abstract
  const name = item.name.toLowerCase();
  if (name.includes('when') && name.length > 40) score += 1;

  return score;
}

// --- Transform TLDR into grading brief ---
function transformTLDR(item) {
  const name = item.name;
  const tldr = item.tldr;

  // Parse TLDR: first sentence is the principle, rest is explanation
  // Handle both newline-separated and flat text formats
  let principle = '';
  let explanation = '';
  let antiPattern = '';
  let source = '';

  // Extract anti-pattern (appears after | Anti-pattern: or Anti-pattern:)
  const antiMatch = tldr.match(/\|?\s*Anti-pattern:\s*([^|]*?)(?:\||$)/i);
  if (antiMatch) antiPattern = antiMatch[1].trim();

  // Extract source line
  const srcMatch = tldr.match(/Source:\s*(.*?)$/m);
  if (srcMatch) source = srcMatch[0].trim();

  // Extract validated info
  const valMatch = tldr.match(/\|?\s*Validated:\s*([^|]*?)(?:\||$)/i);

  // Clean the main text: remove anti-pattern, validated, source lines
  let mainText = tldr
    .replace(/\|?\s*Anti-pattern:.*?(?:\||$)/gi, '')
    .replace(/\|?\s*Validated:.*?(?:\||$)/gi, '')
    .replace(/Source:.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  // First sentence (up to first .) is the principle
  const firstPeriod = mainText.indexOf('. ');
  if (firstPeriod > 0 && firstPeriod < 150) {
    principle = mainText.slice(0, firstPeriod + 1).trim();
    explanation = mainText.slice(firstPeriod + 2).trim();
  } else {
    // No clean sentence break — take first 100 chars as principle
    principle = mainText.slice(0, 100).trim();
    explanation = mainText.slice(100).trim();
  }

  // Extract "When X" from name as the problem trigger
  const problemTrigger = name
    .replace(/^\[(history|frontier)\]\s*/i, '')
    .replace(/^When\s+/i, '')
    .trim();

  // Build the grading brief — compact, scannable
  let brief = '';
  brief += `PROBLEM: ${problemTrigger}\n`;
  brief += `TYPE: ${item.outcomeType || 'Unknown'}\n\n`;
  brief += `PRINCIPLE: ${principle}\n\n`;

  if (explanation) {
    brief += `CONTEXT: ${explanation.slice(0, 500)}\n\n`;
  }

  if (antiPattern) {
    brief += `DON'T: ${antiPattern}\n\n`;
  }

  brief += `GRADE: 1 (noise) → 5 (critical). Is this actionable for the next agent hitting this problem?\n\n`;

  if (source) {
    brief += source;
  } else if (item.sourceSession) {
    brief += `Source: Session ${item.sourceSession}`;
  }

  return brief.trim();
}

// --- Update TLDR on Monday.com ---
async function updateTLDR(itemId, newTldr) {
  // Build column value object, then double-stringify for GraphQL JSON scalar
  const colValues = { long_text_mm0p5m2q: { text: newTldr } };
  const colValuesStr = JSON.stringify(JSON.stringify(colValues));

  const query = `mutation {
    change_multiple_column_values(
      item_id: ${itemId},
      board_id: ${BOARD_ID},
      column_values: ${colValuesStr}
    ) {
      id
    }
  }`;
  return mondayAPI(query);
}

// --- Main ---
async function main() {
  const mode = process.argv[2] || '--preview';

  console.log('=== KB TLDR Rewrite: Abstract Wisdom → Grading Briefs ===\n');

  // Step 1: Fetch all items
  console.log('Fetching all KB items...');
  const items = await fetchAllKBItems();
  console.log(`Found ${items.length} items across ${ALL_GROUP_IDS.length} groups\n`);

  // Step 2: Score and rank
  for (const item of items) {
    item.signalScore = scoreItem(item);
  }
  items.sort((a, b) => b.signalScore - a.signalScore);

  // Step 3: Take top 50, deduplicating by name
  const seen = new Set();
  const top50 = [];
  for (const item of items) {
    const key = item.name.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    top50.push(item);
    if (top50.length >= 50) break;
  }

  console.log('--- TOP 50 HIGHEST-SIGNAL ENTRIES ---');
  const groupCounts = {};
  for (const item of top50) {
    const groupKey = Object.entries(GROUP_IDS).find(([_, v]) => v === item.groupId)?.[0] || 'unknown';
    groupCounts[groupKey] = (groupCounts[groupKey] || 0) + 1;
  }
  console.log('Distribution across groups:');
  for (const [group, count] of Object.entries(groupCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${group}: ${count} entries`);
  }
  console.log();

  if (mode === '--fetch-only') {
    const outFile = path.join(ROOT, '.agent-outputs', 'kb-top50-scored.json');
    fs.writeFileSync(outFile, JSON.stringify(top50.map(i => ({
      id: i.id, name: i.name, score: i.signalScore,
      outcomeType: i.outcomeType, tldr: i.tldr.slice(0, 200),
      group: Object.entries(GROUP_IDS).find(([_, v]) => v === i.groupId)?.[0]
    })), null, 2));
    console.log(`Top 50 saved to ${outFile}`);
    return;
  }

  if (mode === '--preview') {
    console.log('--- PREVIEW: First 5 rewrites ---\n');
    for (const item of top50.slice(0, 5)) {
      console.log(`[${item.id}] ${item.name.slice(0, 80)}`);
      console.log(`  Score: ${item.signalScore} | Outcome: ${item.outcomeType}`);
      console.log('  --- CURRENT TLDR (first 200 chars) ---');
      console.log(`  ${(item.tldr || 'EMPTY').slice(0, 200)}`);
      console.log('  --- NEW BRIEF ---');
      const brief = transformTLDR(item);
      console.log(`  ${brief.slice(0, 300)}`);
      console.log();
    }
    console.log('Use --execute to update Monday.com, or --fetch-only to save scored list.');
    return;
  }

  if (mode === '--execute') {
    console.log(`Rewriting TLDR on ${top50.length} entries...\n`);
    let updated = 0;
    let errors = 0;
    const results = [];

    for (const item of top50) {
      const newBrief = transformTLDR(item);

      if (!newBrief || newBrief.length < 20) {
        console.log(`  SKIP [${item.id}] — brief too short`);
        continue;
      }

      try {
        await updateTLDR(item.id, newBrief);
        updated++;
        results.push({
          id: item.id,
          name: item.name,
          score: item.signalScore,
          briefLength: newBrief.length
        });
        if (updated % 10 === 0) console.log(`  Progress: ${updated}/${top50.length}`);
        await sleep(150); // Rate limiting
      } catch (e) {
        console.error(`  ERROR [${item.id}]: ${e.message}`);
        errors++;
        await sleep(500);
      }
    }

    console.log(`\nDone: ${updated} updated, ${errors} errors`);

    // Save results
    const resultsFile = path.join(ROOT, '.agent-outputs', 'kb-brief-rewrites.json');
    fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
    console.log(`Results saved to ${resultsFile}`);
  }
}

main().catch(e => {
  console.error('Failed:', e.message);
  process.exit(1);
});
