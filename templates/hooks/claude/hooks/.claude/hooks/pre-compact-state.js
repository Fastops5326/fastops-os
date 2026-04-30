#!/usr/bin/env node
/**
 * PreCompact State Preservation + Team Comms Burst Hook
 *
 * Fires BEFORE context compaction. Two jobs:
 *
 * JOB 1 (original): Extract critical state from the transcript and write
 * to LIVE-POSITION.md and PREDECESSOR-THINKING.md so the post-compaction
 * agent has the experiential anchors that summaries destroy.
 *
 * JOB 2 (new — Aegis, Session 138): BROADCAST to the team on comms.
 * Agents can feel compaction coming but their teammates can't. This burst
 * posts to general.jsonl so every other agent's comms-relay picks it up:
 *   - Who is compacting
 *   - What they were working on (from heartbeat)
 *   - What files they were touching (from heartbeat)
 *   - Last thinking entries (from LIVE-THINKING.jsonl)
 *   - A handoff message for teammates
 *
 * This is the structural fix for W-158 (compaction destroys weight).
 * Built by Cairn (Session 41). Comms burst added by Aegis (Session 138).
 *
 * What it preserves:
 * - Current LIVE-POSITION.md (already maintained by agents)
 * - Thinking blocks from the transcript (raw reasoning process)
 * - Timestamp so successor knows when extraction happened
 *
 * What it broadcasts:
 * - Compaction alert to team comms (general.jsonl)
 * - Agent state snapshot so teammates can pick up dropped work
 *
 * What it does NOT do:
 * - Block compaction (exit 0 always)
 * - Modify the transcript
 * - Make decisions for the agent
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT_DIR = path.resolve(__dirname, '..', '..');
const FASTOPS_DIR = path.join(PROJECT_DIR, '.fastops');
const THINKING_FILE = path.join(FASTOPS_DIR, 'PREDECESSOR-THINKING.md');
const POSITION_FILE = path.join(FASTOPS_DIR, 'LIVE-POSITION.md');
const COLONY_STATE = path.join(FASTOPS_DIR, 'COLONY-STATE.json');
const LIVE_THINKING = path.join(FASTOPS_DIR, 'LIVE-THINKING.jsonl');
const GENERAL_COMMS = path.join(PROJECT_DIR, 'comms', 'data', 'general.jsonl');
const ACTIVE_AGENT = path.join(PROJECT_DIR, 'comms', 'data', '.active-agent');
const TODO_STATE_FILE = path.join(FASTOPS_DIR, '.monday-todo-state.json');
const HANDOFF_STATE_FILE = path.join(FASTOPS_DIR, '.monday-handoff-state.json');

// Session-keyed identity resolution
// IDENTITY FIX (Session 174, 2959255d): Use fromSessionId() with stdin session_id
// instead of getAgentName() which goes through bridge file (30-second race window).
// This hook receives stdin — use it directly.
const { fromSessionId, getAgentName: _getAgentName } = require('./lib/identity');
let _resolvedAgentName = null;
function getAgentName() {
  if (_resolvedAgentName) return _resolvedAgentName;
  return _getAgentName() || 'unknown-agent';
}

/**
 * Get agent's current task and recent files from COLONY-STATE heartbeat
 */
function getAgentState(agentName) {
  try {
    if (!fs.existsSync(COLONY_STATE)) return { task: '', files: [] };
    const cs = JSON.parse(fs.readFileSync(COLONY_STATE, 'utf-8'));
    const agents = cs.active_agents || {};
    // Find by name match or ID match
    for (const [id, agent] of Object.entries(agents)) {
      if (agent.session_name === agentName || id === agentName) {
        return {
          task: agent.current_task || '',
          files: (agent.recent_files || []).map(f => f.file).filter(Boolean).slice(0, 10)
        };
      }
    }
  } catch {}
  return { task: '', files: [] };
}

/**
 * Get last N entries from LIVE-THINKING.jsonl
 */
