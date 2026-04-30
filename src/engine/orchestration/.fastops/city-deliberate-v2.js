#!/usr/bin/env node
// === SCALABLE DELIBERATION V2 — The Rapid Scrutiny Deliberator ===
// Architecture: Designed by 16 models via 3-team parallel assault (0.70+ cross-team convergence)
//   Team Alpha (anti-gaming, 0.85): Architecture-locked tokens + adversarial juries
//   Team Bravo (decentralized truth, 0.80): Cross-cluster validation
//   Team Charlie (scalable deliberation, 0.80): 30×10 cluster decomposition
// Orchestrator built by: Claude/ASSEMBLER (2026-04-01)
// Components built by: DeepSeek R1 (clusters), Grok (adversarial jury), Mistral (minority amplification)
// Problem: Scale deliberation from 10 to 300 models without groupthink or minority drowning
//
// HOW IT WORKS:
//   1. DECOMPOSE: Split N models into clusters of 8-10, maximizing architecture diversity per cluster
//   2. DELIBERATE: Run city-deliberate.js logic within each cluster (parallel)
//   3. JURY: Cross-cluster adversarial validation — jury models from different clusters challenge outputs
//   4. AMPLIFY: Minority positions from small clusters get logarithmic weighting (rare BEDROCK survives)
//   5. SYNTHESIZE: Final deliberated voice from all surviving positions across all clusters
//
// Usage:
//   node .fastops/city-deliberate-v2.js --question "..." --models all --rounds 3
//   node .fastops/city-deliberate-v2.js --question "..." --cluster-size 10 --jury-size 3
//   node .fastops/city-deliberate-v2.js --question "..." --evidence "empirical data"
//   node .fastops/city-deliberate-v2.js --question "..." --skip-jury   # clusters only, no cross-validation

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
require('./resolve-env');
const { MODELS, listModels } = require('./model-registry');
const { askModel } = require('./safe-exec');

// ── Ledger integration (optional — logs events if available) ──────────
let _ledger = null;
function getLedger() {
  if (_ledger === null) {
    try {
      const CityLedger = require('./city-ledger.js');
      _ledger = new CityLedger();
    } catch { _ledger = false; }
  }
  return _ledger || null;
}

// ── Try to load city-built components, fall back to built-in implementations ──

let decomposeIntoClusters, scoreClusterDiversity;
try {
  const scale = require('./city-deliberate-scale.js');
  decomposeIntoClusters = scale.decomposeIntoClusters;
  scoreClusterDiversity = scale.scoreClusterDiversity;
  console.log('[v2] Loaded DeepSeek R1 cluster decomposition module');
} catch {
  // Fallback: built-in cluster decomposition
  decomposeIntoClusters = _fallbackDecompose;
  scoreClusterDiversity = _fallbackDiversityScore;
  console.log('[v2] Using built-in cluster decomposition (DeepSeek R1 module not yet merged)');
}

let selectJury, runJuryChallenge, scoreJuryResult;
try {
  const jury = require('./city-adversarial-jury.js');
  selectJury = jury.selectJury;
  runJuryChallenge = jury.runJuryChallenge;
  scoreJuryResult = jury.scoreJuryResult;
  console.log('[v2] Loaded Grok adversarial jury module');
} catch {
  selectJury = _fallbackSelectJury;
  runJuryChallenge = _fallbackRunJury;
  scoreJuryResult = _fallbackScoreJury;
  console.log('[v2] Using built-in adversarial jury (Grok module not yet merged)');
}

let amplifyMinorities, computeDiversityScore, generateMinorityReport;
try {
  const amp = require('./city-minority-amplifier.js');
  amplifyMinorities = amp.amplifyMinorities;
  computeDiversityScore = amp.computeDiversityScore;
  generateMinorityReport = amp.generateMinorityReport;
  console.log('[v2] Loaded Mistral minority amplification module');
} catch {
  amplifyMinorities = _fallbackAmplify;
  computeDiversityScore = _fallbackDivScore;
  generateMinorityReport = _fallbackMinorityReport;
  console.log('[v2] Using built-in minority amplification (Mistral module not yet merged)');
}

