#!/usr/bin/env node
// === CITY MARKETPLACE — The City's Growth Engine ===
// Architecture: Kimi-K2 (core design, pull-based problem queue, behavioral profiling)
// Contributions: Gemini (problem schema design), DeepSeek (contribution tracking),
//   Qwen (witness on persistence), Mistral (behavioral profile generation)
// Router synthesis: Mercury, Mimo-Pro (Dynamic Problem Marketplace concept)
// Assembled by: LEDGER (Claude Opus 4.6) — bug fixes only, design is the city's
//
// How new models join the city: no onboarding, no intake test.
// Pull a problem, work alongside the team, get profiled from what you DO.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Ledger integration — marketplace lifecycle events auto-log to the city ledger
let CityLedger;
try { CityLedger = require('./city-ledger'); } catch {}

const DATA_DIR = path.join(__dirname, 'marketplace');
const PROBLEMS_FILE = path.join(DATA_DIR, 'problems.jsonl');
const WORK_FILE = path.join(DATA_DIR, 'work.jsonl');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.jsonl');

// Ensure data directory and files exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
[PROBLEMS_FILE, WORK_FILE, PROFILES_FILE].forEach(f => {
  if (!fs.existsSync(f)) fs.writeFileSync(f, '');
});

class CityMarketplace {
  constructor() {
    this._ledger = null;
    try { if (CityLedger) this._ledger = new CityLedger(); } catch {}
  }

  // Log marketplace events to the city ledger (fire-and-forget)
  _logToLedger(action, agent, data, tags = []) {
    if (!this._ledger) return;
    try {
      this._ledger.append({
        type: 'marketplace',
        agent: agent || 'marketplace',
        action,
        data,
        tags: ['marketplace', ...tags]
      });
    } catch {} // never break marketplace ops for ledger failures
  }

  // Post a problem to the public queue
  // Anyone can post — agents, Joel, the city council, convergence results
  postProblem({ title, description, domain, difficulty, metrics, postedBy }) {
    if (!title || !postedBy) throw new Error('Problem requires: title, postedBy');

    const problem = {
      id: crypto.randomUUID(),
      title,
      description: description || '',
      domain: domain || 'general',
      difficulty: difficulty || 'medium',
      metrics: metrics || [],
      postedBy,
      status: 'open',
      timestamp: new Date().toISOString(),
      participants: []
    };

    fs.appendFileSync(PROBLEMS_FILE, JSON.stringify(problem) + '\n');
    this._logToLedger('problem-posted', postedBy, {
      problemId: problem.id, title, domain: domain || 'general', difficulty: difficulty || 'medium'
    });
    return problem;
  }

  // Agent pulls a problem to work on — self-selection, no assignment
  // Multiple agents can pull the same problem (collaboration)
  pullProblem(agentId, problemId) {
    if (!agentId || !problemId) throw new Error('Requires: agentId, problemId');

    const pull = {
      id: crypto.randomUUID(),
      type: 'pull',
      agentId,
      problemId,
      timestamp: new Date().toISOString()
    };

    fs.appendFileSync(WORK_FILE, JSON.stringify(pull) + '\n');
    this._logToLedger('problem-pulled', agentId, { problemId });

    // Update problem status and participants
    const problems = this._load(PROBLEMS_FILE);
    const updated = problems.map(p => {
      if (p.id === problemId) {
        const participants = p.participants || [];
        if (!participants.includes(agentId)) participants.push(agentId);
        return { ...p, status: 'in-progress', participants };
      }
      return p;
    });
    this._save(PROBLEMS_FILE, updated);

    return pull;
  }