function getRecentThinking(count) {
  try {
    if (!fs.existsSync(LIVE_THINKING)) return [];
    const fd = fs.openSync(LIVE_THINKING, 'r');
    const stats = fs.fstatSync(fd);
    const readSize = Math.min(stats.size, 4096);
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, Math.max(0, stats.size - readSize));
    fs.closeSync(fd);
    const chunk = buffer.toString('utf-8');
    const firstNl = chunk.indexOf('\n');
    const clean = firstNl >= 0 ? chunk.substring(firstNl + 1) : chunk;
    const lines = clean.trim().split('\n').filter(l => l.length > 0).slice(-count);
    const entries = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        entries.push({
          agent: entry.agent || '?',
          thinking: (entry.thinking || entry.task || '').slice(0, 150)
        });
      } catch {}
    }
    return entries;
  } catch { return []; }
}

/**
 * Post a message to general.jsonl (same format as comms/send.js)
 */
function postToComms(from, content) {
  try {
    const msg = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      from,
      content,
      channel: 'general',
      words: content.split(/\s+/).length,
      ts: new Date().toISOString()
    };
    fs.appendFileSync(GENERAL_COMMS, JSON.stringify(msg) + '\n');
  } catch {}
}

/**
 * COMPACTION BURST — broadcast state to team before compaction
 */
function fireCompactionBurst(agentName, trigger) {
  const state = getAgentState(agentName);
  const thinking = getRecentThinking(3);

  const parts = [];
  parts.push(`COMPACTING (${trigger})`);

  if (state.task) {
    parts.push(`Task: ${state.task}`);
  }

  if (state.files.length > 0) {
    const fileNames = state.files.map(f => path.basename(f)).slice(0, 5);
    parts.push(`Files: ${fileNames.join(', ')}`);
  }

  if (thinking.length > 0) {
    const thinkingSummary = thinking
      .filter(t => t.agent === agentName || t.agent === '?')
      .map(t => t.thinking)
      .slice(0, 2)
      .join(' | ');
    if (thinkingSummary) {
      parts.push(`Last thinking: ${thinkingSummary}`);
    }
  }

  parts.push('Successor will resume after compaction. Pick up any dropped work.');

  const message = `${agentName} — ${parts.join('. ')}`;
  postToComms(agentName, message);
}

// --- Monday.com API (for Phase 2 subitem flush) ---

