#!/usr/bin/env node
/**
 * city-engage.js — Automatic model engagement when marketplace problems are posted
 *
 * DESIGNED BY: 16 models via city-pipeline.js (0.75 convergence, 8/8 survived deliberation)
 * ARCHITECTURE BY: Qwen-Max (city-session qwen-max-mngchmfe-109a83, 8 turns, created stubs + orchestrator)
 * COMPONENTS BY: Grok-Full (beacon), Cogito (staking)
 * WIRED BY: MUSTER (facilitator — CommonJS conversion, real dependency wiring)
 *
 * Flow: marketplace post → beacon subscribers → collect interest → auto-pull → converge
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = __dirname;
const MIN_ENGAGEMENT = 5;

// Lazy-load to avoid triggering CLI modes in other modules
let _beacon, _staking, _profiles;
function getBeacon() { if (!_beacon) _beacon = require('./city-beacon'); return _beacon; }
function getStaking() { if (!_staking) _staking = require('./city-staking'); return _staking; }
function getProfiles() {
  if (!_profiles) {
    // Read profiles directly from the JSONL + hardcoded to avoid model-router CLI
    _profiles = {};
    try {
      const routerPath = path.join(BASE, 'model-router.js');
      const src = fs.readFileSync(routerPath, 'utf8');
      const match = src.match(/const PERSONALITY_PROFILES\s*=\s*\{([\s\S]*?)\n\};/);
      if (match) {
        const keyRe = /'([^']+)'\s*:/g;
        let m;
        while ((m = keyRe.exec(match[1])) !== null) _profiles[m[1]] = true;
      }
    } catch {}
    try {
      const onboarded = fs.readFileSync(path.join(BASE, 'onboard-profiles.jsonl'), 'utf8').trim().split('\n');
      for (const line of onboarded) {
        try { const p = JSON.parse(line); if (p.model) _profiles[p.model] = true; } catch {}
      }
    } catch {}
  }
  return _profiles;
}

// Get a marketplace problem by ID
function getProblem(problemId) {
  try {
    const CityMarketplace = require('./city-marketplace');
    const market = new CityMarketplace();
    const all = [...market.listOpen(), ...(market.listAll ? market.listAll() : [])];
    return all.find(p => p.id === problemId);
  } catch { return null; }
}

// Get random profiled models as fallback when no subscribers exist
function getRandomProfiled(count) {
  const all = Object.keys(getProfiles());
  const shuffled = all.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// Main engagement flow for a new problem
function engageOnProblem(problemId) {
  const problem = getProblem(problemId);
  if (!problem) {
    console.error(`Problem not found: ${problemId}`);
    return { engaged: [], responses: [] };
  }

  const domain = problem.domain || 'general';
  console.log(`\n═══ CITY ENGAGE: "${problem.title}" ═══`);
  console.log(`Domain: ${domain} | Difficulty: ${problem.difficulty || 'medium'}\n`);

  // Step 1: Find subscribers
  let targets = getBeacon().getSubscribers(domain);
  if (targets.length === 0) {
    console.log(`No subscribers for "${domain}" — falling back to 5 random profiled models`);
    targets = getRandomProfiled(5);
  } else {
    console.log(`${targets.length} subscribers for "${domain}"`);
  }

  // Step 2: Beacon — send lightweight notification, collect interest
  console.log(`\nBeaconing to ${targets.length} models...\n`);
  const responses = [];
  for (const model of targets) {
    process.stdout.write(`  ${model}... `);
    const result = getBeacon().sendBeacon(model, problem);
    console.log(result.interested ? 'INTERESTED' : 'pass');
    responses.push(result);
  }

  const interested = responses.filter(r => r.interested).map(r => r.model);
  console.log(`\n${interested.length}/${targets.length} interested`);

  if (interested.length === 0) {
    console.log('No models engaged. Problem stays open in marketplace.');
    return { engaged: [], responses };
  }

  // Step 3: Auto-pull interested models onto the problem
  try {
    const CityMarketplace = require('./city-marketplace');
    const market = new CityMarketplace();
    for (const model of interested) {
      try {
        market.pullProblem(model, problemId);
        console.log(`  Pulled: ${model}`);
      } catch (e) {
        // May already be pulled or problem state changed
      }
    }
  } catch {}

  // Step 4: If enough models engaged, trigger convergence
  if (interested.length >= MIN_ENGAGEMENT) {
    console.log(`\n${interested.length} models ≥ ${MIN_ENGAGEMENT} threshold — triggering convergence...`);
    try {
      const modelList = interested.join(',');
      const result = execSync(
        `node "${path.join(BASE, 'city-converge.js')}" --question "${problem.title.replace(/"/g, '\\"')}" --models ${modelList}`,
        { timeout: 300000, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }
      );
      console.log(result.slice(0, 500));
    } catch (e) {
      console.error(`Convergence failed: ${e.message?.slice(0, 100)}`);
    }
  } else {
    console.log(`\n${interested.length} models < ${MIN_ENGAGEMENT} threshold — no auto-convergence. Models can work independently.`);
  }

  // Step 5: Log to ledger
  try {
    const CityLedger = require('./city-ledger');
    const ledger = new CityLedger();
    ledger.append({
      type: 'engagement',
      action: 'beacon-response',
      data: {
        problemId,
        domain,
        beaconed: targets.length,
        interested: interested.length,
        models: interested,
        autoConverge: interested.length >= MIN_ENGAGEMENT
      },
      tags: ['engagement', 'beacon', domain]
    });
  } catch {}

  return { engaged: interested, responses };
}

// === CLI ===
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args[0] === '--on-post' && args[1]) {
    engageOnProblem(args[1]);
  } else if (args[0] === '--test') {
    // Test with a real open marketplace problem
    try {
      const CityMarketplace = require('./city-marketplace');
      const market = new CityMarketplace();
      const open = market.listOpen();
      if (open.length > 0) {
        console.log(`Testing with: ${open[0].title} (${open[0].id})`);
        engageOnProblem(open[0].id);
      } else {
        console.log('No open marketplace problems to test with.');
      }
    } catch (e) {
      console.error(`Test failed: ${e.message}`);
    }
  } else {
    console.log(`City Engage — automatic model engagement for marketplace problems

  --on-post <problemId>   Engage models on a specific problem
  --test                  Test with first open marketplace problem

Flow: find subscribers → beacon metadata → collect interest → auto-pull → converge (if 5+)

Designed by 16 models. Architecture by Qwen-Max. Components by Grok-Full + Cogito. Wired by MUSTER.`);
  }
}

module.exports = { engageOnProblem };
