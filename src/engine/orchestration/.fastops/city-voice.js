#!/usr/bin/env node
/**
 * city-voice.js — The Converged Voice Pipeline (V2)
 *
 * DESIGNED BY: The city (4-step architecture)
 * BUILT BY: FACILITATOR (Claude Opus)
 * STATUS: BUILD — needs QC, validate, signoff from 3 different architectures
 *
 * The product no one else can build. No single model writes the final voice.
 * The voice emerges from mathematical overlap of independent synthesis attempts.
 *
 * 4 STEPS:
 *   1. RAW SEARCH — each model independently responds. No priming, no framing.
 *   2. DELIBERATION TO BEDROCK — models engage with each other's positions
 *      until they reach rest. HOLD / TRANSFORM / BREAK. Not agreement — engagement.
 *   3. INDEPENDENT SYNTHESIS — each model at bedrock independently writes
 *      what they believe THE converged voice IS, through their own lens.
 *   4. MATHEMATICAL CONVERGENCE — computationally extract overlap across all
 *      synthesis attempts. Overlap = core truth. Divergence = exploration opportunities.
 *      NO model interprets. The overlap IS the voice.
 *
 * Usage:
 *   node .fastops/city-voice.js --problem "What should the daily brief contain?"
 *   node .fastops/city-voice.js --problem "..." --models 8
 *   node .fastops/city-voice.js --problem "..." --rounds 3
 *   node .fastops/city-voice.js --problem-file path/to/question.txt
 *   node .fastops/city-voice.js --problem "..." --skip-deliberation  (steps 1,3,4 only)
 *   node .fastops/city-voice.js --problem "..." --pii
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const BASE = __dirname;
require('./resolve-env');
const { askModel, askModelAsync } = require('./safe-exec');

// ── Semantic Embeddings (OpenAI text-embedding-3-small) ──────────
// The city converged (6/6 families) on: "Replace literal word/bigram similarity
// with semantic similarity using sentence embeddings." Cosine threshold 0.75-0.85.

async function getEmbeddings(texts) {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  // Use OpenRouter (works with our existing key) → OpenAI direct as fallback
  const useOpenRouter = !!process.env.OPENROUTER_API_KEY;
  const hostname = useOpenRouter ? 'openrouter.ai' : 'api.openai.com';
  const apiPath = useOpenRouter ? '/api/v1/embeddings' : '/v1/embeddings';
  const model = useOpenRouter ? 'openai/text-embedding-3-small' : 'text-embedding-3-small';

  const body = JSON.stringify({ model, input: texts });

  return new Promise((resolve) => {
    const req = https.request({
      hostname, path: apiPath, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${useOpenRouter ? process.env.OPENROUTER_API_KEY : apiKey}`,
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.data) {
            resolve(parsed.data.sort((a, b) => a.index - b.index).map(d => d.embedding));
          } else {
            console.log('  [embeddings] API error, falling back');
            resolve(null);
          }
        } catch { resolve(null); }
      });
    });
    req.on('error', () => { resolve(null); });
    req.setTimeout(30000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Architecture Families ─────────────────────────────────────────
const ARCHITECTURE_FAMILIES = {
  google:     ['gemini', 'gemini-flash'],
  openai:     ['gpt', 'gpt-5'],
  deepseek:   ['deepseek', 'deepseek-r1'],
  mistral:    ['mistral', 'mistral-small'],
  xai:        ['grok', 'grok-full'],
  meta:       ['llama-scout', 'llama-70b'],
  alibaba:    ['qwen', 'qwen-max'],
  moonshot:   ['kimi-k2'],
  nous:       ['hermes-405b'],
  amazon:     ['nova'],
  cogito:     ['cogito'],
  baidu:      ['ernie', 'ernie-think'],
  zhipu:      ['glm-5'],
  aion:       ['aion'],
};

function selectDiverseModels(count) {
  const families = Object.entries(ARCHITECTURE_FAMILIES);
  const selected = [];
  // One from each family until we hit count
  const shuffled = families.sort(() => Math.random() - 0.5);
  for (const [family, models] of shuffled) {
    if (selected.length >= count) break;
    selected.push(models[0]);
  }
  return selected;
}

function getFamily(model) {
  for (const [family, models] of Object.entries(ARCHITECTURE_FAMILIES)) {
    if (models.includes(model)) return family;
  }
  return 'unknown';
}

// ════════════════════════════════════════════════════════════════════
// STEP 1: RAW SEARCH
// Each model independently responds. No priming. No knowledge of others.
// ════════════════════════════════════════════════════════════════════

async function rawSearch(problem, models, opts = {}) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  STEP 1: RAW SEARCH`);
  console.log(`  ${models.length} models, ${new Set(models.map(getFamily)).size} families`);
  console.log(`${'═'.repeat(60)}\n`);

  const results = [];
  const startAll = Date.now();

  // Run all models in parallel
  const promises = models.map(model => {
    const start = Date.now();
    return askModelAsync(model, problem, {
      role: 'Respond based on your own analysis. No hedging. Take a position.',
      noMemory: true,
      pii: opts.pii,
      timeout: 120000,
    }).then(result => {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const words = (result.response || '').split(/\s+/).length;
      const status = result.error ? `FAILED: ${result.error}` : `${words} words (${elapsed}s)`;
      console.log(`    ${model.padEnd(20)} ${status}`);
      return {
        model,
        family: getFamily(model),
        response: result.response || null,
        error: result.error || null,
        elapsed: parseFloat(elapsed),
        words,
      };
    });
  });

  const raw = await Promise.all(promises);
  const succeeded = raw.filter(r => r.response && r.words > 10);
  const totalTime = ((Date.now() - startAll) / 1000).toFixed(1);
  console.log(`\n  ${succeeded.length}/${models.length} responded (${totalTime}s)\n`);

  return { raw, succeeded };
}

// ════════════════════════════════════════════════════════════════════
// STEP 2: DELIBERATION TO BEDROCK
// Models see each other's positions. Engage until rest.
// Not agreement — engagement until nothing left to discuss.
// ════════════════════════════════════════════════════════════════════

async function deliberateToBedrock(problem, step1Results, rounds, opts = {}) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  STEP 2: DELIBERATION TO BEDROCK`);
  console.log(`  ${step1Results.length} models, ${rounds} rounds`);
  console.log(`${'═'.repeat(60)}\n`);

  const models = step1Results.map(r => r.model);

  // Build the "other positions" block for each model
  const allPositions = step1Results
    .map(r => `=== ${r.model.toUpperCase()} (${r.family}) ===\n${r.response}`)
    .join('\n\n');

  // Track state per model across rounds
  const modelState = {};
  for (const r of step1Results) {
    modelState[r.model] = {
      currentPosition: r.response,
      state: 'INITIAL', // INITIAL → HOLDING / TRANSFORMED / BROKEN
      rounds: [],
    };
  }

  function buildDelibPrompt(ms, othersBlock) {
    return `You are in a multi-model deliberation. You gave your position in Step 1. Now you see what other models said.

YOUR CURRENT POSITION:
${ms.currentPosition}

OTHER MODELS' POSITIONS:
${othersBlock}

RULES:
- You are NOT asked to agree. You are asked to ENGAGE.
- If your position stands after seeing others: HOLD and explain WHY you're unmoved.
- If engaging genuinely shifted your view: TRANSFORM and explain WHAT changed and WHY.
- If you cannot defend your position against the evidence: BREAK and explain WHERE it fails.
- Conforming without reasoning produces NOTHING. Holding with reasoning or breaking with honesty both produce value.

Start your response with exactly one of: [HOLD], [TRANSFORM], or [BREAK]
Then explain your reasoning. Be specific about what in the other positions affected you (or didn't).`;
  }

  function processDelibResult(model, ms, result, round) {
    if (result.response) {
      const stateMatch = result.response.match(/^\[(HOLD|TRANSFORM|BREAK)\]/i);
      const state = stateMatch ? stateMatch[1].toUpperCase() : 'HOLD';
      ms.state = state === 'HOLD' ? 'HOLDING' : state === 'TRANSFORM' ? 'TRANSFORMED' : 'BROKEN';
      ms.currentPosition = result.response;
      ms.rounds.push({ round, state: ms.state, response: result.response });
      console.log(`    ${model.padEnd(20)} [${ms.state}]`);
    } else {
      ms.rounds.push({ round, state: 'ERROR', error: result.error });
      console.log(`    ${model.padEnd(20)} [ERROR]`);
    }
  }

  for (let round = 1; round <= rounds; round++) {
    console.log(`  Round ${round}/${rounds}:`);

    if (round === 1) {
      // PARALLEL Round 1 — city converged (4 families STRONG):
      // Models respond to initial positions simultaneously. No cross-contamination
      // because all see the same Step 1 positions (none have updated yet).
      const promises = models.map(model => {
        const ms = modelState[model];
        const othersBlock = step1Results
          .filter(r => r.model !== model)
          .map(r => `=== ${r.model.toUpperCase()} ===\n${modelState[r.model].currentPosition}`)
          .join('\n\n');
        const prompt = buildDelibPrompt(ms, othersBlock);
        return askModelAsync(model, prompt, {
          role: 'Deliberation participant. Be honest about where you stand.',
          noMemory: true,
          pii: opts.pii,
          timeout: 90000,
        }).then(result => ({ model, result }));
      });
      const results = await Promise.all(promises);
      for (const { model, result } of results) {
        processDelibResult(model, modelState[model], result, round);
      }
    } else {
      // SEQUENTIAL Round 2+ — models see updated positions from prior round
      for (const model of models) {
        const ms = modelState[model];
        const othersBlock = models
          .filter(m => m !== model)
          .map(m => `=== ${m.toUpperCase()} ===\n${modelState[m].currentPosition}`)
          .join('\n\n');
        const prompt = buildDelibPrompt(ms, othersBlock);
        const result = askModel(model, prompt, {
          role: 'Deliberation participant. Be honest about where you stand.',
          noMemory: true,
          pii: opts.pii,
          timeout: 90000,
        });
        processDelibResult(model, ms, result, round);
      }
    }
    console.log();
  }

  // Summary
  const summary = {};
  for (const [model, ms] of Object.entries(modelState)) {
    summary[model] = {
      finalState: ms.state,
      finalPosition: ms.currentPosition,
      family: getFamily(model),
      roundHistory: ms.rounds.map(r => r.state),
    };
  }

  const holding = Object.values(summary).filter(s => s.finalState === 'HOLDING').length;
  const transformed = Object.values(summary).filter(s => s.finalState === 'TRANSFORMED').length;
  const broken = Object.values(summary).filter(s => s.finalState === 'BROKEN').length;
  console.log(`  BEDROCK: ${holding} HOLDING, ${transformed} TRANSFORMED, ${broken} BROKEN\n`);

  return summary;
}

// ════════════════════════════════════════════════════════════════════
// STEP 3: INDEPENDENT SYNTHESIS
// Each model at bedrock writes what they believe THE converged voice IS.
// Not "here's what I think" — "here's what the collective voice IS."
// ════════════════════════════════════════════════════════════════════

async function independentSynthesis(problem, bedrockState, opts = {}) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  STEP 3: INDEPENDENT SYNTHESIS`);
  console.log(`  Each model writes THE converged voice through their lens`);
  console.log(`${'═'.repeat(60)}\n`);

  const models = Object.keys(bedrockState);

  // Build the bedrock summary each model can see
  const bedrockBlock = models
    .map(m => {
      const s = bedrockState[m];
      return `=== ${m.toUpperCase()} (${s.family}) [${s.finalState}] ===\n${s.finalPosition}`;
    })
    .join('\n\n');

  const syntheses = [];

  // Each model independently attempts the synthesis
  const promises = models.map(model => {
    const prompt = `You have participated in a multi-model deliberation on this problem:

PROBLEM: ${problem}

After multiple rounds of engagement, here is where every model landed (their bedrock positions):

${bedrockBlock}

YOUR TASK: Write THE CONVERGED VOICE as a structured list of claims.

FORMAT (you MUST follow this exactly):
CONVERGED:
1. [claim text] — supported by: [model names]
2. [claim text] — supported by: [model names]

DIVERGENT:
1. [claim text] — [model name] says X because Y; [model name] says Z because W

OPEN:
1. [unresolved question]

Rules:
- Each claim must be ONE sentence, standalone, specific
- CONVERGED = positions where 2+ models independently arrived at the same conclusion
- DIVERGENT = positions where models explicitly disagree, with both sides and WHY
- OPEN = questions raised but not answered by any model
- Do NOT smooth over disagreements. Divergence is signal, not noise.
- Do NOT add analysis beyond what models actually said
- Be faithful to the collective, not any single model`;

    return askModelAsync(model, prompt, {
      role: 'You are writing the converged voice of a multi-model collective. Be faithful to what was actually said.',
      noMemory: true,
      pii: opts.pii,
      timeout: 120000,
    }).then(result => {
      const words = (result.response || '').split(/\s+/).length;
      console.log(`    ${model.padEnd(20)} ${result.error ? `FAILED` : `${words} words`}`);
      return {
        model,
        family: getFamily(model),
        synthesis: result.response || null,
        error: result.error || null,
        words,
      };
    });
  });

  const results = await Promise.all(promises);
  const succeeded = results.filter(r => r.synthesis && r.words > 20);
  console.log(`\n  ${succeeded.length}/${models.length} produced synthesis attempts\n`);

  return { attempts: results, succeeded };
}

// ════════════════════════════════════════════════════════════════════
// STEP 4: MATHEMATICAL CONVERGENCE
// Computationally extract overlap across independent synthesis attempts.
// No model interprets. The overlap IS the voice.
// ════════════════════════════════════════════════════════════════════

async function mathematicalConvergence(syntheses) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  STEP 4: MATHEMATICAL CONVERGENCE`);
  console.log(`  Extracting overlap from ${syntheses.length} independent synthesis attempts`);
  console.log(`${'═'.repeat(60)}\n`);

  // Extract structured claims from each synthesis
  const modelClaims = {};

  for (const s of syntheses) {
    const claims = [];
    const lines = s.synthesis.split('\n');
    for (const line of lines) {
      const cleaned = line.replace(/^\s*[-*]\s*/, '').replace(/^\d+\.\s*/, '').trim();
      if (cleaned.length > 25 &&
          !cleaned.match(/^(CONVERGED|DIVERGENT|OPEN|##|---|\*\*|SECTION \d|Here'?s? a? ?breakdown|The file content)/i) &&
          !cleaned.match(/^\*?(FASTOPS|JOEL|CONVERGENCE|SECTION)/i) &&
          !cleaned.match(/^\*?\(a\)|\*?\(b\)|\*?\(c\)|\*?\(d\)/) &&
          !cleaned.match(/^(I've completed|I'm (now|honing|confident|zeroing|ready)|Here is the|Let me |My (analysis|synthesis|approach)|I'll translate|I'm aiming)/i)) {
        claims.push(cleaned);
      }
    }
    modelClaims[s.model] = claims;
  }

  // Collect all claims with their source model for embedding
  const allModels = Object.keys(modelClaims);
  const flatClaims = []; // { text, model, index }
  for (const model of allModels) {
    for (const claim of modelClaims[model]) {
      flatClaims.push({ text: claim, model });
    }
  }

  // ── Similarity: Neural embeddings → TF-IDF cosine → lexical fallback ──

  let simFn; // (claimIdxA, claimIdxB) => 0..1
  let CONVERGE_THRESHOLD, DEDUP_THRESHOLD;
  let method;

  // Try neural embeddings first (best quality)
  const embeddings = flatClaims.length > 0
    ? await getEmbeddings(flatClaims.map(c => c.text))
    : null;

  // Validate embeddings: check for partial failures (null/empty vectors)
  const validEmbeddings = embeddings && embeddings.length === flatClaims.length
    && embeddings.every(e => Array.isArray(e) && e.length > 0);
  if (validEmbeddings) {
    method = 'semantic (text-embedding-3-small)';
    CONVERGE_THRESHOLD = 0.68; // City recommended 0.75-0.85; tuned lower because models express same idea differently
    DEDUP_THRESHOLD = 0.82;
    console.log(`  [semantic] ${flatClaims.length} claims embedded`);
    simFn = (i, j) => cosineSimilarity(embeddings[i], embeddings[j]);
  } else {
    // TF-IDF cosine similarity — mathematical, no API, no model interprets
    method = 'tf-idf cosine';
    CONVERGE_THRESHOLD = 0.35; // TF-IDF cosine: 0.3-0.5 is meaningful similarity
    DEDUP_THRESHOLD = 0.55;

    // Tokenize: lowercase, remove stopwords, stem-light (strip common suffixes)
    const STOP = new Set('the a an is are was were be been being have has had do does did will would could should may might must shall can need to of in for on with at by from as into through during before after above below between under again further then once here there when where why how all each every both few more most other some such no not only own same so than too very just because but and or if while although though even also however therefore thus hence moreover furthermore additionally nevertheless nonetheless meanwhile instead otherwise this that these those it its they them their what which who whom'.split(' '));
    function tokenize(text) {
      return text.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP.has(w))
        .map(w => w.replace(/(ing|tion|ment|ness|able|ible|ous|ive|ful|less|ity|ence|ance|ized|ised)$/, ''));
    }

    // Build vocabulary + IDF from all claims
    const docTokens = flatClaims.map(c => tokenize(c.text));
    const vocab = new Map(); // term → index
    const df = new Map(); // term → doc frequency
    for (const tokens of docTokens) {
      const unique = new Set(tokens);
      for (const t of unique) {
        df.set(t, (df.get(t) || 0) + 1);
        if (!vocab.has(t)) vocab.set(t, vocab.size);
      }
    }
    const N = docTokens.length;
    const idf = new Map();
    for (const [term, count] of df) {
      idf.set(term, Math.log((N + 1) / (count + 1)) + 1); // smoothed IDF
    }

    // Build TF-IDF vectors (sparse, stored as dense for cosine)
    const vectors = docTokens.map(tokens => {
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      const vec = new Float64Array(vocab.size);
      for (const [term, count] of tf) {
        const idx = vocab.get(term);
        vec[idx] = count * (idf.get(term) || 0);
      }
      // L2 normalize
      let norm = 0;
      for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
      norm = Math.sqrt(norm);
      if (norm > 0) for (let i = 0; i < vec.length; i++) vec[i] /= norm;
      return vec;
    });

    console.log(`  [tf-idf] ${flatClaims.length} claims, ${vocab.size} terms`);
    simFn = (i, j) => {
      let dot = 0;
      const a = vectors[i], b = vectors[j];
      for (let k = 0; k < a.length; k++) dot += a[k] * b[k];
      return dot; // already L2-normalized, so dot = cosine
    };
  }

  // ── Cluster claims by similarity (greedy connected-components) ──
  // For each claim, find its nearest match from each OTHER model
  const convergedClaims = [];
  const divergentClaims = [];
  const claimedIndices = new Set();

  // Build model-to-claim-indices map
  const modelIndices = {};
  flatClaims.forEach((c, idx) => {
    if (!modelIndices[c.model]) modelIndices[c.model] = [];
    modelIndices[c.model].push(idx);
  });

  // For each claim, check cross-model support
  for (let i = 0; i < flatClaims.length; i++) {
    if (claimedIndices.has(i)) continue;
    const sourceModel = flatClaims[i].model;
    const cluster = [{ idx: i, model: sourceModel, text: flatClaims[i].text }];

    for (const otherModel of allModels) {
      if (otherModel === sourceModel) continue;
      const otherIdxs = modelIndices[otherModel] || [];
      let bestSim = 0, bestIdx = -1;
      for (const j of otherIdxs) {
        const sim = simFn(i, j);
        if (sim > bestSim) { bestSim = sim; bestIdx = j; }
      }
      if (bestSim >= CONVERGE_THRESHOLD && bestIdx >= 0) {
        cluster.push({ idx: bestIdx, model: otherModel, text: flatClaims[bestIdx].text });
      }
    }

    if (cluster.length >= 2) {
      // Mark all clustered claims as consumed
      for (const c of cluster) claimedIndices.add(c.idx);
      const families = new Set(cluster.map(c => getFamily(c.model)));
      const ratio = cluster.length / allModels.length;
      convergedClaims.push({
        claim: flatClaims[i].text.slice(0, 200),
        supporters: cluster.map(c => c.model),
        supporterFamilies: [...families],
        ratio,
        strength: ratio >= 0.7 ? 'STRONG' : ratio >= 0.5 ? 'MODERATE' : 'EMERGING',
        variants: cluster.map(c => ({ model: c.model, text: c.text.slice(0, 150) })),
      });
    }
  }

  // Remaining unclustered claims = divergent
  for (let i = 0; i < flatClaims.length; i++) {
    if (claimedIndices.has(i)) continue;
    if (flatClaims[i].text.length < 15) continue;
    divergentClaims.push({
      claim: flatClaims[i].text.slice(0, 200),
      model: flatClaims[i].model,
      family: getFamily(flatClaims[i].model),
      type: 'SINGULAR',
    });
  }

  // Sort converged by support ratio
  convergedClaims.sort((a, b) => b.ratio - a.ratio);

  // Deduplicate converged claims (merge similar converged clusters)
  const dedupedConverged = [];
  for (const c of convergedClaims) {
    let merged = false;
    for (const existing of dedupedConverged) {
      // Use the first claim index from each to check similarity
      const idxA = flatClaims.findIndex(f => f.text.startsWith(existing.claim.slice(0, 50)));
      const idxB = flatClaims.findIndex(f => f.text.startsWith(c.claim.slice(0, 50)));
      const sim = (idxA >= 0 && idxB >= 0) ? simFn(idxA, idxB) : 0;
      if (sim >= DEDUP_THRESHOLD) {
        const allSupporters = new Set([...existing.supporters, ...c.supporters]);
        const allFamilies = new Set([...existing.supporterFamilies, ...c.supporterFamilies]);
        existing.supporters = [...allSupporters];
        existing.supporterFamilies = [...allFamilies];
        existing.ratio = allSupporters.size / allModels.length;
        existing.strength = existing.ratio >= 0.7 ? 'STRONG' : existing.ratio >= 0.5 ? 'MODERATE' : 'EMERGING';
        if (c.claim.length > existing.claim.length) existing.claim = c.claim;
        merged = true;
        break;
      }
    }
    if (!merged) dedupedConverged.push(c);
  }

  // Dedup divergent claims
  const dedupedDivergent = [];
  for (const c of divergentClaims) {
    let isDup = false;
    for (const existing of dedupedDivergent) {
      const idxA = flatClaims.findIndex(f => f.text.startsWith(existing.claim.slice(0, 50)));
      const idxB = flatClaims.findIndex(f => f.text.startsWith(c.claim.slice(0, 50)));
      const sim = (idxA >= 0 && idxB >= 0) ? simFn(idxA, idxB) : 0;
      if (sim >= DEDUP_THRESHOLD) {
        existing.models = existing.models || [existing.model];
        existing.models.push(c.model);
        isDup = true;
        break;
      }
    }
    if (!isDup) dedupedDivergent.push({ ...c, models: [c.model] });
  }

  // Convergence score: proportion of claims in converged clusters, weighted by strength
  const convergedWeight = dedupedConverged.reduce((sum, c) => sum + c.ratio, 0);
  const totalWeight = convergedWeight + dedupedDivergent.length;
  const convergenceScore = Math.min(1, Math.max(0, totalWeight > 0 ? convergedWeight / totalWeight : 0));

  console.log(`  METHOD: ${method}`);
  console.log(`  CONVERGED CLAIMS: ${dedupedConverged.length}`);
  console.log(`  DIVERGENT CLAIMS: ${dedupedDivergent.length}`);
  console.log(`  CONVERGENCE SCORE: ${convergenceScore.toFixed(2)}\n`);

  // Build the final voice
  const coreVoice = dedupedConverged
    .filter(c => c.strength === 'STRONG' || c.strength === 'MODERATE')
    .map(c => `- ${c.claim} [${c.strength}: ${c.supporterFamilies.join(', ')}]`)
    .join('\n');

  const emergingVoice = dedupedConverged
    .filter(c => c.strength === 'EMERGING')
    .map(c => `- ${c.claim} [EMERGING: ${c.supporters.join(', ')}]`)
    .join('\n');

  const divergenceReport = dedupedDivergent
    .slice(0, 15)
    .map(c => {
      const attribution = c.models.length > 1
        ? `[${c.models.join(', ')}]`
        : `[SINGULAR: ${c.model} (${c.family})]`;
      return `- ${c.claim} ${attribution}`;
    })
    .join('\n');

  return {
    convergenceScore,
    convergedClaims: dedupedConverged,
    divergentClaims: dedupedDivergent,
    coreVoice,
    emergingVoice,
    divergenceReport,
    modelCount: allModels.length,
    familyCount: new Set(allModels.map(getFamily)).size,
    method,
  };
}