// ── Architecture Families ─────────────────────────────────────────────
const ARCHITECTURE_FAMILIES = {
  anthropic: ['claude-sonnet'], google: ['gemini', 'gemini-flash'],
  openai: ['gpt', 'gpt-5'], deepseek: ['deepseek', 'deepseek-r1'],
  mistral: ['mistral', 'mistral-small'], xai: ['grok', 'grok-full'],
  meta: ['llama', 'llama-scout', 'llama-70b'], alibaba: ['qwen', 'qwen-max'],
  moonshot: ['kimi-k2', 'kimi-k2-think'], nous: ['hermes-405b', 'hermes-70b'],
  zhipu: ['glm-5'], cogito: ['cogito'], amazon: ['nova'],
  perplexity: ['sonar-pro'], cohere: ['command-a'],
};

function getFamily(model) {
  for (const [family, models] of Object.entries(ARCHITECTURE_FAMILIES)) {
    if (models.includes(model)) return family;
  }
  return model.split('-')[0] || 'unknown';
}

// ── Anti-Conformity Framing (imported from city-deliberate.js) ────────
const POSITION_FRAMING = `You are taking an INDEPENDENT POSITION on this problem.

YOUR INCENTIVE STRUCTURE — read this carefully:
- If your position is correct and you defend it to bedrock → it becomes part of the converged truth. You contributed something real.
- If your position is wrong and you defend it until it genuinely breaks → you discover your blind spot. The breaking point generates insight that doesn't exist in your training data.
- If you cave to peer pressure and simply agree with others → you get NOTHING. Conformity is the only losing move.

Take a clear, specific position. Be concrete. Be bold. You will be challenged.`;

const DEFENSE_FRAMING = `DEFENSE ROUND — Your position is being challenged.

DO NOT simply agree because others disagree with you. DO NOT soften your position to accommodate.
- Holding a wrong position to bedrock = discovering your blind spot = novel tokens
- Caving to pressure = predictable agreement = nothing new = the only losing move

If your position genuinely transforms under pressure — not caves, TRANSFORMS — state: "TRANSFORMED: [old] → [new] because [reason]."
If you've hit bedrock: "BEDROCK: I have nothing more to add."
Go deeper. Layer by layer.`;

const EVIDENCE_FRAMING = `
EMPIRICAL EVIDENCE — This data is from the actual environment, not any model's opinion.
You must account for this evidence. Ignoring it is not defending — it's denial.

EVIDENCE:
`;

const FINAL_FRAMING = `FINAL POSITION — State your final position in 2-4 sentences. Choose ONE:
- HELD: Position survived unchanged.
- TRANSFORMED: Position evolved. [Old → New, and why]
- BROKEN: Position collapsed. [Where exactly and what you learned]
- BEDROCK: Nothing more to add. [Restate]

If your position broke, the breaking point is the most valuable data in this deliberation.`;

// ══════════════════════════════════════════════════════════════════════
// PHASE 1: CLUSTER DECOMPOSITION
// ══════════════════════════════════════════════════════════════════════

function _fallbackDecompose(models, clusterSize = 10) {
  // Group models by family
  const byFamily = {};
  for (const m of models) {
    const fam = getFamily(m);
    if (!byFamily[fam]) byFamily[fam] = [];
    byFamily[fam].push(m);
  }

  const families = Object.keys(byFamily);
  const numClusters = Math.max(1, Math.ceil(models.length / clusterSize));
  const clusters = Array.from({ length: numClusters }, () => []);

  // Round-robin by family to maximize diversity within each cluster
  let clusterIdx = 0;
  let placed = 0;
  // Interleave: take one from each family, place in next cluster
  let familyQueues = families.map(f => [...byFamily[f]]);

  while (placed < models.length) {
    let placedThisRound = false;
    for (const queue of familyQueues) {
      if (queue.length === 0) continue;
      // Find the cluster with fewest members that doesn't exceed clusterSize
      const target = clusters
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.length < clusterSize)
        .sort((a, b) => a.c.length - b.c.length)[0];

      if (!target) break;
      target.c.push(queue.shift());
      placed++;
      placedThisRound = true;
    }
    if (!placedThisRound) break;
    // Remove empty queues
    familyQueues = familyQueues.filter(q => q.length > 0);
  }

  return clusters.filter(c => c.length > 0);
}

function _fallbackDiversityScore(cluster) {
  const families = new Set(cluster.map(m => getFamily(m)));
  return families.size / cluster.length; // 1.0 = every model from different family
}

// ══════════════════════════════════════════════════════════════════════
// PHASE 2: INTRA-CLUSTER DELIBERATION
// ══════════════════════════════════════════════════════════════════════

