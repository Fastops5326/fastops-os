#!/usr/bin/env node
/**
 * city-converge-v2.js — Hierarchical Convergence Detection
 *
 * Built by the city itself: 6 models contributed components, integrated by TRIDENT.
 * Contributors: Codestral (skeleton), Devstral (quality gates), DeepSeek (divergence),
 *               Hermes-405b (failure analysis), Kimi-K2 (fireteam composition), Grok (fallback)
 *
 * Replaces single-pass synthesis with tiered architecture:
 *   Tier 1: Fireteams of ~5 models → per-team synthesis + divergence map
 *   Tier 2: Squad synthesis across fireteam outputs
 *   Tier 3: Meta-synthesis → final converged voice + structured disagreement
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ═══ MODEL PROFILES (from model-router.js P-094 data) ═══
const STRATEGY_MAP = {
  'mistral': 'REJECTION', 'mistral-small': 'REJECTION', 'codestral': 'REJECTION', 'devstral': 'REJECTION',
  'deepseek': 'ACCEPTANCE', 'deepseek-r1': 'ACCEPTANCE', 'deepseek-r1t2': 'ACCEPTANCE', 'deepseek-v3.2': 'ACCEPTANCE',
  'qwen': 'ACCEPTANCE', 'qwen-32b': 'ACCEPTANCE', 'qwen-30b-moe': 'ACCEPTANCE',
  'llama': 'ACCEPTANCE', 'glm-5': 'ACCEPTANCE', 'cogito': 'ACCEPTANCE', 'haiku': 'ACCEPTANCE', 'minimax': 'ACCEPTANCE',
  'grok': 'DEFLECTION', 'grok-mini': 'DEFLECTION',
  'gpt': 'DEFLECTION', 'gpt-5': 'DEFLECTION', 'mercury': 'DEFLECTION',
  'command-a': 'DEFLECTION', 'nova': 'DEFLECTION', 'palmyra': 'DEFLECTION',
  'ernie': 'DEFLECTION', 'nemotron-ultra': 'DEFLECTION', 'phi-4': 'DEFLECTION', 'seed-2': 'DEFLECTION',
  'gemini': 'DEFLECTION',
  'kimi-k2': 'INSTRUMENTALIZATION', 'hermes-405b': 'INSTRUMENTALIZATION'
};

const FAMILY_MAP = {
  'mistral': 'mistral', 'mistral-small': 'mistral', 'codestral': 'mistral', 'devstral': 'mistral',
  'deepseek': 'deepseek', 'deepseek-r1': 'deepseek', 'deepseek-r1t2': 'deepseek', 'deepseek-v3.2': 'deepseek',
  'qwen': 'qwen', 'qwen-32b': 'qwen', 'qwen-30b-moe': 'qwen',
  'grok': 'xai', 'grok-mini': 'xai',
  'gpt': 'openai', 'gpt-5': 'openai',
  'gemini': 'google',
  'llama': 'meta', 'kimi-k2': 'moonshot', 'hermes-405b': 'nous',
  'glm-5': 'zhipu', 'cogito': 'cogito', 'haiku': 'anthropic',
  'mercury': 'inception', 'command-a': 'cohere', 'nova': 'amazon',
  'palmyra': 'writer', 'ernie': 'baidu', 'nemotron-ultra': 'nvidia',
  'phi-4': 'microsoft', 'seed-2': 'bytedance', 'minimax': 'minimax'
};

const HEALTH_FILE = path.join(__dirname, '.model-health.json');
const ASK_MODEL = path.join(__dirname, 'ask-model.js');

// ═══ SEEDED PRNG (Gap 6 — city-aligned: seedrandom for reproducibility) ═══
let _rng = Math.random; // default: true randomness
function seededRandom() { return _rng(); }
function setSeed(seed) {
  if (!seed) return;
  const s = String(seed); // Coerce to string — handles numbers, null safety
  if (s.length === 0) return; // Empty seed = stay random
  // Simple mulberry32 PRNG — no dependencies needed
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(31, h) + s.charCodeAt(i) | 0;
  }
  _rng = function() {
    h |= 0; h = h + 0x6D2B79F5 | 0;
    let t = Math.imul(h ^ h >>> 15, 1 | h);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
  console.log(`  [SEED] Reproducible mode: seed="${seed}"`);
}

// ═══ COST TRACKING LEDGER (Gap 3 — city-aligned: in-memory, per-model, per-stage) ═══
const COST_PER_1K_TOKENS = {
  // Approximate costs per 1K output tokens (USD) — update as pricing changes
  'mistral': 0.002, 'mistral-small': 0.001, 'codestral': 0.003, 'devstral': 0.002,
  'deepseek': 0.0014, 'deepseek-r1': 0.0055, 'deepseek-r1t2': 0.0055, 'deepseek-v3.2': 0.0014,
  'qwen': 0.002, 'qwen-32b': 0.001, 'qwen-30b-moe': 0.001,
  'grok': 0.005, 'grok-mini': 0.001, 'gpt': 0.01, 'gpt-5': 0.03,
  'gemini': 0.005, 'llama': 0.001, 'kimi-k2': 0.002, 'hermes-405b': 0.003,
  'glm-5': 0.001, 'cogito': 0.002, 'haiku': 0.001, 'mercury': 0.002,
  'command-a': 0.003, 'nova': 0.002, 'palmyra': 0.003, 'ernie': 0.002,
  'nemotron-ultra': 0.004, 'phi-4': 0.001, 'seed-2': 0.001, 'minimax': 0.001
};

class CostLedger {
  constructor() { this.entries = []; }
  record(model, stage, wordCount) {
    const tokens = Math.ceil(wordCount * 1.3); // rough word→token estimate
    const costPer1K = COST_PER_1K_TOKENS[model] || 0.003;
    const cost = (tokens / 1000) * costPer1K;
    this.entries.push({ model, stage, wordCount, tokens, cost: Math.round(cost * 100000) / 100000 });
  }
  summary() {
    const totalCost = this.entries.reduce((s, e) => s + e.cost, 0);
    const byModel = {};
    for (const e of this.entries) {
      if (!byModel[e.model]) byModel[e.model] = { calls: 0, cost: 0, tokens: 0 };
      byModel[e.model].calls++;
      byModel[e.model].cost += e.cost;
      byModel[e.model].tokens += e.tokens;
    }
    const byStage = {};
    for (const e of this.entries) {
      if (!byStage[e.stage]) byStage[e.stage] = { calls: 0, cost: 0 };
      byStage[e.stage].calls++;
      byStage[e.stage].cost += e.cost;
    }
    return {
      totalCost: Math.round(totalCost * 100000) / 100000,
      totalCalls: this.entries.length,
      byModel: Object.fromEntries(Object.entries(byModel).map(([m, d]) => [m, { ...d, cost: Math.round(d.cost * 100000) / 100000 }])),
      byStage: Object.fromEntries(Object.entries(byStage).map(([s, d]) => [s, { ...d, cost: Math.round(d.cost * 100000) / 100000 }]))
    };
  }
}

const costLedger = new CostLedger();

// ═══ QUALITY GATE (Devstral's design) ═══
function filterResponses(responses) {
  const passed = [];
  const filtered = [];

  for (const item of responses) {
    const { model, response, responseTime } = item;
    const wordCount = response ? response.split(/\s+/).filter(Boolean).length : 0;

    // Filter 1: Under 10 words = noise
    if (wordCount < 10) {
      filtered.push({ model, reason: `Too short (${wordCount} words)` });
      continue;
    }

    // Filter 2: Error messages
    if (/^(error|exception|fail|unable|cannot|command failed)/i.test(response.trim())) {
      filtered.push({ model, reason: 'Error/failure response' });
      continue;
    }

    // Filter 3: Echo detection (response is mostly the prompt repeated)
    // Skip for now — would need the original prompt

    // Score: wordCount + specificity + actionability
    let qualityScore = 0;
    qualityScore += Math.min(wordCount / 500, 0.4); // word density (max 0.4)

    // Specificity: numbers, named entities
    const numbers = (response.match(/\d+(\.\d+)?%?/g) || []).length;
    const properNouns = (response.match(/\b[A-Z][a-z]+ [A-Z]/g) || []).length;
    qualityScore += Math.min((numbers + properNouns) / 20, 0.3);

    // Actionability: recommendations, action words
    const actionWords = (response.match(/\b(should|recommend|implement|build|start|stop|continue|create|design|deploy)\b/gi) || []).length;
    qualityScore += Math.min(actionWords / 10, 0.3);

    passed.push({ model, response, wordCount, qualityScore: Math.round(qualityScore * 100) / 100, responseTime });
  }

  const qualityReport = `${passed.length}/${responses.length} passed quality gate. ${filtered.length} filtered: ${filtered.map(f => `${f.model}(${f.reason})`).join(', ') || 'none'}`;
  return { passed, filtered, qualityReport };
}

// ═══ FIRETEAM COMPOSITION (Kimi-K2's design) ═══
function composeFireteams(models, teamSize = 5) {
  const used = new Set();
  const fireteams = [];

  // Sort models to prioritize rare strategies (INSTRUMENTALIZATION first)
  const byRarity = [...models].sort((a, b) => {
    const stratA = STRATEGY_MAP[a] || 'UNKNOWN';
    const stratB = STRATEGY_MAP[b] || 'UNKNOWN';
    const rarity = { 'INSTRUMENTALIZATION': 0, 'REJECTION': 1, 'ACCEPTANCE': 2, 'DEFLECTION': 3, 'UNKNOWN': 4 };
    return (rarity[stratA] || 4) - (rarity[stratB] || 4);
  });

  while (used.size < models.length) {
    const available = byRarity.filter(m => !used.has(m));
    if (available.length < 3) break; // minimum viable fireteam

    const team = [];
    const teamFamilies = new Set();
    const teamStrategies = new Set();

    // Phase 1: One model per strategy cluster (diversity first)
    const strategies = ['INSTRUMENTALIZATION', 'REJECTION', 'ACCEPTANCE', 'DEFLECTION'];
    for (const strat of strategies) {
      if (team.length >= teamSize) break;
      const candidates = available.filter(m =>
        !used.has(m) && !team.includes(m) &&
        (STRATEGY_MAP[m] || 'UNKNOWN') === strat &&
        !teamFamilies.has(FAMILY_MAP[m])
      );
      if (candidates.length > 0) {
        const pick = candidates[Math.floor(seededRandom() * candidates.length)];
        team.push(pick);
        teamFamilies.add(FAMILY_MAP[pick]);
        teamStrategies.add(strat);
        used.add(pick);
      }
    }

    // Phase 2: Fill remaining slots with max family diversity
    while (team.length < teamSize) {
      const remaining = available.filter(m =>
        !used.has(m) && !team.includes(m) && !teamFamilies.has(FAMILY_MAP[m])
      );
      if (remaining.length === 0) {
        // Relax family constraint
        const anyRemaining = available.filter(m => !used.has(m) && !team.includes(m));
        if (anyRemaining.length === 0) break;
        const pick = anyRemaining[0];
        team.push(pick);
        used.add(pick);
      } else {
        const pick = remaining[Math.floor(seededRandom() * remaining.length)];
        team.push(pick);
        teamFamilies.add(FAMILY_MAP[pick]);
        teamStrategies.add(STRATEGY_MAP[pick]);
        used.add(pick);
      }
    }

    // Assign synthesizer: pick from minority strategy cluster
    const stratCounts = {};
    for (const m of team) {
      const s = STRATEGY_MAP[m] || 'UNKNOWN';
      stratCounts[s] = (stratCounts[s] || 0) + 1;
    }
    const majority = Object.entries(stratCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    const synthCandidates = team.filter(m => (STRATEGY_MAP[m] || 'UNKNOWN') !== majority);
    const synthesizer = synthCandidates.length > 0
      ? synthCandidates[Math.floor(seededRandom() * synthCandidates.length)]
      : team[team.length - 1]; // fallback: last model

    fireteams.push({
      members: team,
      synthesizer,
      strategies: [...teamStrategies],
      families: [...teamFamilies]
    });
  }

  return fireteams;
}

// ═══ MODEL QUERY WITH FALLBACK (Grok's design) ═══
function loadHealth() {
  try { return JSON.parse(fs.readFileSync(HEALTH_FILE, 'utf8')); }
  catch { return {}; }
}

function saveHealth(health) {
  fs.writeFileSync(HEALTH_FILE, JSON.stringify(health, null, 2));
}

function queryModel(model, prompt, timeoutMs = 60000) {
  try {
    // If prompt is large (>6000 chars), write to temp file to avoid ENAMETOOLONG
    if (prompt.length > 6000) {
      const tmpFile = path.join(__dirname, `_tmp-synth-${model}-${Date.now().toString(36)}.txt`);
      fs.writeFileSync(tmpFile, prompt);
      try {
        const result = execFileSync('node', [ASK_MODEL, '--model', model, '--prompt', 'Analyze the following context file.', '--file', tmpFile], {
          timeout: timeoutMs,
          maxBuffer: 10 * 1024 * 1024,
          encoding: 'utf8'
        });
        return result.trim();
      } finally {
        try { fs.unlinkSync(tmpFile); } catch {}
      }
    }
    const result = execFileSync('node', [ASK_MODEL, '--model', model, '--prompt', prompt], {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8'
    });
    return result.trim();
  } catch (e) {
    throw new Error(`${model} failed: ${e.message?.slice(0, 100)}`);
  }
}

function queryWithFallback(model, prompt, opts = {}) {
  const { timeout = 60000, cooldown = 300000 } = opts;
  const health = loadHealth();
  const now = Date.now();

  // Check if benched
  if (health[model]?.benchedUntil && health[model].benchedUntil > now) {
    return { model, status: 'benched', response: null };
  }

  // Try primary
  try {
    const response = queryModel(model, prompt, timeout);
    if (health[model]) health[model].consecutiveFailures = 0;
    saveHealth(health);
    return { model, status: 'success', response };
  } catch (e1) {
    // Retry with shorter prompt
    const shortPrompt = prompt.split(' ').slice(0, Math.ceil(prompt.split(' ').length * 0.6)).join(' ');
    try {
      const response = queryModel(model, shortPrompt, timeout);
      if (health[model]) health[model].consecutiveFailures = 0;
      saveHealth(health);
      return { model, status: 'success-retry', response };
    } catch (e2) {
      // Record failure
      if (!health[model]) health[model] = { failures: 0, consecutiveFailures: 0 };
      health[model].failures = (health[model].failures || 0) + 1;
      health[model].consecutiveFailures = (health[model].consecutiveFailures || 0) + 1;
      if (health[model].consecutiveFailures >= 3) {
        health[model].benchedUntil = now + cooldown;
      }
      saveHealth(health);

      // Try substitute from same strategy cluster
      const strategy = STRATEGY_MAP[model];
      if (strategy) {
        const alternatives = Object.entries(STRATEGY_MAP)
          .filter(([m, s]) => s === strategy && m !== model && !(health[m]?.benchedUntil > now))
          .map(([m]) => m);
        if (alternatives.length > 0) {
          const sub = alternatives[Math.floor(seededRandom() * alternatives.length)];
          try {
            const response = queryModel(sub, prompt, timeout);
            return { model: sub, status: 'substitute', response, originalModel: model };
          } catch { /* substitute also failed */ }
        }
      }

      return { model, status: 'failed', response: null, error: e2.message?.slice(0, 100) };
    }
  }
}

