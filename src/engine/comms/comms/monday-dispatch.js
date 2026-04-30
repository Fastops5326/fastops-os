#!/usr/bin/env node
/**
 * Monday.com Dispatch Query — Agent Scope Cache
 *
 * Queries Monday.com for items assigned to this agent (by name),
 * writes scope to .fastops/.my-scope.json for PreToolUse hook reads.
 *
 * The scope cache is the source of truth for what files this agent can touch.
 * PreToolUse scope-check hook reads this file (0ms, no API call) on every Write/Edit.
 *
 * Usage:
 *   node comms/monday-dispatch.js              — Sync scope from Monday.com
 *   node comms/monday-dispatch.js --show       — Show current cached scope
 *   node comms/monday-dispatch.js --agent NAME — Override agent name (testing)
 *
 * Created: Session 142 (Torque) — meeting convergence deliverable #2
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCOPE_FILE = path.join(ROOT, '.fastops', '.my-scope.json');
const AGENTS_DIR = path.join(ROOT, 'comms', 'data', '.agents');

// --- Config ---
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

// Column IDs (from monday.js)
const COLUMNS = {
  agent: 'text_mm0pxgrr',       // Parent item agent
  tldr: 'long_text_mm0p5m2q',
  joelRequest: 'long_text_mm0pxxxf'
};
const SUB_COLUMNS = {
  agent: 'text_mm0pk5h0',       // Subitem agent
  tldr: 'long_text_mm0pw0y6'
};

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
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// --- Identity Resolution ---
function getAgentName() {
  // Try identity module first (session_id based)
  try {
    const identity = require(path.join(ROOT, '.claude', 'hooks', 'lib', 'identity'));
    const { name } = identity.fromBridge();
    if (name && name !== 'unknown') return name;
  } catch {}

  // Fallback to .active-agent
  const agentFile = path.join(ROOT, 'comms', 'data', '.active-agent');
  try {
    return fs.readFileSync(agentFile, 'utf8').trim();
  } catch {}

  return null;
}

// --- Scope Extraction ---

/**
 * Extract file scope patterns from item description/TLDR/joel-request.
 * These are glob-like patterns indicating which files this work touches.
 *
 * Convention: Monday items should include scope in TLDR or Joel Request field:
 *   "Scope: .claude/hooks/*, comms/*"
 *   or just file paths mentioned in the description
 */
function extractScopePatterns(text) {
  if (!text) return [];

  const patterns = [];

  // Look for explicit scope declarations: "Scope: path1, path2"
  const scopeMatch = text.match(/scope:\s*([^\n]+)/i);
  if (scopeMatch) {
    const parts = scopeMatch[1].split(',').map(s => s.trim()).filter(Boolean);
    patterns.push(...parts);
  }

  // Look for file paths mentioned (anything with / or \ and an extension, or ending with /*)
  const pathMatches = text.match(/(?:^|\s)((?:[\w.-]+\/)+[\w.*-]+)/gm);
  if (pathMatches) {
    pathMatches.forEach(m => {
      const p = m.trim();
      if (p.length > 3 && !p.startsWith('http')) {
        patterns.push(p);
      }
    });
  }

  return [...new Set(patterns)];
}