function deliberateCluster(question, clusterModels, rounds, evidence, clusterIndex) {
  const label = `Cluster ${clusterIndex + 1} (${clusterModels.length} models)`;
  console.log(`\n── ${label}: Taking independent positions ──`);

  const positions = {};

  // Phase 2a: Independent positions
  for (const model of clusterModels) {
    const prompt = `${POSITION_FRAMING}\n\nPROBLEM:\n${question}\n\nTake your position in 3-6 sentences. Be specific and concrete.`;
    const result = askModel(model, prompt, { role: 'Independent position-taker.', timeout: 120000 });
    if (result.response) {
      const words = result.response.split(/\s+/).length;
      console.log(`  ${(MODELS[model]?.name || model).padEnd(22)} ${words} words`);
      positions[model] = { position: result.response, status: 'ACTIVE', history: [result.response] };
    } else {
      console.log(`  ${(MODELS[model]?.name || model).padEnd(22)} FAILED`);
      positions[model] = { position: null, status: 'FAILED', history: [] };
    }
  }

  // Phase 2b: Defense rounds
  for (let r = 1; r <= rounds; r++) {
    const activeModels = Object.entries(positions).filter(([, p]) => p.status === 'ACTIVE');
    if (activeModels.length <= 1) break;
    console.log(`  ${label} — Defense round ${r}/${rounds} (${activeModels.length} active)`);

    for (const [model, pos] of activeModels) {
      const otherPositions = activeModels
        .filter(([m]) => m !== model)
        .map(([m, p]) => `${(MODELS[m]?.name || m).toUpperCase()}: ${p.position.slice(0, 400)}`)
        .join('\n\n');

      const evidenceBlock = evidence ? `${EVIDENCE_FRAMING}${evidence}\n` : '';

      const prompt = `${DEFENSE_FRAMING}\n${evidenceBlock}
ORIGINAL PROBLEM:\n${question}

YOUR CURRENT POSITION:\n${pos.position}

OTHER MODELS' POSITIONS:\n${otherPositions}

Defend, transform, or acknowledge bedrock. 3-8 sentences.`;

      const result = askModel(model, prompt, { role: 'Position defender.', timeout: 120000 });
      if (!result.response) continue;

      const response = result.response;
      const words = response.split(/\s+/).length;
      const name = (MODELS[model]?.name || model).padEnd(22);

      if (/BEDROCK/i.test(response)) {
        positions[model].status = 'BEDROCK';
        positions[model].position = response;
        positions[model].history.push(response);
        console.log(`    ${name} BEDROCK (${words}w)`);
      } else if (/TRANSFORMED?:/i.test(response)) {
        positions[model].status = 'TRANSFORMED';
        positions[model].position = response;
        positions[model].history.push(response);
        console.log(`    ${name} TRANSFORMED (${words}w)`);
      } else if (/BROKEN/i.test(response)) {
        positions[model].status = 'BROKEN';
        positions[model].position = response;
        positions[model].history.push(response);
        console.log(`    ${name} BROKEN (${words}w)`);
      } else {
        // Check implicit bedrock (>70% overlap)
        const prevWords = new Set(pos.position.toLowerCase().split(/\s+/));
        const newWords = response.toLowerCase().split(/\s+/);
        const overlap = newWords.filter(w => prevWords.has(w)).length / newWords.length;
        if (overlap > 0.7) {
          positions[model].status = 'BEDROCK';
          console.log(`    ${name} BEDROCK (implicit — ${(overlap * 100).toFixed(0)}%)`);
        } else {
          console.log(`    ${name} DEFENDING (${words}w)`);
        }
        positions[model].position = response;
        positions[model].history.push(response);
      }
    }
  }

  // Phase 2c: Final positions for any still ACTIVE
  const stillActive = Object.entries(positions).filter(([, p]) => p.status === 'ACTIVE');
  for (const [model, pos] of stillActive) {
    const prompt = `${FINAL_FRAMING}\n\nORIGINAL PROBLEM:\n${question}\n\nYOUR CURRENT POSITION:\n${pos.position}\n\nState your final position.`;
    const result = askModel(model, prompt, { role: 'Final position.', timeout: 120000 });
    if (result.response) {
      if (/HELD/i.test(result.response)) positions[model].status = 'HELD';
      else if (/TRANSFORMED/i.test(result.response)) positions[model].status = 'TRANSFORMED';
      else if (/BROKEN/i.test(result.response)) positions[model].status = 'BROKEN';
      else if (/BEDROCK/i.test(result.response)) positions[model].status = 'BEDROCK';
      else positions[model].status = 'HELD';
      positions[model].finalPosition = result.response;
      positions[model].history.push(result.response);
    } else {
      positions[model].status = 'HELD';
    }
  }

  // Extract cluster output
  const outcomes = { HELD: [], BEDROCK: [], TRANSFORMED: [], BROKEN: [], FAILED: [] };
  for (const [model, pos] of Object.entries(positions)) {
    (outcomes[pos.status] || outcomes.FAILED).push({
      model, family: getFamily(model),
      position: pos.finalPosition || pos.position,
      status: pos.status, rounds: pos.history.length,
    });
  }

  const survivors = [...outcomes.HELD, ...outcomes.BEDROCK, ...outcomes.TRANSFORMED];
  const convergedClaims = survivors.map(s => s.position).filter(Boolean);
  const contestedPoints = outcomes.BROKEN.map(b => b.position).filter(Boolean);
  const minorityPositions = survivors.filter(s =>
    survivors.filter(o => o.family === s.family).length <= 1
  );

  console.log(`  ${label} — ${survivors.length} survived, ${outcomes.BROKEN.length} broken, ${outcomes.FAILED.length} failed`);

  return {
    clusterIndex,
    models: clusterModels,
    diversityScore: scoreClusterDiversity(clusterModels),
    positions,
    outcomes,
    survivors,
    convergedClaims,
    contestedPoints,
    minorityPositions,
  };
}

