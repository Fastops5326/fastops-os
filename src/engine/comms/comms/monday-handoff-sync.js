#!/usr/bin/env node
/**
 * Monday.com Handoff Auto-Sync
 *
 * Run after /handoff writes the handoff entry. Reads the latest entry
 * from HANDOFF.md, extracts sections, and posts to the claimed board item.
 *
 * What it syncs:
 *   - "What Was Done" → TLDR column + update comment
 *   - "Outstanding Questions" → Questions column
 *   - "What's Next" → Comment on item
 *   - Status → Done (if no in-progress items) or Working on it
 *
 * Reads claim from .monday-sync-state.json (written by monday-autoclaim.js
 * or manual claim). If no claim exists, posts comment on best-match parent item.
 *
 * Usage:
 *   node comms/monday-handoff-sync.js           — Sync latest handoff entry
 *   node comms/monday-handoff-sync.js --dry-run — Show what would be synced
 *
 * Origin: Horsepower Session 109, Component 3
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const HANDOFF_FILE = path.join(ROOT, '.fastops', 'HANDOFF.md');
const STATE_FILE = path.join(ROOT, '.fastops', '.monday-sync-state.json');
const ACTIVE_AGENT_FILE = path.join(ROOT, 'comms', 'data', '.active-agent');
const ROSTER_FILE = path.join(ROOT, 'comms', 'data', 'roster.json');
const ENGAGEMENT_FILE = path.join(ROOT, '.fastops', '.model-engagements.json');

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
  if (!env.MONDAY_API_KEY) return Promise.resolve(null);

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

const SUB_COLUMNS = {
  status: 'status', agent: 'text_mm0pk5h0',
  tldr: 'long_text_mm0pw0y6', date: 'date0',
  questions: 'long_text_mm0pca52',
  modelsUsed: 'text_mm0pqpsr',
  modelCount: 'numeric_mm0pthtf'
};

const STATUS_LABELS = {
  'working on it': 0, 'done': 1, 'stuck': 2,
  'joel support': 3, 'not started': 5
};

// --- Extract Latest Handoff Entry ---

function extractLatestHandoff() {
  if (!fs.existsSync(HANDOFF_FILE)) return null;
  const content = fs.readFileSync(HANDOFF_FILE, 'utf8');

  // Split by handoff entries — supports both old "HANDOFF #" and new "SESSION #" formats
  const entries = content.split(/^--- (?:HANDOFF|SESSION|TEAM HANDOFF) #/m);
  if (entries.length < 2) return null;

  const prefix = content.match(/--- ((?:HANDOFF|SESSION|TEAM HANDOFF) #)/m)?.[1] || 'SESSION #';
  const lastEntry = '--- ' + prefix + entries[entries.length - 1];

  // Extract sections
  const sections = {};

  const extractSection = (name) => {
    // Case-insensitive match — handoff entries use Title Case, ALL CAPS, or mixed
    const regex = new RegExp(`^## ${name}\\b[^\\n]*\\n([\\s\\S]*?)(?=^## |^---|$)`, 'mi');
    const match = lastEntry.match(regex);
    if (match) {
      return match[1].trim().split('\n').filter(l => l.trim()).map(l => l.replace(/^[-*|]\s*/, '').trim()).join('; ');
    }
    return '';
  };

  // Current format (Session 132+): Shipped, Next Session Needs, etc.
  // Legacy format: What Was Done, What's Next, etc.
  sections.whatWasDone = extractSection('Shipped') || extractSection('What Was Done');
  sections.whatsInProgress = extractSection('Errors \\+ Fixes') || extractSection("What's In Progress");
  sections.whatsNext = extractSection('Next Session Needs') || extractSection("What's Next");
  sections.outstandingQuestions = extractSection('Wisdom Candidates') || extractSection('Outstanding Questions');
  sections.decisionsLocked = extractSection('Decisions Locked');
  sections.triad = extractSection('(?:Session )?Triad');

  // Extract entry number (supports HANDOFF #N, SESSION #N, TEAM HANDOFF #N)
  const numMatch = lastEntry.match(/(?:HANDOFF|SESSION|TEAM HANDOFF) #(\d+[-\d]*)/);
  sections.entryNumber = numMatch ? numMatch[1] : '?';

  return sections;
}

// --- Helpers ---

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