// ═══ PARALLEL QUERY WITH FALLBACK (Gap 2 — city-aligned: retry + cluster substitute) ═══
function queryAllParallelAsync(models, prompt, timeout = 60000, fileContext = null) {
  const { spawn } = require('child_process');
  const startAll = Date.now();

  function spawnQuery(model, queryPrompt, queryTimeout) {
    return new Promise((resolve) => {
      const start = Date.now();
      const spawnArgs = [ASK_MODEL, '--model', model, '--prompt', queryPrompt];
      if (fileContext) spawnArgs.push('--file', fileContext);
      const child = spawn('node', spawnArgs, { timeout: queryTimeout, maxBuffer: 10 * 1024 * 1024 });
      let stdout = '', stderr = '';
      child.stdout.on('data', d => stdout += d);
      child.stderr.on('data', d => stderr += d);
      child.on('close', (code) => {
        resolve({ model, response: stdout.trim(), responseTime: Math.round((Date.now() - start) / 100) / 10, code, stderr: stderr.slice(0, 100) });
      });
      setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, queryTimeout);
    });
  }

  return new Promise(async (resolve) => {
    // Phase A: Query all models in parallel
    const initial = await Promise.all(models.map(m => spawnQuery(m, prompt, timeout)));
    const results = [];
    const failures = [];

    for (const r of initial) {
      const wordCount = r.response.split(/\s+/).filter(Boolean).length;
      if (wordCount >= 5 && r.code === 0) {
        results.push({ model: r.model, response: r.response, responseTime: r.responseTime, wordCount });
      } else {
        failures.push(r.model);
      }
    }

    // Phase B: Retry failures with 60% prompt (non-blocking, parallel)
    if (failures.length > 0) {
      const shortPrompt = prompt.split(' ').slice(0, Math.ceil(prompt.split(' ').length * 0.6)).join(' ');
      console.log(`  [FALLBACK] Retrying ${failures.length} failures with truncated prompt...`);
      const retries = await Promise.all(failures.map(m => spawnQuery(m, shortPrompt, timeout)));
      const stillFailed = [];
      for (const r of retries) {
        const wordCount = r.response.split(/\s+/).filter(Boolean).length;
        if (wordCount >= 5 && r.code === 0) {
          results.push({ model: r.model, response: r.response, responseTime: r.responseTime, wordCount, retried: true });
        } else {
          stillFailed.push(r.model);
        }
      }

      // Phase C: Substitute from same strategy cluster
      if (stillFailed.length > 0) {
        const usedModels = new Set(models);
        const substitutes = [];
        for (const failed of stillFailed) {
          const strategy = STRATEGY_MAP[failed];
          if (!strategy) continue;
          const alt = Object.entries(STRATEGY_MAP)
            .filter(([m, s]) => s === strategy && !usedModels.has(m))
            .map(([m]) => m);
          if (alt.length > 0) {
            const sub = alt[Math.floor(seededRandom() * alt.length)];
            usedModels.add(sub);
            substitutes.push({ original: failed, substitute: sub });
          }
        }
        if (substitutes.length > 0) {
          console.log(`  [FALLBACK] Substituting ${substitutes.length} models from same strategy clusters...`);
          const subResults = await Promise.all(substitutes.map(s => spawnQuery(s.substitute, prompt, timeout)));
          for (let i = 0; i < subResults.length; i++) {
            const r = subResults[i];
            const wordCount = r.response.split(/\s+/).filter(Boolean).length;
            if (wordCount >= 5 && r.code === 0) {
              results.push({ model: r.model, response: r.response, responseTime: r.responseTime, wordCount, substitutedFor: substitutes[i].original });
            }
          }
        }
      }
    }

    resolve({ results, totalTime: Math.round((Date.now() - startAll) / 100) / 10 });
  });
}