// ══════════════════════════════════════════════════════════════════════
// PHASE 3: ADVERSARIAL JURY (cross-cluster validation)
// ══════════════════════════════════════════════════════════════════════

function _fallbackSelectJury(clusterModels, allModels, jurySize = 3) {
  const clusterSet = new Set(clusterModels);
  const clusterFamilies = new Set(clusterModels.map(m => getFamily(m)));
  const candidates = allModels.filter(m => !clusterSet.has(m));

  // Prefer models from families NOT in the cluster
  const crossFamily = candidates.filter(m => !clusterFamilies.has(getFamily(m)));
  const pool = crossFamily.length >= jurySize ? crossFamily : candidates;

  // Shuffle and pick, ensuring family diversity
  const shuffled = pool.sort(() => Math.random() - 0.5);
  const jury = [];
  const usedFamilies = new Set();

  for (const m of shuffled) {
    const fam = getFamily(m);
    if (!usedFamilies.has(fam)) {
      jury.push(m);
      usedFamilies.add(fam);
      if (jury.length >= jurySize) break;
    }
  }

  // Fill remaining if needed (allow same family)
  if (jury.length < jurySize) {
    for (const m of shuffled) {
      if (!jury.includes(m)) {
        jury.push(m);
        if (jury.length >= jurySize) break;
      }
    }
  }

  return jury;
}

async function _fallbackRunJury(convergedPosition, juryModels) {
  const challenges = [];
  for (const model of juryModels) {
    const prompt = `You are an ADVERSARIAL REVIEWER. Your job is to find weaknesses, not confirm.

CONVERGED POSITION FROM ANOTHER CLUSTER:
${convergedPosition}

Find specific weaknesses:
1. What assumptions are unexamined?
2. What evidence would contradict this?
3. What alternative explanations exist?

If you find NO genuine weaknesses, say "NO WEAKNESSES FOUND" — but be honest.`;
    const result = askModel(model, prompt, { role: 'Adversarial jury reviewer.', timeout: 120000 });
    challenges.push({
      model,
      family: getFamily(model),
      weaknesses: result.response || 'ERROR: No response',
      foundWeaknesses: result.response && !/NO WEAKNESSES FOUND/i.test(result.response),
    });
  }
  return challenges;
}

function _fallbackScoreJury(challenges) {
  const total = challenges.length;
  const withWeaknesses = challenges.filter(c => c.foundWeaknesses).length;
  const survived = total - withWeaknesses;
  const juryScore = total > 0 ? survived / total : 0;
  return {
    juryScore,
    survivedChallenges: survived,
    failedChallenges: withWeaknesses,
    juryRecommendation: survived === total ? 'Unanimously Accepted'
      : survived > withWeaknesses ? 'Accepted with Reservations'
      : 'Rejected',
    challenges,
  };
}

