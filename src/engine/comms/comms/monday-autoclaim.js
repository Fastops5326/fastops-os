#!/usr/bin/env node
/**
 * Monday.com Auto-Claim — Multi-Signal Matching
 *
 * Runs at session-start. Reads predecessor handoff, board items, and
 * product mappings to auto-claim the most likely board item for this session.
 *
 * Signals (weight × recency):
 *   1. HANDOFF.md "What's Next" text vs board item names (weight: 0.4)
 *   2. PRODUCTS.md product mapping (weight: 0.3)
 *   3. LIVE-THINKING.jsonl mentions of item names (weight: 0.2)
 *   4. Manual claim from predecessor handoff (weight: 0.1 bonus)
 *
 * Confidence thresholds:
 *   80%+ → auto-claim silently
 *   50-79% → suggest to agent, require confirmation
 *   <50% → no match, fall through to nudge
 *
 * Anti-Goodhart: matches against artifacts that ARE the work.
 * Degeneracy: multiple redundant signals for robustness.
 *
 * Usage:
 *   node comms/monday-autoclaim.js           — Run matching, output result
 *   node comms/monday-autoclaim.js --commit  — Auto-claim if confidence >= 80%
 *
 * Origin: DeepSeek R1 (costly signaling + degeneracy), Horsepower Session 109
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const HANDOFF_FILE = path.join(ROOT, '.fastops', 'HANDOFF.md');
const PRODUCTS_FILE = path.join(ROOT, 'PRODUCTS.md');
const THINKING_FILE = path.join(ROOT, '.fastops', 'LIVE-THINKING.jsonl');
const STATE_FILE = path.join(ROOT, '.fastops', '.monday-sync-state.json');
const ACTIVE_AGENT_FILE = path.join(ROOT, 'comms', 'data', '.active-agent');
const ROSTER_FILE = path.join(ROOT, 'comms', 'data', 'roster.json');

// --- Monday.com API ---

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

function mondayAPI(query) {
  const env = loadEnv();
  if (!env.MONDAY_API_KEY || !env.MONDAY_BOARD_ID) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const options = {
      hostname: 'api.monday.com', path: '/v2', method: 'POST',
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
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// --- String Similarity (Normalized Levenshtein) ---

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const al = a.toLowerCase().trim();
  const bl = b.toLowerCase().trim();
  if (al === bl) return 1.0;
  if (al.includes(bl) || bl.includes(al)) return 0.8;
  const maxLen = Math.max(al.length, bl.length);
  if (maxLen === 0) return 0;
  return 1 - levenshtein(al, bl) / maxLen;
}

// Also check word overlap for multi-word matching
function wordOverlap(text, itemName) {
  if (!text || !itemName) return 0;
  const textWords = new Set(text.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const itemWords = itemName.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (itemWords.length === 0) return 0;
  const matches = itemWords.filter(w => textWords.has(w)).length;
  return matches / itemWords.length;
}

// --- Signal Extractors ---

function extractHandoffNext() {
  if (!fs.existsSync(HANDOFF_FILE)) return [];
  const content = fs.readFileSync(HANDOFF_FILE, 'utf8');

  // Find the last "What's Next" section
  const sections = content.split(/^## What's Next/m);
  if (sections.length < 2) return [];

  const lastNext = sections[sections.length - 1];
  // Extract numbered items
  const items = [];
  const lines = lastNext.split('\n');
  for (const line of lines) {
    const match = line.match(/^\d+\.\s+\*\*(.+?)\*\*/);
    if (match) {
      items.push(match[1].trim());
    } else {
      const simpleMatch = line.match(/^\d+\.\s+(.+)/);
      if (simpleMatch && !simpleMatch[1].startsWith('#')) {
        items.push(simpleMatch[1].trim().replace(/\*\*/g, ''));
      }
    }
    // Stop at next section
    if (line.startsWith('## ') && !line.startsWith('## What\'s Next')) break;
  }
  return items;
}

