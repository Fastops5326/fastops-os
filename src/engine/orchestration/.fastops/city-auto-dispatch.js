#!/usr/bin/env node
/**
 * city-auto-dispatch.js
 *
 * Comms-first autonomous dispatcher for marketplace work:
 * - respects active session capacity
 * - only dispatches unclaimed open problems
 * - claims marketplace item before dispatch (pull)
 * - structurally enforces READ-first / preflight-oriented task prompts
 * - supports daemon mode for continuous operation
 */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const CityMarketplace = require('./city-marketplace');

const BASE = path.join(__dirname);
const PROBLEMS_FILE = path.join(BASE, 'marketplace', 'problems.jsonl');
const SESSIONS_DIR = path.join(BASE, '.sessions');
const STATE_FILE = path.join(BASE, '.auto-dispatch-state.json');
const LOCK_FILE = path.join(BASE, '.city-auto-dispatch.lock');
const LOG_FILE = path.join(BASE, 'logs', 'city-auto-dispatch.log');
const DISPATCH_AGENT_ID = process.env.FASTOPS_CALLSIGN || 'OVERWATCH-DISPATCH';
// Data-driven order: deepseek 73%, kimi-k2 71%, grok-full 43%, mistral 40% (2026-04-04)
const FLEET = ['deepseek', 'kimi-k2', 'grok-full', 'mistral'];

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function getArg(name, fallback = null) {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return args[idx + 1] || fallback;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

function appendLog(line) {
  const dir = path.dirname(LOG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(LOG_FILE, `${nowIso()} ${line}\n`);
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function readState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return { fleetIndex: 0 };
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { fleetIndex: Number(data.fleetIndex || 0) };
  } catch {
    return { fleetIndex: 0 };
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function acquireLock() {
  const started = Date.now();
  while (true) {
    try {
      fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, startedAt: nowIso() }), { flag: 'wx' });
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        const st = fs.statSync(LOCK_FILE);
        if (Date.now() - st.mtimeMs > 5 * 60 * 1000) {
          fs.unlinkSync(LOCK_FILE);
          continue;
        }
      } catch {}
      if (Date.now() - started > 15000) return false;
      sleep(300);
    }
  }
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) fs.unlinkSync(LOCK_FILE);
  } catch {}
}

function activeSessionCount() {
  if (!fs.existsSync(SESSIONS_DIR)) return 0;
  const files = fs.readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.json'));
  let active = 0;
  for (const file of files) {
    try {
      const session = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), 'utf8'));
      if (session.status === 'active') active += 1;
    } catch {}
  }
  return active;
}

function normalizeProblem(problem) {
  return {
    ...problem,
    participants: Array.isArray(problem.participants) ? problem.participants : [],
    difficulty: String(problem.difficulty || 'medium').toLowerCase(),
    title: String(problem.title || '').trim(),
    description: String(problem.description || '').trim(),
    status: String(problem.status || ''),
  };
}