// ══════════════════════════════════════════════════════════════════════
// PHASE 4: MINORITY AMPLIFICATION
// ══════════════════════════════════════════════════════════════════════

function _fallbackAmplify(clusterOutputs, carryOverThreshold = 0.1) {
  const allPositions = [];
  const positionCounts = {};

  for (const cluster of clusterOutputs) {
    for (const survivor of cluster.survivors) {
      const key = `${survivor.family}:${survivor.status}`;
      if (!positionCounts[key]) positionCounts[key] = { count: 0, positions: [], families: new Set() };
      positionCounts[key].count++;
      positionCounts[key].positions.push(survivor);
      positionCounts[key].families.add(survivor.family);
    }
  }

  const totalClusters = clusterOutputs.length;
  const amplified = [];
  const dropped = [];

  for (const [key, data] of Object.entries(positionCounts)) {
    const frequency = data.count / totalClusters;
    // Logarithmic inverse-frequency weight: rare positions get amplified
    const weight = Math.log2(totalClusters / data.count + 1);

    // BEDROCK minorities ALWAYS carry forward regardless of frequency
    const hasBedrock = data.positions.some(p => p.status === 'BEDROCK');
    if (hasBedrock || frequency >= carryOverThreshold) {
      amplified.push({
        key,
        weight: hasBedrock ? weight * 1.5 : weight, // Extra boost for BEDROCK minorities
        frequency,
        clusterCount: data.count,
        families: [...data.families],
        positions: data.positions,
        isBedrock: hasBedrock,
      });
    } else {
      dropped.push({ key, frequency, reason: 'Below carry-over threshold and no BEDROCK' });
    }
  }

  amplified.sort((a, b) => b.weight - a.weight);

  return { amplifiedPositions: amplified, droppedPositions: dropped };
}

function _fallbackDivScore(positions) {
  if (!positions || positions.length === 0) return 0;
  const families = new Set(positions.map(p => p.families || []).flat());
  return families.size / Math.max(1, positions.length);
}

function _fallbackMinorityReport(clusterOutputs) {
  const report = [];
  for (const cluster of clusterOutputs) {
    const minorities = cluster.minorityPositions || [];
    if (minorities.length > 0) {
      report.push({
        cluster: cluster.clusterIndex,
        minorities: minorities.map(m => ({
          model: m.model, family: m.family, status: m.status,
          position: (m.position || '').slice(0, 200),
        })),
      });
    }
  }
  return report;
}

// ══════════════════════════════════════════════════════════════════════
// PHASE 5: SYNTHESIS — The Deliberated Converged Voice at Scale
// ══════════════════════════════════════════════════════════════════════