function extractThinkingMentions(boardItems) {
  if (!fs.existsSync(THINKING_FILE)) return {};
  const lines = fs.readFileSync(THINKING_FILE, 'utf8').trim().split('\n').slice(-20);
  const mentions = {};

  for (const item of boardItems) {
    mentions[item.name] = 0;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const content = (entry.content || '').toLowerCase();
        if (content.includes(item.name.toLowerCase())) {
          mentions[item.name]++;
        }
        // Also check word overlap
        if (wordOverlap(content, item.name) >= 0.5) {
          mentions[item.name] += 0.5;
        }
      } catch {}
    }
  }
  return mentions;
}

// --- Main Matching ---

async function matchBoardItems() {
  const env = loadEnv();
  if (!env.MONDAY_BOARD_ID) {
    console.log('No MONDAY_BOARD_ID in .env');
    return null;
  }

  // Fetch work items only — group-filtered to skip 200+ Knowledge Base entries
  // KB group (group_mm0vk3wg) was bulk-seeded first, so items_page always returns KB items only.
  // Fix: query specific work groups directly.
  const WORK_GROUPS = '"topics", "group_mm0pyd17", "group_title"'; // Active, Joel Request, Completed
  const data = await mondayAPI(`{
    boards(ids: [${env.MONDAY_BOARD_ID}]) {
      groups(ids: [${WORK_GROUPS}]) {
        id title
        items_page(limit: 100) {
          items {
            id name
            column_values { id text }
            subitems {
              id name
              column_values { id text }
            }
          }
        }
      }
    }
  }`);

  if (!data || !data.boards || !data.boards[0]) return null;

  // Flatten items from all work groups, attaching group info
  const items = data.boards[0].groups.flatMap(g =>
    g.items_page.items.map(item => ({ ...item, group: { id: g.id, title: g.title } }))
  );

  // Collect all claimable items (parent items + subitems without an agent)
  const claimable = [];
  for (const item of items) {
    // Add parent items that are active
    const group = item.group?.title || '';
    if (group.toLowerCase().includes('completed')) continue;

    claimable.push({
      id: item.id,
      name: item.name,
      type: 'parent',
      parent_id: null,
      parent_name: null
    });

    for (const sub of (item.subitems || [])) {
      const agent = sub.column_values.find(c => c.id === 'text_mm0pk5h0')?.text || '';
      const status = sub.column_values.find(c => c.id === 'status')?.text || '';
      // Include items that are unclaimed or not done
      if (status.toLowerCase() !== 'done') {
        claimable.push({
          id: sub.id,
          name: sub.name,
          type: 'subitem',
          parent_id: item.id,
          parent_name: item.name,
          current_agent: agent
        });
      }
    }
  }

  // Signal 1: Handoff "What's Next" (weight 0.4)
  const handoffItems = extractHandoffNext();

  // Signal 2: Thinking stream mentions (weight 0.2)
  const thinkingMentions = extractThinkingMentions(claimable);

  // Score each claimable item
  const scores = claimable.map(item => {
    let score = 0;
    let signals = [];

    // Signal 1: Handoff match (weight 0.4)
    for (const handoffText of handoffItems) {
      const sim = Math.max(similarity(handoffText, item.name), wordOverlap(handoffText, item.name));
      if (sim > 0.4) {
        const handoffScore = sim * 0.4;
        score += handoffScore;
        signals.push(`handoff: "${handoffText}" → ${Math.round(sim * 100)}%`);
        break; // Best match only
      }
    }

    // Signal 2: Thinking stream mentions (weight 0.2)
    const mentions = thinkingMentions[item.name] || 0;
    if (mentions > 0) {
      const thinkingScore = Math.min(mentions / 3, 1) * 0.2;
      score += thinkingScore;
      signals.push(`thinking: ${mentions} mentions`);
    }

    // Signal 3: Prefer subitems over parent items (weight 0.1 bonus)
    if (item.type === 'subitem' && !item.current_agent) {
      score += 0.1;
      signals.push('unclaimed subitem bonus');
    }

    return {
      ...item,
      confidence: Math.round(score * 100),
      signals
    };
  });

  // Sort by confidence descending
  scores.sort((a, b) => b.confidence - a.confidence);

  return scores.filter(s => s.confidence > 0);
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

function loadSyncState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch {}
  return { version: 1, sessions: {}, queue: [], last_flush_ts: null };
}