function getModelEngagements() {
  try {
    if (fs.existsSync(ENGAGEMENT_FILE)) {
      return JSON.parse(fs.readFileSync(ENGAGEMENT_FILE, 'utf8'));
    }
  } catch {}
  return { count: 0, models: [], sessions: [] };
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
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const agentName = getAgentName();

  // Extract latest handoff
  const handoff = extractLatestHandoff();
  if (!handoff) {
    console.log('No handoff entry found in HANDOFF.md');
    return;
  }

  console.log(`\nMONDAY HANDOFF SYNC — Entry #${handoff.entryNumber}\n`);
  console.log(`  Done: ${handoff.whatWasDone.slice(0, 120)}...`);
  console.log(`  Next: ${handoff.whatsNext.slice(0, 120)}...`);
  if (handoff.outstandingQuestions) {
    console.log(`  Questions: ${handoff.outstandingQuestions.slice(0, 120)}...`);
  }

  // Find claim
  const state = loadSyncState();
  let session = null;
  for (const [key, s] of Object.entries(state.sessions)) {
    if (s.agent_name === agentName || key === agentName) {
      session = s;
      break;
    }
  }

  if (!session || !session.claim) {
    console.log('\n  No claim found in sync state. Skipping board sync.');
    console.log('  (Handoff entry is preserved in HANDOFF.md for the backstop mechanism)');
    return;
  }

  const claim = session.claim;
  const hasInProgress = handoff.whatsInProgress && handoff.whatsInProgress.length > 0;
  const newStatus = hasInProgress ? 'working on it' : 'done';
  const engagements = getModelEngagements();

  console.log(`\n  Claim: "${claim.board_item_name}" (ID: ${claim.board_item_id})`);
  console.log(`  Status: ${session.state} → ${newStatus}`);
  console.log(`  Models engaged: ${engagements.count}`);

  if (dryRun) {
    console.log('\n  DRY RUN — no changes made.');
    return;
  }

  try {
    // Get subitem board ID
    const boardData = await mondayAPI(`{ items(ids: [${claim.board_item_id}]) { board { id } } }`);
    if (!boardData || !boardData.items || !boardData.items[0]) {
      console.log('  Could not find board item. Skipping sync.');
      return;
    }
    const subBoardId = boardData.items[0].board.id;

    // Build column update
    const columnValues = {
      [SUB_COLUMNS.status]: { index: STATUS_LABELS[newStatus] },
      [SUB_COLUMNS.date]: { date: new Date().toISOString().slice(0, 10) },
      [SUB_COLUMNS.tldr]: { text: handoff.whatWasDone.slice(0, 200) }
    };

    if (handoff.outstandingQuestions) {
      columnValues[SUB_COLUMNS.questions] = { text: handoff.outstandingQuestions.slice(0, 500) };
    }

    if (engagements.count > 0) {
      columnValues[SUB_COLUMNS.modelsUsed] = engagements.models.join(', ');
      columnValues[SUB_COLUMNS.modelCount] = String(engagements.count);
    }

    // Update columns
    await mondayAPI(`mutation {
      change_multiple_column_values(
        board_id: ${subBoardId},
        item_id: ${claim.board_item_id},
        column_values: ${JSON.stringify(JSON.stringify(columnValues))}
      ) { id }
    }`);

    // Post handoff summary as update comment
    const comment = [
      `HANDOFF #${handoff.entryNumber} — ${agentName}`,
      ``,
      `DONE: ${handoff.whatWasDone}`,
      handoff.whatsInProgress ? `IN PROGRESS: ${handoff.whatsInProgress}` : '',
      `NEXT: ${handoff.whatsNext}`,
      handoff.outstandingQuestions ? `QUESTIONS: ${handoff.outstandingQuestions}` : '',
      ``,
      `Models: ${engagements.count} (${engagements.models.join(', ') || 'none'})`
    ].filter(Boolean).join('\n');

    await mondayAPI(`mutation {
      create_update(item_id: ${claim.board_item_id}, body: ${JSON.stringify(comment)}) { id }
    }`);

    // Update sync state
    session.state = newStatus === 'done' ? 'done' : 'working';
    session.last_sync_ts = new Date().toISOString();
    saveSyncState(state);

    console.log(`\n  Board synced: "${claim.board_item_name}" → ${newStatus}`);
    console.log(`  Comment posted with handoff summary.`);

  } catch (e) {
    console.error(`  Sync error: ${e.message}`);
    console.log('  (Handoff entry preserved in HANDOFF.md — board can be updated manually)');
  }
}

main();