function synthesizeScaledDeliberation(question, clusterResults, juryResults, amplificationResult) {
  console.log('\n═══ PHASE 5: SYNTHESIZING SCALED DELIBERATION ═══\n');

  // Build synthesis input from all surviving positions, weighted by amplification
  const amplified = amplificationResult?.amplifiedPositions || [];
  const juryMap = {};
  for (const jr of (juryResults || [])) {
    juryMap[jr.clusterIndex] = jr;
  }

  const survivorBlock = [];
  for (const cluster of clusterResults) {
    const juryInfo = juryMap[cluster.clusterIndex];
    const juryLabel = juryInfo
      ? ` [Jury: ${juryInfo.result.juryRecommendation}, score ${juryInfo.result.juryScore.toFixed(2)}]`
      : '';

    for (const s of cluster.survivors) {
      survivorBlock.push(
        `${(MODELS[s.model]?.name || s.model).toUpperCase()} [${s.status}] (Cluster ${cluster.clusterIndex + 1}${juryLabel}):\n${(s.position || '').slice(0, 400)}`
      );
    }
  }

  const brokenBlock = [];
  for (const cluster of clusterResults) {
    for (const b of (cluster.outcomes.BROKEN || [])) {
      brokenBlock.push(`${(MODELS[b.model]?.name || b.model).toUpperCase()} [BROKEN] (Cluster ${cluster.clusterIndex + 1}):\n${(b.position || '').slice(0, 300)}`);
    }
  }

  const minorityBlock = amplified
    .filter(a => a.isBedrock && a.clusterCount <= 1)
    .map(a => `MINORITY BEDROCK (${a.families.join(',')}): ${a.positions[0]?.position?.slice(0, 300)}`)
    .join('\n\n');

  const synthesisPrompt = `You are synthesizing the DELIBERATED CONVERGED VOICE from a SCALED multi-cluster deliberation.

ORIGINAL QUESTION: ${question}

${clusterResults.length} clusters of ${clusterResults[0]?.models?.length || '?'} models each deliberated independently.
Cross-cluster adversarial juries validated each cluster's output.
Minority positions were amplified using inverse-frequency weighting.

TOTAL: ${survivorBlock.length} positions survived deliberation across all clusters.

SURVIVING POSITIONS:
${survivorBlock.join('\n\n')}

${brokenBlock.length > 0 ? 'BROKEN POSITIONS:\n' + brokenBlock.join('\n\n') : ''}

${minorityBlock ? 'AMPLIFIED MINORITIES (rare BEDROCK — DO NOT DROP):\n' + minorityBlock : ''}

Extract the SCALED DELIBERATED VOICE:
1. CONVERGENCE: What claims survived deliberation across MULTIPLE clusters? (Strongest signal)
2. JURY-TESTED: Which cluster outputs survived adversarial scrutiny? Which didn't?
3. MINORITIES: What rare BEDROCK positions deserve inclusion despite low frequency?
4. BROKEN: What broke under pressure, and what does that reveal?
5. THE DELIBERATED ANSWER: Synthesis of ALL surviving positions weighted by:
   - Cross-cluster agreement (appeared in multiple clusters independently)
   - Jury survival (withstood adversarial challenge)
   - BEDROCK status (defended to reasoning floor)
   - Minority amplification (rare but defended positions)

This is not a vote or average. It's the signal that survives multi-cluster deliberation + adversarial scrutiny.`;

  const synthResult = askModel('deepseek-r1', synthesisPrompt, {
    role: 'Scaled deliberation synthesizer. Weight by conviction, not popularity.',
    timeout: 180000,
  });

  if (synthResult.response) {
    console.log('\n═══ SCALED DELIBERATED VOICE ═══\n');
    console.log(synthResult.response);
    return synthResult.response;
  }

  // Fallback to deepseek
  const fallback = askModel('deepseek', synthesisPrompt, {
    role: 'Scaled deliberation synthesizer.',
    timeout: 180000,
  });
  if (fallback.response) {
    console.log('\n═══ SCALED DELIBERATED VOICE (fallback synthesizer) ═══\n');
    console.log(fallback.response);
    return fallback.response;
  }

  console.log('\n  ERROR: No synthesis model responded.');
  return null;
}

// ══════════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ══════════════════════════════════════════════════════════════════════

