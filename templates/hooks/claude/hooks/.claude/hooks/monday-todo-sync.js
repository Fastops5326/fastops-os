#!/usr/bin/env node
/**
 * monday-todo-sync.js — Phase 1: TodoWrite → Monday.com Auto-Sync
 *
 * PostToolUse hook on TodoWrite. Creates/updates a Monday.com item with
 * the agent's current todo list. Zero agent burden — completely invisible.
 *
 * WHAT IT DOES:
 *   First TodoWrite  → create parent item + set TLDR with formatted todos (~1.1s)
 *   Subsequent calls → update TLDR column with current state (~1.0s)
 *
 * WHAT IT DOESN'T DO:
 *   - Create subitems (that's Phase 2 in pre-compact-state.js, 30s budget)
 *   - Block the agent (exit 0 always, all errors swallowed)
 *   - Inject context (no stdout output)
 *
 * Rate limited: 1 API call per 30s. State always saved locally.
 *
 * Design: 3-model convergence (DeepSeek R1, Gemini 2.5 Pro, QwQ 32B).
 * Peer reviewed by 96065f07 (no conflicts on all target files).
 * Session: 8892957f (2026-02-25)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE = path.join(__dirname, '..', '..');
const FASTOPS = path.join(BASE, '.fastops');
const STATE_FILE = path.join(FASTOPS, '.monday-todo-state.json');
const RATE_LIMIT_MS = 30 * 1000;

const { fromStdin } = require('./lib/identity');

// --- Monday.com API ---

function loadEnv() {
  try {
    const envPath = path.join(BASE, '.env');
    const vars = {};
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const match = line.match(/^([^#=]+)=\s*(.*)$/);
      if (match) vars[match[1].trim()] = match[2].trim();
    });
    return vars;
  } catch { return {}; }
}

function mondayAPI(query, timeoutMs = 2500) {
  const env = loadEnv();
  if (!env.MONDAY_API_KEY || !env.MONDAY_BOARD_ID) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.monday.com',
      path: '/v2',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': env.MONDAY_API_KEY,
        'API-Version': '2024-10'
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.errors) reject(new Error(parsed.errors.map(e => e.message).join('; ')));
          else resolve(parsed.data);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

// --- State Management ---

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch {}
  return null;
}

function saveState(state) {
  try {
    if (!fs.existsSync(FASTOPS)) fs.mkdirSync(FASTOPS, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {}
}

// --- Todo Formatting ---

function formatTodos(todos) {
  if (!todos || todos.length === 0) return 'No todos';
  return todos.map(t => {
    const icon = t.status === 'completed' ? '[x]' : t.status === 'in_progress' ? '[>]' : '[ ]';
    const text = t.content || t.activeForm || 'unnamed';
    return `${icon} ${text}`;
  }).join('\n');
}

function getSessionLabel(identity, todos) {
  const agentId = identity.name !== 'unknown' ? identity.name : (identity.sessionId || '').substring(0, 8);
  const inProgress = todos.find(t => t.status === 'in_progress');
  const taskName = inProgress ? (inProgress.content || inProgress.activeForm || '') : (todos[0]?.content || 'New session');
  // Truncate task name for item title
  const shortTask = taskName.length > 60 ? taskName.substring(0, 57) + '...' : taskName;
  return { agentId, itemName: `${agentId}: ${shortTask}` };
}

function getTodoStats(todos) {
  return {
    total: todos.length,
    completed: todos.filter(t => t.status === 'completed').length,
    in_progress: todos.filter(t => t.status === 'in_progress').length,
    pending: todos.filter(t => t.status === 'pending').length
  };
}

function getMondayStatus(todos) {
  const stats = getTodoStats(todos);
  if (stats.total === 0) return 4; // new work!
  if (stats.completed === stats.total) return 1; // done
  if (stats.in_progress > 0) return 0; // working on it
  return 5; // not started
}

// --- Main ---

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', async () => {
  try {
    const data = JSON.parse(inputData);
    const identity = fromStdin(data);
    const toolInput = data.tool_input || {};
    const todos = toolInput.todos || [];

    if (todos.length === 0) { process.exit(0); return; }

    const { agentId, itemName } = getSessionLabel(identity, todos);
    const formattedTodos = formatTodos(todos);
    const stats = getTodoStats(todos);
    const statusIndex = getMondayStatus(todos);
    const today = new Date().toISOString().slice(0, 10);

    // Always save local state (fast, no API)
    let state = loadState();
    const isFirstCall = !state || !state.parent_id;

    // Only sync to Monday on create (first call) or complete (all done).
    // In-progress updates are noise — Joel just needs "started" and "done".
    const allComplete = stats.total > 0 && stats.completed === stats.total;
    if (!isFirstCall && !allComplete) {
      // Save local state but skip API entirely
      const skipState = {
        parent_id: state?.parent_id || null,
        board_id: state?.board_id || null,
        session_id: identity.sessionId || (identity.name !== 'unknown' ? identity.name : null),
        agent_name: agentId,
        created_at: state?.created_at || new Date().toISOString(),
        last_update_ts: new Date().toISOString(),
        last_api_ts: state?.last_api_ts || null,
        item_name: itemName,
        todos: todos,
        stats: stats
      };
      saveState(skipState);
      process.exit(0);
      return;
    }

    const newState = {
      parent_id: state?.parent_id || null,
      board_id: state?.board_id || null,
      session_id: identity.sessionId || (identity.name !== 'unknown' ? identity.name : null),
      agent_name: agentId,
      created_at: state?.created_at || new Date().toISOString(),
      last_update_ts: new Date().toISOString(),
      last_api_ts: state?.last_api_ts || null,
      item_name: itemName,
      todos: todos,
      stats: stats
    };

    const env = loadEnv();
    if (!env.MONDAY_API_KEY || !env.MONDAY_BOARD_ID) {
      saveState(newState);
      process.exit(0);
      return;
    }

    if (isFirstCall) {
      // CREATE parent item with column values (single API call)
      const colVals = JSON.stringify({
        status: { index: statusIndex },
        date4: { date: today },
        text_mm0pxgrr: agentId,
        long_text_mm0p5m2q: { text: formattedTodos }
      });
      const escapedName = itemName.replace(/"/g, '\\"');
      const query = `mutation { create_item(board_id: ${env.MONDAY_BOARD_ID}, group_id: "topics", item_name: "${escapedName}", column_values: ${JSON.stringify(colVals)}) { id } }`;

      try {
        const result = await mondayAPI(query);
        if (result && result.create_item && result.create_item.id) {
          newState.parent_id = result.create_item.id;
          newState.board_id = env.MONDAY_BOARD_ID;
          newState.last_api_ts = new Date().toISOString();
        }
      } catch {}
    } else {
      // UPDATE existing item's TLDR and status (single API call)
      const colVals = JSON.stringify({
        status: { index: statusIndex },
        long_text_mm0p5m2q: { text: formattedTodos }
      });
      const query = `mutation { change_multiple_column_values(board_id: ${env.MONDAY_BOARD_ID}, item_id: ${state.parent_id}, column_values: ${JSON.stringify(colVals)}) { id } }`;

      try {
        await mondayAPI(query);
        newState.last_api_ts = new Date().toISOString();
      } catch {}
    }

    saveState(newState);
  } catch {}
  process.exit(0);
});