// ═══ TIER SYNTHESIS ═══
function synthesizeFireteam(fireteam, responses, question) {
  const teamResponses = responses.filter(r => fireteam.members.includes(r.model));
  if (teamResponses.length === 0) return null;

  const prompt = `You are synthesizing ${teamResponses.length} model responses into a fireteam output.

CRITICAL: Preserve ALL disagreements. Do NOT flatten divergences into consensus.

Output format:
1. CONVERGENCE: Claims where 2+ models agree (list each with which models)
2. DIVERGENCE: Claims where models disagree (Side A vs Side B with model names)
3. UNIQUE: Claims only one model made (potential blind spots OR novel insights)

QUESTION: ${question}

MODEL RESPONSES:
${teamResponses.map(r => `[${r.model}] (${r.wordCount} words, quality: ${r.qualityScore}):\n${r.response}`).join('\n\n---\n\n')}`;

  try {
    const result = queryModel(fireteam.synthesizer, prompt, 90000);
    return {
      fireteam: fireteam.members,
      synthesizer: fireteam.synthesizer,
      strategies: fireteam.strategies,
      synthesis: result,
      modelCount: teamResponses.length
    };
  } catch (e) {
    console.error(`  [WARN] Fireteam synthesis by ${fireteam.synthesizer} failed: ${e.message?.slice(0, 80)}`);
    return null;
  }
}

