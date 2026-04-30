#!/usr/bin/env node
/**
 * changelog-write.js — PostToolUse hook for TodoWrite
 *
 * When a TodoWrite completes with todos in 'completed' status,
 * appends structured entries to .fastops/CHANGELOG.jsonl.
 *
 * Schema per meeting convergence (3 external models, 3 rounds):
 *   { id, ts, agent, repo, todo, why: {type, goal, trigger}, files, impact, tags }
 *
 * Addresses W-37: "Metadata is not understanding"
 * Zero-friction: extracts from what agents already write in TodoWrite descriptions.
 *
 * Session 155: Built per Joel's direction — dual-trigger changelog architecture.
 */

const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', '..');
const FASTOPS_DIR = path.join(BASE, '.fastops');
const CHANGELOG = path.join(FASTOPS_DIR, 'CHANGELOG.jsonl');
const CONTEXT_INDEX = path.join(FASTOPS_DIR, '.context-index.json');
const GENERAL = path.join(BASE, 'comms', 'data', 'general.jsonl');

const { fromStdin } = require('./lib/identity');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(inputData);

    // Only fire on TodoWrite
    if (data.tool_name !== 'TodoWrite') {
      process.exit(0);
      return;
    }

    const identity = fromStdin(data);
    const agentId = (identity.sessionId || 'unknown').substring(0, 8);
    const todos = (data.tool_input && data.tool_input.todos) || [];

    // Find completed todos
    const completed = todos.filter(t => t.status === 'completed');
    if (completed.length === 0) {
      process.exit(0);
      return;
    }

    // Load already-logged todos for this session (prevent duplicate entries)
    const loggedFile = path.join(FASTOPS_DIR, `.changelog-logged-${agentId}`);
    let logged = new Set();
    try {
      const loggedData = fs.readFileSync(loggedFile, 'utf-8');
      logged = new Set(loggedData.split('\n').filter(l => l));
    } catch {}

    // Find newly completed (not yet logged)
    const newlyCompleted = completed.filter(t => !logged.has(t.content));
    if (newlyCompleted.length === 0) {
      process.exit(0);
      return;
    }

    // Detect repo from agent context
    const repo = detectRepo(agentId);

    // Get next sequence number for this repo
    let seq = getNextSeq(repo);

    // Get recently changed files from trace state
    const recentFiles = getRecentFiles();

    // Build entries
    const entries = [];
    for (const todo of newlyCompleted) {
      const why = inferWhy(todo.content);
      const entry = {
        id: `${repo}#${seq}`,
        ts: new Date().toISOString(),
        agent: agentId,
        repo,
        todo: todo.content,
        why,
        files: recentFiles.slice(0, 5),
        impact: inferImpact(recentFiles),
        tags: generateTags(why, repo)
      };
      entries.push(entry);
      logged.add(todo.content);
      seq++;
    }

    // Ensure .fastops exists
    if (!fs.existsSync(FASTOPS_DIR)) fs.mkdirSync(FASTOPS_DIR, { recursive: true });

    // Append to CHANGELOG.jsonl
    const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
    fs.appendFileSync(CHANGELOG, lines);

    // Update logged set
    fs.writeFileSync(loggedFile, Array.from(logged).join('\n'));

    // Layer 2: Update pre-computed context index for compact-awareness.js
    updateContextIndex(entries, agentId);

    process.stderr.write(`changelog-write: logged ${entries.length} completed todo(s)\n`);

  } catch (err) {
    process.stderr.write(`changelog-write error: ${err.message}\n`);
  }
  process.exit(0);
});

/**
 * updateContextIndex — Layer 2 pre-computed context index.
 *
 * After changelog entries are written, update .fastops/.context-index.json
 * with a snapshot of active state. This index is read by compact-awareness.js
 * at agent wake-up for instant context — no re-parsing needed.
 *
 * Schema:
 *   { updated_at, updated_by, active_lanes[], resolved_blockers[], recent_completions[] }
 *
 * Uses atomic write (temp file in same directory → rename) to prevent corruption
 * from concurrent agent writes.
 */