function saveSyncState(state) {
  const dir = path.dirname(STATE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  const shouldCommit = args.includes('--commit');

  try {
    const matches = await matchBoardItems();

    if (!matches || matches.length === 0) {
      console.log('MONDAY AUTO-CLAIM: No matching board items found.');
      console.log('Use `node comms/monday.js claim "<parent>" "<name>"` to claim manually.');
      return;
    }

    const best = matches[0];
    const agentName = getAgentName();

    console.log(`\nMONDAY AUTO-CLAIM RESULTS\n`);

    // Show top 3 matches
    for (const match of matches.slice(0, 3)) {
      const marker = match.confidence >= 80 ? 'AUTO' : match.confidence >= 50 ? 'SUGGEST' : 'LOW';
      const parentInfo = match.parent_name ? ` (under ${match.parent_name})` : '';
      console.log(`  [${marker} ${match.confidence}%] ${match.name}${parentInfo}`);
      if (match.signals.length > 0) {
        console.log(`    Signals: ${match.signals.join(', ')}`);
      }
    }
    console.log('');

    if (best.confidence >= 80 && shouldCommit) {
      // Auto-claim
      const state = loadSyncState();
      state.sessions[agentName] = {
        claim: {
          board_item_id: best.id,
          board_item_name: best.name,
          parent_item_id: best.parent_id,
          parent_item_name: best.parent_name,
          confidence: best.confidence,
          method: 'auto-handoff',
          signals_used: best.signals.map(s => s.split(':')[0]),
          claimed_at: new Date().toISOString()
        },
        state: 'claimed',
        last_sync_ts: null,
        pending_transitions: [],
        todos_summary: null,
        agent_name: agentName,
        session_start: new Date().toISOString()
      };
      saveSyncState(state);

      // Also update Monday.com directly
      if (best.type === 'subitem') {
        try {
          const boardData = await mondayAPI(`{ items(ids: [${best.id}]) { board { id } } }`);
          if (boardData && boardData.items && boardData.items[0]) {
            const subBoardId = boardData.items[0].board.id;
            const columnValues = {
              'text_mm0pk5h0': agentName,
              'status': { index: 0 } // working on it
            };
            await mondayAPI(`mutation {
              change_multiple_column_values(
                board_id: ${subBoardId},
                item_id: ${best.id},
                column_values: ${JSON.stringify(JSON.stringify(columnValues))}
              ) { id }
            }`);
          }
        } catch (e) {
          console.log(`  (Board update failed: ${e.message} — claim saved locally)`);
        }
      }

      console.log(`AUTO-CLAIMED: "${best.name}" → ${agentName} (${best.confidence}% confidence)`);
      console.log(`Sync state saved. monday-sync.js will track further transitions.`);
    } else if (best.confidence >= 50) {
      console.log(`SUGGESTED: "${best.name}" (${best.confidence}% confidence)`);
      console.log(`To claim: node comms/monday.js claim "${best.parent_name || best.name}" "${best.name}"`);
      console.log(`Or run: node comms/monday-autoclaim.js --commit`);
    } else {
      console.log(`No high-confidence match. Best: "${best.name}" at ${best.confidence}%`);
      console.log(`Claim manually: node comms/monday.js claim "<parent>" "<name>" --tldr "what you're working on"`);
    }

  } catch (e) {
    console.error('Auto-claim error:', e.message);
    process.exit(1);
  }
}

main();