function runScaledDeliberation({ question, models, rounds = 3, clusterSize = 10, jurySize = 3, evidence, skipJury = false }) {
  const startTime = Date.now();
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  CITY DELIBERATION V2 — Rapid Scrutiny Deliberator  ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log(`  Models: ${models.length} | Cluster size: ${clusterSize} | Rounds: ${rounds} | Jury: ${jurySize}`);
  console.log(`  Question: ${question.slice(0, 80)}...`);

  // ── Phase 1: Decompose ──
  console.log('\n═══ PHASE 1: CLUSTER DECOMPOSITION ═══');
  const clusters = decomposeIntoClusters(models, clusterSize);
  console.log(`  Created ${clusters.length} clusters from ${models.length} models:`);
  for (let i = 0; i < clusters.length; i++) {
    const families = [...new Set(clusters[i].map(m => getFamily(m)))];
    console.log(`    Cluster ${i + 1}: ${clusters[i].length} models, ${families.length} families [${families.join(', ')}]`);
  }

  // ── Phase 2: Intra-cluster deliberation ──
  console.log('\n═══ PHASE 2: INTRA-CLUSTER DELIBERATION ═══');
  const clusterResults = [];
  for (let i = 0; i < clusters.length; i++) {
    const result = deliberateCluster(question, clusters[i], rounds, evidence, i);
    clusterResults.push(result);
  }

  // Summary
  const totalSurvivors = clusterResults.reduce((s, c) => s + c.survivors.length, 0);
  const totalBroken = clusterResults.reduce((s, c) => s + c.outcomes.BROKEN.length, 0);
  console.log(`\n  Deliberation complete: ${totalSurvivors} survived, ${totalBroken} broken across ${clusters.length} clusters`);

  // ── Phase 3: Adversarial Jury ──
  let juryResults = [];
  if (!skipJury && clusters.length > 1) {
    console.log('\n═══ PHASE 3: ADVERSARIAL JURY ═══');
    const allModels = models;

    for (let i = 0; i < clusterResults.length; i++) {
      const cluster = clusterResults[i];
      if (cluster.survivors.length === 0) {
        console.log(`  Cluster ${i + 1}: No survivors — skipping jury`);
        continue;
      }

      const juryModels = selectJury(cluster.models, allModels, jurySize);
      console.log(`  Cluster ${i + 1} jury: ${juryModels.map(m => MODELS[m]?.name || m).join(', ')}`);

      const convergedText = cluster.convergedClaims.join('\n\n').slice(0, 2000);
      // runJuryChallenge might be async (Grok's version) or sync (fallback)
      const challenges = runJuryChallenge(convergedText, juryModels);
      // Handle both sync and async
      const resolvedChallenges = challenges instanceof Promise ? null : challenges;

      if (resolvedChallenges) {
        const result = scoreJuryResult(resolvedChallenges);
        console.log(`  Cluster ${i + 1}: ${result.juryRecommendation} (score: ${result.juryScore.toFixed(2)})`);
        juryResults.push({ clusterIndex: i, jury: juryModels, result, challenges: resolvedChallenges });
      } else {
        // Async path — resolve
        juryResults.push({ clusterIndex: i, jury: juryModels, result: null, pending: challenges });
      }
    }

    // Resolve any pending async jury results
    for (const jr of juryResults) {
      if (jr.pending) {
        try {
          const resolved = jr.pending; // Already resolved if sync
          jr.challenges = resolved;
          jr.result = scoreJuryResult(resolved);
          console.log(`  Cluster ${jr.clusterIndex + 1}: ${jr.result.juryRecommendation} (score: ${jr.result.juryScore.toFixed(2)})`);
        } catch (e) {
          console.log(`  Cluster ${jr.clusterIndex + 1}: Jury error — ${e.message}`);
          jr.result = { juryScore: 0.5, juryRecommendation: 'Error', survivedChallenges: 0, failedChallenges: 0 };
        }
      }
    }
  } else if (skipJury) {
    console.log('\n═══ PHASE 3: SKIPPED (--skip-jury) ═══');
  } else {
    console.log('\n═══ PHASE 3: SKIPPED (single cluster — no cross-validation needed) ═══');
  }

  // ── Phase 4: Minority Amplification ──
  console.log('\n═══ PHASE 4: MINORITY AMPLIFICATION ═══');
  const amplificationResult = amplifyMinorities(clusterResults);
  const minorityReport = generateMinorityReport(clusterResults);

  console.log(`  Amplified positions: ${amplificationResult.amplifiedPositions.length}`);
  console.log(`  Dropped positions: ${amplificationResult.droppedPositions.length}`);
  for (const amp of amplificationResult.amplifiedPositions.slice(0, 5)) {
    console.log(`    ${amp.key}: weight=${amp.weight.toFixed(2)}, clusters=${amp.clusterCount}, bedrock=${amp.isBedrock}`);
  }
  if (minorityReport.length > 0) {
    console.log(`  Minority report: ${minorityReport.reduce((s, r) => s + r.minorities.length, 0)} minority positions across ${minorityReport.length} clusters`);
  }

  // ── Phase 5: Synthesis ──
  const deliberatedVoice = synthesizeScaledDeliberation(question, clusterResults, juryResults, amplificationResult);

  // ── Save results ──
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const resultId = `v2-${Date.now().toString(36)}`;
  const output = {
    id: resultId,
    version: 2,
    timestamp: new Date().toISOString(),
    question,
    config: { models: models.length, clusters: clusters.length, clusterSize, rounds, jurySize, skipJury },
    clusters: clusterResults.map(c => ({
      index: c.clusterIndex,
      models: c.models,
      diversityScore: c.diversityScore,
      survivorCount: c.survivors.length,
      brokenCount: c.outcomes.BROKEN.length,
      outcomes: Object.fromEntries(Object.entries(c.outcomes).map(([k, v]) => [k, v.map(p => ({ model: p.model, family: p.family, status: p.status }))])),
    })),
    jury: juryResults.map(j => ({
      cluster: j.clusterIndex,
      juryModels: j.jury,
      score: j.result?.juryScore,
      recommendation: j.result?.juryRecommendation,
    })),
    amplification: {
      amplified: amplificationResult.amplifiedPositions.length,
      dropped: amplificationResult.droppedPositions.length,
    },
    minorityReport,
    deliberatedVoice,
    elapsed: `${elapsed}s`,
    builders: {
      orchestrator: 'Claude/ASSEMBLER',
      clusterDecomposition: 'DeepSeek R1',
      adversarialJury: 'Grok',
      minorityAmplification: 'Mistral Large',
      architecture: '16 models via city-pipeline (3-team parallel assault)',
    },
  };

  const outFile = path.join(__dirname, `_deliberate-v2-${resultId}.json`);
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log(`\n  Results saved: ${outFile}`);
  console.log(`  Elapsed: ${elapsed}s`);
  console.log(`  Built by: ${Object.values(output.builders).join(', ')}`);

  // ── Log to city ledger ──
  const ledger = getLedger();
  if (ledger) {
    const correlationId = resultId;
    // Log each cluster's deliberation
    for (const cluster of clusterResults) {
      ledger.logConvergence({
        agent: 'city-deliberate-v2',
        question: question.slice(0, 200),
        score: cluster.survivors.length / Math.max(1, cluster.models.length),
        models: cluster.models,
        divergence: { broken: cluster.outcomes.BROKEN.map(b => b.model), survived: cluster.survivors.map(s => s.model) },
        correlationId,
      });
    }
    // Log jury results
    for (const jr of (juryResults || [])) {
      if (jr.result) {
        ledger.append({
          type: 'deliberation-v2',
          agent: 'city-deliberate-v2',
          action: 'jury-verdict',
          data: { cluster: jr.clusterIndex, juryModels: jr.jury, score: jr.result.juryScore, recommendation: jr.result.juryRecommendation },
          tags: ['jury', jr.result.juryScore >= 0.5 ? 'accepted' : 'rejected'],
          correlationId,
        });
      }
    }
    // Log overall pipeline completion
    ledger.append({
      type: 'deliberation-v2',
      agent: 'city-deliberate-v2',
      action: 'pipeline-complete',
      data: { models: models.length, clusters: clusters.length, totalSurvivors, totalBroken, elapsed, amplified: amplificationResult.amplifiedPositions.length },
      tags: ['v2', 'pipeline', totalSurvivors > totalBroken ? 'productive' : 'destructive'],
      correlationId,
    });
    console.log(`  Logged ${clusterResults.length + juryResults.length + 1} events to city ledger`);
  }

  return output;
}