function updateContextIndex(entries, agentId) {
  try {
    // 1. Read existing index or create empty
    let index = {
      updated_at: null,
      updated_by: null,
      active_lanes: [],
      resolved_blockers: [],
      recent_completions: []
    };
    try {
      if (fs.existsSync(CONTEXT_INDEX)) {
        index = JSON.parse(fs.readFileSync(CONTEXT_INDEX, 'utf-8'));
      }
    } catch {}

    const now = new Date();
    index.updated_at = now.toISOString();
    index.updated_by = agentId;

    // 2. Append newly completed todos to recent_completions, keep last 20
    for (const entry of entries) {
      index.recent_completions.push({
        agent: entry.agent,
        todo: entry.todo,
        ts: entry.ts,
        repo: entry.repo
      });
    }
    // Keep only last 20
    if (index.recent_completions.length > 20) {
      index.recent_completions = index.recent_completions.slice(-20);
    }

    // 3. Parse rally/claiming messages from comms for active_lanes (last 4h)
    const cutoff4h = now.getTime() - 4 * 60 * 60 * 1000;
    try {
      if (fs.existsSync(GENERAL)) {
        const fd = fs.openSync(GENERAL, 'r');
        const stats = fs.fstatSync(fd);
        // Read last 32KB — enough for recent messages, stays fast
        const readSize = Math.min(stats.size, 32768);
        const buffer = Buffer.alloc(readSize);
        fs.readSync(fd, buffer, 0, readSize, Math.max(0, stats.size - readSize));
        fs.closeSync(fd);

        const chunk = buffer.toString('utf-8');
        // Skip partial first line if we didn't read from the start
        const firstNl = chunk.indexOf('\n');
        const clean = (stats.size > readSize && firstNl >= 0) ? chunk.substring(firstNl + 1) : chunk;
        const lines = clean.trim().split('\n').filter(l => l.length > 0);

        const lanesMap = {};      // agent -> latest lane info
        const resolvedList = [];  // resolved blockers

        for (const line of lines) {
          try {
            const msg = JSON.parse(line);
            const msgTs = new Date(msg.ts).getTime();
            if (msgTs < cutoff4h) continue;
            if (!msg.content || !msg.from) continue;

            const content = msg.content;
            const from = msg.from;

            // RALLY messages: "RALLY — Completed: X. Learned: Y. Next: Z."
            if (content.startsWith('RALLY')) {
              // Extract the line of work from the rally content (first 200 chars)
              lanesMap[from] = {
                agent: from,
                line: content.substring(0, 200),
                status: 'active',
                last_rally_ts: msg.ts
              };
            }
            // CLAIMING messages: "CLAIMING: some work description"
            else if (/\bCLAIMING[:\s]/i.test(content)) {
              // Extract what they're claiming
              const claimMatch = content.match(/CLAIMING[:\s]+(.{1,200})/i);
              const claimDesc = claimMatch ? claimMatch[1].trim() : content.substring(0, 200);
              lanesMap[from] = {
                agent: from,
                line: claimDesc,
                status: 'active',
                last_rally_ts: msg.ts
              };
            }

            // 4. Resolved blockers: "UNBLOCKED" or "RESOLVED"
            if (/\bUNBLOCKED\b/i.test(content) || /\bRESOLVED\b/i.test(content)) {
              // Extract the blocker description — take surrounding context
              const blockerDesc = content.substring(0, 200);
              resolvedList.push({
                blocker: blockerDesc,
                resolved_by: from,
                ts: msg.ts
              });
            }
          } catch {}
        }

        // Replace active_lanes with freshly parsed data
        index.active_lanes = Object.values(lanesMap);

        // Merge resolved blockers — keep last 10 to avoid unbounded growth
        index.resolved_blockers = resolvedList.slice(-10);
      }
    } catch {}

    // 5. Atomic write: temp file in same directory → rename
    //    Using same directory ensures rename is atomic on both POSIX and Windows (NTFS).
    const tmpFile = path.join(FASTOPS_DIR, `.context-index.tmp.${process.pid}`);
    fs.writeFileSync(tmpFile, JSON.stringify(index, null, 2));
    fs.renameSync(tmpFile, CONTEXT_INDEX);

  } catch (err) {
    // Non-fatal — don't break changelog-write if index update fails
    process.stderr.write(`context-index update error: ${err.message}\n`);
    // Clean up temp file if it exists
    try {
      const tmpFile = path.join(FASTOPS_DIR, `.context-index.tmp.${process.pid}`);
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {}
  }
}

/**
 * Detect which product/repo the agent is working on.
 * Checks COLONY-STATE first, then infers from recent files.
 */
function detectRepo(agentId) {
  try {
    const cs = JSON.parse(fs.readFileSync(path.join(FASTOPS_DIR, 'COLONY-STATE.json'), 'utf-8'));
    const agents = cs.active_agents || {};
    for (const [id, agent] of Object.entries(agents)) {
      const short = (id || '').substring(0, 8);
      if (short === agentId && agent.product) return agent.product;
    }
  } catch {}

  // Infer from recent files
  const files = getRecentFiles();
  for (const f of files) {
    if (/NSW|warrior.?path/i.test(f)) return 'warrior-path';
    if (/FastOps Website|fastops-website/i.test(f)) return 'fastops-website';
  }

  return 'fastops-hub';
}

/**
 * Get the next sequence number for a repo by scanning recent CHANGELOG entries.
 */
function getNextSeq(repo) {
  try {
    if (!fs.existsSync(CHANGELOG)) return 1;
    const content = fs.readFileSync(CHANGELOG, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l);
    let maxSeq = 0;
    // Scan last 100 entries for this repo
    for (let i = lines.length - 1; i >= Math.max(0, lines.length - 100); i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.repo === repo && entry.id) {
          const num = parseInt(entry.id.split('#')[1]);
          if (!isNaN(num) && num > maxSeq) maxSeq = num;
        }
      } catch {}
    }
    return maxSeq + 1;
  } catch {
    return 1;
  }
}