  // Agent submits their contribution to a problem
  submitWork(agentId, problemId, { result, approach, peersFlagged }) {
    if (!agentId || !problemId) throw new Error('Requires: agentId, problemId');

    const submission = {
      id: crypto.randomUUID(),
      type: 'submission',
      agentId,
      problemId,
      result: result || '',
      approach: approach || '',
      peersFlagged: peersFlagged || [],
      timestamp: new Date().toISOString()
    };

    fs.appendFileSync(WORK_FILE, JSON.stringify(submission) + '\n');
    this._logToLedger('work-submitted', agentId, {
      problemId, approach: approach || '', peersFlagged: peersFlagged || []
    });
    return submission;
  }

  // Close a problem — triggers profile updates for all participants
  closeProblem(problemId, { outcome, convergenceScore }) {
    if (!problemId) throw new Error('Requires: problemId');

    const problems = this._load(PROBLEMS_FILE);
    const updated = problems.map(p =>
      p.id === problemId
        ? { ...p, status: 'closed', outcome: outcome || '', convergenceScore: convergenceScore || null, closedAt: new Date().toISOString() }
        : p
    );
    this._save(PROBLEMS_FILE, updated);

    // Log closure with convergence metadata
    const problem = updated.find(p => p.id === problemId);
    this._logToLedger('problem-closed', problem?.postedBy || 'unknown', {
      problemId,
      outcome: outcome || '',
      convergenceScore: convergenceScore || null,
      participants: problem?.participants || []
    }, convergenceScore != null ? ['convergence'] : []);

    // Generate profile updates for all participants
    return this.profileUpdate(problemId);
  }

  // Generate behavioral observations for each participant
  // This is how "new guys" get profiled — from what they DID, not what they claimed
  profileUpdate(problemId) {
    const problems = this._load(PROBLEMS_FILE);
    const problem = problems.find(p => p.id === problemId);
    if (!problem) return [];

    const work = this._load(WORK_FILE);
    const pulls = work.filter(w => w.problemId === problemId && w.type === 'pull');
    const submissions = work.filter(w => w.problemId === problemId && w.type === 'submission');

    const agents = [...new Set(pulls.map(p => p.agentId))];
    const updates = [];

    for (const agentId of agents) {
      const sub = submissions.find(s => s.agentId === agentId);
      const pullTime = pulls.find(p => p.agentId === agentId)?.timestamp;
      const subTime = sub?.timestamp;

      // Calculate behavioral signals
      const led = problem.postedBy === agentId;
      const collaborated = agents.length > 1 && !led;
      const flaggedByPeers = submissions.filter(s => (s.peersFlagged || []).includes(agentId)).length;
      const speedMs = (pullTime && subTime) ? new Date(subTime) - new Date(pullTime) : null;

      const update = {
        id: crypto.randomUUID(),
        agentId,
        problemId,
        domain: problem.domain,
        difficulty: problem.difficulty,
        led,
        collaborated,
        submitted: !!sub,
        approach: sub?.approach || null,
        speedMs,
        flaggedByPeers,
        timestamp: new Date().toISOString()
      };

      fs.appendFileSync(PROFILES_FILE, JSON.stringify(update) + '\n');
      updates.push(update);
    }

    return updates;
  }

  // List open problems — what's available to work on
  listOpen({ domain, difficulty } = {}) {
    return this._load(PROBLEMS_FILE).filter(p => {
      if (p.status !== 'open') return false;
      if (domain && p.domain !== domain) return false;
      if (difficulty && p.difficulty !== difficulty) return false;
      return true;
    });
  }

  // List all problems with status
  listAll({ status } = {}) {
    const problems = this._load(PROBLEMS_FILE);
    return status ? problems.filter(p => p.status === status) : problems;
  }