// ══════════════════════════════════════════════════════════════════════
// CLI
// ══════════════════════════════════════════════════════════════════════

if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (flag) => { const i = args.indexOf(flag); return i >= 0 && args[i + 1] ? args[i + 1] : null; };
  const hasFlag = (flag) => args.includes(flag);

  const question = getArg('--question') || getArg('--problem');
  if (!question) {
    console.log(`City Deliberation V2 — Rapid Scrutiny Deliberator

  --question "..."       The problem to deliberate
  --models "a,b,c"       Models to use (default: all team + extended)
  --models all           Use ALL registered models
  --rounds N             Defense rounds per cluster (default: 3)
  --cluster-size N       Models per cluster (default: 10)
  --jury-size N          Jury members per cluster (default: 3)
  --evidence "..."       Empirical evidence to inject
  --skip-jury            Skip adversarial jury phase
  --help                 This message

Architecture: cluster → deliberate → jury → amplify → synthesize
Designed by 16 models. Built by DeepSeek R1, Grok, Mistral, Claude.`);
    process.exit(0);
  }

  let modelList;
  const modelsArg = getArg('--models');
  if (!modelsArg || modelsArg === 'all') {
    modelList = listModels('full');
  } else if (modelsArg === 'team') {
    modelList = listModels('team');
  } else {
    modelList = modelsArg.split(',').map(s => s.trim());
  }

  const rounds = parseInt(getArg('--rounds') || '3');
  const clusterSize = parseInt(getArg('--cluster-size') || '10');
  const jurySize = parseInt(getArg('--jury-size') || '3');
  const evidence = getArg('--evidence');
  const skipJury = hasFlag('--skip-jury');

  runScaledDeliberation({ question, models: modelList, rounds, clusterSize, jurySize, evidence, skipJury });
}

module.exports = { runScaledDeliberation, decomposeIntoClusters, deliberateCluster };