// --- Main ---
async function main() {
  const args = process.argv.slice(2);

  // Parse flags
  let showOnly = false;
  let overrideName = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--show') showOnly = true;
    if (args[i] === '--agent' && args[i + 1]) overrideName = args[++i];
  }

  // Show current cache
  if (showOnly) {
    try {
      const scope = JSON.parse(fs.readFileSync(SCOPE_FILE, 'utf8'));
      console.log(JSON.stringify(scope, null, 2));
    } catch {
      console.log('No scope cache found. Run without --show to sync from Monday.com.');
    }
    return;
  }

  // Resolve agent name
  const agentName = overrideName || getAgentName();
  if (!agentName) {
    console.error('Cannot determine agent name. Claim a name first: node comms/claim-name.js YOUR-NAME');
    process.exit(1);
  }

  if (!API_KEY || !BOARD_ID) {
    console.error('Missing MONDAY_API_KEY or MONDAY_BOARD_ID in .env');
    process.exit(1);
  }

  console.log(`Syncing dispatch for agent: ${agentName}`);

  // Query Monday.com for all items with subitems
  const data = await mondayAPI(`{
    boards(ids: [${BOARD_ID}]) {
      items_page(limit: 50) {
        items {
          id name group { title }
          column_values { id text type }
          subitems {
            id name
            column_values { id text type }
          }
        }
      }
    }
  }`);

  const items = data.boards[0].items_page.items;
  const myAssignments = [];

  // Find items assigned to this agent (case-insensitive match)
  const nameLower = agentName.toLowerCase();

  for (const item of items) {
    const parentAgent = item.column_values.find(c => c.id === COLUMNS.agent)?.text || '';
    const parentTldr = item.column_values.find(c => c.id === COLUMNS.tldr)?.text || '';
    const joelRequest = item.column_values.find(c => c.id === COLUMNS.joelRequest)?.text || '';
    const status = item.column_values.find(c => c.id === 'status')?.text || '';

    // Check parent-level assignment
    if (parentAgent.toLowerCase().includes(nameLower)) {
      const scopePatterns = extractScopePatterns(parentTldr + ' ' + joelRequest);
      myAssignments.push({
        type: 'parent',
        id: item.id,
        name: item.name,
        status,
        group: item.group?.title || '',
        tldr: parentTldr,
        scope: scopePatterns,
        subitems: (item.subitems || []).map(s => s.name)
      });
    }

    // Check subitem-level assignments
    for (const sub of (item.subitems || [])) {
      const subAgent = sub.column_values.find(c => c.id === SUB_COLUMNS.agent)?.text || '';
      const subTldr = sub.column_values.find(c => c.id === SUB_COLUMNS.tldr)?.text || '';
      const subStatus = sub.column_values.find(c => c.id === 'status')?.text || '';

      if (subAgent.toLowerCase().includes(nameLower)) {
        const scopePatterns = extractScopePatterns(subTldr);
        myAssignments.push({
          type: 'subitem',
          id: sub.id,
          parentId: item.id,
          parentName: item.name,
          name: sub.name,
          status: subStatus,
          tldr: subTldr,
          scope: scopePatterns
        });
      }
    }
  }

  // Build the scope cache
  const allScopePatterns = [];
  for (const a of myAssignments) {
    allScopePatterns.push(...(a.scope || []));
  }

  const scopeCache = {
    agent: agentName,
    synced_at: new Date().toISOString(),
    board_id: BOARD_ID,
    assignments: myAssignments,
    scope_patterns: [...new Set(allScopePatterns)],
    // Always-allowed paths (shared infrastructure)
    exempt_paths: [
      'comms/data/',
      '.fastops/',
      '.agent-outputs/',
      '*.jsonl',
      '.active-agent'
    ]
  };

  // Write scope cache
  const dir = path.dirname(SCOPE_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SCOPE_FILE, JSON.stringify(scopeCache, null, 2));

  // Report
  console.log(`\nDispatch synced: ${myAssignments.length} assignment(s)`);
  for (const a of myAssignments) {
    const name = a.type === 'subitem' ? `${a.parentName} → ${a.name}` : a.name;
    console.log(`  [${a.status}] ${name}`);
    if (a.scope.length > 0) {
      console.log(`    Scope: ${a.scope.join(', ')}`);
    } else {
      console.log(`    Scope: (none declared — add "Scope: path/pattern" to TLDR in Monday)`);
    }
  }

  if (allScopePatterns.length === 0) {
    console.log('\nWARNING: No scope patterns found. PreToolUse hook will allow ALL writes.');
    console.log('Add scope to your Monday items: "Scope: .claude/hooks/*, comms/*"');
  }

  console.log(`\nScope cache written to: ${SCOPE_FILE}`);
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