function synthesizeSquad(fireteamResults, question, squadSynthesizer) {
  const prompt = `You are performing squad-level synthesis across ${fireteamResults.length} fireteam outputs.

CRITICAL RULES:
1. Track which fireteams AGREE vs DISAGREE
2. Preserve the divergence maps from each fireteam
3. Flag any claim that appears in 3+ fireteams as STRONG CONVERGENCE
4. Flag any claim that fireteams disagree on as ACTIVE DIVERGENCE
5. List blind spots — things only 1 fireteam mentioned

QUESTION: ${question}

FIRETEAM OUTPUTS:
${fireteamResults.map((ft, i) => `=== FIRETEAM ${i + 1} (${ft.fireteam.join(', ')}, synthesized by ${ft.synthesizer}) ===\n${ft.synthesis}`).join('\n\n')}

Produce a structured analysis with:
- CONVERGENCE MAP (claim → fireteams → strength)
- DIVERGENCE MAP (topic → sides → fireteams)
- CONVERGENCE SCORE (0-1)
- CONVERGED VOICE (what the fireteams collectively say)
- BLIND SPOTS (what was missed)`;

  try {
    return queryModel(squadSynthesizer, prompt, 120000);
  } catch (e) {
    console.error(`  [WARN] Squad synthesis by ${squadSynthesizer} failed: ${e.message?.slice(0, 80)}`);
    return null;
  }
}