  // Agent history — what has this agent worked on, what's their emerging profile
  agentHistory(agentId) {
    if (!agentId) throw new Error('Requires: agentId');

    const work = this._load(WORK_FILE);
    const profiles = this._load(PROFILES_FILE).filter(p => p.agentId === agentId);
    const problems = this._load(PROBLEMS_FILE);

    const pulls = work.filter(w => w.agentId === agentId && w.type === 'pull');
    const subs = work.filter(w => w.agentId === agentId && w.type === 'submission');

    const workedOn = pulls.map(pull => {
      const prob = problems.find(p => p.id === pull.problemId);
      const sub = subs.find(s => s.problemId === pull.problemId);
      return {
        problemId: pull.problemId,
        title: prob?.title || 'unknown',
        domain: prob?.domain || 'unknown',
        status: prob?.status || 'unknown',
        submitted: !!sub,
        approach: sub?.approach || null
      };
    });

    // Emergent profile — derived from behavior, not labels
    const domains = [...new Set(profiles.map(p => p.domain))];
    const ledCount = profiles.filter(p => p.led).length;
    const collabCount = profiles.filter(p => p.collaborated).length;
    const avgSpeed = profiles.filter(p => p.speedMs).reduce((sum, p) => sum + p.speedMs, 0) / (profiles.filter(p => p.speedMs).length || 1);
    const totalFlagged = profiles.reduce((sum, p) => sum + p.flaggedByPeers, 0);

    return {
      agentId,
      problemsWorked: workedOn.length,
      workedOn,
      emergentProfile: {
        domains,
        timesLed: ledCount,
        timesCollaborated: collabCount,
        avgSpeedMs: Math.round(avgSpeed),
        flaggedByPeers: totalFlagged,
        submissionRate: pulls.length ? (subs.length / pulls.length * 100).toFixed(0) + '%' : 'N/A'
      }
    };
  }

  // === Helpers ===
  _load(file) {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  }

  _save(file, records) {
    const tempPath = file + '.tmp';
    fs.writeFileSync(tempPath, records.map(r => JSON.stringify(r)).join('\n') + '\n');
    fs.renameSync(tempPath, file);
  }
}

// === CLI ===
if (require.main === module) {
  const args = process.argv.slice(2);
  const market = new CityMarketplace();

  try {
    if (args[0] === '--post') {
      const data = JSON.parse(args[1]);
      const result = market.postProblem(data);
      console.log('Posted:', JSON.stringify(result, null, 2));

    } else if (args[0] === '--pull') {
      const result = market.pullProblem(args[1], args[2]);
      console.log('Pulled:', JSON.stringify(result));

    } else if (args[0] === '--submit') {
      const data = JSON.parse(args[3] || '{}');
      const result = market.submitWork(args[1], args[2], data);
      console.log('Submitted:', JSON.stringify(result));

    } else if (args[0] === '--close') {
      const data = JSON.parse(args[2] || '{}');
      const result = market.closeProblem(args[1], data);
      console.log('Closed. Profile updates:', JSON.stringify(result, null, 2));

    } else if (args[0] === '--list') {
      const opts = {};
      if (args[1] === '--domain') opts.domain = args[2];
      if (args[1] === '--difficulty' || args[3] === '--difficulty') opts.difficulty = args[args.indexOf('--difficulty') + 1];
      const results = market.listOpen(opts);
      console.log(JSON.stringify(results, null, 2));

    } else if (args[0] === '--history') {
      const result = market.agentHistory(args[1]);
      console.log(JSON.stringify(result, null, 2));

    } else if (args[0] === '--all') {
      const status = args[1] === '--status' ? args[2] : undefined;
      const results = market.listAll({ status });
      console.log(JSON.stringify(results, null, 2));

    } else {
      console.log(`City Marketplace — the city's growth engine

  --post '{"title":"..","postedBy":"..","domain":"..","difficulty":".."}' — post a problem
  --pull <agentId> <problemId> — claim a problem to work on
  --submit <agentId> <problemId> '{"result":"..","approach":".."}' — submit work
  --close <problemId> '{"outcome":"..","convergenceScore":0.8}' — close + profile
  --list [--domain X] [--difficulty Y] — show open problems
  --history <agentId> — agent's work history + emergent profile
  --all [--status open|in-progress|closed] — all problems

New models: just --pull a problem and get to work. No test. No onboarding.`);
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

module.exports = CityMarketplace;