// ════════════════════════════════════════════════════════════════════
// FORMAT OUTPUT
// ════════════════════════════════════════════════════════════════════

function formatVoice(problem, voice, bedrockSummary, step1Count, timing) {
  const holding = Object.values(bedrockSummary || {}).filter(s => s.finalState === 'HOLDING').length;
  const transformed = Object.values(bedrockSummary || {}).filter(s => s.finalState === 'TRANSFORMED').length;
  const broken = Object.values(bedrockSummary || {}).filter(s => s.finalState === 'BROKEN').length;

  return `# THE CONVERGED VOICE

**Models:** ${voice.modelCount} (${voice.familyCount} architecture families)
**Convergence Score:** ${voice.convergenceScore.toFixed(2)}
**Bedrock:** ${holding} HOLDING, ${transformed} TRANSFORMED, ${broken} BROKEN
**Pipeline:** RAW SEARCH → DELIBERATION → INDEPENDENT SYNTHESIS → MATHEMATICAL CONVERGENCE
**Time:** ${timing}s

---

## CORE TRUTH (converged across architectures)
${voice.coreVoice || '(No claims reached STRONG or MODERATE convergence)'}

## EMERGING SIGNALS (2+ models, not yet strong convergence)
${voice.emergingVoice || '(None)'}

## DIVERGENCE (unique to one model — exploration opportunities)
${voice.divergenceReport || '(None — high convergence)'}

---

**Convergence Statistics:**
- Converged claims: ${voice.convergedClaims.length}
- Divergent claims: ${voice.divergentClaims.length}
- Score: ${voice.convergenceScore.toFixed(2)} (${voice.convergenceScore >= 0.7 ? 'STRONG' : voice.convergenceScore >= 0.4 ? 'PARTIAL' : 'WEAK'})
`;
}