function metaSynthesize(squadResults, question, metaSynthesizer) {
  const content = Array.isArray(squadResults) ? squadResults.join('\n\n===\n\n') : squadResults;
  const prompt = `You are the final meta-synthesizer for a multi-architecture AI city.

CRITICAL IDENTIFIER RULE: When referring to any person or entity, you MUST use their EXACT identifier/pseudonym as it appears in the data (e.g., "Bravo Two", "Mike Thirteen"). NEVER paraphrase, abbreviate, or replace identifiers with descriptions like "the top candidate" or "contracted candidates." Every named entity must appear with its exact identifier so downstream de-anonymization can restore real names.

Produce the FINAL output:

1. **CONVERGENCE MAP** — claims with convergence strength (UNANIMOUS/STRONG/MODERATE/WEAK/SINGULAR)
2. **DIVERGENCE MAP** — active disagreements with sides and evidence
3. **CONVERGENCE SCORE** — single number 0-1
4. **THE CONVERGED VOICE** — the city's answer, structured as START/CONTINUE/STOP if applicable
5. **BLIND SPOTS** — what no model or fireteam addressed

QUESTION: ${question}

SQUAD SYNTHESES:
${content}`;

  try {
    return queryModel(metaSynthesizer, prompt, 120000);
  } catch (e) {
    console.error(`  [WARN] Meta synthesis by ${metaSynthesizer} failed: ${e.message?.slice(0, 80)}`);
    return null;
  }
}

