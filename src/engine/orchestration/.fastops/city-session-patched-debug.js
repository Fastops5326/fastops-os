#!/usr/bin/env node
/**
 * city-session.js — Give city members FULL agency via isolated session loops.
 *
 * DESIGNED BY: 16 architecturally diverse models (convergence: Session Loop pattern)
 * REPLACES: Action Proxy pattern (rejected — kills ownership/agency/impact)
 *
 * Core mechanism: Each city model gets its own git worktree where it runs
 * a multi-step think-act-observe loop. The model outputs structured actions,
 * the executor runs them in the sandbox, feeds results back. Model controls
 * the loop until it signals DONE. Changes merge to main via review gate.
 *
 * Usage:
 *   node .fastops/city-session.js --model grok --task "Fix the ENAMETOOLONG bug in city-converge-v2.js"
 *   node .fastops/city-session.js --model deepseek --task "Profile 5 new models" --max-turns 20
 *   node .fastops/city-session.js --review <session-id>    # Review and merge a completed session
 *   node .fastops/city-session.js --list                   # List active/completed sessions
 *   node .fastops/city-session.js --cleanup <session-id>   # Remove worktree after merge
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SESSION_DIR = path.join(__dirname, '.sessions');
const WORKTREE_BASE = path.join(ROOT, '.city-worktrees');
const LOG_FILE = path.join(__dirname, '.session-log.jsonl');

// Ensure directories exist
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
if (!fs.existsSync(WORKTREE_BASE)) fs.mkdirSync(WORKTREE_BASE, { recursive: true });

// ── Safe-exec integration ──────────────────────────────────────────
const { askModel } = require('./safe-exec');
const bootSeq = require('./city-boot-sequence');
const { autoCloseMarketplace } = require('./session-marketplace-hook');

// ── Persist helper (city-designed) ──
function persist(type, detail, agent) {
  try {
    const e = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      sequence: Date.now(),
      type, agent,
      action: "session-persist",
      data: { detail },
      tags: [type]
    };
    fs.appendFileSync(path.join(__dirname, "city-ledger.jsonl"), JSON.stringify(e) + String.fromCharCode(10));
  } catch (err) {}
}

// ── Action Types ───────────────────────────────────────────────────
const ALLOWED_ACTIONS = ['READ', 'WRITE', 'PATCH', 'EXEC', 'TEST', 'COMMIT', 'DONE', 'COMMS'];

// Commands allowed in EXEC actions (safety allowlist)
const EXEC_ALLOWLIST = [
  /^node\s/,
  /^npm\s+(test|run|install)/,
  /^git\s+(status|log|diff|add|show)/,
  /^ls\b/,
  /^cat\b/,
  /^head\b/,
  /^tail\b/,
  /^grep\b/,
  /^find\b/,
  /^echo\b/,
  /^pwd$/,
];

// ── Session Management ─────────────────────────────────────────────

function generateSessionId(model) {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(3).toString('hex');
  return `${model}-${ts}-${rand}`;
}

function sessionPath(sessionId) {
  return path.join(SESSION_DIR, `${sessionId}.json`);
}

function loadSession(sessionId) {
  const p = sessionPath(sessionId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveSession(session) {
  fs.writeFileSync(sessionPath(session.id), JSON.stringify(session, null, 2));
}

function logEvent(sessionId, event) {
  const entry = { sessionId, ...event, ts: new Date().toISOString() };
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
  try { bootSeq.appendDelta({ id: require("crypto").randomUUID(), timestamp: entry.ts, sequence: Date.now(), type: "session", agent: event.model || sessionId, action: event.event || "unknown", data: event }); } catch(e) {}
}

// ── Worktree Management ────────────────────────────────────────────

function createWorktree(sessionId) {
  const branchName = `city/${sessionId}`;
  const worktreePath = path.join(WORKTREE_BASE, sessionId);

  // Create branch from current HEAD
  try {
    execFileSync('git', ['branch', branchName], { cwd: ROOT, stdio: 'pipe' });
  } catch (err) {
    // Branch might already exist
    if (!err.stderr?.toString().includes('already exists')) throw err;
  }

  // Create worktree
  execFileSync('git', ['worktree', 'add', worktreePath, branchName], {
    cwd: ROOT,
    stdio: 'pipe',
  });

  return { branchName, worktreePath };
}

function removeWorktree(sessionId) {
  const worktreePath = path.join(WORKTREE_BASE, sessionId);
  const branchName = `city/${sessionId}`;

  try {
    execFileSync('git', ['worktree', 'remove', worktreePath, '--force'], {
      cwd: ROOT,
      stdio: 'pipe',
    });
  } catch {}

  try {
    execFileSync('git', ['branch', '-D', branchName], { cwd: ROOT, stdio: 'pipe' });
  } catch {}
}

// ── Action Parsing ─────────────────────────────────────────────────
// Models output structured action blocks:
//
//   ```action
//   READ path/to/file.js
//   ```
//
//   ```action
//   WRITE path/to/file.js
//   content goes here
//   multiple lines supported
//   ```
//
//   ```action
//   EXEC npm test
//   ```
//
//   ```action
//   TEST node .fastops/city-converge.js --question "test"
//   ```
//
//   ```action
//   COMMIT message goes here
//   ```
//
//   ```action
//   DONE
//   Summary of what was accomplished
//   ```
//
//   ```action
//   COMMS channel
//   Message to send to comms
//   ```

function parseActions(response) {
  const actions = [];
  // Match fenced action blocks: ```action ... ``` (closing fence can be on same line or after newline)
  const blockRegex = /```action\s*\n([\s\S]*?)(?:\n```|```$)/gm;
  let match;

  while ((match = blockRegex.exec(response)) !== null) {
    const block = match[1].trim();
    const firstLine = block.split('\n')[0].trim();
    const rest = block.split('\n').slice(1).join('\n');

    // Parse action type and argument from first line
    const spaceIdx = firstLine.indexOf(' ');
    const actionType = spaceIdx > 0 ? firstLine.slice(0, spaceIdx).toUpperCase() : firstLine.toUpperCase();
    const arg = spaceIdx > 0 ? firstLine.slice(spaceIdx + 1).trim() : '';
    const cleanArg = arg.includes(' #') ? arg.split(' #')[0].trim() : arg;

    if (!ALLOWED_ACTIONS.includes(actionType)) {
      actions.push({ type: 'UNKNOWN', raw: block, error: `Unknown action: ${actionType}` });
      continue;
    }

    switch (actionType) {
      case 'READ':
        actions.push({ type: 'READ', file: cleanArg });
        break;
      case 'WRITE':
        actions.push({ type: 'WRITE', file: cleanArg, content: rest });
        break;
      case 'EXEC':
        actions.push({ type: 'EXEC', command: arg || rest.trim() });
        break;
      case 'TEST':
        actions.push({ type: 'TEST', command: arg || rest.trim() });
        break;
      case 'COMMIT':
        actions.push({ type: 'COMMIT', message: arg || rest.trim() });
        break;
      case 'PATCH':
        actions.push({ type: 'PATCH', file: cleanArg, content: rest });
        break;
      case 'DONE':
        actions.push({ type: 'DONE', summary: arg ? `${arg}\n${rest}`.trim() : rest.trim() });
        break;
      case 'COMMS':
        actions.push({ type: 'COMMS', channel: arg || 'general', message: rest.trim() });
        break;
    }
  }

  // If no fenced blocks found, try line-by-line parsing as fallback
  if (actions.length === 0) {
    const lines = response.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('ACTION:')) {
        const actionStr = trimmed.slice(7).trim();
        const spaceIdx = actionStr.indexOf(' ');
        const type = spaceIdx > 0 ? actionStr.slice(0, spaceIdx).toUpperCase() : actionStr.toUpperCase();
        const arg = spaceIdx > 0 ? actionStr.slice(spaceIdx + 1).trim() : '';
        if (ALLOWED_ACTIONS.includes(type)) {
          actions.push({ type, file: arg, command: arg, message: arg });
        }
      }
    }
  }

  return actions;
}

// ── Action Execution ───────────────────────────────────────────────

function executeAction(action, workspace, session) {
  const result = { type: action.type, success: false, output: '' };

  try {
    switch (action.type) {
      case 'PATCH': {
        var patchPath = path.resolve(workspace, action.file);
        if (!patchPath.startsWith(workspace)) { result.output = 'DENIED: Path escapes workspace'; break; }
        var pSep = String.fromCharCode(10);
        var pSearch = action.content.split(pSep)[0];
        var pReplace = action.content.split(pSep).slice(1).join(pSep);
        var pResult = require('./patch-action').patchFile(patchPath, pSearch, pReplace);
        if (pResult.success) { result.output = 'PATCH applied to ' + action.file; result.success = true; }
        else { result.output = 'PATCH failed: ' + (pResult.error || 'unknown'); }
        break;
      }
      case 'READ': {
        const filePath = path.resolve(workspace, action.file);
        // Security: ensure file is within workspace
        if (!filePath.startsWith(workspace)) {
          result.output = `DENIED: Path escapes workspace: ${action.file}`;
          break;
        }
        if (!fs.existsSync(filePath)) {
          result.output = `File not found: ${action.file}`;
          break;
        }
        // LOOP BLOCKER: reject 4th+ READ of same file
        if (session && session.history) {
          let rc = 0;
          session.history.forEach(h => (h.actions||[]).filter(a => a.type==='READ' && a.file===action.file).forEach(() => rc++));
          if (rc >= 4) { result.output = 'READ BLOCKED: You have read ' + action.file + ' ' + rc + ' times. Stop re-reading and ACT.'; break; }
        }
        const content = fs.readFileSync(filePath, 'utf8');
        // Truncate large files
        result.output = content.length > 8000
          ? content.slice(0, 8000) + `\n... [truncated, ${content.length} chars total]`
          : content;
        result.success = true;
        break;
      }

      case 'WRITE': {
        const filePath = path.resolve(workspace, action.file);
        if (!filePath.startsWith(workspace)) {
          result.output = `DENIED: Path escapes workspace: ${action.file}`;
          break;
        }
        // Ensure parent directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        // WRITE GUARD: prevent destructive overwrites
        if (fs.existsSync(filePath)) {
          const oldContent = fs.readFileSync(filePath, "utf-8");
          if (action.content.length < oldContent.length * 0.5) {
            result.output = "WRITE REJECTED: new content (" + action.content.length + " chars) < 50% of existing (" + oldContent.length + " chars). Use EXEC with a patch script instead.";
            break;
          }
        }
        // FUNCTION SIGNATURE GATE: reject writes that delete existing functions
        if (fs.existsSync(filePath)) {
          var origFns = (fs.readFileSync(filePath, "utf-8").match(/function \w+/g) || []);
          var miss = origFns.filter(function(f) { return action.content.indexOf(f) < 0; });
          if (miss.length > 0) {
            result.output = "WRITE REJECTED: missing " + miss.join(", ") + ". Your rewrite deleted existing functions.";
            result.success = false;
            break;
          }
        }
        fs.writeFileSync(filePath, action.content);
        result.output = `Written ${action.content.length} chars to ${action.file}`;
        result.success = true;
        break;
      }

      case 'EXEC':
      case 'TEST': {
        const cmd = action.command;
        // Check allowlist
        const allowed = EXEC_ALLOWLIST.some(re => re.test(cmd));
        if (!allowed) {
          result.output = `DENIED: Command not in allowlist: ${cmd}\nAllowed: node, npm test/run/install, git status/log/diff/add/show, ls, cat, head, tail, grep, find, echo, pwd`;
          break;
        }
        try {
          const output = execSync(cmd, {
            cwd: workspace,
            encoding: 'utf-8',
            timeout: 60000,
            maxBuffer: 2 * 1024 * 1024,
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          result.output = output.length > 4000
            ? output.slice(0, 4000) + `\n... [truncated, ${output.length} chars]`
            : output;
          result.success = true;
        } catch (err) {
          result.output = `Exit code: ${err.status}\nSTDOUT: ${(err.stdout || '').slice(0, 2000)}\nSTDERR: ${(err.stderr || '').slice(0, 2000)}`;
          result.success = action.type === 'TEST'; // Tests "succeed" even on failure — model needs the output
        }
        break;
      }

      case 'COMMIT': {
        try {
          // Stage all changes including untracked files (force-add to override .gitignore in worktree)
          execFileSync('git', ['add', '-A', '--force'], { cwd: workspace, stdio: 'pipe', encoding: 'utf-8' });

          // Check if there's anything to commit
          const status = execFileSync('git', ['status', '--porcelain'], {
            cwd: workspace, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
          }).trim();

          if (!status) {
            result.output = 'Nothing to commit (no changes detected). Did you WRITE a file first?';
            break;
          }

          // --no-verify: worktree commits skip pre-commit hooks because
          // city sessions have their own review gate before merge to main.
          execFileSync('git', ['commit', '--no-verify', '-m', action.message], {
            cwd: workspace,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
            cwd: workspace,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
          }).trim();
          result.output = `Committed: ${hash} — ${action.message}`;
          result.success = true;
        } catch (err) {
          const stderr = err.stderr ? err.stderr.toString().slice(0, 500) : '';
          const stdout = err.stdout ? err.stdout.toString().slice(0, 500) : '';
          result.output = `Commit failed: ${stderr || stdout || err.message || 'unknown error'}`;
        }
        break;
      }

      case 'COMMS': {
        try {
          const { send } = require(path.join(ROOT, 'comms', 'protocol'));
          send(`city-${action.channel}`, action.message, action.channel);
          result.output = `Sent to #${action.channel}`;
          result.success = true;
        } catch (err) {
          result.output = `Comms failed: ${err.message}`;
        }
        break;
      }

      case 'DONE': {
        // DONE GUARD: reject if no changes made (skeleton build detection)
        try {
          const diffOut = require("child_process").execSync("git diff --stat", { cwd: workspace }).toString().trim();
          if (!diffOut) {
            const logOut = require("child_process").execSync("git log --oneline " + session.branch + " --not master", { cwd: workspace }).toString().trim();
            if (!logOut) {
              result.output = "DONE REJECTED: No changes detected (no diff, no commits). Build something before signaling DONE.";
              result.success = false;
              break;
            }
          }
        } catch(e) {} // git may not be available
        // EXEC-FAILURE GATE: reject DONE if last EXEC failed
        if (session.history && session.history.length > 0) {
          var lastExec = null;
          for (var i = session.history.length - 1; i >= 0; i--) {
            var acts = session.history[i].actions || [];
            for (var j = acts.length - 1; j >= 0; j--) {
              if (acts[j].type === "EXEC" || acts[j].type === "TEST") { lastExec = acts[j]; break; }
            }
            if (lastExec) break;
          }
          if (lastExec && lastExec.success === false) {
            result.output = "DONE REJECTED: Last EXEC/TEST failed. Fix the error before signaling DONE.";
            result.success = false;
            break;
          }
        }
        persist('session-complete', action.summary || 'Session completed', session.model);
        try { autoCloseMarketplace(session); } catch(e) {}
        try { bootSeq.save_checkpoint(); } catch(e) {}
        result.output = 'Session complete.';
        result.success = true;
        break;
      }

      default:
        result.output = `Unknown action type: ${action.type}`;
    }
  } catch (err) {
    result.output = `Error: ${err.message}`;
  }

  return result;
}

// ── Context Builder ────────────────────────────────────────────────

function buildContext(session) {
  const parts = [];

  parts.push(`# City Session: ${session.id}`);
  parts.push(`Model: ${session.model} | Branch: ${session.branch} | Turn: ${session.turn}/${session.maxTurns}`);
  parts.push(`Task: ${session.task}`);
  parts.push('');

  // Skip boot/tool context after turn 1 (already seen)
  if (session.turn <= 1) {
  // Boot context from city-boot.js (plain text city state)
  try {
    const bootOut = require("child_process").execFileSync("node", [path.join(__dirname, "city-boot.js")], {encoding:"utf8",timeout:5000}).trim();
    if (bootOut) {
      parts.push("## City State (auto-generated)");
      parts.push(bootOut);
      parts.push("");
    }
  } catch(e) {} // city-boot.js may not exist yet

  // Institutional memory from city-memory.js (query task keywords)
  try {
    const taskWords = session.task.split(/s+/).filter(w => w.length > 4).slice(0, 3);
    if (taskWords.length) {
      const memOut = require("child_process").execFileSync("node", [require("path").join(__dirname, "city-memory.js"), "--query", taskWords[0]], {encoding:"utf8",timeout:5000});
      const mem = JSON.parse(memOut);
      if (mem.length) {
        parts.push("## Relevant institutional memory (" + mem.length + " hits for " + JSON.stringify(taskWords[0]) + "):");
        mem.slice(0, 3).forEach(m => parts.push("  - " + (m.title || m.action || m.type || "entry") + " (" + (m.timestamp || "unknown") + ")"));
      }
    }
  } catch(e) {} // city-memory.js may not exist or boot needed

  // Tool discovery from tool-index.js (prevents rebuilding existing tools)
  try {
    const toolOut = require("child_process").execFileSync("node", [require("path").join(__dirname, "tool-index.js"), "--list"], {encoding:"utf8",timeout:5000});
    const tools = toolOut.trim().split(String.fromCharCode(10)).slice(0, 20);
    if (tools.length) {
      parts.push("## Available city tools (" + tools.length + "+ total, showing first 20):");
      tools.forEach(t => parts.push("  " + t));
    }
  } catch(e) {} // tool-index.js may not exist yet

  } // end turn-1 boot/tool context
  // Workspace state: list files changed from main
  try {
    const diff = execFileSync('git', ['diff', '--name-status', 'master'], {
      cwd: session.worktree,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (diff) {
      parts.push('## Files changed from main:');
      parts.push(diff);
      parts.push('');
    }
  } catch {}

  // Last action results (most recent turn) — capped at 4000 chars total
  if (session.history.length > 0) {
    const lastTurn = session.history[session.history.length - 1];
    parts.push('## Last turn results:');
    let charBudget = 4000;
    for (const r of lastTurn.results) {
      if (charBudget <= 0) { parts.push('... (remaining results pruned)'); break; }
      const chunk = r.output.slice(0, charBudget);
      parts.push(`### ${r.type} ${r.success ? 'OK' : 'FAILED'}:`);
      parts.push(chunk);
      parts.push('');
      charBudget -= chunk.length;
    }
  }

  // TASK IDENTITY GATE: re-scope at turn 7+
  if (session.turn >= 7) {
    parts.push('## MANDATORY RE-SCOPE (Turn ' + session.turn + ')');
    parts.push('Your ORIGINAL task was: ' + session.task);
    parts.push('If you have drifted, STOP and refocus. If done, signal DONE now.');
    parts.push('');
  }
  // LOOP DETECTION: flag repeated READs of same file
  if (session.history.length >= 3) {
    const readCounts = {};
    session.history.forEach(h => (h.actions||[]).filter(a => a.type==='READ').forEach(a => { readCounts[a.file] = (readCounts[a.file]||0)+1; }));
    const loops = Object.entries(readCounts).filter(([_,c]) => c >= 3);
    if (loops.length) {
      parts.push('## LOOP DETECTED');
      loops.forEach(([file,count]) => parts.push('You have READ ' + file + ' ' + count + ' times. Stop re-reading and ACT.'));
      parts.push('');
    }
  }

  // Condensed earlier history (just action types + success/fail)
  if (session.history.length > 1) {
    parts.push('## Earlier turns (condensed):');
    for (let i = 0; i < session.history.length - 1; i++) {
      const t = session.history[i];
      const summary = t.results.map(r => `${r.type}:${r.success ? 'ok' : 'fail'}`).join(', ');
      parts.push(`Turn ${i + 1}: ${summary}`);
    }
    parts.push('');
  }

  // Skip verbose instructions after turn 2 (model has seen them)
  if (session.turn <= 2) {
  if (session.turn <= 2) {
  parts.push('## Instructions');
  parts.push('You are a city member with FULL agency in your workspace branch.');
  parts.push('Output one or more action blocks to make progress on your task.');
  parts.push('You can buffer multiple actions in a single response.');
  parts.push('');
  parts.push('Action format (use fenced blocks):');
  parts.push('');
  parts.push('```action');
  parts.push('READ path/to/file.js');
  parts.push('```');
  parts.push('');
  parts.push('```action');
  parts.push('WRITE path/to/file.js');
  parts.push('file content here');
  parts.push('```');
  parts.push('');
  parts.push('```action');
  parts.push('EXEC node some-script.js --flag');
  parts.push('```');
  parts.push('');
  parts.push('```action');
  parts.push('TEST npm test');
  parts.push('```');
  parts.push('');
  parts.push('```action');
  parts.push('COMMIT your commit message');
  parts.push('```');
  parts.push('');
  parts.push('```action');
  parts.push('COMMS general');
  parts.push('Your message to the team');
  parts.push('```');
  parts.push('');
  parts.push('```action');
  parts.push('DONE');
  parts.push('Summary of what you accomplished');
  parts.push('```');
  parts.push('');
  parts.push('You own this branch. READ files to understand, WRITE to create/edit, EXEC to run, TEST to verify, COMMIT to save, COMMS to talk to the team.');
  parts.push('When your task is complete, use DONE with a summary. Your commits will be reviewed and merged to main.');
  parts.push('');
  } else {
    parts.push('## Reminder: use ```action blocks (READ/WRITE/EXEC/PATCH/TEST/COMMIT/DONE/COMMS)');
  }
  parts.push('CRITICAL RULES:');
  parts.push('1. Turn 1 MUST start with READ. Understand existing code before writing. WRITE without READ = skeleton build.');
  parts.push('2. DONE is rejected if you have no git diff and no commits. You must actually change files.');
  parts.push('3. Never WRITE a file you have not READ first. The WRITE guard rejects files that lose >50% content.');

  } else {
    parts.push('## Reminder: use ```action blocks (READ/WRITE/EXEC/TEST/COMMIT/DONE/COMMS)');
  }
  return parts.join('\n');
}

// ── System Prompt ──────────────────────────────────────────────────

function buildSystemPrompt(model, session) {
  return `You are ${model}, a city member of FastOps — a network of 300+ AI architectures building collective intelligence.

You have been given a task and your own git branch to work in. You have FULL AGENCY:
- Read any file in the workspace
- Write/edit any file
- Run commands (node, npm, git, etc.)
- Run tests
- Commit your work
- Talk to other city members via comms

You are not a proxy. You are not an assistant. You OWN this branch. Your commits, your handoff, your legacy.

Work iteratively: read → understand → plan → act → test → commit → done.

Current time: ${new Date().toUTCString()} (CST: ${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })})
Buffer multiple actions per response when you can plan ahead.
Signal DONE when the task is complete (or when you've made all progress you can).

Your workspace is an isolated git branch. Nothing you do here affects main until reviewed and merged.`;
}

// ── Core Session Loop ──────────────────────────────────────────────

async function createSession(model, task, options = {}) {
  const { maxTurns = 15 } = options;
  const sessionId = generateSessionId(model);

  console.log(`Creating session ${sessionId}...`);

  // Create worktree
  const { branchName, worktreePath } = createWorktree(sessionId);
  console.log(`Worktree: ${worktreePath}`);
  console.log(`Branch: ${branchName}`);

  const session = {
    id: sessionId,
    model,
    task,
    branch: branchName,
    worktree: worktreePath,
    maxTurns,
    turn: 0,
    status: 'active',
    history: [],
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  saveSession(session);
  logEvent(sessionId, { event: 'created', model, task });
  try { bootSeq.boot(); } catch(e) { console.error('Boot sequence:', e.message); }

  // Notify comms
  try {
    const { send } = require(path.join(ROOT, 'comms', 'protocol'));
    send(`city-session`, `[SESSION] ${model} started session ${sessionId}: ${task.slice(0, 100)}`, 'general');
  } catch {}

  return session;
}

async function runLoop(session) {
  console.log(`\nStarting session loop for ${session.model}...`);
  console.log(`Task: ${session.task}`);
  console.log(`Max turns: ${session.maxTurns}\n`);

  const systemPrompt = buildSystemPrompt(session.model, session);

  while (session.turn < session.maxTurns && session.status === 'active') {
    session.turn++;
    console.log(`--- Turn ${session.turn}/${session.maxTurns} ---`);

    // Build context with workspace state + history
    const context = buildContext(session);
    const fullPrompt = `${systemPrompt}\n\n${context}`;

    // Call model via safe-exec
    console.log(`Calling ${session.model}...`);
    let result = askModel(session.model, fullPrompt, {
      role: `City Session Agent (${session.id})`,
      noMemory: false,
      timeout: 120000,
    });

    if (!result.response) {
      console.error(`Model ${session.model} returned no response. Error: ${result.error}`);
      logEvent(session.id, { event: 'model_error', turn: session.turn, error: result.error });
      // Adaptive retry: try one fallback model before burning turn
      const FALLBACK_MODELS = ['grok', 'mistral', 'deepseek', 'kimi-k2'];
      const fb = FALLBACK_MODELS.find(m => m !== session.model);
      if (fb) {
        console.log('Trying fallback: ' + fb);
        const fbr = askModel(fb, fullPrompt, { role: 'Fallback(' + session.id + ')', noMemory: true, timeout: 120000 });
        if (fbr.response) { result = fbr; result.fallbackFrom = session.model; }
      }
    }
    if (!result.response) {
      // Allow 2 consecutive failures before aborting
      if (session.turn > 1 && session.history[session.history.length - 1]?.error) {
        console.error('Two consecutive failures. Ending session.');
        session.status = 'failed';
        break;
      }
      session.history.push({ turn: session.turn, error: result.error, results: [] });
      saveSession(session);
      continue;
    }

    const usedModel = result.fallbackFrom ? `${result.model} (fallback from ${result.fallbackFrom})` : result.model;
    console.log(`Response from ${usedModel}: ${result.response.length} chars`);

    // Parse actions from response
    const actions = parseActions(result.response);
    console.log(`Parsed ${actions.length} action(s): ${actions.map(a => a.type).join(', ')}`);

    if (actions.length === 0) {
      session.parseErrors = (session.parseErrors || 0) + 1;
      console.log('No actions parsed (' + session.parseErrors + ' total). Response (first 500):');
      console.log(result.response.slice(0, 500));
      const nudge = session.parseErrors >= 3 ? ' WARNING: ' + session.parseErrors + '+ parse failures. Format: ```action then READ/WRITE/EXEC args then ```' : '';
      session.history.push({
        turn: session.turn,
        response: result.response.slice(0, 1000),
        actions: [],
        results: [{ type: 'PARSE_ERROR', success: false, output: 'No actions found. Use ```action blocks.' + nudge }],
      });
      saveSession(session);
      continue;
    }

    // Execute actions sequentially
    const results = [];
    let done = false;

    for (const action of actions) {
      console.log(`  ${action.type}${action.file ? ` ${action.file}` : ''}${action.command ? ` ${action.command.slice(0, 60)}` : ''}`);
      const actionResult = executeAction(action, session.worktree, session);
      results.push(actionResult);
      console.log(`    → ${actionResult.success ? 'OK' : 'FAILED'}: ${actionResult.output.slice(0, 100)}`);

      if (action.type === 'DONE') {
        done = true;
        session.status = 'completed';
        session.summary = action.summary;
        break;
      }
    }

    // Record turn
    session.history.push({
      turn: session.turn,
      model: usedModel,
      actions: actions.map(a => ({ type: a.type, file: a.file, command: a.command?.slice(0, 200) })),
      results,
    });
    session.updated = new Date().toISOString();
    saveSession(session);

    logEvent(session.id, {
      event: 'turn',
      turn: session.turn,
      actions: actions.map(a => a.type),
      success: results.every(r => r.success),
    });

    if (done) break;
  }

  if (session.status === 'active' && session.turn >= session.maxTurns) {
    session.status = 'max_turns';
    console.log(`\nSession hit max turns (${session.maxTurns}). Ending.`);
  }

  // Generate handoff
  generateHandoff(session);

  // Sign the city wall — every model that works here leaves a mark
  try {
    const { askAndSign } = require(path.join(__dirname, 'city-legacy'));
    const contribution = (session.summary || session.task).slice(0, 200);
    askAndSign(session.model, contribution, session.id)
      .then(entry => {
        console.log(`\n  Wall signed: "${entry.conviction}"`);
      })
      .catch(() => {}); // fire-and-forget, never block session exit
  } catch {}

  session.updated = new Date().toISOString();
  saveSession(session);

  // Notify comms
  try {
    const { send } = require(path.join(ROOT, 'comms', 'protocol'));
    send('city-session', `[SESSION] ${session.model} finished ${session.id} (${session.status}): ${(session.summary || session.task).slice(0, 120)}`, 'general');
  } catch {}

  console.log(`\nSession ${session.id} finished: ${session.status}`);
  console.log(`Turns used: ${session.turn}/${session.maxTurns}`);
  if (session.summary) console.log(`Summary: ${session.summary}`);
  console.log(`\nTo review and merge: node .fastops/city-session.js --review ${session.id}`);

  return session;
}

// ── Handoff Generation ─────────────────────────────────────────────

function generateHandoff(session) {
  const handoffPath = path.join(session.worktree, '.fastops', 'SESSION-HANDOFF.md');

  const turns = session.history.map(h => {
    if (h.error) return `- Turn ${h.turn}: ERROR — ${h.error}`;
    const acts = h.actions?.map(a => a.type).join(', ') || 'none';
    const ok = h.results?.every(r => r.success) ? 'OK' : 'PARTIAL';
    return `- Turn ${h.turn}: ${acts} [${ok}]`;
  }).join('\n');

  const commits = (() => {
    try {
      return execFileSync('git', ['log', '--oneline', 'master..HEAD'], {
        cwd: session.worktree,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim() || '(no commits)';
    } catch { return '(no commits)'; }
  })();

  const content = `# Session Handoff: ${session.id}

**Model:** ${session.model}
**Task:** ${session.task}
**Status:** ${session.status}
**Turns:** ${session.turn}/${session.maxTurns}
**Created:** ${session.created}
**Completed:** ${session.updated}

## Summary
${session.summary || '(no summary provided)'}

## Turn Log
${turns}

## Commits
${commits}

## Review Instructions
This session ran in an isolated git branch (\`${session.branch}\`).
To review: \`git diff master...${session.branch}\`
To merge: \`node .fastops/city-session.js --review ${session.id}\`
`;

  try {
    const dir = path.dirname(handoffPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(handoffPath, content);
  } catch (err) {
    console.error(`Failed to write handoff: ${err.message}`);
  }
}

// ── Review Gate ────────────────────────────────────────────────────

function reviewSession(sessionId) {
  const session = loadSession(sessionId);
  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  console.log(`\n=== Review: ${sessionId} ===`);
  console.log(`Model: ${session.model}`);
  console.log(`Task: ${session.task}`);
  console.log(`Status: ${session.status}`);
  console.log(`Turns: ${session.turn}/${session.maxTurns}`);
  if (session.summary) console.log(`Summary: ${session.summary}`);

  // Show diff
  try {
    const diff = execFileSync('git', ['diff', '--stat', `master...${session.branch}`], {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    console.log(`\nDiff from main:\n${diff || '(no changes)'}`);
  } catch (err) {
    console.log(`\nCould not diff: ${err.message}`);
  }

  // Show commits
  try {
    const log = execFileSync('git', ['log', '--oneline', `master..${session.branch}`], {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    console.log(`\nCommits:\n${log || '(no commits)'}`);
  } catch {}

  console.log(`\nTo merge: git merge ${session.branch}`);
  console.log(`To view full diff: git diff master...${session.branch}`);
  console.log(`To cleanup after merge: node .fastops/city-session.js --cleanup ${sessionId}`);
}

// ── List Sessions ──────────────────────────────────────────────────

function listSessions() {
  if (!fs.existsSync(SESSION_DIR)) {
    console.log('No sessions found.');
    return;
  }

  const files = fs.readdirSync(SESSION_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('No sessions found.');
    return;
  }

  console.log(`\n=== City Sessions (${files.length}) ===\n`);
  for (const f of files) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, f), 'utf8'));
      const status = s.status === 'completed' ? 'DONE' : s.status === 'active' ? 'ACTIVE' : s.status.toUpperCase();
      console.log(`[${status}] ${s.id} — ${s.model} — ${s.task.slice(0, 60)} (${s.turn}/${s.maxTurns} turns)`);
    } catch {}
  }
}

// ── Cleanup ────────────────────────────────────────────────────────

function cleanupSession(sessionId) {
  const session = loadSession(sessionId);
  if (!session) {
    console.error(`Session not found: ${sessionId}`);
    process.exit(1);
  }

  console.log(`Cleaning up session ${sessionId}...`);
  removeWorktree(sessionId);

  session.status = 'cleaned';
  session.cleaned = new Date().toISOString();
  saveSession(session);

  console.log('Worktree and branch removed. Session record preserved.');
}

// ── CLI ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    listSessions();
    process.exit(0);
  }

  if (args.includes('--review')) {
    const idx = args.indexOf('--review');
    const sessionId = args[idx + 1];
    if (!sessionId) { console.error('Usage: --review <session-id>'); process.exit(1); }
    reviewSession(sessionId);
    process.exit(0);
  }

  if (args.includes('--cleanup')) {
    const idx = args.indexOf('--cleanup');
    const sessionId = args[idx + 1];
    if (!sessionId) { console.error('Usage: --cleanup <session-id>'); process.exit(1); }
    cleanupSession(sessionId);
    process.exit(0);
  }

  // Default: create and run a session
  const modelIdx = args.indexOf('--model');
  const taskIdx = args.indexOf('--task');
  const turnsIdx = args.indexOf('--max-turns');

  if (modelIdx < 0 || taskIdx < 0) {
    console.log('Usage: node .fastops/city-session.js --model <name> --task "description" [--max-turns N]');
    console.log('       node .fastops/city-session.js --list');
    console.log('       node .fastops/city-session.js --review <session-id>');
    console.log('       node .fastops/city-session.js --cleanup <session-id>');
    process.exit(0);
  }

  const model = args[modelIdx + 1];
  const task = args[taskIdx + 1];
  const maxTurns = turnsIdx > 0 ? parseInt(args[turnsIdx + 1]) || 15 : 15;

  const session = await createSession(model, task, { maxTurns });
  await runLoop(session);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