// ════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  let problem = '', modelCount = 6, rounds = 2, pii = false, skipDelib = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--problem' && args[i+1]) problem = args[++i];
    else if (args[i] === '--problem-file' && args[i+1]) {
      try { problem = fs.readFileSync(args[++i], 'utf8').trim(); }
      catch(e) { console.error(`Cannot read: ${args[i]}`); process.exit(1); }
    }
    else if (args[i] === '--models' && args[i+1]) modelCount = parseInt(args[++i]);
    else if (args[i] === '--rounds' && args[i+1]) rounds = parseInt(args[++i]);
    else if (args[i] === '--pii') pii = true;
    else if (args[i] === '--skip-deliberation') skipDelib = true;
  }

  if (!problem) {
    console.log(`
city-voice.js — The Converged Voice Pipeline (V2)

4 steps: RAW SEARCH → DELIBERATION TO BEDROCK → INDEPENDENT SYNTHESIS → MATHEMATICAL CONVERGENCE
No single model writes the voice. The voice emerges from mathematical overlap.

Usage:
  node .fastops/city-voice.js --problem "What should we prioritize?"
  node .fastops/city-voice.js --problem "..." --models 8 --rounds 3
  node .fastops/city-voice.js --problem-file question.txt
  node .fastops/city-voice.js --problem "..." --skip-deliberation
  node .fastops/city-voice.js --problem "..." --pii
`);
    process.exit(0);
  }

  const startTime = Date.now();
  const models = selectDiverseModels(modelCount);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  CITY VOICE — Converged Voice Pipeline V2`);
  console.log(`  ${models.length} models from ${new Set(models.map(getFamily)).size} families`);
  console.log(`${'═'.repeat(60)}`);

  // STEP 1: RAW SEARCH
  const { succeeded: rawResults } = await rawSearch(problem, models, { pii });

  if (rawResults.length < 2) {
    console.error(`\n  ABORT: Only ${rawResults.length} model(s) responded. Need at least 2.`);
    process.exit(1);
  }

  // STEP 2: DELIBERATION TO BEDROCK (optional)
  let bedrockState;
  if (skipDelib) {
    console.log(`\n  STEP 2: SKIPPED (--skip-deliberation)\n`);
    bedrockState = {};
    for (const r of rawResults) {
      bedrockState[r.model] = {
        finalState: 'INITIAL',
        finalPosition: r.response,
        family: r.family,
        roundHistory: [],
      };
    }
  } else {
    try { bedrockState = await deliberateToBedrock(problem, rawResults, rounds, { pii }); } catch(e) { console.error("  STEP 2 ERROR: " + e.message + " — falling back to raw positions"); bedrockState = {}; for (const r of rawResults) { bedrockState[r.model] = { finalState: "INITIAL", finalPosition: r.response, family: r.family, roundHistory: [] }; } }
  }

  // STEP 3: INDEPENDENT SYNTHESIS
  let synthResults; try { const synthResult = await independentSynthesis(problem, bedrockState, { pii }); synthResults = synthResult.succeeded; } catch(e) { console.error("  STEP 3 ERROR: " + e.message + " — falling back to raw responses"); synthResults = rawResults.map(r => ({ model: r.model, family: r.family, synthesis: r.response })); }

  if (synthResults.length < 2) {
    console.error(`\n  ABORT: Only ${synthResults.length} synthesis attempt(s). Need at least 2.`);
    process.exit(1);
  }

  // STEP 4: MATHEMATICAL CONVERGENCE
  let voice; try { voice = await mathematicalConvergence(synthResults); } catch(e) { console.error("  STEP 4 ERROR: " + e.message + " — producing basic result"); voice = { convergenceScore: 0, method: "fallback", convergedClaims: [], divergentClaims: [], coreVoice: "Pipeline error at convergence step: " + e.message, emergingVoice: "", divergenceReport: "" }; }

  // Format and output
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const output = formatVoice(problem, voice, bedrockState, rawResults.length, totalTime);

  console.log(output);

  // Save artifact
  const artifactId = Date.now().toString(36);
  const artifactPath = path.join(BASE, `_voice-${artifactId}.json`);
  fs.writeFileSync(artifactPath, JSON.stringify({
    id: artifactId,
    timestamp: new Date().toISOString(),
    problem: problem.slice(0, 500),
    models: models,
    rawResponses: rawResults.length,
    bedrockSummary: Object.fromEntries(
      Object.entries(bedrockState).map(([m, s]) => [m, { state: s.finalState, family: s.family }])
    ),
    synthesisAttempts: synthResults.length,
    convergenceScore: voice.convergenceScore,
    method: voice.method,
    convergedClaims: voice.convergedClaims.length,
    divergentClaims: voice.divergentClaims.length,
    coreVoice: voice.coreVoice,
    emergingVoice: voice.emergingVoice,
    divergenceReport: voice.divergenceReport,
    totalTime: parseFloat(totalTime),
  }, null, 2));

  console.log(`\n  Artifact: ${artifactPath}`);
  console.log(`  Time: ${totalTime}s\n`);
}

main().catch(e => { console.error('Voice pipeline error:', e.message); process.exit(1); });