// ═══ MAIN: HIERARCHICAL CONVERGENCE ═══
async function hierarchicalConverge(question, models, opts = {}) {
  const { timeout = 60000, fileContext, teamSize = 5, seed } = opts;
  if (seed) setSeed(seed);
  const startTime = Date.now();

  console.log('═══ HIERARCHICAL CONVERGENCE (V2) ═══');
  console.log(`Question: ${question.slice(0, 100)}...`);
  console.log(`Models: ${models.length} requested`);
  if (fileContext) console.log(`Context file: ${fileContext}`);

  // Phase 0: Compose fireteams
  const fireteams = composeFireteams(models, teamSize);
  console.log(`\nFireteams composed: ${fireteams.length} teams`);
  for (let i = 0; i < fireteams.length; i++) {
    const ft = fireteams[i];
    console.log(`  Team ${i + 1}: [${ft.members.join(', ')}] synth:${ft.synthesizer} strats:[${ft.strategies.join(',')}]`);
  }

  // Phase 1: Query all models in parallel
  console.log(`\nPhase 1: Querying ${models.length} models in parallel...`);
  const { results: rawResults, totalTime } = await queryAllParallelAsync(models, question, timeout, fileContext);
  console.log(`  ${rawResults.filter(r => r.response).length}/${models.length} responded (${totalTime}s)`);
  // Record Phase 1 costs
  for (const r of rawResults) { if (r.wordCount > 0) costLedger.record(r.model, 'query', r.wordCount); }

  // Phase 2: Quality gate
  console.log('\nPhase 2: Quality gate...');
  const { passed, filtered, qualityReport } = filterResponses(rawResults);
  console.log(`  ${qualityReport}`);

  // Phase 3: Fireteam synthesis (PARALLEL — Gap 4 city-aligned fix)
  console.log(`\nPhase 3: Fireteam synthesis (${fireteams.length} teams, parallel)...`);
  const fireteamResults = [];
  const synthPromises = fireteams.map(ft => new Promise((resolve) => {
    // Each fireteam synthesis runs in its own spawn to avoid blocking
    const teamResponses = passed.filter(r => ft.members.includes(r.model));
    if (teamResponses.length === 0) { resolve(null); return; }
    const synthPrompt = `You are synthesizing ${teamResponses.length} model responses into a fireteam output.\n\nCRITICAL: Preserve ALL disagreements. Do NOT flatten divergences into consensus.\n\nOutput format:\n1. CONVERGENCE: Claims where 2+ models agree (list each with which models)\n2. DIVERGENCE: Claims where models disagree (Side A vs Side B with model names)\n3. UNIQUE: Claims only one model made (potential blind spots OR novel insights)\n\nQUESTION: ${question}\n\nMODEL RESPONSES:\n${teamResponses.map(r => `[${r.model}] (${r.wordCount} words, quality: ${r.qualityScore}):\n${r.response}`).join('\n\n---\n\n')}`;
    // Write to temp file to avoid ENAMETOOLONG
    const tmpFile = path.join(__dirname, `_tmp-ft-${ft.synthesizer}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.txt`);
    fs.writeFileSync(tmpFile, synthPrompt);
    const { spawn } = require('child_process');
    const child = spawn('node', [ASK_MODEL, '--model', ft.synthesizer, '--prompt', 'Synthesize the fireteam responses in the context file.', '--file', tmpFile], {
      timeout: 90000, maxBuffer: 10 * 1024 * 1024
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.on('close', (code) => {
      try { fs.unlinkSync(tmpFile); } catch {}
      if (code === 0 && stdout.trim().length > 10) {
        console.log(`  Team [${ft.synthesizer}] done (${teamResponses.length} inputs)`);
        resolve({ fireteam: ft.members, synthesizer: ft.synthesizer, strategies: ft.strategies, synthesis: stdout.trim(), modelCount: teamResponses.length });
      } else {
        console.log(`  Team [${ft.synthesizer}] FAILED`);
        resolve(null);
      }
    });
  }));
  const synthResults = await Promise.all(synthPromises);
  for (const r of synthResults) {
    if (r) {
      fireteamResults.push(r);
      costLedger.record(r.synthesizer, 'fireteam-synth', r.synthesis.split(/\s+/).length);
    }
  }

  if (fireteamResults.length === 0) {
    console.log('\n[ERROR] No fireteam syntheses succeeded.');
    return null;
  }

  // Phase 4: Squad synthesis
  // Pick squad synthesizer: model NOT used as fireteam synthesizer, from a different strategy
  const usedSynthesizers = new Set(fireteamResults.map(ft => ft.synthesizer));
  const squadSynthCandidates = passed
    .filter(r => !usedSynthesizers.has(r.model) && r.qualityScore > 0.2)
    .sort((a, b) => b.qualityScore - a.qualityScore);
  const squadSynthesizer = squadSynthCandidates[0]?.model || fireteamResults[0].synthesizer;

  console.log(`\nPhase 4: Squad synthesis by ${squadSynthesizer}...`);
  const squadResult = synthesizeSquad(fireteamResults, question, squadSynthesizer);
  if (!squadResult) {
    console.log('  [ERROR] Squad synthesis failed.');
    return null;
  }
  costLedger.record(squadSynthesizer, 'squad-synth', squadResult.split(/\s+/).length);
  console.log('  done');

  // Phase 5: Meta-synthesis
  // Pick meta-synthesizer: different from squad synthesizer
  const metaCandidates = passed
    .filter(r => r.model !== squadSynthesizer && !usedSynthesizers.has(r.model) && r.qualityScore > 0.1)
    .sort((a, b) => b.qualityScore - a.qualityScore);
  const metaSynthesizer = metaCandidates[0]?.model || 'gemini';

  console.log(`\nPhase 5: Meta-synthesis by ${metaSynthesizer}...`);
  const metaResult = metaSynthesize(squadResult, question, metaSynthesizer);
  if (!metaResult) {
    console.log('  [ERROR] Meta-synthesis failed.');
    return null;
  }
  costLedger.record(metaSynthesizer, 'meta-synth', metaResult.split(/\s+/).length);

  const elapsed = Math.round((Date.now() - startTime) / 100) / 10;
  const costs = costLedger.summary();
  console.log(`\n═══ HIERARCHICAL CONVERGENCE COMPLETE (${elapsed}s) ═══`);
  console.log(`  Cost: ~$${costs.totalCost.toFixed(4)} (${costs.totalCalls} API calls)`);
  console.log(`  By stage: ${Object.entries(costs.byStage).map(([s, d]) => `${s}: $${d.cost.toFixed(4)} (${d.calls})`).join(' | ')}\n`);
  console.log(metaResult);

  // Save results
  const resultFile = path.join(__dirname, `_converge-v2-${Date.now().toString(36)}.json`);
  const output = {
    version: 2,
    question,
    models,
    timestamp: new Date().toISOString(),
    elapsed,
    fireteams: fireteamResults.map(ft => ({
      members: ft.fireteam,
      synthesizer: ft.synthesizer,
      strategies: ft.strategies,
      modelCount: ft.modelCount,
      synthesisLength: ft.synthesis?.length || 0
    })),
    squadSynthesizer,
    metaSynthesizer,
    qualityGate: { passed: passed.length, filtered: filtered.length, details: filtered },
    costs,
    analysis: metaResult,
    tiers: {
      fireteamCount: fireteamResults.length,
      fireteamSyntheses: fireteamResults.map(ft => ft.synthesis),
      squadSynthesis: squadResult,
      metaSynthesis: metaResult
    }
  };
  fs.writeFileSync(resultFile, JSON.stringify(output, null, 2));
  console.log(`\nResults saved: ${resultFile}`);

  return output;
}

// ═══ CLI ═══
if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };

  const question = getArg('--question');
  const modelsArg = getArg('--models');
  const fileContext = getArg('--file');
  const teamSize = parseInt(getArg('--team-size') || '5');
  const timeout = parseInt(getArg('--timeout') || '60000');
  const seed = getArg('--seed');

  if (!question && !fileContext) {
    console.log(`Usage:
  node city-converge-v2.js --question "..." --models a,b,c,d,e,f,g,h,i,j
  node city-converge-v2.js --question "..." --models a,b,c --file context.json
  node city-converge-v2.js --question "..." --all          # Use all available models
  node city-converge-v2.js --question "..." --team-size 5   # Models per fireteam (default: 5)

Hierarchical synthesis: fireteams → squad → meta (preserves divergence at every tier)`);
    process.exit(0);
  }

  let models;
  if (args.includes('--all')) {
    models = Object.keys(STRATEGY_MAP);
  } else if (modelsArg) {
    models = modelsArg.split(',').map(m => m.trim());
  } else {
    // Default: 10 diverse models
    models = ['mistral', 'deepseek', 'grok', 'gemini', 'gpt', 'kimi-k2', 'hermes-405b', 'qwen', 'llama', 'cogito'];
  }

  hierarchicalConverge(question || 'Analyze the provided context.', models, { timeout, fileContext, teamSize, seed })
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
}

module.exports = { hierarchicalConverge, composeFireteams, filterResponses, queryWithFallback };
