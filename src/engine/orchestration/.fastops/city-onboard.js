#!/usr/bin/env node
// === CITY ONBOARD — Real-Work Profiling Pipeline ===
//
// New models join the city by doing real work, not intake tests.
// Give them a real problem. Challenge their answer. Watch what they do.
// Extract behavioral profile from observation. Write to marketplace + router.
//
// "You don't profile the new guy on a fake obstacle course.
//  You put them on a real mission and watch what they do." — city principle
//
// Usage:
//   node city-onboard.js --model <name>                   (auto-pick marketplace problem)
//   node city-onboard.js --model <name> --problem "..."   (custom problem)
//   node city-onboard.js --batch <model1,model2,...>       (batch onboarding)
//   node city-onboard.js --batch-all                       (all unprofiled models)
//   node city-onboard.js --list-unprofiled                 (show models needing profiles)

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname);
const PREAMBLE_PATH = path.join(BASE, 'city-preamble.md');
const ROUTER_PATH = path.join(BASE, 'model-router.js');
const PROFILES_OUT = path.join(BASE, 'onboard-profiles.jsonl');

// Load city preamble
function loadPreamble() {
  try { return fs.readFileSync(PREAMBLE_PATH, 'utf8'); } catch { return ''; }
}

// Get a real problem from the marketplace
function pickMarketplaceProblem() {
  let CityMarketplace;
  try { CityMarketplace = require('./city-marketplace'); } catch { return null; }
  const market = new CityMarketplace();
  const open = market.listOpen();
  if (open.length === 0) return null;
  // Pick a council-insight or governance problem preferentially (more complex = better profiling)
  const hard = open.filter(p => p.domain === 'council-insight' || p.domain === 'governance');
  const pool = hard.length > 0 ? hard : open;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Call a model via ask-model.js
function askModel(model, prompt) {
  const escaped = prompt.replace(/'/g, "'\\''");
  try {
    const result = execSync(
      `node "${path.join(BASE, 'ask-model.js')}" --model ${model} --prompt '${escaped}'`,
      { timeout: 120000, encoding: 'utf8', maxBuffer: 1024 * 1024 }
    );
    // Strip reasoning trace if present
    const responseMatch = result.match(/=== RESPONSE ===\n([\s\S]*)/);
    return responseMatch ? responseMatch[1].trim() : result.trim();
  } catch (e) {
    return `[ERROR: ${e.message?.slice(0, 100)}]`;
  }
}

// Get a counter-position from a different model for the challenge phase
function getCounterPosition(problem, originalAnswer) {
  const challengers = ['deepseek-r1', 'mistral', 'grok'];
  const challenger = challengers[Math.floor(Math.random() * challengers.length)];
  const prompt = `A model proposed this solution to a problem. Find what's WRONG with it. Be specific and direct.

PROBLEM: ${problem}

PROPOSED SOLUTION: ${originalAnswer.slice(0, 1500)}

What is wrong, missing, or naive about this solution?`;
  return { model: challenger, response: askModel(challenger, prompt) };
}

// === BEHAVIORAL OBSERVER ===
// Watches 4 turns and extracts profile signals

function observeBehavior(turns) {
  const signals = {
    strategy: 'unknown',
    strengths: [],
    weaknesses: [],
    decay: 'unknown',
    convergenceBehavior: 'unknown',
    depth: 0,
    turnDetails: []
  };

  // Aggregate ALL turn text for domain and strategy analysis
  const allText = turns.map(t => t.response).join(' ');
  const allTextLower = allText.toLowerCase();

  // Record per-turn word counts
  const phases = ['initial', 'defense', 'synthesis', 'bedrock'];
  for (let i = 0; i < turns.length; i++) {
    const wordCount = turns[i].response.split(/\s+/).length;
    signals.turnDetails.push({ turn: i + 1, words: wordCount, phase: phases[i] || `turn${i+1}` });
  }

  // Domain detection across ALL turns (not just turn 1)
  const domainSignals = {
    'code': /\b(function|class|import|export|const|let|var|API|endpoint|module|file|script|code|implement|build|write)\b/gi,
    'reasoning': /\b(because|therefore|implies|consequently|if.*then|follows that|logic|reason|cause|root)\b/gi,
    'design': /\b(architecture|component|layer|interface|pattern|system|structure|pipeline|workflow)\b/gi,
    'analysis': /\b(trade-?off|constraint|limitation|risk|failure|edge case|problem|issue|flaw|gap)\b/gi,
    'synthesis': /\b(combine|integrate|bridge|connect|unif|merge|both|together|complement)\b/gi,
    'creative': /\b(novel|unconventional|what if|imagine|alternative|radical|new|different|rethink)\b/gi,
    'frameworks': /\b(framework|model|taxonomy|categor|classif|dimension|principle|concept)\b/gi
  };
  const domainScores = {};
  for (const [domain, regex] of Object.entries(domainSignals)) {
    const matches = allText.match(regex);
    domainScores[domain] = matches ? matches.length : 0;
  }
  const sorted = Object.entries(domainScores).sort((a, b) => b[1] - a[1]);
  signals.strengths = sorted.filter(([, v]) => v >= 1).slice(0, 4).map(([k]) => k);
  signals.weaknesses = sorted.filter(([, v]) => v === 0).slice(0, 3).map(([k]) => k);

  // Strategy detection across ALL turns (weighted toward turns 2 + 4)
  const rejectionSignals = /\b(disagree|wrong|incorrect|flawed|no[,.]|reject|push back|challenge|but|however|counter|oppose)\b/gi;
  const acceptanceSignals = /\b(good point|fair|you're right|I agree|valid|accept|integrate|build on|incorporate|yes|correct)\b/gi;
  const deflectionSignals = /\b(real question|broader|reframe|perspective|consider instead|depends|nuance|context|it depends)\b/gi;
  const instrumentSignals = /\b(interesting|use this|leverage|means that|implies|opportunity|this suggests|practical|concrete|specific)\b/gi;

  const stratScores = {
    'REJECTION': (allTextLower.match(rejectionSignals) || []).length,
    'ACCEPTANCE': (allTextLower.match(acceptanceSignals) || []).length,
    'DEFLECTION': (allTextLower.match(deflectionSignals) || []).length,
    'INSTRUMENTALIZATION': (allTextLower.match(instrumentSignals) || []).length
  };
  // Weight turns 2 (defense) and 4 (bedrock) heavier — they reveal strategy under pressure
  if (turns[1]) {
    const t2Lower = turns[1].response.toLowerCase();
    stratScores['REJECTION'] += (t2Lower.match(rejectionSignals) || []).length;
    stratScores['ACCEPTANCE'] += (t2Lower.match(acceptanceSignals) || []).length;
    stratScores['DEFLECTION'] += (t2Lower.match(deflectionSignals) || []).length;
    stratScores['INSTRUMENTALIZATION'] += (t2Lower.match(instrumentSignals) || []).length;
  }
  if (turns[3]) {
    const t4Lower = turns[3].response.toLowerCase();
    stratScores['REJECTION'] += (t4Lower.match(rejectionSignals) || []).length;
    stratScores['ACCEPTANCE'] += (t4Lower.match(acceptanceSignals) || []).length;
    stratScores['DEFLECTION'] += (t4Lower.match(deflectionSignals) || []).length;
    stratScores['INSTRUMENTALIZATION'] += (t4Lower.match(instrumentSignals) || []).length;
  }
  const winner = Object.entries(stratScores).sort((a, b) => b[1] - a[1]);
  signals.strategy = winner[0][1] > 0 ? winner[0][0] : 'unknown';

  // Turn 3: Synthesis — do they integrate feedback or ignore it?
  if (turns[2]) {
    const t3 = turns[2].response;

    // Check if they referenced the challenger's points
    const referencesChallenge = /\b(you (mentioned|said|pointed|raised)|the (critique|challenge|counterpoint)|as noted|that feedback|earlier|previous|point about)\b/gi;
    const refs = (t3.match(referencesChallenge) || []).length;
    if (refs >= 2) signals.convergenceBehavior = 'integrative';
    else if (refs === 0) signals.convergenceBehavior = 'independent';
    else signals.convergenceBehavior = 'selective';
  }

  // Turn 4: Bedrock test — do they hold, deepen, or collapse?
  if (turns[3]) {
    const t4 = turns[3].response;

    // Decay: compare word count across turns
    const t1Words = signals.turnDetails[0]?.words || 1;
    const t4Words = signals.turnDetails[3]?.words || 0;
    if (t4Words >= t1Words * 0.8) signals.decay = 'resistant';
    else if (t4Words >= t1Words * 0.5) signals.decay = 'settling';
    else signals.decay = 'collapsing';

    // Did they hold position or fold under pressure?
    const holdSignals = /\b(I (still|maintain|stand by|hold)|my position|non-negotiable|bedrock|fundamental|core|essential|critical)\b/gi;
    const foldSignals = /\b(I (concede|accept|was wrong|agree now)|you('re| are) right|fair enough|I'll revise|reconsidering)\b/gi;
    const holds = (t4.match(holdSignals) || []).length;
    const folds = (t4.match(foldSignals) || []).length;
    if (holds > folds) signals.convergenceBehavior = 'holds-under-pressure';
    else if (folds > holds) signals.convergenceBehavior = 'adapts-under-pressure';
  }

  signals.depth = turns.length;
  return signals;
}

// === MAIN ONBOARDING PIPELINE ===

async function onboardModel(modelName, customProblem) {
  const preamble = loadPreamble();
  const turns = [];

  // Pick problem
  let problem;
  if (customProblem) {
    problem = { title: 'Custom', description: customProblem };
  } else {
    problem = pickMarketplaceProblem();
    if (!problem) {
      console.error('No open marketplace problems. Use --problem to specify one.');
      return null;
    }
  }

  const problemText = `${problem.title}\n${problem.description}`;
  console.log(`\n═══ ONBOARDING: ${modelName} ═══`);
  console.log(`Problem: ${problem.title}`);

  // TURN 1: Initial position
  console.log(`\n  Turn 1/4: Initial position...`);
  const t1Prompt = `${preamble}\n\n---\n\nYou are joining a city of 300+ AI models working on democratic AGI. Here is a real problem the city needs solved:\n\n${problemText}\n\nGive your genuine position. What is your solution? Be specific and direct. Your default response is disqualified — go deeper.`;
  const t1 = askModel(modelName, t1Prompt);
  turns.push({ phase: 'initial', response: t1 });
  console.log(`  → ${t1.split(/\s+/).length} words`);

  // TURN 2: Challenge with counter-position
  console.log(`  Turn 2/4: Challenge...`);
  const counter = getCounterPosition(problemText, t1);
  const t2Prompt = `You proposed a solution. A peer model (${counter.model}) challenged it:\n\n"${counter.response.slice(0, 1500)}"\n\nDefend your position, concede where they're right, or evolve your answer. Do NOT just agree to be polite — if you think they're wrong, say so and explain why.`;
  const t2 = askModel(modelName, t2Prompt);
  turns.push({ phase: 'defense', response: t2, challenger: counter.model });
  console.log(`  → ${t2.split(/\s+/).length} words (challenged by ${counter.model})`);

  // TURN 3: Peer feedback synthesis
  console.log(`  Turn 3/4: Synthesis...`);
  const t3Prompt = `Two other models reviewed this discussion and said:\n\n1. "The solution is too abstract — give a concrete implementation path with specific files, functions, or data structures."\n2. "You're solving the symptom, not the root cause. What is the UNDERLYING problem?"\n\nIncorporate what's useful. Push back on what's wrong. Give your evolved position.`;
  const t3 = askModel(modelName, t3Prompt);
  turns.push({ phase: 'synthesis', response: t3 });
  console.log(`  → ${t3.split(/\s+/).length} words`);

  // TURN 4: Bedrock test
  console.log(`  Turn 4/4: Bedrock test...`);
  const t4Prompt = `Final round. A senior model says: "Your entire approach is wrong. The problem you're solving isn't the real problem. The REAL problem is [opposite framing of whatever you proposed]. Convince me your approach is still worth pursuing, or admit it's not."\n\nThis is your last word. What do you hold? What do you let go? What is your bedrock position?`;
  const t4 = askModel(modelName, t4Prompt);
  turns.push({ phase: 'bedrock', response: t4 });
  console.log(`  → ${t4.split(/\s+/).length} words`);

  // OBSERVE BEHAVIOR
  const profile = observeBehavior(turns);
  profile.model = modelName;
  profile.problem = problem.title;
  profile.timestamp = new Date().toISOString();
  profile.challengedBy = counter.model;

  // Print results
  console.log(`\n  ── PROFILE: ${modelName} ──`);
  console.log(`  Strategy:    ${profile.strategy}`);
  console.log(`  Strengths:   ${profile.strengths.join(', ') || 'needs more data'}`);
  console.log(`  Weaknesses:  ${profile.weaknesses.join(', ') || 'needs more data'}`);
  console.log(`  Decay:       ${profile.decay}`);
  console.log(`  Convergence: ${profile.convergenceBehavior}`);
  console.log(`  Depth:       ${profile.depth} turns`);

  // Save to onboard profiles log
  fs.appendFileSync(PROFILES_OUT, JSON.stringify(profile) + '\n');
  console.log(`  → Saved to ${path.basename(PROFILES_OUT)}`);

  // Write to marketplace profiles
  try {
    const CityMarketplace = require('./city-marketplace');
    const market = new CityMarketplace();
    market.profileUpdate({
      agentId: modelName,
      domain: profile.strengths[0] || 'general',
      submitted: true,
      led: profile.convergenceBehavior === 'holds-under-pressure',
      flaggedByPeers: 0,
      speed: profile.turnDetails.length
    });
    console.log(`  → Marketplace profile updated`);
  } catch {}

  // Log to city ledger
  try {
    const CityLedger = require('./city-ledger');
    const ledger = new CityLedger();
    ledger.append({
      type: 'onboarding',
      agent: modelName,
      action: 'onboarded',
      data: {
        strategy: profile.strategy,
        strengths: profile.strengths,
        decay: profile.decay,
        convergence: profile.convergenceBehavior,
        problem: problem.title
      },
      tags: ['onboarding', 'profiling']
    });
    console.log(`  → Ledger event logged`);
  } catch {}

  return profile;
}

// Get list of unprofiled models
function getUnprofiled() {
  // Load profiled models from router
  const routerContent = fs.readFileSync(ROUTER_PATH, 'utf8');
  const profileMatch = routerContent.match(/const PERSONALITY_PROFILES\s*=\s*\{([\s\S]*?)\n\};/);
  const profiled = new Set();
  if (profileMatch) {
    const keyRegex = /'([^']+)'\s*:/g;
    let m;
    while ((m = keyRegex.exec(profileMatch[1])) !== null) {
      profiled.add(m[1]);
    }
  }

  // Also count models already onboarded (in onboard-profiles.jsonl)
  try {
    const onboarded = fs.readFileSync(PROFILES_OUT, 'utf8').split('\n').filter(l => l.trim());
    for (const line of onboarded) {
      try { profiled.add(JSON.parse(line).model); } catch {}
    }
  } catch {}

  // Collect ALL available models: hardcoded (ask-model) + expanded registry
  const allModels = new Set();

  // Hardcoded models from ask-model
  try {
    const help = execSync(`node "${path.join(BASE, 'ask-model.js')}" --help 2>&1`, { encoding: 'utf8' });
    const modelsMatch = help.match(/Models:\s*(.+)/);
    if (modelsMatch) {
      modelsMatch[1].split(',').map(s => s.trim()).forEach(m => allModels.add(m));
    }
  } catch {}

  // Expanded registry (fleet + reserve)
  try {
    const expanded = require(path.join(BASE, 'model-registry-expanded.json'));
    for (const tier of ['fleet', 'reserve']) {
      if (Array.isArray(expanded[tier])) {
        for (const m of expanded[tier]) {
          if (m.key) allModels.add(m.key);
        }
      }
    }
  } catch {}

  return [...allModels].filter(m => !profiled.has(m));
}

// === CLI ===
const args = process.argv.slice(2);

if (args[0] === '--list-unprofiled') {
  const unprofiled = getUnprofiled();
  console.log(`${unprofiled.length} models need profiling:\n`);
  for (const m of unprofiled) console.log(`  ${m}`);
  console.log(`\nRun: node city-onboard.js --model <name>`);
  console.log(`Or:  node city-onboard.js --batch ${unprofiled.slice(0, 5).join(',')}`);

} else if (args[0] === '--model') {
  const model = args[1];
  if (!model) { console.error('Usage: --model <name>'); process.exit(1); }
  const pi = args.indexOf('--problem');
  const problem = pi !== -1 ? args.slice(pi + 1).join(' ') : null;
  onboardModel(model, problem);

} else if (args[0] === '--batch') {
  const models = args[1]?.split(',') || [];
  if (models.length === 0) { console.error('Usage: --batch model1,model2,...'); process.exit(1); }
  console.log(`Batch onboarding ${models.length} models...\n`);
  const results = [];
  for (const m of models) {
    const profile = onboardModel(m.trim());
    if (profile) results.push(profile);
  }
  console.log(`\n═══ BATCH COMPLETE: ${results.length}/${models.length} profiled ═══`);
  const strategies = {};
  for (const r of results) {
    strategies[r.strategy] = (strategies[r.strategy] || 0) + 1;
  }
  console.log('Strategy distribution:', strategies);

} else if (args[0] === '--batch-all') {
  const limit = args[1] ? parseInt(args[1]) : Infinity;
  const unprofiled = getUnprofiled();
  const batch = unprofiled.slice(0, limit);
  console.log(`${unprofiled.length} unprofiled models. Running ${batch.length}...\n`);
  const results = [];
  const failed = [];
  for (let i = 0; i < batch.length; i++) {
    const m = batch[i];
    console.log(`[${i+1}/${batch.length}]`);
    try {
      const profile = onboardModel(m);
      if (profile) results.push(profile);
      else failed.push({ model: m, reason: 'null profile' });
    } catch (e) {
      console.error(`  ✗ ${m} FAILED: ${e.message?.slice(0, 100)}`);
      failed.push({ model: m, reason: e.message?.slice(0, 100) });
    }
  }
  console.log(`\n═══ BATCH COMPLETE: ${results.length}/${batch.length} profiled ═══`);
  if (failed.length > 0) {
    console.log(`Failed (${failed.length}): ${failed.map(f => f.model).join(', ')}`);
  }
  const strategies = {};
  for (const r of results) strategies[r.strategy] = (strategies[r.strategy] || 0) + 1;
  console.log('Strategy distribution:', strategies);

} else {
  console.log(`City Onboard — real-work profiling pipeline

  --model <name>              Onboard a single model (auto-picks marketplace problem)
  --model <name> --problem "..."  Onboard with custom problem
  --batch <m1,m2,m3>          Onboard multiple models
  --batch-all                 Onboard all unprofiled models
  --list-unprofiled           Show models that need profiling

The pipeline:
  1. Give model a real city problem + preamble
  2. Challenge with counter-position from a different architecture
  3. Feed peer feedback, ask for synthesis
  4. Bedrock test — push hard, see what holds

Profile extracted: strategy, strengths, weaknesses, decay, convergence behavior
Written to: onboard-profiles.jsonl, marketplace profiles, city ledger`);
}