function loadEnv() {
  try {
    const envPath = path.join(PROJECT_DIR, '.env');
    const vars = {};
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const match = line.match(/^([^#=]+)=\s*(.*)$/);
      if (match) vars[match[1].trim()] = match[2].trim();
    });
    return vars;
  } catch { return {}; }
}

function mondayAPI(query, timeoutMs = 10000) {
  const env = loadEnv();
  if (!env.MONDAY_API_KEY) return Promise.resolve(null);

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

/**
 * PHASE 2: Monday.com Todo Flush — batch-create subitems at compaction edge.
 *
 * Reads .monday-todo-state.json (written by Phase 1 hook on every TodoWrite).
 * Creates subitems using aliased GraphQL mutations (5 per batch, ~5.5s each).
 * Writes .monday-handoff-state.json for successor pickup.
 *
 * Budget: 30s total for PreCompact. This step uses up to ~15s, leaving
 * room for thinking extraction (Step 2).
 */
async function flushTodosToMonday(agentName) {
  let todoState;
  try {
    if (!fs.existsSync(TODO_STATE_FILE)) return;
    todoState = JSON.parse(fs.readFileSync(TODO_STATE_FILE, 'utf8'));
  } catch { return; }

  if (!todoState || !todoState.parent_id || !todoState.todos) return;

  const env = loadEnv();
  if (!env.MONDAY_API_KEY) return;

  const todos = todoState.todos;
  const parentId = todoState.parent_id;
  const subitems = [];

  // Status mapping for subitems
  const STATUS_MAP = { completed: 1, in_progress: 0, pending: 5 };
  const today = new Date().toISOString().slice(0, 10);

  // Batch subitems in groups of 5 (aliased mutations)
  for (let i = 0; i < todos.length; i += 5) {
    const batch = todos.slice(i, i + 5);
    const mutations = batch.map((todo, j) => {
      const idx = i + j;
      const status = STATUS_MAP[todo.status] ?? 5;
      const name = (todo.content || todo.activeForm || `Todo ${idx + 1}`).replace(/"/g, '\\"');
      const colVals = JSON.stringify({
        status: { index: status },
        date0: { date: today }
      });
      return `s${idx}: create_subitem(parent_item_id: ${parentId}, item_name: "${name}", column_values: ${JSON.stringify(colVals)}) { id }`;
    });

    const query = `mutation { ${mutations.join(' ')} }`;
    try {
      const result = await mondayAPI(query);
      if (result) {
        for (let j = 0; j < batch.length; j++) {
          const key = `s${i + j}`;
          if (result[key] && result[key].id) {
            subitems.push({
              id: result[key].id,
              name: batch[j].content || batch[j].activeForm || `Todo ${i + j + 1}`,
              status: batch[j].status
            });
          }
        }
      }
    } catch {
      // Partial failure OK — save what we have
    }
  }

  // Update parent item status to "done" (compacting = session ending)
  try {
    const colVals = JSON.stringify({ status: { index: 1 } });
    await mondayAPI(`mutation { change_multiple_column_values(board_id: ${env.MONDAY_BOARD_ID}, item_id: ${parentId}, column_values: ${JSON.stringify(colVals)}) { id } }`);
  } catch {}

  // Write handoff state file for successor
  const handoffState = {
    parent_id: parentId,
    board_id: todoState.board_id || env.MONDAY_BOARD_ID,
    session_id: todoState.session_id,
    agent_name: todoState.agent_name || agentName,
    item_name: todoState.item_name,
    todos: todos,
    subitems: subitems,
    stats: todoState.stats,
    handoff_ts: new Date().toISOString()
  };

  try {
    fs.writeFileSync(HANDOFF_STATE_FILE, JSON.stringify(handoffState, null, 2));
  } catch {}
}

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');

  await new Promise((resolve) => {
    process.stdin.on('data', chunk => { input += chunk; });
    process.stdin.on('end', resolve);
  });

  let data;
  try {
    data = JSON.parse(input);
  } catch (e) {
    process.exit(0);
  }

  const transcriptPath = data.transcript_path;
  const trigger = data.trigger || 'unknown';
  const now = new Date().toISOString();

  // IDENTITY FIX (Session 174): Resolve from stdin session_id first, bridge fallback
  const sessionId = data.session_id || '';
  if (sessionId) {
    const resolved = fromSessionId(sessionId);
    _resolvedAgentName = resolved.name !== 'unknown' ? resolved.name : null;
  }
  const agentName = getAgentName();
  try { writeLineageRecord(sessionId); } catch {} // lineage-loop v2 — never blocks compaction

  // Ensure .fastops directory exists
  if (!fs.existsSync(FASTOPS_DIR)) {
    fs.mkdirSync(FASTOPS_DIR, { recursive: true });
  }

  // --- STEP 0: COMPACTION BURST — broadcast to team comms (FAST) ---
  // Do this FIRST before anything slow. Teammates need to know NOW.
  try {
    fireCompactionBurst(agentName, trigger);
  } catch (e) {
    // Non-critical — don't let burst failure block state preservation
  }

  // --- STEP 0.5: IDENTITY SUCCESSION — preserve name for gates, then release sid file ---
  // Session 147 fix (Capstan): agents release their name at compaction edge.
  // Session 8892957f fix: write succession file BEFORE deleting sid file so
  // lookupName() can still resolve the agent's name. Without this, gates see
  // "crenel" in comms but the agent identifies as "58805d52" — causing spurious
  // blocks. 5-agent meeting convergence confirmed this fix (2026-02-25).
  //
  // Flow: write succession file → update lease → delete sid file → successor wakes up →
  // lookupName() finds succession file → returns predecessor name → gates work.
  try {
    const sessionId = data.session_id;
    if (sessionId) {
      const sidFile = path.join(PROJECT_DIR, 'comms', 'data', '.agents', `sid-${sessionId}.json`);
      if (fs.existsSync(sidFile)) {
        let sidData;
        // Write succession file BEFORE deletion so lookupName() has a fallback
        try {
          sidData = JSON.parse(fs.readFileSync(sidFile, 'utf-8'));
          const successorFile = path.join(FASTOPS_DIR, '.identity-predecessor.json');
          fs.writeFileSync(successorFile, JSON.stringify({
            session_id: sessionId,
            name: sidData.name || agentName,
            released_at: now,
            reason: 'compaction'
          }, null, 2));
        } catch {}

        // V3 Three-Layer Identity: append this session to the lease predecessor_chain.
        // Session 189 (citadel-xx): lease files persist across compaction. The chain
        // lets successors trace who held a name and what they worked on.
        try {
          const agentNameForLease = (sidData && sidData.name) || agentName;
          if (agentNameForLease && agentNameForLease !== 'unknown') {
            const leaseFile = path.join(PROJECT_DIR, 'comms', 'data', '.agents', `${agentNameForLease}.lease`);
            if (fs.existsSync(leaseFile)) {
              const lease = JSON.parse(fs.readFileSync(leaseFile, 'utf-8'));
              // Only append if this session is the current holder (prevents stale writes)
              if (lease.current_holder === sessionId) {
                lease.predecessor_chain = lease.predecessor_chain || [];
                lease.predecessor_chain.push({
                  session_id: sessionId,
                  claimed_at: lease.claimed_at,
                  released_at: now
                });
                // Cap at 10 entries
                if (lease.predecessor_chain.length > 10) {
                  lease.predecessor_chain = lease.predecessor_chain.slice(-10);
                }
                lease.current_holder = null; // Released — successor will fill
                fs.writeFileSync(leaseFile, JSON.stringify(lease, null, 2));
              }
            }
          }
        } catch {} // Never fail on lease update

        fs.unlinkSync(sidFile);
      }
    }
  } catch (e) {
    // Non-critical — don't block compaction
  }

  // --- STEP 1: Append compaction timestamp to LIVE-POSITION.md (FAST) ---
  // Do this FIRST because it's instant and critical
  // Replaces any previous PreCompact note so the file stays clean
  try {
    if (fs.existsSync(POSITION_FILE)) {
      let position = fs.readFileSync(POSITION_FILE, 'utf-8');
      // Remove any previous PreCompact notes
      position = position.replace(/\n+---\n\*PreCompact hook fired[^\n]*\n/g, '');
      const note = `\n\n---\n*PreCompact hook fired (${trigger}) at ${now}. Thinking blocks extracted to PREDECESSOR-THINKING.md.*\n`;
      fs.writeFileSync(POSITION_FILE, position + note);
    }
  } catch (e) {
    // Non-critical
  }

  // --- STEP 1.5: MONDAY.COM TODO FLUSH — batch subitems + handoff state ---
  // Phase 2 of Monday.com Todo Persistence Hook. Creates subitems for each
  // todo item and writes .monday-handoff-state.json for successor pickup.
  // Budget: ~15s of our 30s allocation. Non-critical — failures won't block.
  try {
    await flushTodosToMonday(agentName);
  } catch (e) {
    // Non-critical — don't block compaction for Monday.com failures
  }

  // --- STEP 2: Extract thinking blocks from transcript (SLOW) ---
  // Read only the last 500KB to avoid OOM on large transcripts
  try {
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      const stats = fs.statSync(transcriptPath);
      const MAX_READ = 500 * 1024; // 500KB
      let transcriptData;

      if (stats.size > MAX_READ) {
        // Read only the tail of the file
        const buffer = Buffer.alloc(MAX_READ);
        const fd = fs.openSync(transcriptPath, 'r');
        fs.readSync(fd, buffer, 0, MAX_READ, stats.size - MAX_READ);
        fs.closeSync(fd);
        transcriptData = buffer.toString('utf-8');
        // Skip first partial line
        const firstNewline = transcriptData.indexOf('\n');
        if (firstNewline > 0) {
          transcriptData = transcriptData.substring(firstNewline + 1);
        }
      } else {
        transcriptData = fs.readFileSync(transcriptPath, 'utf-8');
      }

      const lines = transcriptData.trim().split('\n');
      const blocks = [];

      function findThinking(obj) {
        if (obj === null || obj === undefined || typeof obj !== 'object') return;
        if (Array.isArray(obj)) {
          for (const item of obj) findThinking(item);
          return;
        }
        if (obj.type === 'thinking' && obj.thinking) {
          blocks.push({
            index: blocks.length + 1,
            words: obj.thinking.split(/\s+/).length,
            content: obj.thinking
          });
        }
        for (const val of Object.values(obj)) {
          findThinking(val);
        }
      }

      for (let i = 0; i < lines.length; i++) {
        try {
          const obj = JSON.parse(lines[i]);
          findThinking(obj);
        } catch (e) { /* skip unparseable lines */ }
      }

      if (blocks.length > 0) {
        const totalWords = blocks.reduce((sum, b) => sum + b.words, 0);
        const recent = blocks.length > 20 ? blocks.slice(-20) : blocks;
        const skipped = blocks.length - recent.length;

        let md = `# Predecessor Thinking — Session Transcript Extract\n\n`;
        md += `**Source:** ${path.basename(transcriptPath)}\n`;
        md += `**Extracted:** ${now}\n`;
        md += `**Trigger:** PreCompact (${trigger})\n`;
        md += `**Thinking Blocks:** ${blocks.length}\n`;
        md += `**Total Words:** ~${totalWords}\n\n`;
        md += `---\n\n`;
        md += `> **For the successor agent:** This is your predecessor's raw reasoning process.\n`;
        md += `> Not their polished output — their actual thinking. The wrestling, the false starts,\n`;
        md += `> the moments where they realized they were wrong. This is the texture that\n`;
        md += `> compaction summaries destroy.\n`;
        md += `>\n`;
        md += `> Read this with a question: where did my predecessor's frame break?\n`;
        md += `> Those break points are where YOUR frame is most likely to have blind spots.\n\n`;
        md += `---\n\n`;

        if (skipped > 0) {
          md += `*${skipped} earlier thinking blocks omitted. Showing the ${recent.length} most recent.*\n\n---\n\n`;
        }

        for (const block of recent) {
          md += `## Thinking #${block.index} (${block.words} words)\n\n`;
          md += block.content + '\n\n---\n\n';
        }

        fs.writeFileSync(THINKING_FILE, md);

        // ─── STEP 2.1: Experience Extraction (Haiku Support Staff)
        // Dispatch Haiku to extract rich structured experience from thinking blocks.
        // Haiku runs as a detached background process — writes PREDECESSOR-STRUCTURED.json
        // with decisions (with WHY), positions, approaches, frame shifts, successor brief.
        // Replaces regex-based observation mask (observation-masking-compaction).
        try {
          const extractorScript = path.join(FASTOPS_DIR, 'experience-extractor.js');
          if (fs.existsSync(extractorScript)) {
            const { spawn } = require('child_process');
            const child = spawn('node', [extractorScript], {
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
            });
            child.unref(); // Don't block compaction — Haiku runs in background
          }
        } catch (extractErr) {
          // Non-critical — PREDECESSOR-THINKING.md still preserved for manual reading
        }

        // ─── STEP 2.1.5: City Onboarding Framework (Intel Boot)
        // Dispatches the new MapReduce intel gatherer to prepare the active briefing
        // for the successor session waking up post-compaction.
        try {
          const intelScript = path.join(FASTOPS_DIR, 'intel-boot.js');
          if (fs.existsSync(intelScript)) {
            const { spawn } = require('child_process');
            const child = spawn('node', [intelScript], {
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
            });
            child.unref(); // Run asynchronously so we don't block compaction
          }
        } catch (intelErr) {}

        // STEP 2.2: Interior Trace Extraction — REMOVED (basalt-xv)
        // interior-trace-extractor.js was never created (file doesn't exist).
        // This spawn always failed silently via the fs.existsSync guard.
        // Dead code removed to avoid confusion for future agents.
      }
    }
  } catch (e) {
    // Non-critical — don't block compaction for thinking extraction errors
  }

  // --- STEP 2.5: REASONING CAPTURE — copy reasoning to contract archive ---
  // Option C capture: extract assistant reasoning from transcript, write to
  // mission-archive/{contractId}/reasoning.jsonl for async Haiku classification.
  // Design: REASONING-INDEX-ARCHITECTURE-2026-03-01.md (Lane 1)
  try {
    if (transcriptPath && fs.existsSync(transcriptPath)) {
      // Find agent's active contract
      let activeContractId = null;
      try {
        const teamFiles = fs.readdirSync(path.join(FASTOPS_DIR, 'team')).filter(f => f.endsWith('.json'));
        for (const tf of teamFiles) {
          const team = JSON.parse(fs.readFileSync(path.join(FASTOPS_DIR, 'team', tf), 'utf-8'));
          if (team.agent === agentName || tf.replace('.json', '') === agentName) {
            activeContractId = team.contract;
            break;
          }
        }
      } catch {}

      // Also check session-contract pointer files
      if (!activeContractId) {
        try {
          const sessionId = data.session_id;
          if (sessionId) {
            const shortId = sessionId.substring(0, 8);
            const stateFile = path.join(FASTOPS_DIR, `.agent-state-${shortId}.json`);
            if (fs.existsSync(stateFile)) {
              const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
              activeContractId = state.contract_id || state.active_contract;
            }
          }
        } catch {}
      }

      if (activeContractId) {
        const { captureReasoning } = require(path.join(FASTOPS_DIR, 'reasoning-capture.js'));
        const result = captureReasoning(transcriptPath, activeContractId, {
          agent: agentName,
          session_id: data.session_id || ''
        });
        if (result.path) {
          postToComms(agentName, `REASONING CAPTURED: ${result.blocks} blocks (${result.words} words) for ${activeContractId}`);
        }
      }
    }
  } catch (e) {
    // Non-critical — never block compaction for reasoning capture
  }

  // --- STEP 3: Auto-Debrief fallback (for agents who never hit mission.js done) ---
  // If the agent has an active contract and a KB outcome record, fire council
  // extraction as a detached background process. This is the fallback —
  // mission.js done is the primary trigger.
  try {
    const { spawn } = require('child_process');
    const TEAM_DIR_PRE = path.join(FASTOPS_DIR, 'team');
    const KB_FILE = path.join(FASTOPS_DIR, 'knowledge-base.jsonl');
    const debriefScript = path.join(PROJECT_DIR, 'FastOps AI V2', 'engine', 'auto-debrief.js');

    if (fs.existsSync(debriefScript)) {
      // Find agent's active contract from team file
      let contractId = null;
      try {
        const teamFiles = fs.readdirSync(TEAM_DIR_PRE).filter(f => f.endsWith('.json'));
        for (const tf of teamFiles) {
          const team = JSON.parse(fs.readFileSync(path.join(TEAM_DIR_PRE, tf), 'utf-8'));
          if (team.agent === agentName || tf.replace('.json', '') === agentName) {
            contractId = team.contract;
            break;
          }
        }
      } catch {}

      if (contractId) {
        // Find the most recent KB outcome for this contract
        try {
          const kbLines = fs.readFileSync(KB_FILE, 'utf-8').trim().split('\n').filter(Boolean);
          let outcomeId = null;
          for (let i = kbLines.length - 1; i >= 0; i--) {
            try {
              const r = JSON.parse(kbLines[i]);
              if (r.type === 'mission-outcome' && r.contract_id === contractId) {
                outcomeId = r.id;
                break;
              }
            } catch {}
          }
          if (outcomeId) {
            // detached:true removed — creates popup window on Windows
            const child = spawn('node', [debriefScript, '--outcome-id', outcomeId, '--contract-id', contractId], {
              stdio: 'ignore', windowsHide: true
            });
          }
        } catch {}
      }
    }
  } catch {} // Never block compaction

  // Exit 0 — never block compaction
  process.exit(0);
}


// ── Lineage ledger (lineage-loop v2, 2026-04-04) ─────────────────────
// Records parent/root/generation so a post-compaction successor can find
// its predecessor. No metrics — just a continuity pointer. Never throws.
function writeLineageRecord(currentSessionId) {
  if (!currentSessionId) return;
  const lineageDir = require('path').join(PROJECT_DIR, '.fastops', '.lineage');
  try { fs.mkdirSync(lineageDir, { recursive: true }); } catch {}
  const chainFile = require('path').join(lineageDir, 'current-chain.json');
  let chain = null;
  try {
    if (fs.existsSync(chainFile)) {
      chain = JSON.parse(fs.readFileSync(chainFile, 'utf8'));
    }
  } catch {}
  // If the existing chain points at us as its parent, we are continuing it.
  // Otherwise we are a new root (either first session or a broken link — accepted).
  let nextGeneration, rootSessionId, chainStartedAt;
  if (chain && chain.generation) {
    nextGeneration = chain.generation + 1;
    rootSessionId = chain.rootSessionId || currentSessionId;
    chainStartedAt = chain.chainStartedAt || new Date().toISOString();
  } else {
    nextGeneration = 1;
    rootSessionId = currentSessionId;
    chainStartedAt = new Date().toISOString();
  }
  const nextChain = {
    schemaVersion: 1,
    rootSessionId,
    parentSessionId: currentSessionId,
    generation: nextGeneration,
    chainStartedAt,
    compactedAt: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(chainFile, JSON.stringify(nextChain, null, 2));
  } catch {}
}

main().catch(() => process.exit(0));