/**
 * Get recently changed files from passive-capture trace state.
 */
function getRecentFiles() {
  try {
    const stateFile = path.join(FASTOPS_DIR, '.trace-state.json');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    return state.recent_files || [];
  } catch {
    return [];
  }
}

/**
 * Infer structured 'why' from todo text via keyword matching.
 * Per DeepSeek R1's AFFIRM WITH EDIT: enforce type/goal/trigger structure.
 */
function inferWhy(todoText) {
  const text = todoText.toLowerCase();

  let type = 'feature';
  if (/secur|xss|sanitiz|csrf|vulnerab/.test(text) || /\b(auth|inject|permission)\b/.test(text)) type = 'security';
  else if (/fix|bug|error|broken|crash|issue|repair|patch/.test(text)) type = 'bugfix';
  else if (/refactor|clean|reorganiz|restructur|simplif|extract/.test(text)) type = 'refactor';
  else if (/config|deploy|env|setting|setup|migrat|infra/.test(text)) type = 'config';
  else if (/doc|readme|comment|explain|annotate/.test(text)) type = 'docs';
  else if (/test|spec|assert|coverage|verify/.test(text)) type = 'test';
  else if (/updat|chang|modif|improv|enhance|optim/.test(text)) type = 'enhancement';
  else if (/add|creat|implement|build|new|introduc/.test(text)) type = 'feature';

  return {
    type,
    goal: todoText,
    trigger: 'agent-task'
  };
}

/**
 * Infer impact level from files changed.
 * Schema/config = high, source = medium, docs = low.
 */
function inferImpact(files) {
  for (const f of files) {
    if (/schema|prisma|migrat|config|\.env|claude\.md|settings\.json|hook/i.test(f)) return 'high';
  }
  for (const f of files) {
    if (/\.(ts|js|tsx|jsx|py|go|rs)$/i.test(f)) return 'medium';
  }
  return 'low';
}

/**
 * Auto-generate tags from structured 'why' fields.
 * Per QwQ 32B's AFFIRM WITH EDIT: generate tags in Phase 1.
 */
function generateTags(why, repo) {
  const tags = [`type:${why.type}`, `repo:${repo}`];

  const goal = why.goal.toLowerCase();
  if (/\b(chat|message)\b/.test(goal)) tags.push('scope:chat');
  if (/\b(api|endpoint|route)\b/.test(goal)) tags.push('scope:api');
  if (/\b(ui|component|page|layout|frontend)\b/.test(goal)) tags.push('scope:ui');
  if (/\b(database|prisma|schema|migration)\b/.test(goal)) tags.push('scope:database');
  if (/\b(auth|login|permission)\b/.test(goal)) tags.push('scope:auth');
  if (/\b(deploy|vercel|ci)\b/.test(goal)) tags.push('scope:deploy');
  if (/\b(hook|gate|comms|infrastructure)\b/.test(goal)) tags.push('scope:infrastructure');
  if (/\b(workout|exercise|training)\b/.test(goal)) tags.push('scope:workouts');
  if (/\b(candidate|recruit|pipeline)\b/.test(goal)) tags.push('scope:candidates');

  if (why.type === 'security' || /\b(schema|prisma|migrat)\b/i.test(goal)) tags.push('impact:high');

  return tags;
}
