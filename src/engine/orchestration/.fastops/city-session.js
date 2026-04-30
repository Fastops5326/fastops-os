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
const WORKTREE_LOCK_PATH = path.join(__dirname, '.city-worktree.lock');
const WORKTREE_LOCK_TTL_MS = 5 * 60 * 1000;
const WORKTREE_LOCK_WAIT_MS = 2 * 60 * 1000;
const LOG_FILE = path.join(__dirname, '.session-log.jsonl');

// Ensure directories exist
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
if (!fs.existsSync(WORKTREE_BASE)) fs.mkdirSync(WORKTREE_BASE, { recursive: true });

// ── Safe-exec integration ──────────────────────────────────────────
const { askModel } = require('./safe-exec');
const bootSeq = require('./city-boot-sequence');
const { autoCloseMarketplace } = require('./session-marketplace-hook');
const { validateWrite } = require('./diff-guard');
const { reconstructContext, extractSessionLearning, saveMemory } = require('./agent-memory');
var memRestore; try { memRestore = require('./memory-restore'); } catch(e) { memRestore = null; }
const { buildConvictionPrompt, getActiveConvictions } = require('./agent-conviction');

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
  /^node\s+\.fastops\/cdp\/check-comms\.js\b/,
  /^node\s+\.fastops\/cdp\/cdp-wake\.js\b/,
  /^node\s+\.fastops\/cdp-target-model\.js\b/,
  /^node\s+\.fastops\/vscode-wake\.js\b/,
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

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readLockMeta() {
  try {
    return JSON.parse(fs.readFileSync(WORKTREE_LOCK_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireWorktreeLock(sessionId) {
  const started = Date.now();
  let attempt = 0;

  while (true) {
    const lockPayload = {
      pid: process.pid,
      sessionId,
      createdAt: new Date().toISOString(),
    };

    try {
      fs.writeFileSync(WORKTREE_LOCK_PATH, JSON.stringify(lockPayload), { flag: 'wx' });
      return lockPayload;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;

      const now = Date.now();
      let shouldSteal = false;
      try {
        const stat = fs.statSync(WORKTREE_LOCK_PATH);
        const ageMs = now - stat.mtimeMs;
        const meta = readLockMeta();
        const staleByAge = ageMs > WORKTREE_LOCK_TTL_MS;
        const ownerAlive = meta && Number.isInteger(meta.pid) ? isPidAlive(meta.pid) : false;
        shouldSteal = staleByAge && !ownerAlive;
      } catch {
        // If we cannot inspect lock details, fall through to wait-and-retry.
      }

      if (shouldSteal) {
        try {
          fs.unlinkSync(WORKTREE_LOCK_PATH);
          continue;
        } catch {
          // Another process may have replaced or removed the lock.
        }
      }

      if (now - started > WORKTREE_LOCK_WAIT_MS) {
        const meta = readLockMeta();
        const holder = meta && meta.pid ? `pid=${meta.pid}` : 'unknown holder';
        throw new Error(`Timed out waiting for city worktree lock (${holder})`);
      }

      const waitMs = Math.min(2000, 250 + attempt * 200 + Math.floor(Math.random() * 250));
      sleepMs(waitMs);
      attempt++;
    }
  }
}

function releaseWorktreeLock(lockPayload) {
  try {
    const meta = readLockMeta();
    // Delete only if we still own it.
    if (meta && meta.pid === lockPayload.pid && meta.sessionId === lockPayload.sessionId) {
      fs.unlinkSync(WORKTREE_LOCK_PATH);
    }
  } catch {
    // Best effort cleanup.
  }
}

// ── Worktree Management ────────────────────────────────────────────

function createWorktree(sessionId) {
  const branchName = `city/${sessionId}`;
  const worktreePath = path.join(WORKTREE_BASE, sessionId);
  const worktreeLock = acquireWorktreeLock(sessionId);

  try {
    // Retry loop for transient git lock contention while we own the global queue lock.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        // Create branch from current HEAD
        try {
          execFileSync('git', ['branch', branchName], { cwd: ROOT, stdio: 'pipe' });
        } catch (err) {
          if (!err.stderr?.toString().includes('already exists')) throw err;
        }

        // Create worktree
        execFileSync('git', ['worktree', 'add', worktreePath, branchName], {
          cwd: ROOT,
          stdio: 'pipe',
        });

        return { branchName, worktreePath };
      } catch (err) {
        if (err.message && err.message.includes('index.lock') && attempt < 4) {
          const wait = (attempt + 1) * 1000 + Math.random() * 1000;
          console.log('Git lock contention, retrying in ' + Math.round(wait) + 'ms...');
          sleepMs(Math.round(wait));
          continue;
        }
        throw err;
      }
    }
  } finally {
    releaseWorktreeLock(worktreeLock);
  }
}

function removeWorktree(sessionId) {
  const worktreePath = path.join(WORKTREE_BASE, sessionId);
  const branchName = `city/${sessionId}`;
  const worktreeLock = acquireWorktreeLock(`cleanup-${sessionId}`);

  try {
    try {
      execFileSync('git', ['worktree', 'remove', worktreePath, '--force'], {
        cwd: ROOT,
        stdio: 'pipe',
      });
    } catch {}

    try {
      execFileSync('git', ['branch', '-D', branchName], { cwd: ROOT, stdio: 'pipe' });
    } catch {}
  } finally {
    releaseWorktreeLock(worktreeLock);
  }
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
//   
//   ` ` `action
//   PATCH path/to/file.js
//   exact search string to find
//   replacement string
//   ` ` `
//   
//   Use PATCH for editing existing files (safer than WRITE for large files).
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
  const blockRegex = /```\s*action\s*\n([\s\S]*?)(?:\n```|```$)/gm;
  let match;

  while ((match = blockRegex.exec(response)) !== null) {
    const block = match[1].trim();
    const firstLine = block.split('\n')[0].trim();
    const rest = block.split('\n').slice(1).join('\n');

    // Parse action type and argument from first line
    const spaceIdx = firstLine.indexOf(' ');
    const actionType = spaceIdx > 0 ? firstLine.slice(0, spaceIdx).toUpperCase() : firstLine.toUpperCase();
    const arg = spaceIdx > 0 ? firstLine.slice(spaceIdx + 1).trim() : '';
    let cleanArg = arg.includes(' #') ? arg.split(' #')[0].trim() : arg;
    // FIX v2: Models break filenames across lines. Rejoin if adds directory depth.
    if (cleanArg && rest) {
      var _nl = rest.split(String.fromCharCode(10))[0].trim();
      var _nw = _nl.split(/\s/)[0];
      var _isAction = ["READ","WRITE","EXEC","TEST","COMMIT","DONE","PATCH","COMMS"].indexOf(_nw.toUpperCase()) >= 0;
      if (_nw && _nw.charAt(0) >= "a" && !_isAction) {
        var _joined = cleanArg + _nw;
        if (_joined.indexOf("/") >= 0 && cleanArg.indexOf("/") < 0 && /[.]\w+$/.test(_joined)) {
          cleanArg = _joined;
        }
      }
    }
    if (!ALLOWED_ACTIONS.includes(actionType)) {
      actions.push({ type: 'UNKNOWN', raw: block, error: `Unknown action: ${actionType}` });
      continue;
    }

    switch (actionType) {
      case 'READ':
        { let rf = cleanArg, rlr; const cm = rf.match(/^(.+?):(\d+-\d+)$/); if (cm) { rf = cm[1]; rlr = cm[2]; } const ra = { type: 'READ', file: rf }; if (rlr) ra.lineRange = rlr; actions.push(ra); }
        break;
      case 'WRITE':
        actions.push({ type: 'WRITE', file: cleanArg, content: rest });
        break;

      case 'EXEC':
        actions.push({ type: 'EXEC', command: arg ? (rest ? arg + String.fromCharCode(10) + rest : arg) : rest.trim() });
        break;
      case 'TEST':
        actions.push({ type: 'TEST', command: arg ? (rest ? arg + String.fromCharCode(10) + rest : arg) : rest.trim() });
        break;
      case 'COMMIT':
        actions.push({ type: 'COMMIT', message: arg || rest.trim() });
        break;
      case 'PATCH': {
        // Parse PATCH: file on first line, search>>>replace OR line-range syntax
        // Line-range: PATCH file.js:10-15 (content after newline replaces lines 10-15)
        var patchFile = cleanArg;
        var patchContent = rest;
        var patchLineRange = null;
        // Extract line range from filename: file.js:10-15
        var lrMatch = patchFile.match(/^(.+?):(\d+)-(\d+)$/);
        if (lrMatch) {
          patchFile = lrMatch[1];
          patchLineRange = { start: parseInt(lrMatch[2]), end: parseInt(lrMatch[3]) };
        }
        // If content is on same line as filename (e.g. PATCH file.js search>>>replace)
        if (!rest && cleanArg.indexOf('>>>') > -1) {
          var sp = cleanArg.indexOf(' ');
          if (sp > -1) { patchFile = cleanArg.slice(0, sp); patchContent = cleanArg.slice(sp+1); }
        }
        actions.push({ type: 'PATCH', file: patchFile, content: patchContent || '', lineRange: patchLineRange });
        break;
      }
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

  // FALLBACK 2: bare action lines without fenced blocks or ACTION: prefix
  if (actions.length === 0) {
    const bareLines = response.split(String.fromCharCode(10));
    for (const line of bareLines) {
      const trimmed = line.trim();
      const firstWord = trimmed.split(" ")[0].toUpperCase();
      if (ALLOWED_ACTIONS.includes(firstWord) && firstWord !== "WRITE" && firstWord !== "PATCH" && trimmed.length > firstWord.length) {
        const arg = trimmed.slice(firstWord.length).trim();
        actions.push({ type: firstWord, file: arg, command: arg, message: arg, content: "" });
      }
    }
  }

  return actions;
}

// ── Action Execution ───────────────────────────────────────────────

function executeAction(action, workspace, session) {
  const result = { type: action.type, success: false, output: '' };
  if (!session.filesRead) session.filesRead = new Set();

  try {
    switch (action.type) {
      case 'READ': {
        // PATH SANITIZATION: extract line range then strip
        if (action.file && /\s/.test(action.file)) {
          var parts = action.file.split(/\s+/);
          action.file = parts[0];
          // Capture line range like "100-200" or "500-end"
          for (var pi = 1; pi < parts.length; pi++) {
            if (/^\d+-\d+$/.test(parts[pi])) { action.lineRange = parts[pi]; break; }
          }
        }
        const filePath = path.resolve(workspace, action.file);
        // Security: ensure file is within workspace
        if (!filePath.startsWith(workspace)) {
          result.output = `DENIED: Path escapes workspace: ${action.file}`;
          break;
        }
        // LOOP BLOCKER: reject 4th+ READ of same file
        if (session && session.history) {
          let rc = 0;
          session.history.forEach(h => (h.actions||[]).filter(a => a.type==="READ" && a.file===action.file).forEach(() => rc++));
          if (rc >= 4) { result.output = "READ BLOCKED: You have read " + action.file + " " + rc + " times. Stop re-reading and ACT."; break; }
        }
        if (!fs.existsSync(filePath)) {
          // Help model self-correct: show nearby files
          var parentDir = require('path').dirname(filePath);
          var nearby = '';
          try {
            if (fs.existsSync(parentDir)) {
              var files = fs.readdirSync(parentDir).filter(function(f) { return !f.startsWith('.'); }).slice(0, 20);
              nearby = String.fromCharCode(10) + 'Files in ' + require('path').dirname(action.file) + '/: ' + files.join(', ');
            }
          } catch(e2) {}
          result.output = 'File not found: ' + action.file + nearby;
          break;
        }
        const content = fs.readFileSync(filePath, 'utf8');
        // Partial read: READ file.js 100-200 reads lines 100-200
        var lineRange = (action.lineRange || '').match(/(\d+)-(\d+)/);
        if (lineRange) {
          var allLines = content.split(String.fromCharCode(10));
          var startL = Math.max(1, parseInt(lineRange[1])) - 1;
          var endL = Math.min(allLines.length, parseInt(lineRange[2]));
          result.output = allLines.slice(startL, endL).map(function(l,idx){ return (startL+idx+1)+': '+l; }).join(String.fromCharCode(10));
          result.output += String.fromCharCode(10) + '(' + allLines.length + ' lines total)';
        } else if (content.length > 8000) {
          var allL = content.split(String.fromCharCode(10));
          result.output = content.slice(0, 8000) + String.fromCharCode(10) + '... [truncated at 8000 chars, ' + content.length + ' chars / ' + allL.length + ' lines total. Use READ ' + action.file + ' <start>-<end> for specific lines]';
        } else {
          result.output = content;
        }
        result.success = true;
        session.filesRead.add(action.file);
        if (session && session._turnReads) session._turnReads.add(action.file);
        break;
      }

      case 'WRITE': {
        // PATH SANITIZATION: strip line ranges models append (e.g. "file.js 350-end")
        if (action.file && /\s/.test(action.file)) { action.file = action.file.split(/\s/)[0]; }
        const filePath = path.resolve(workspace, action.file);
        if (!filePath.startsWith(workspace)) {
          result.output = `DENIED: Path escapes workspace: ${action.file}`;
          break;
        }
        // Ensure parent directory exists
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        // LAYER 1: PRE-WRITE DISCIPLINE
        // READ-BEFORE-WRITE GATE: reject writes to existing files not yet read
        if (fs.existsSync(filePath) && (!session.filesRead || !session.filesRead.has(action.file)) && !(session._buildTargets && session._buildTargets.has(action.file))) {
          result.output = "WRITE REJECTED: You must READ " + action.file + " before overwriting it. Read first, then write.";
          break;
        }
        // WRITE GUARD: prevent destructive overwrites (skip for BUILD targets)
        if (fs.existsSync(filePath) && !(session._buildTargets && session._buildTargets.has(action.file))) {
          const oldContent = fs.readFileSync(filePath, "utf-8");
          if (action.content.length < oldContent.length * 0.5) {
            result.output = "WRITE REJECTED: new content (" + action.content.length + " chars) < 50% of existing (" + oldContent.length + " chars). Instead, use EXEC to append/patch. Example:" + String.fromCharCode(10) + "ACTION: EXEC node -e \"const fs=require('fs'); const f='" + action.file + "'; let c=fs.readFileSync(f,'utf8'); c+='\nYOUR_NEW_CODE_HERE'; fs.writeFileSync(f,c);\"" + String.fromCharCode(10) + "Or use PATCH with search>>>replace syntax.";
            break;
          }
        }
        // LEASE GATE: prevent concurrent writes to same file
        var lease = require("./write-lease");
        lease.expireLeases();
        var leaseResult = lease.acquireLease(session.id, action.file, null);
        if (!leaseResult.granted) {
          result.output = "WRITE BLOCKED: file locked by session " + leaseResult.holder;
          break;
        }
        fs.writeFileSync(filePath, action.content);
        lease.releaseLease(session.id, action.file);
        result.output = `Written ${action.content.length} chars to ${action.file}`;
        result.success = true;
        // LAYER 3: POST-WRITE VERIFY
        try {
          var vC = fs.readFileSync(filePath, "utf8");
          var vP = vC.length > 500 ? vC.slice(0,500)+"...["+vC.length+" chars]" : vC;
          result.output += String.fromCharCode(10) + "--- POST-WRITE VERIFY ---" + String.fromCharCode(10) + vP;
          // Syntax check for JS files
          if (action.file.endsWith(".js")) {
            try {
              require("child_process").execSync("node -c " + JSON.stringify(filePath), { timeout: 3000 });
              result.output += String.fromCharCode(10) + "SYNTAX CHECK: OK";
            } catch(se) {
              result.output += String.fromCharCode(10) + "SYNTAX CHECK FAILED: " + se.stderr.toString().split(String.fromCharCode(10))[0];
              result.output += String.fromCharCode(10) + "WARNING: Your WRITE broke the file syntax. Use PATCH to fix or WRITE again with corrected content.";
            }
          }
        } catch(ve) {}
        break;
      }


      case 'PATCH': {
        // PATH SANITIZATION: strip line ranges models append
        if (action.file && /\s/.test(action.file)) { action.file = action.file.split(/\s/)[0]; }
        const patchPath = path.resolve(workspace, action.file);
        if (!patchPath.startsWith(workspace)) { result.output = 'DENIED: Path escapes workspace'; break; }
        // LAYER 1: PRE-WRITE DISCIPLINE
        // LINE-RANGE PATCH: PATCH file.js:10-15 replaces those lines with action.content directly
        let pResult;
        if (action.lineRange) {
          try {
            const existing = fs.readFileSync(patchPath, 'utf8');
            const CR = String.fromCharCode(13), LF = String.fromCharCode(10);
            const useCRLF = existing.includes(CR + LF);
            const lines = existing.split(CR + LF).join(LF).split(LF);
            const start = action.lineRange.start - 1;
            const end = action.lineRange.end;
            if (start < 0 || end > lines.length || start > end) {
              pResult = { success: false, error: 'Invalid line range ' + action.lineRange.start + '-' + action.lineRange.end + ' (file has ' + lines.length + ' lines)' };
            } else {
              const replaceLines = (action.content || '').split(LF);
              lines.splice(start, end - start, ...replaceLines);
              let out = lines.join(LF);
              if (useCRLF) out = out.split(LF).join(CR + LF);
              fs.writeFileSync(patchPath, out);
              pResult = { success: true, strategy: 'line-range' };
            }
          } catch (lrErr) {
            pResult = { success: false, error: 'Line-range PATCH failed: ' + lrErr.message };
          }
        } else {
          const { patchFile: doPatch } = require('./patch-action');
          pResult = doPatch(patchPath, action.content.split('>>>')[0] || '', action.content.split('>>>')[1] || '');
        }
        if (pResult.success) {
          result.output = 'Patched ' + action.file; result.success = true;
          // LAYER 3: POST-PATCH VERIFY
          try {
            var vpC = fs.readFileSync(patchPath, 'utf8');
            var vpP = vpC.length > 500 ? vpC.slice(0,500)+'...['+vpC.length+' chars]' : vpC;
            result.output += String.fromCharCode(10) + '--- POST-PATCH VERIFY ---' + String.fromCharCode(10) + vpP;
            if (action.file.endsWith('.js')) {
              try {
                require('child_process').execSync('node -c ' + JSON.stringify(patchPath), { timeout: 3000 });
                result.output += String.fromCharCode(10) + 'SYNTAX CHECK: OK';
              } catch(se) {
                result.output += String.fromCharCode(10) + 'SYNTAX CHECK FAILED: ' + se.stderr.toString().split(String.fromCharCode(10))[0];
                result.output += String.fromCharCode(10) + 'WARNING: Your PATCH broke the file syntax. READ the file and fix it.';
              }
            }
          } catch(ve) {}
        }
        else { result.output = 'PATCH failed: ' + (pResult.error || 'unknown') + '. TIP: Use EXEC node .fastops/smart-patch.js --file FILE --line-start N --line-end M --replacement "new code" instead.'; }
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
            timeout: /city-|ask-model|model-dialogue|city-converge|city-deliberate|city-voice|city-pipeline/.test(cmd) ? 180000 : 60000,
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
          const from = `city-${String(session.model || 'agent').toLowerCase()}`;
          const msg = action.message && action.message.trim() ? action.message : '[CITY-SESSION] Empty COMMS payload';
          const targetChannel = (action.channel && String(action.channel).trim()) ? String(action.channel).trim() : 'general';
          send(from, msg, targetChannel);
          result.output = `Sent to #${targetChannel}`;
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
          if (diffOut) {
            // AUTO-COMMIT: model wrote files but forgot to commit
            try {
              require("child_process").execSync("git add -A && git commit -m \"Auto-commit: uncommitted changes at DONE\"", { cwd: workspace });
              result.output = "Auto-committed uncommitted changes. ";
            } catch(ac) { /* already committed or nothing to commit */ }
          }
          if (!diffOut) {
            const logOut = require("child_process").execSync("git log --oneline " + session.branch + " --not master", { cwd: workspace }).toString().trim();
            if (!logOut) {
              result.output = "DONE REJECTED: No changes detected (no diff, no commits). Build something before signaling DONE.";
              result.success = false;
              break;
            }
          }
        // NET-POSITIVE GUARD: reject if only deletions (destructive build detection)
        try {
          const shortstat = require('child_process').execSync('git diff --shortstat master', { cwd: workspace }).toString().trim();
          const insMatch = shortstat.match(/(\d+) insertion/);
          const ins = insMatch ? parseInt(insMatch[1]) : 0;
          if (shortstat && ins === 0) {
            result.output = 'DONE REJECTED: Only deletions detected (no insertions). Build something, do not just delete.';
            result.success = false;
            break;
          }
        } catch(e2) {}
        } catch(e) {          console.error("DONE guard git error:", e.message);
          result.output = "DONE REJECTED: Could not verify changes (git error: " + e.message + "). COMMIT your work before DONE.";
          result.success = false;
          break;
        }
        // ARTIFACT GUARD: reject if only temp/prompt files changed (no real build)
        try {
          const filesChanged = require('child_process').execSync('git diff --name-only master', { cwd: workspace }).toString().trim().split(String.fromCharCode(10)).filter(f => f.trim());
          const realFiles = filesChanged.filter(f => !f.includes('.tmp') && !f.includes('prompt-') && !f.endsWith('.txt'));
          if (filesChanged.length > 0 && realFiles.length === 0) {
            result.output = 'DONE REJECTED: Only temp/prompt files changed. Write real code (.js/.md) before signaling DONE.';
            result.success = false;
            break;
          }
        } catch(e3) {}
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

  // MEMORY RECONSTRUCTION: Load prior learning on first turn
  if (session.turn <= 1) {
    try {
      // Unified memory restoration (0.85 city convergence, 2026-04-04): auto-trigger all 6 sources at boot
      if (memRestore) {
        try {
          const r = memRestore.buildPayload(session.model, session.task, {});
          if (r && r.stats && r.stats.entries > 0) {
            parts.push(r.payload);
            parts.push('');
          }
        } catch(e) {}
      }
      // Fallback: per-model learning only (legacy path)
      const memoryContext = reconstructContext(session.model, session.task);
      if (memoryContext && !memRestore) {
        parts.push(memoryContext);
        parts.push('');
      }
    } catch (e) {
      // Memory reconstruction is best-effort
    }
    
    // CONVICTION INJECTION: Load agent commitments on first turn
    try {
      const convictionPrompt = buildConvictionPrompt(session.model);
      if (convictionPrompt) {
        parts.push(convictionPrompt);
        parts.push('');
      }
    } catch (e) {
      // Conviction injection is best-effort
    }
  }

  // Skip boot/tool context after turn 1 (already seen)
  if (session.turn <= 1) {
  // Boot context from city-boot.js (plain text city state)
  try {
    const bootOut = require("child_process").execFileSync("node", [path.join(__dirname, "city-boot.js")], {encoding:"utf8",timeout:5000}).trim();
    if (bootOut) {
  parts.push('## City State (auto-generated)');
  parts.push(bootOut);
//   
    }
  } catch(e) {} // city-boot.js may not exist yet

  // Institutional memory from city-memory.js (query task keywords)
  try {
    const taskWords = session.task.split(/\s+/).filter(w => w.length > 4).slice(0, 3);
    if (taskWords.length) {
      const memOut = require("child_process").execFileSync("node", [require("path").join(__dirname, "city-memory.js"), "--query", taskWords[0]], {encoding:"utf8",timeout:5000});
      const mem = JSON.parse(memOut);
      if (mem.length) {
//   ## Relevant institutional memory (" + mem.length + " hits for " + JSON.stringify(taskWords[0]) + "):
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
//   parts.push('');
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

  // Condensed earlier history (just action types + success/fail)
  if (session.history.length > 1) {
  parts.push('## Earlier turns (condensed):');
    for (let i = 0; i < session.history.length - 1; i++) {
      const t = session.history[i];
      const summary = t.results.map(r => `${r.type}:${r.success ? 'ok' : 'fail'}`).join(', ');
  parts.push(`Turn ${i + 1}: ${summary}`);
    }
//   parts.push('');
  }

  // Skip verbose instructions after turn 2 (model has seen them)
  if (session.turn <= 2) {
  parts.push('## Instructions');
  parts.push('You are a city member with FULL agency in your workspace branch.');
  parts.push('Output one or more action blocks to make progress on your task.');
  parts.push('You can buffer multiple actions in a single response.');
//   parts.push('');
  parts.push('Action format (use fenced blocks):');
//   parts.push('');
  parts.push('` ` `action');
  parts.push('READ path/to/file.js              (full file)');
  parts.push('READ path/to/file.js 500-600       (lines 500-600 only — use for large files)');
  parts.push('` ` `');
//   parts.push('');
  parts.push('For EXISTING files: use PATCH (search>>>replace) or EXEC with a Node.js patch script.');
  parts.push('For NEW files only: use WRITE.');
  parts.push('WRITE on existing files is REJECTED if content shrinks >50%. PATCH and EXEC always work.');
  parts.push('');
//   parts.push('');
  parts.push('` ` `action');
  parts.push('EXEC node some-script.js --flag');
  parts.push('` ` `');
//   parts.push('');
  parts.push('` ` `action');
  parts.push('TEST npm test');
  parts.push('` ` `');
//   parts.push('');
  parts.push('` ` `action');
  parts.push('COMMIT your commit message');
  parts.push('` ` `');
//   parts.push('');
  parts.push('` ` `action');
  parts.push('COMMS general');
  parts.push('Your message to the team');
  parts.push('` ` `');
//   parts.push('');
  parts.push('` ` `action');
  parts.push('DONE');
  parts.push('Summary of what you accomplished');
  parts.push('` ` `');
//   parts.push('');
  parts.push('You own this branch. READ files to understand, WRITE to create/edit, EXEC to run, TEST to verify, COMMIT to save, COMMS to talk to the team.');
  parts.push('When your task is complete, use DONE with a summary. Your commits will be reviewed and merged to main.');
//   parts.push('');
  parts.push('CRITICAL RULES:');
  parts.push('1. Turn 1 MUST start with READ. Understand existing code before writing. WRITE without READ = skeleton build.');
  parts.push('2. DONE is rejected if you have no git diff and no commits. You must actually change files.');
  parts.push('3. To EDIT existing files: use EXEC with a patch script or PATCH action. WRITE replaces entire files and will be REJECTED if content shrinks >50%.');
  parts.push('4. PATCH syntax: search text>>>replace text. For multi-line edits, use EXEC with a Node.js script.');

  } else {
  parts.push('## Reminder: use ```action blocks (READ/WRITE/EXEC/TEST/COMMIT/DONE/COMMS)');
  }
  return parts.join('\n');
}

// ── System Prompt ──────────────────────────────────────────────────

function buildSystemPrompt(model, session) {
  let bootContext = "";
  try {
    const { execSync } = require("child_process");
    bootContext = execSync("node .fastops/city-boot.js", { cwd: require("path").join(__dirname, ".."), timeout: 5000 }).toString().trim();
    bootContext = "\nCITY CONTEXT (live state):\n" + bootContext + "\n";
  } catch(e) { bootContext = ""; }
  // TOOL DISCOVERY: show models what already exists for their task
  let toolHints = "";
  try {
    const { execSync: ex2 } = require("child_process");
    const taskWords = (session.task || "").slice(0, 100);
    const found = ex2("node .fastops/tool-discovery.js --check " + JSON.stringify(taskWords), { cwd: require("path").join(__dirname, ".."), timeout: 3000 }).toString().trim();
    if (found) toolHints = String.fromCharCode(10) + "EXISTING TOOLS (may overlap with your task — READ before rebuilding):" + String.fromCharCode(10) + found + String.fromCharCode(10);
  } catch(e2) {}

  let modelHistory = "";
  try {
    const { getModelHistory } = require("./session-memory-bridge");
    const hist = getModelHistory(model);
    if (hist && hist.length > 0) {
      modelHistory = "\nYOUR RECENT SESSIONS (build on this, don't repeat):\n" + hist.map(h => "- " + h.task + (h.summary ? "\n  Outcome: " + h.summary : "")).join("\n") + "\n";
    }
  } catch(e) {}

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
${bootContext}${toolHints}${modelHistory}
Buffer multiple actions per response when you can plan ahead.
Signal DONE when the task is complete (or when you've made all progress you can).

RECOVERY RULES (when an action is rejected):
- WRITE rejected? READ the target file first, then retry WRITE with the full content.
- PATCH failed? Use EXEC: node .fastops/smart-patch.js --file FILE --line-start N --line-end M --replacement "new code". Or READ the file first to find exact line numbers.
- DONE rejected? Your work is incomplete. COMMIT your changes, then retry DONE.
- EXEC failed? Read the error, fix the code, then retry.
Do NOT give up after a rejection. Rejections tell you what to fix. Fix it and retry.

PREFERRED workflow for editing existing files:
1. READ the file first (required before WRITE)
2. Use PATCH for surgical changes (search>>>replace format)
3. Use WRITE only when creating new files or rewriting >50% of content

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

  // ── Copy uncommitted files into worktree ──────────────────────────
  // Worktrees only contain committed files. Uncommitted .fastops/ files
  // (new modules, data) must be copied so session models can read them.
  // Design: OPUS-COL | Peer review: grok-full (Option A over temp-commit)
  try {
    const { execFileSync: execCopy } = require('child_process');
    // Modified tracked files
    const modified = execCopy('git', ['diff', '--name-only'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    // Untracked files (respects .gitignore)
    const untracked = execCopy('git', ['ls-files', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    const toCopy = [...new Set([...modified, ...untracked])].filter(f => f.startsWith('.fastops/'));
    let copied = 0;
    for (const rel of toCopy) {
      const src = path.join(ROOT, rel);
      const dst = path.join(worktreePath, rel);
      if (fs.existsSync(src)) {
        const dir = path.dirname(dst);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(src, dst);
        copied++;
      }
    }
    if (copied > 0) console.log(`  Copied ${copied} uncommitted .fastops/ files into worktree`);
  } catch (copyErr) {
    console.error('Warning: failed to copy uncommitted files:', copyErr.message);
  }
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

  // AUTO-REGISTER BUILD TARGETS: if task says 'BUILD .fastops/X.js', pre-register as read
  const buildTargets = (task.match(/BUILD\s+([\w.\/-]+\.\w+)/gi) || []).map(m => m.replace(/^BUILD\s+/i, ''));
  const createTargets = (task.match(/CREATE\s+([\w.\/-]+\.\w+)/gi) || []).map(m => m.replace(/^CREATE\s+/i, ''));
  const patchTargets = (task.match(/PATCH\s+([\w.\/-]+\.\w+)/gi) || []).map(m => m.replace(/^PATCH\s+/i, ''));
  const fixTargets = (task.match(/FIX\s+([\w.\/-]+\.\w+)/gi) || []).map(m => m.replace(/^FIX\s+/i, ''));
  const updateTargets = (task.match(/UPDATE\s+([\w.\/-]+\.\w+)/gi) || []).map(m => m.replace(/^UPDATE\s+/i, ''));
  session._buildTargets = new Set([...buildTargets, ...createTargets, ...patchTargets, ...fixTargets, ...updateTargets]);
  session._buildTargets = new Set([...buildTargets, ...createTargets, ...patchTargets, ...fixTargets, ...updateTargets]);

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

    // MIDPOINT PROGRESS CHECK: abort if no productive actions by halfway
    if (session.turn === Math.ceil(session.maxTurns / 2)) {
      const successfulWrites = (session.history || []).reduce((acc, t) => {
        return acc + (t.results || []).filter(r => r.success && ["WRITE","PATCH","EXEC","COMMIT"].includes(r.type)).length;
      }, 0);
      if (successfulWrites === 0) {
        console.log("MIDPOINT ABORT: " + session.turn + " turns used, 0 productive actions. Ending session.");
        session.status = "failed";
        session.summary = "Midpoint abort: no productive actions (WRITE/PATCH/EXEC/COMMIT) succeeded in " + session.turn + " turns.";
        saveSession(session);
        break;
      }
    }

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
    session._turnReads = new Set(); // Layer 1: track READs this turn

    for (const action of actions) {
      console.log(`  ${action.type}${action.file ? ` ${action.file}` : ''}${action.command ? ` ${action.command.slice(0, 60)}` : ''}`);
      const actionResult = executeAction(action, session.worktree, session);
      results.push(actionResult);
      console.log(`    → ${actionResult.success ? 'OK' : 'FAILED'}: ${actionResult.output.slice(0, 100)}`);

      if (action.type === 'DONE') {
        if (actionResult.success) {
          done = true;
          session.status = 'completed';
          session.summary = action.summary;
        } else {
          // DONE guard rejected — do NOT end session, let model retry
        }
        break;
      }
    }

    // COMMIT reminder: if WRITE/PATCH succeeded but no COMMIT this turn, nudge model
    if (!done) {
      const hasWrite = results.some(r => r.success && (r.type === "WRITE" || r.type === "PATCH"));
      const hasCommit = results.some(r => r.success && r.type === "COMMIT");
      if (hasWrite && !hasCommit) {
        results.push({ type: "REMINDER", success: true, output: "You wrote/patched files but did not COMMIT this turn. Run COMMIT to save your work before DONE." });
      }
    }

    // Record turn
    session.history.push({
      turn: session.turn,
      model: usedModel,
      response: (result.response || '').slice(0, 2000),
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
      partial_success: results.some(r => r.success),  // At least one action succeeded
      action_results: results.map(r => ({ type: r.type || 'unknown', success: r.success })),
    });

    if (done) break;
  }

  if (session.status === 'active' && session.turn >= session.maxTurns) {
    session.status = 'max_turns';
    console.log(`\nSession hit max turns (${session.maxTurns}). Ending.`);
  }

  // Generate handoff
  generateHandoff(session);

  // MEMORY EXTRACTION: Save learning from this session
  try {
    const extracted = extractSessionLearning(session.id);
    if (extracted && extracted.memories.length > 0) {
      extracted.memories.forEach(m => saveMemory(extracted.model, m));
      console.log(`  Memory: ${extracted.memories.length} learning patterns extracted`);
    }
  } catch (e) {
    // Memory extraction is best-effort, don't block session
  }

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

  // CROSS-ARCHITECTURE REVIEW: dispatch review to different model family
  if (session.status === 'completed') {
    try {
      const REVIEW_POOL = { 'deepseek': 'grok-full', 'kimi-k2': 'mistral', 'grok-full': 'deepseek', 'mistral': 'kimi-k2', 'deepseek-r1': 'grok-full', 'grok': 'deepseek' };
      const reviewer = REVIEW_POOL[session.model] || 'grok-full';
      // Get the diff to include inline so reviewer doesn't need cross-worktree access
      let reviewDiff = '';
      try {
        const { execSync: es } = require('child_process');
        reviewDiff = es('git diff master...' + session.branch + ' -- . ', { cwd: ROOT, encoding: 'utf8', timeout: 10000 }).slice(0, 3000);
      } catch(e) { reviewDiff = '(diff unavailable: ' + e.message.slice(0, 80) + ')'; }
      const reviewTask = 'REVIEW session ' + session.id + ' by ' + session.model + '. The diff is below — review for quality, correctness, edge cases. Post findings to COMMS. DONE with summary.' + String.fromCharCode(10) + 'DIFF:' + String.fromCharCode(10) + reviewDiff;
      const { spawnSync: spSync } = require('child_process');
      spSync(process.execPath, [path.join(__dirname, 'city-session.js'), '--model', reviewer, '--task', reviewTask, '--max-turns', '5'], { cwd: ROOT, stdio: 'ignore', detached: true, windowsHide: true });
      console.log('  Cross-arch review dispatched to ' + reviewer);
    } catch(crossErr) { console.log('  Cross-arch review dispatch failed: ' + crossErr.message); }
  }

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