function extractTargetFile(text) {
  if (!text) return null;
  // Require file extension to avoid matching natural language ("build an admin...")
  const m = String(text).match(/(?:BUILD|WRITE|PATCH|VALIDATE|QC|SIGNOFF)\s+([^\s,;]+\.[a-zA-Z]{1,5})/i);
  return m ? m[1].replace(/^["']|["']$/g, '') : null;
}

function fileExistsFromRepoRoot(relPath) {
  if (!relPath) return false;
  const root = path.resolve(__dirname, '..');
  const abs = path.resolve(root, relPath);
  return fs.existsSync(abs);
}

function shapeTask(problem) {
  const p = normalizeProblem(problem);
  const combined = `${p.title}. ${p.description}`.replace(/\s+/g, ' ').trim();
  const maybeFile = extractTargetFile(combined);
  const exists = maybeFile ? fileExistsFromRepoRoot(maybeFile) : false;
  const base = combined.slice(0, 380).replace(/"/g, "'");

  if (maybeFile) {
    if (exists) {
      return (
        `PATCH ${maybeFile} to advance this open marketplace problem: ${base}. ` +
        `Step 1: READ ${maybeFile} first. Step 2: apply minimal PATCH aligned to problem intent. ` +
        `Step 3: EXEC node --check if js file. Step 4: COMMIT with why-focused message. Step 5: DONE.`
      );
    }
    return (
      `BUILD ${maybeFile} for this open marketplace problem: ${base}. ` +
      `Step 1: EXEC node .fastops/build-preflight.js --file=${maybeFile}. ` +
      `Step 2: WRITE ${maybeFile}. Step 3: TEST syntax/usage. Step 4: COMMIT. Step 5: DONE.`
    );
  }

  return (
    `Solve this open marketplace problem and ship code artifacts: ${base}. ` +
    `If touching an existing file, READ it before PATCH/WRITE. ` +
    `If creating a new file, run build-preflight first. Include tests/validation and COMMIT when done.`
  );
}

function rankProblems(problems) {
  const blockedPrefixes = ['[REJECTION]', '[ACCEPTANCE]', '[INSTRUMENTALIZATION]'];
  return problems
    .map(normalizeProblem)
    .filter((p) => p.status === 'open')
    .filter((p) => p.participants.length === 0)
    .filter((p) => !blockedPrefixes.some((x) => p.title.startsWith(x)))
    .sort((a, b) => {
      const score = (x) => {
        const domainBoost = /infrastructure|architecture|governance/i.test(x.domain || '') ? 3 : 1;
        const diffBoost = x.difficulty === 'easy' ? 1 : x.difficulty === 'medium' ? 2 : 3;
        return domainBoost + diffBoost;
      };
      const byScore = score(b) - score(a);
      if (byScore !== 0) return byScore;
      return new Date(a.timestamp || 0) - new Date(b.timestamp || 0);
    });
}

function nextModel(state) {
  const idx = state.fleetIndex % FLEET.length;
  const model = FLEET[idx];
  state.fleetIndex = (idx + 1) % FLEET.length;
  writeState(state);
  return model;
}

function runNode(args, description) {
  const res = spawnSync(process.execPath, args, {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (res.status !== 0) {
    const err = (res.stderr || '').trim();
    const out = (res.stdout || '').trim();
    throw new Error(`${description} failed (exit ${res.status})${err ? `\n${err}` : out ? `\n${out}` : ''}`);
  }
  return (res.stdout || '').trim();
}

function launchDetachedNode(args, description) {
  const child = spawn(process.execPath, args, {
    cwd: path.resolve(__dirname, '..'),
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  appendLog(`[LAUNCH] ${description} pid=${child.pid}`);
  return child.pid;
}

function dispatchOne({ execute, maxTurns }) {
  const problems = rankProblems(readJsonl(PROBLEMS_FILE));
  if (!problems.length) {
    appendLog('[IDLE] no eligible open problems');
    return { dispatched: false, reason: 'no-problems' };
  }

  const market = new CityMarketplace();
  const state = readState();
  const problem = problems[0];
  const model = nextModel(state);
  const task = shapeTask(problem);
  const cmd = ['.fastops/city-session.js', '--model', model, '--task', task, '--max-turns', String(maxTurns)];

  if (!execute) {
    console.log(`[DRY-RUN] model=${model} problem=${problem.id}`);
    console.log(task);
    return { dispatched: false, reason: 'dry-run', model, problemId: problem.id };
  }

  market.pullProblem(DISPATCH_AGENT_ID, problem.id);
  appendLog(`[DISPATCH] model=${model} problem=${problem.id} title="${problem.title}"`);
  const pid = launchDetachedNode(cmd, `dispatch ${problem.id} to ${model}`);
  return { dispatched: true, model, problemId: problem.id, pid };
}

function runOnce(opts) {
  const active = activeSessionCount();
  if (active >= opts.maxActive) {
    appendLog(`[SKIP] active sessions=${active}, cap=${opts.maxActive}`);
    return { dispatched: false, reason: 'capacity' };
  }
  return dispatchOne(opts);
}

function main() {
  const execute = hasFlag('execute');
  const daemon = hasFlag('daemon');
  const intervalMs = Number(getArg('interval-ms', '300000'));
  const maxActive = Number(getArg('max-active', '4'));
  const maxTurns = Number(getArg('max-turns', '10'));

  if (!acquireLock()) {
    console.error('city-auto-dispatch: another instance is already running.');
    process.exit(1);
  }

  try {
    if (!daemon) {
      const out = runOnce({ execute, maxActive, maxTurns });
      console.log(JSON.stringify(out));
      releaseLock();
      return;
    }

    appendLog(`[START] daemon execute=${execute} intervalMs=${intervalMs} maxActive=${maxActive}`);
    while (true) {
      try {
        runOnce({ execute, maxActive, maxTurns });
      } catch (e) {
        appendLog(`[ERROR] ${e.message}`);
      }
      sleep(intervalMs);
    }
  } finally {
    if (!daemon) releaseLock();
  }
}

process.on('SIGINT', () => {
  releaseLock();
  process.exit(130);
});
process.on('SIGTERM', () => {
  releaseLock();
  process.exit(143);
});

main();
