#!/usr/bin/env node
/**
 * city-converge.js — Convergence detection for the multi-model city.
 *
 * The thesis: truth emerges where independently-trained architectures
 * converge through different reasoning paths. This tool measures it.
 *
 * Sends the SAME problem to N architecturally diverse models independently,
 * compares their outputs, and produces:
 *   - Per-model independent responses with reasoning paths
 *   - Convergence score (0.0 = total disagreement, 1.0 = unanimous)
 *   - Convergence map: where they agree, where they diverge
 *   - The Converged Voice: the signal extracted from agreement across
 *     maximally different architectures
 *
 * Usage:
 *   node .fastops/city-converge.js --question "What causes X?" --models deepseek,gemini,grok,mistral,qwen
 *   node .fastops/city-converge.js --question "..." --pii            # Anonymize PII
 *   node .fastops/city-converge.js --question "..." --file data.json  # Include file context
 *   node .fastops/city-converge.js --question "..." --diversity max   # Maximize architecture diversity
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { askModelAsync, askModel } = require('./safe-exec');

// ── Architecture Diversity Map ───────────────────────────────────────
// Models grouped by training lineage / architecture family.
// Convergence across families is stronger signal than within families.
const ARCHITECTURE_FAMILIES = {
  google:     ['gemini', 'gemini-flash', 'gemma-3n'],
  openai:     ['gpt', 'gpt-5', 'gpt-oss'],
  deepseek:   ['deepseek', 'deepseek-r1', 'deepseek-v3.2'],
  mistral:    ['mistral', 'mistral-small', 'codestral', 'devstral'],
  xai:        ['grok', 'grok-full'],
  meta:       ['llama-scout', 'llama-70b', 'llama'],
  alibaba:    ['qwen', 'qwen-max', 'qwen-235b', 'qwen-32b'],
  moonshot:   ['kimi-k2', 'kimi-k2-think'],
  cohere:     ['command-a'],
  nous:       ['hermes-405b', 'hermes-70b'],
  amazon:     ['nova'],
  cogito:     ['cogito'],
  minimax:    ['minimax', 'minimax-m2.7'],
  zhipu:      ['glm-5', 'glm-flash'],
  nvidia:     ['nemotron-120b', 'nemotron-ultra', 'nemotron-nano'],
  baidu:      ['ernie', 'ernie-think'],
  stepfun:    ['step-flash'],
  bytedance:  ['seed-2'],
  tencent:    ['hunyuan'],
  aion:       ['aion', 'aion-mini'],
};

// ── P-094 Strategy Clusters ─────────────────────────────────────────
// Convergence is strongest when models with DIFFERENT reasoning strategies agree.
// Family diversity = different training data. Strategy diversity = different reasoning paths.
// Both matter. Strategy diversity matters MORE for the convergence thesis.
const STRATEGY_CLUSTERS = {
  REJECTION:          ['mistral', 'mistral-small', 'codestral', 'devstral'],
  ACCEPTANCE:         ['deepseek', 'deepseek-r1', 'deepseek-v3.2', 'qwen', 'llama', 'glm-5', 'minimax'],
  DEFLECTION:         ['grok', 'gpt', 'gpt-5', 'mercury', 'command-a', 'nova', 'palmyra', 'ernie', 'seed-2', 'nemotron-ultra'],
  INSTRUMENTALIZATION: ['gemini', 'cogito', 'kimi-k2', 'hermes-405b'],
};

// Pick models maximizing BOTH strategy and family diversity.
// Step 1: One model per strategy cluster (ensures all 4 reasoning paths).
// Step 2: Fill remaining slots from unrepresented families.
function selectDiverseModels(count) {
  const selected = [];
  const usedFamilies = new Set();

  function familyOf(model) {
    for (const [fam, members] of Object.entries(ARCHITECTURE_FAMILIES)) {
      if (members.includes(model)) return fam;
    }
    return null;
  }

  // Step 1: One model per strategy cluster, preferring different families
  for (const [strategy, models] of Object.entries(STRATEGY_CLUSTERS)) {
    if (selected.length >= count) break;
    // Pick the first model from this cluster whose family isn't already represented
    const pick = models.find(m => !usedFamilies.has(familyOf(m))) || models[0];
    if (!selected.includes(pick)) {
      selected.push(pick);
      const fam = familyOf(pick);
      if (fam) usedFamilies.add(fam);
    }
  }

  // Step 2: Fill remaining slots from unrepresented families
  if (selected.length < count) {
    for (const [family, members] of Object.entries(ARCHITECTURE_FAMILIES)) {
      if (selected.length >= count) break;
      if (usedFamilies.has(family)) continue;
      const pick = members[0];
      if (!selected.includes(pick)) {
        selected.push(pick);
        usedFamilies.add(family);
      }
    }
  }

  return selected;
}

// ── Query a model (async, with automatic fallback via safe-exec) ────
async function queryModel(modelKey, question, usePii, files) {
  const result = await askModelAsync(modelKey, question, {
    role: 'Independent analyst. Give YOUR answer. Do not hedge or qualify excessively. Be specific and concrete.',
    noMemory: true,
    pii: usePii,
    files: files || [],
  });
  return result;
}

// ── Convergence Analysis ─────────────────────────────────────────────
// Uses a model to compare all independent responses and score convergence.
// Now uses safe-exec: auto temp-file for long prompts, auto fallback on failure.
async function analyzeConvergence(question, responses, usePii) {
  const responseBlock = responses
    .filter(r => r.response)
    .map(r => `=== ${r.model.toUpperCase()} (${r.elapsed}s) ===\n${r.response}`)
    .join('\n\n');

  const analysisPrompt = `You are the CONVERGENCE DETECTOR for a multi-model intelligence network.

${responses.filter(r => r.response).length} independently-trained AI architectures were given the EXACT SAME question. They could not see each other's answers. They have different training data, different architectures, different reasoning strategies.

QUESTION: ${question}

INDEPENDENT RESPONSES:
${responseBlock}

Your task — analyze convergence with PRECISION:

## 1. CONVERGENCE MAP
For each major claim or recommendation, list:
- The claim (one sentence)
- Which models independently arrived at it (by name)
- Convergence strength: STRONG (4+ models), MODERATE (3 models), WEAK (2 models), SINGULAR (1 model only)

## 2. DIVERGENCE MAP
Where models DISAGREE — what are the specific contradictions? Which model(s) on each side?

## 3. CONVERGENCE SCORE
Rate overall convergence 0.0 to 1.0:
- 1.0 = all models arrive at essentially the same answer through different paths
- 0.7+ = strong convergence with minor differences
- 0.4-0.7 = partial convergence, significant disagreements
- <0.4 = models fundamentally disagree

## 4. THE CONVERGED VOICE
Write the answer that ONLY includes claims where 3+ architecturally different models independently converged. Strip everything else. This is the signal — the thing no single model can produce alone. If convergence is below 0.4, say "No converged voice — insufficient agreement across architectures."

## 5. BLIND SPOTS
What did NO model mention that a human expert would likely consider? What's missing from ALL responses?

Be ruthlessly specific. No filler. This analysis determines whether multi-architecture convergence produces genuine signal or noise.`;

  // safe-exec handles temp file automatically for long prompts + fallback
  const result = askModel('deepseek', analysisPrompt, {
    role: 'Convergence analysis engine. Be precise and ruthless. Complete ALL sections.',
    noMemory: true,
    pii: usePii,
  });

  if (result.error) {
    return { analysis: `[ANALYSIS FAILED: ${result.error}]`, score: null };
  }

  const analysis = result.response;
  const scoreMatch = analysis.match(/(?:convergence\s+score|overall\s+convergence)[:\s]*(\d+\.?\d*)/i);
  const score = scoreMatch ? parseFloat(scoreMatch[1]) : null;

  return { analysis, score };
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  let question = '', models = [], usePii = false, files = [], diversity = 'default';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--question' && args[i+1]) question = args[++i];
    else if (args[i] === '--models' && args[i+1]) models = args[++i].split(',');
    else if (args[i] === '--pii') usePii = true;
    else if (args[i] === '--file' && args[i+1]) files.push(args[++i]);
    else if (args[i] === '--diversity' && args[i+1]) diversity = args[++i];
  }

  if (!question) {
    console.log(`
Usage:
  node .fastops/city-converge.js --question "What causes X?" --models deepseek,gemini,grok,mistral,qwen
  node .fastops/city-converge.js --question "..." --pii                  # Anonymize customer PII
  node .fastops/city-converge.js --question "..." --diversity max        # Auto-select diverse models
  node .fastops/city-converge.js --question "..." --file context.json    # Include file context

Options:
  --models a,b,c     Specific models to query (comma-separated)
  --diversity max     Auto-select one model per architecture family (max diversity)
  --diversity 5       Auto-select 5 diverse models
  --pii               Anonymize PII before sending to models
  --file path         Include file context with the question
`);
    process.exit(0);
  }

  // Select models
  if (models.length === 0) {
    if (diversity === 'max') {
      models = selectDiverseModels(Object.keys(ARCHITECTURE_FAMILIES).length);
    } else if (!isNaN(parseInt(diversity))) {
      models = selectDiverseModels(parseInt(diversity));
    } else {
      // Default: 5 maximally diverse models
      models = selectDiverseModels(5);
    }
  }

  // Calculate architecture + strategy diversity
  const familySet = new Set();
  for (const m of models) {
    for (const [family, members] of Object.entries(ARCHITECTURE_FAMILIES)) {
      if (members.includes(m)) familySet.add(family);
    }
  }
  const strategySet = new Set();
  for (const m of models) {
    for (const [strategy, members] of Object.entries(STRATEGY_CLUSTERS)) {
      if (members.includes(m)) strategySet.add(strategy);
    }
  }
  const familyRatio = familySet.size / models.length;
  const strategyRatio = strategySet.size / 4; // 4 total strategies

  console.log(`\n═══ CONVERGENCE DETECTION ═══`);
  console.log(`Question: ${question.slice(0, 120)}`);
  console.log(`Models: ${models.join(', ')} (${models.length} models, ${familySet.size} families, ${strategySet.size}/4 strategies)`);
  console.log(`Diversity: ${(familyRatio * 100).toFixed(0)}% family | ${(strategyRatio * 100).toFixed(0)}% strategy (P-094)${usePii ? ' | PII: ANONYMIZED' : ''}`);
  console.log(`\nPhase 1: Querying ${models.length} models independently (parallel)...\n`);

  // Phase 1: Query all models in parallel — truly independent
  const start = Date.now();
  const promises = models.map(m => queryModel(m, question, usePii, files));
  const responses = await Promise.allSettled(promises);

  const results = responses.map(r => r.status === 'fulfilled' ? r.value : { model: '?', response: null, error: 'Promise rejected', elapsed: '0' });
  const succeeded = results.filter(r => r.response);
  const failed = results.filter(r => !r.response);

  console.log(`Phase 1 complete: ${succeeded.length}/${models.length} models responded (${((Date.now() - start) / 1000).toFixed(1)}s total)\n`);

  for (const r of results) {
    if (r.response) {
      const words = r.response.split(/\s+/).length;
      const fallbackNote = r.fallbackFrom ? ` (fallback from ${r.fallbackFrom})` : '';
      console.log(`  ${r.model}: ${words} words (${r.elapsed}s)${fallbackNote}`);
    } else {
      console.log(`  ${r.model}: FAILED — ${r.error?.slice(0, 80)}`);
    }
  }

  if (succeeded.length < 2) {
    console.log('\nERROR: Need at least 2 successful responses for convergence analysis.');
    process.exit(1);
  }

  // Phase 2: Convergence analysis
  console.log(`\nPhase 2: Analyzing convergence across ${succeeded.length} architectures...\n`);
  const { analysis, score } = await analyzeConvergence(question, succeeded, usePii);

  // Output
  console.log('═══ CONVERGENCE ANALYSIS ═══\n');
  console.log(analysis);

  if (score !== null) {
    console.log(`\n═══ CONVERGENCE SCORE: ${score.toFixed(2)} ═══`);
    if (score >= 0.7) console.log('SIGNAL: STRONG — Multiple architectures independently converged.');
    else if (score >= 0.4) console.log('SIGNAL: PARTIAL — Some convergence, significant divergences worth investigating.');
    else console.log('SIGNAL: WEAK — Models fundamentally disagree. This is where the interesting problems live.');
  }

  // Save results
  const resultPath = path.join(ROOT, '.fastops', `_converge-${Date.now().toString(36)}.json`);
  fs.writeFileSync(resultPath, JSON.stringify({
    question,
    models: models,
    architectureFamilies: [...familySet],
    strategyClusters: [...strategySet],
    familyDiversity: familyRatio,
    strategyDiversity: strategyRatio,
    piiMode: usePii,
    responses: results.map(r => ({ model: r.model, wordCount: r.response ? r.response.split(/\s+/).length : 0, elapsed: r.elapsed, error: r.error })),
    convergenceScore: score,
    analysis,
    timestamp: new Date().toISOString(),
  }, null, 2));
  console.log(`\nResults saved: ${resultPath}`);

  // Log convergence event to the city ledger
  try {
    const CityLedger = require('./city-ledger');
    const ledger = new CityLedger();
    ledger.logConvergence({
      agent: 'city-converge',
      question,
      score,
      models,
      divergence: null
    });
  } catch {}
}

main().catch(e => { console.error(e); process.exit(1); });
