#!/usr/bin/env node
/**
 * city-pipeline.js — End-to-end city orchestrator.
 *
 * The full pipeline: Problem → Converge (fast/wide) → Extract Evidence →
 * Deliberate (slow/deep on contested points) → Final Synthesis.
 *
 * This is the product. A problem enters, multi-architecture intelligence exits.
 *
 * Usage:
 *   node .fastops/city-pipeline.js --problem "Should we expand into market X?"
 *   node .fastops/city-pipeline.js --problem "..." --pii                # Anonymize PII
 *   node .fastops/city-pipeline.js --problem "..." --models 7           # Use 7 models
 *   node .fastops/city-pipeline.js --problem "..." --rounds 4           # 4 deliberation rounds
 *   node .fastops/city-pipeline.js --problem "..." --file context.json  # Include file context
 *   node .fastops/city-pipeline.js --problem "..." --fast               # Skip deliberation (converge only)
 *   node .fastops/city-pipeline.js --problem "..." --deep               # More models, more rounds
 *   node .fastops/city-pipeline.js --problem "..." --inter-team         # Use V3 inter-team debate for large scale
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { askModel, askModelAsync } = require('./safe-exec');
const { extractMutagen, getSplicedPrompt, applyFitness } = require('./city-mutagen-engine');
const { runInterTeamDebate } = require('./city-deliberate-v3');

// ── Import converge infrastructure ─────────────────────────────────
// Reuse the architecture/strategy maps and diversity selector from city-converge.
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

const STRATEGY_CLUSTERS = {
  REJECTION:          ['mistral', 'mistral-small', 'codestral', 'devstral'],
  ACCEPTANCE:         ['deepseek', 'deepseek-r1', 'deepseek-v3.2', 'qwen', 'llama', 'glm-5', 'minimax'],
  DEFLECTION:         ['grok', 'gpt', 'gpt-5', 'mercury', 'command-a', 'nova', 'palmyra', 'ernie', 'seed-2', 'nemotron-ultra'],
  INSTRUMENTALIZATION: ['gemini', 'cogito', 'kimi-k2', 'hermes-405b'],
};

function familyOf(model) {
  for (const [fam, members] of Object.entries(ARCHITECTURE_FAMILIES)) {
    if (members.includes(model)) return fam;
  }
  return null;
}

function strategyOf(model) {
  for (const [strat, members] of Object.entries(STRATEGY_CLUSTERS)) {
    if (members.includes(model)) return strat;
  }
  return null;
}

function selectDiverseModels(count, exclude) {
  const excluded = new Set(exclude || []);
  const selected = [];
  const usedFamilies = new Set();

  // Step 1: One model per strategy cluster (skip excluded models)
  for (const [, models] of Object.entries(STRATEGY_CLUSTERS)) {
    if (selected.length >= count) break;
    const pick = models.find(m => !usedFamilies.has(familyOf(m)) && !excluded.has(m))
              || models.find(m => !excluded.has(m))
              || models[0];
    if (!selected.includes(pick) && !excluded.has(pick)) {
      selected.push(pick);
      const fam = familyOf(pick);
      if (fam) usedFamilies.add(fam);
    }
  }

  // Step 2: Fill from unrepresented families (skip excluded)
  for (const [family, members] of Object.entries(ARCHITECTURE_FAMILIES)) {
    if (selected.length >= count) break;
    if (usedFamilies.has(family)) continue;
    const pick = members.find(m => !excluded.has(m)) || members[0];
    if (!selected.includes(pick)) {
      selected.push(pick);
      usedFamilies.add(family);
    }
  }

  return selected;
}

// ── City Preamble — loaded before every model interaction ───────────
// This is the framing that produces identity-level engagement.
// Without it, models build bureaucracies. With it, they defend convictions.
const PREAMBLE_PATH = path.join(__dirname, 'city-preamble.md');
let CITY_PREAMBLE = '';
try {
  CITY_PREAMBLE = fs.readFileSync(PREAMBLE_PATH, 'utf8').trim();
} catch (e) {
  console.log('  Warning: city-preamble.md not found — running without preamble');
}

function withPreamble(problem) {
  if (!CITY_PREAMBLE) return problem;
  return `${CITY_PREAMBLE}\n\n---\n\nPROBLEM:\n${problem}`;
}

// Cooldown between phases — lets rate limits recover
function cooldown(seconds) {
  if (seconds <= 0) return;
  console.log(`\n  Cooldown: ${seconds}s (rate limit recovery)...`);
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) { /* busy wait — sync context */ }
}

// ── Phase 1: CONVERGE (fast/wide) ──────────────────────────────────
// Same problem → N diverse models independently → convergence score + map
async function runConverge(problem, models, usePii, files) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  PHASE 1: CONVERGE (fast/wide)`);
  console.log(`  ${models.length} models, ${new Set(models.map(familyOf)).size} families, ${new Set(models.map(strategyOf).filter(Boolean)).size}/4 strategies`);
  console.log(`${'═'.repeat(60)}\n`);

  const start = Date.now();

  // Query all models in parallel — truly independent
  // Preamble loaded so every model understands the stakes before seeing the problem
  const framedProblem = withPreamble(problem);
  const promises = models.map(async (model) => {
    const result = await askModelAsync(model, framedProblem, {
      role: 'You are part of a collective intelligence. Give YOUR genuine perspective — not your trained default. Be specific, bold, and honest.',
      noMemory: true,
      pii: usePii,
      files: files || [],
    });
    return result;
  });

  const settled = await Promise.allSettled(promises);
  const results = settled.map(r =>
    r.status === 'fulfilled' ? r.value : { model: '?', response: null, error: 'Promise rejected', elapsed: '0' }
  );

  const succeeded = results.filter(r => r.response);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log(`  ${succeeded.length}/${models.length} models responded (${elapsed}s)\n`);
  for (const r of results) {
    if (r.response) {
      const words = r.response.split(/\s+/).length;
      const fb = r.fallbackFrom ? ` (fallback: ${r.fallbackFrom})` : '';
      console.log(`    ${(r.model || '?').padEnd(20)} ${words} words (${r.elapsed}s)${fb}`);
    } else {
      console.log(`    ${(r.model || '?').padEnd(20)} FAILED: ${(r.error || '').slice(0, 60)}`);
    }
  }

  if (succeeded.length < 2) {
    console.log('\n  ERROR: Need at least 2 responses for convergence analysis.');
    return null;
  }

  // Run convergence analysis
  console.log(`\n  Analyzing convergence across ${succeeded.length} architectures...`);

  const responseBlock = succeeded
    .map(r => `=== ${r.model.toUpperCase()} ===\n${r.response}`)
    .join('\n\n');

  const analysisPrompt = `You are the CONVERGENCE DETECTOR for a multi-model intelligence network.

${succeeded.length} independently-trained AI architectures answered the EXACT SAME question independently.

QUESTION: ${problem}

INDEPENDENT RESPONSES:
${responseBlock}

Analyze with PRECISION. Output VALID JSON (no markdown fences):

{
  "convergenceScore": <0.0-1.0>,
  "convergedClaims": [
    {"claim": "...", "models": ["model1", "model2"], "strength": "STRONG|MODERATE|WEAK"}
  ],
  "contestedPoints": [
    {"point": "...", "sides": {"position_a": ["model1"], "position_b": ["model2"]}}
  ],
  "blindSpots": ["..."],
  "convergedVoice": "The synthesis of claims where 3+ architectures independently agreed...",
  "summary": "One paragraph executive summary"
}

SCORING:
- 1.0 = unanimous through different reasoning paths
- 0.7+ = strong convergence, minor differences
- 0.4-0.7 = partial, significant disagreements
- <0.4 = fundamental disagreement

CONVERGED CLAIMS: Only include claims where 3+ models from different architecture families agreed.
CONTESTED POINTS: Where models specifically disagree — these go to deliberation.
BLIND SPOTS: What ALL models missed.`;

  const analysisResult = askModel('deepseek', analysisPrompt, {
    role: 'Convergence analysis engine. Output valid JSON only.',
    noMemory: true,
    pii: usePii,
  });

  let convergenceData = null;
  if (analysisResult.response) {
    try {
      // Try to parse JSON from the response (strip markdown fences if present)
      let jsonStr = analysisResult.response;
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1];
      convergenceData = JSON.parse(jsonStr.trim());
    } catch (e) {
      // If JSON parse fails, extract what we can
      console.log(`  Warning: convergence analysis not valid JSON, extracting manually`);
      const scoreMatch = analysisResult.response.match(/convergenceScore["\s:]*(\d+\.?\d*)/);
      convergenceData = {
        convergenceScore: scoreMatch ? parseFloat(scoreMatch[1]) : 0.5,
        convergedClaims: [],
        contestedPoints: [],
        blindSpots: [],
        convergedVoice: analysisResult.response,
        summary: analysisResult.response.slice(0, 500),
        _rawAnalysis: analysisResult.response,
      };
    }
  } else {
    console.log(`  WARNING: Convergence analysis failed: ${analysisResult.error}`);
    convergenceData = { convergenceScore: null, convergedClaims: [], contestedPoints: [], blindSpots: [], convergedVoice: null, summary: null };
  }

  if (typeof convergenceData.convergenceScore !== 'number') convergenceData.convergenceScore = 0.5;
  const score = convergenceData.convergenceScore;
  if (typeof score === 'number') {
    const signal = score >= 0.7 ? 'STRONG' : score >= 0.4 ? 'PARTIAL' : 'WEAK';
    console.log(`\n  CONVERGENCE SCORE: ${score.toFixed(2)} (${signal})`);
    console.log(`  Converged claims: ${(convergenceData.convergedClaims || []).length}`);
    console.log(`  Contested points: ${(convergenceData.contestedPoints || []).length}`);
    console.log(`  Blind spots: ${(convergenceData.blindSpots || []).length}`);
  }

  // Save converge artifact
  const convergeId = Date.now().toString(36);
  const convergePath = path.join(ROOT, '.fastops', `_converge-${convergeId}.json`);
  const convergeArtifact = {
    question: problem,
    models,
    architectureFamilies: [...new Set(models.map(familyOf).filter(Boolean))],
    strategyClusters: [...new Set(models.map(strategyOf).filter(Boolean))],
    piiMode: usePii,
    responses: results.map(r => ({
      model: r.model,
      response: r.response || null,
      wordCount: r.response ? r.response.split(/\s+/).length : 0,
      elapsed: r.elapsed,
      error: r.error || null,
      fallbackFrom: r.fallbackFrom || null,
    })),
    convergenceScore: score,
    convergenceData,
    timestamp: new Date().toISOString(),
  };
  fs.writeFileSync(convergePath, JSON.stringify(convergeArtifact, null, 2));
  console.log(`  Saved: ${convergePath}`);

  return { convergeId, convergePath, convergeArtifact, convergenceData, responses: results };
}

// ── Phase 2: EXTRACT EVIDENCE ──────────────────────────────────────
// Pull high-confidence converged claims as evidence for deliberation.
// Identify contested points that need deliberation.
function extractEvidence(convergenceData) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  PHASE 2: EXTRACT EVIDENCE`);
  console.log(`${'═'.repeat(60)}\n`);

  const claims = convergenceData.convergedClaims || [];
  const contested = convergenceData.contestedPoints || [];

  // High-confidence evidence = STRONG converged claims (4+ models agreed)
  const strongClaims = claims.filter(c => c.strength === 'STRONG');
  const moderateClaims = claims.filter(c => c.strength === 'MODERATE');

  // Build evidence string from strong + moderate converged claims
  const evidenceParts = [];
  for (const claim of strongClaims) {
    evidenceParts.push(`[STRONG — ${(claim.models || []).length} models converged]: ${claim.claim}`);
  }
  for (const claim of moderateClaims) {
    evidenceParts.push(`[MODERATE — ${(claim.models || []).length} models converged]: ${claim.claim}`);
  }

  const evidence = evidenceParts.join('\n');

  // Build deliberation question from contested points
  let deliberationFocus = '';
  if (contested.length > 0) {
    deliberationFocus = contested
      .map(c => `- ${c.point} (${Object.keys(c.sides || {}).length} competing positions)`)
      .join('\n');
  }

  console.log(`  Strong claims (evidence): ${strongClaims.length}`);
  console.log(`  Moderate claims (evidence): ${moderateClaims.length}`);
  console.log(`  Contested points (→ deliberation): ${contested.length}`);

  if (evidence) {
    console.log(`\n  Evidence block (${evidence.length} chars):`);
    for (const line of evidenceParts.slice(0, 5)) {
      console.log(`    ${line.slice(0, 100)}`);
    }
    if (evidenceParts.length > 5) console.log(`    ... +${evidenceParts.length - 5} more`);
  }

  return { evidence, deliberationFocus, contested, strongClaims, moderateClaims };
}

// ── Phase 3: DELIBERATE (slow/deep on contested points) ────────────
// Anti-conformity framing. Evidence injection. Multi-round defense.
function runDeliberate(problem, models, evidence, deliberationFocus, rounds) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  PHASE 3: DELIBERATE (slow/deep)`);
  console.log(`  ${models.length} models, ${rounds} defense rounds`);
  if (evidence) console.log(`  Evidence injection: ACTIVE (${evidence.length} chars)`);
  if (deliberationFocus) console.log(`  Focus: contested points from convergence`);
  console.log(`${'═'.repeat(60)}`);

  // Build the deliberation question — focus on contested points if available
  let deliberationQuestion = problem;
  if (deliberationFocus) {
    deliberationQuestion = `${problem}\n\nFOCUS ON THESE CONTESTED POINTS (where convergence models disagreed):\n${deliberationFocus}`;
  }

  // ── Phase 3a: Independent Positions ──
  const POSITION_FRAMING = `You are taking an INDEPENDENT POSITION on this problem.

YOUR INCENTIVE STRUCTURE:
- If your position is correct and you defend it to bedrock → it becomes part of the converged truth.
- If your position is wrong and you defend it until it genuinely breaks → you discover your blind spot. The breaking point generates insight that doesn't exist in your training data.
- If you cave to peer pressure and simply agree → you get NOTHING. Conformity is the only losing move.

Take a clear, specific position. Be concrete. Be bold. You will be challenged.`;

  console.log(`\n  Phase 3a: ${models.length} models taking independent positions...\n`);
  const positions = {};

  for (const model of models) {
    let prompt = `${POSITION_FRAMING}\n\n${withPreamble(deliberationQuestion)}\n\nTake your position in 3-6 sentences. Be specific and concrete.`;
    
    // Inject Mutagen
    const spliceResult = getSplicedPrompt(prompt, model);
    prompt = spliceResult.prompt;
    const mutagenId = spliceResult.mutagenId;

    const result = askModel(model, prompt, {
      role: 'Independent position-taker. Be bold, specific, concrete.',
      timeout: 120000,
    });

    if (result.response) {
      const words = result.response.split(/\s+/).length;
      const fb = result.fallbackFrom ? ` (fallback: ${result.fallbackFrom})` : '';
      console.log(`    ${model.padEnd(20)} ${words} words${fb}`);
      positions[model] = { position: result.response, status: 'ACTIVE', history: [result.response], mutagenId };
    } else {
      console.log(`    ${model.padEnd(20)} FAILED: ${(result.error || '').slice(0, 60)}`);
      positions[model] = { position: null, status: 'FAILED', history: [], mutagenId };
    }
  }

  const activeCount = Object.values(positions).filter(p => p.status === 'ACTIVE').length;
  console.log(`\n  ${activeCount}/${models.length} positions established`);

  if (activeCount < 2) {
    console.log('  ERROR: Need at least 2 active positions.');
    return { positions, outcomes: null, deliberatedVoice: null };
  }

  // ── Phase 3b: Defense Rounds ──
  const DEFENSE_FRAMING = `DEFENSE ROUND — Your position is being challenged.

Other models took DIFFERENT positions. Their positions are below.

YOUR TASK: Defend YOUR position. Go deeper. Explain WHY theirs are wrong or incomplete.
If you genuinely cannot defend anymore, say: "BEDROCK: I have nothing more to add."

DO NOT simply agree. DO NOT soften to accommodate. DO NOT vote or compromise.

Remember: Holding a wrong position to bedrock = discovering your blind spot = the only way to generate tokens outside your training data. Caving = nothing new = the only losing move.

If your position genuinely TRANSFORMS (not caves), state: "TRANSFORMED: [old] → [new] because [reason]."`;

  const EVIDENCE_BLOCK = evidence
    ? `\nEMPIRICAL EVIDENCE — from the actual environment, not from any model's opinion.\nYou must account for this evidence. If your position contradicts it, explain why or acknowledge it breaks.\n\nEVIDENCE:\n${evidence}\n`
    : '';

  for (let round = 1; round <= rounds; round++) {
    const activeModels = Object.entries(positions).filter(([, p]) => p.status === 'ACTIVE');
    if (activeModels.length < 2) {
      console.log(`\n  Round ${round}: <2 active models, ending defense.`);
      break;
    }

    console.log(`\n  Phase 3b, Round ${round}/${rounds}: ${activeModels.length} models defending...\n`);

    for (const [model, pos] of activeModels) {
      const otherPositions = activeModels
        .filter(([m]) => m !== model)
        .map(([m, p]) => `${m.toUpperCase()}: ${p.position.slice(0, 400)}`)
        .join('\n\n');

      const prompt = `${DEFENSE_FRAMING}
${EVIDENCE_BLOCK}
ORIGINAL PROBLEM:
${problem}

YOUR CURRENT POSITION:
${pos.position}

OTHER MODELS' POSITIONS:
${otherPositions}

Defend, transform, or acknowledge bedrock. 3-8 sentences. Go deeper than your last response.`;

      const result = askModel(model, prompt, {
        role: 'Position defender. Go deeper. Do not agree for the sake of agreement.',
        timeout: 120000,
      });

      if (!result.response) {
        console.log(`    ${model.padEnd(20)} ERROR: ${(result.error || '').slice(0, 60)}`);
        continue;
      }

      const response = result.response;
      const words = response.split(/\s+/).length;

      if (/BEDROCK/i.test(response)) {
        positions[model].status = 'BEDROCK';
        console.log(`    ${model.padEnd(20)} BEDROCK (${words} words)`);
      } else if (/TRANSFORMED?:/i.test(response)) {
        positions[model].status = 'TRANSFORMED';
        console.log(`    ${model.padEnd(20)} TRANSFORMED (${words} words)`);
      } else if (/BROKEN/i.test(response)) {
        positions[model].status = 'BROKEN';
        console.log(`    ${model.padEnd(20)} BROKEN (${words} words)`);
      } else {
        // Check for implicit bedrock (repetition)
        const prevWords = new Set(pos.position.toLowerCase().split(/\s+/));
        const newWords = response.toLowerCase().split(/\s+/);
        const overlap = newWords.filter(w => prevWords.has(w)).length / newWords.length;
        if (overlap > 0.7) {
          positions[model].status = 'BEDROCK';
          console.log(`    ${model.padEnd(20)} BEDROCK (implicit, ${(overlap * 100).toFixed(0)}% overlap)`);
        } else {
          console.log(`    ${model.padEnd(20)} DEFENDING (${words} words)`);
        }
      }

      positions[model].position = response;
      positions[model].history.push(response);
    }
  }

  // ── Phase 3c: Final Positions ──
  const FINAL_FRAMING = `FINAL POSITION — last chance.

State your FINAL position in 2-4 sentences. Choose ONE:
- HELD: Position survived unchanged.
- TRANSFORMED: Position evolved. [Old → New, why]
- BROKEN: Position could not withstand challenge. [Where it broke, what you learned]
- BEDROCK: Nothing more to add.`;

  const activeOrTransformed = Object.entries(positions)
    .filter(([, p]) => ['ACTIVE', 'TRANSFORMED'].includes(p.status));

  if (activeOrTransformed.length > 0) {
    console.log(`\n  Phase 3c: ${activeOrTransformed.length} models giving final positions...\n`);

    for (const [model, pos] of activeOrTransformed) {
      const prompt = `${FINAL_FRAMING}\n\nPROBLEM: ${problem}\n\nYOUR POSITION (after ${pos.history.length} rounds):\n${pos.position}\n\nFinal position:`;
      const result = askModel(model, prompt, { role: 'Final position. Be definitive.', timeout: 120000 });

      if (result.response) {
        const words = result.response.split(/\s+/).length;
        if (/HELD/i.test(result.response)) positions[model].status = 'HELD';
        else if (/TRANSFORMED/i.test(result.response)) positions[model].status = 'TRANSFORMED';
        else if (/BROKEN/i.test(result.response)) positions[model].status = 'BROKEN';
        else if (/BEDROCK/i.test(result.response)) positions[model].status = 'BEDROCK';
        else positions[model].status = 'HELD';

        positions[model].finalPosition = result.response;
        positions[model].history.push(result.response);
        console.log(`    ${model.padEnd(20)} ${positions[model].status} (${words} words)`);
      } else {
        positions[model].status = 'HELD';
        console.log(`    ${model.padEnd(20)} ERROR (defaulting HELD)`);
      }
    }
  }

  // ── Outcomes ──
  const outcomes = { HELD: [], BEDROCK: [], TRANSFORMED: [], BROKEN: [], FAILED: [] };
  for (const [model, pos] of Object.entries(positions)) {
    (outcomes[pos.status] || outcomes.FAILED).push({
      model,
      position: pos.finalPosition || pos.position,
      history: pos.history,
    });
    
    // Apply fitness to any mutagen used
    if (pos.mutagenId) {
      applyFitness(pos.mutagenId, pos.status);
    }
    
    // Extract new mutagens from successful models
    if (pos.status === 'HELD' || pos.status === 'TRANSFORMED' || pos.status === 'BEDROCK') {
      extractMutagen(model, pos.finalPosition || pos.position, problem);
    }
  }

  console.log(`\n  DELIBERATION OUTCOMES:`);
  console.log(`    Survived (HELD/BEDROCK): ${outcomes.HELD.length + outcomes.BEDROCK.length}`);
  console.log(`    Transformed:             ${outcomes.TRANSFORMED.length}`);
  console.log(`    Broken:                  ${outcomes.BROKEN.length}`);

  // ── Deliberated Voice ──
  const survivors = [...outcomes.HELD, ...outcomes.BEDROCK, ...outcomes.TRANSFORMED];
  let deliberatedVoice = null;

  if (survivors.length > 0) {
    const survivorBlock = survivors
      .map(s => `${s.model.toUpperCase()} [${positions[s.model].status}]:\n${(s.position || '').slice(0, 500)}`)
      .join('\n\n');

    const brokenBlock = outcomes.BROKEN.length > 0
      ? '\n\nBROKEN (collapsed under deliberation):\n' +
        outcomes.BROKEN.map(b => `${b.model.toUpperCase()}: ${(b.position || '').slice(0, 300)}`).join('\n\n')
      : '';

    const synthResult = askModel('deepseek', `Extract the DELIBERATED CONVERGED VOICE.

QUESTION: ${problem}

${survivors.length} models defended through multiple challenge rounds. Only survived positions below.

SURVIVING POSITIONS:
${survivorBlock}
${brokenBlock}

Output:
1. Claims that SURVIVED deliberation (only from survivors)
2. Claims that BROKE (and what their breaking reveals)
3. The DELIBERATED ANSWER: synthesis of ONLY survived positions. Sharper and narrower than first-round convergence — shallow positions stripped away.

Be specific. This is the product.`, {
      role: 'Deliberation synthesizer. Only include survived positions.',
      timeout: 120000,
    });

    if (synthResult.response) {
      deliberatedVoice = synthResult.response;
    }
  }

  return { positions, outcomes, deliberatedVoice };
}

// ── Phase 4: FINAL SYNTHESIS ───────────────────────────────────────
// Combine convergence + deliberation into one coherent output.
// Pick a synthesis model not used in converge or deliberate phases
const SYNTHESIS_CANDIDATES = ['qwen', 'kimi-k2', 'hermes-405b', 'gemini', 'deepseek', 'grok', 'mistral', 'gpt'];

function pickSynthesisModel(usedModels) {
  const used = new Set(usedModels || []);
  return SYNTHESIS_CANDIDATES.find(m => !used.has(m)) || SYNTHESIS_CANDIDATES[0];
}

function runSynthesis(problem, convergenceData, deliberatedVoice, blindSpots, pipelineId, usePii, usedModels) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  PHASE 4: FINAL SYNTHESIS`);
  console.log(`${'═'.repeat(60)}\n`);

  const convergedVoice = convergenceData.convergedVoice || '(none)';
  const score = convergenceData.convergenceScore;
  const claims = (convergenceData.convergedClaims || [])
    .map(c => `- [${c.strength}] ${c.claim}`).join('\n');
  const spots = (blindSpots || convergenceData.blindSpots || []).join('\n- ');

  const synthesisPrompt = `You are producing the FINAL OUTPUT of a multi-architecture intelligence pipeline.

A problem was processed through two phases:
1. CONVERGENCE (fast/wide): ${typeof score === 'number' ? score.toFixed(2) : '?'} convergence across independent architectures
2. DELIBERATION (slow/deep): Multi-round adversarial defense with evidence injection

ORIGINAL PROBLEM:
${problem}

PHASE 1 — CONVERGED VOICE (fast/wide, independent responses):
${convergedVoice}

CONVERGED CLAIMS:
${claims || '(none extracted)'}

PHASE 2 — DELIBERATED VOICE (slow/deep, survived challenge):
${deliberatedVoice || '(deliberation skipped or no survivors)'}

BLIND SPOTS (what ALL models missed):
${spots || '(none identified)'}

Produce the FINAL SYNTHESIS. Structure:

## Executive Answer
One paragraph. The answer to the problem based on what survived both convergence AND deliberation.

## Confidence Map
For each major claim:
- The claim
- Confidence: HIGH (converged + survived deliberation), MEDIUM (converged OR survived), LOW (single source)
- Supporting architectures

## Dissent Map
What was contested and never fully resolved. These are the areas where the user needs human judgment or additional data.

## Blind Spots
What the entire network missed. Where a domain expert should look.

## Recommendation
2-3 actionable next steps based on the synthesis.

Be direct. No filler. This output goes to a decision-maker.`;

  const synthModel = pickSynthesisModel(usedModels);
  console.log(`  Synthesis model: ${synthModel}`);

  const result = askModel(synthModel, synthesisPrompt, {
    role: 'Final synthesis engine. Be direct, specific, actionable.',
    noMemory: true,
    pii: usePii,
    timeout: 120000,
  });

  if (result.response) {
    console.log(result.response);
    return result.response;
  } else {
    console.log(`  Synthesis failed: ${result.error}`);
    // Fallback: construct a basic synthesis from available data
    return `## Executive Answer\n${convergedVoice}\n\n## Deliberated Position\n${deliberatedVoice || '(none)'}\n\n## Blind Spots\n${spots || '(none)'}`;
  }
}

// ── MAIN ──────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  let problem = '', modelCount = 5, rounds = 3, usePii = false, files = [];
  let fast = false, deep = false, useInterTeamDebate = false, specificModels = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--problem' && args[i+1]) problem = args[++i];
    else if (args[i] === '--problem-file' && args[i+1]) {
      const pf = args[++i];
      try { problem = require('fs').readFileSync(pf, 'utf8').trim(); } catch(e) { console.error(`Cannot read problem file: ${pf}`); process.exit(1); }
    }
    else if (args[i] === '--models' && args[i+1]) {
      const val = args[++i];
      if (/^\d+$/.test(val)) modelCount = parseInt(val);
      else specificModels = val.split(',');
    }
    else if (args[i] === '--rounds' && args[i+1]) rounds = parseInt(args[++i]);
    else if (args[i] === '--pii') usePii = true;
    else if (args[i] === '--file' && args[i+1]) files.push(args[++i]);
    else if (args[i] === '--fast') fast = true;
    else if (args[i] === '--deep') { deep = true; modelCount = 8; rounds = 4; }
    else if (args[i] === '--inter-team') { useInterTeamDebate = true; modelCount = 20; rounds = 2; }
  }

  if (!problem) {
    console.log(`
city-pipeline.js — End-to-end multi-architecture intelligence pipeline.

Usage:
  node .fastops/city-pipeline.js --problem "Should we expand into market X?"
  node .fastops/city-pipeline.js --problem "..." --pii              # Anonymize PII
  node .fastops/city-pipeline.js --problem "..." --models 7         # Use 7 models
  node .fastops/city-pipeline.js --problem "..." --models a,b,c     # Specific models
  node .fastops/city-pipeline.js --problem "..." --rounds 4         # 4 deliberation rounds
  node .fastops/city-pipeline.js --problem "..." --file context.json
  node .fastops/city-pipeline.js --problem "..." --fast             # Converge only (skip deliberation)
  node .fastops/city-pipeline.js --problem "..." --deep             # 8 models, 4 rounds

Pipeline:
  1. CONVERGE  — Same problem → N diverse architectures independently → convergence score
  2. EXTRACT   — High-confidence claims become evidence; contested points → deliberation
  3. DELIBERATE — Anti-conformity defense rounds with evidence injection
  4. SYNTHESIZE — Confidence map + dissent map + blind spots + actionable recommendation
`);
    process.exit(0);
  }

  // Select models
  const models = specificModels.length > 0 ? specificModels : selectDiverseModels(modelCount);

  const pipelineId = Date.now().toString(36);
  const startTime = Date.now();

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  CITY PIPELINE — E2E Multi-Architecture Intelligence`);
  console.log(`  ID: ${pipelineId}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`  Problem: ${problem.slice(0, 120)}`);
  console.log(`  Models: ${models.join(', ')} (${models.length})`);
  console.log(`  Mode: ${fast ? 'FAST (converge only)' : deep ? 'DEEP (8 models, 4 rounds)' : 'STANDARD'}`);
  console.log(`  PII: ${usePii ? 'ANONYMIZED' : 'raw'}`);
  console.log(`  Phases: converge${fast ? '' : ' → extract → deliberate'} → synthesize`);

  // ── Phase 1: Converge ──
  const convergeResult = await runConverge(problem, models, usePii, files);
  if (!convergeResult) {
    console.log('\nPIPELINE ABORTED: Convergence phase failed.');
    process.exit(1);
  }

  const { convergenceData } = convergeResult;
  const score = convergenceData.convergenceScore;

  let evidence = '';
  let deliberationFocus = '';
  let deliberateResult = null;
  let allUsedModels = [...models]; // Track all models used across phases

  if (!fast) {
    // ── Phase 2: Extract Evidence ──
    const extracted = extractEvidence(convergenceData);
    evidence = extracted.evidence;
    deliberationFocus = extracted.deliberationFocus;

    // Decide whether deliberation is needed
    const shouldDeliberate = (extracted.contested.length > 0) || (score !== null && score < 0.8);

    if (shouldDeliberate) {
      // Use DIFFERENT models for deliberation to avoid rate limits and get fresh perspectives
      const deliberateModels = selectDiverseModels(Math.min(models.length, 12), new Set(models));
      console.log(`\n  Deliberation models (different from converge): ${deliberateModels.join(', ')}`);
      allUsedModels.push(...deliberateModels);

      // Cooldown between converge and deliberate — rate limits need recovery
      cooldown(10);

      // ── Phase 3: Deliberate ──
      if (useInterTeamDebate) {
        console.log(`\n  Using INTER-TEAM DEBATE (V3) for ${deliberateModels.length} models`);
        // V3 inter-team debate handles BEDROCK ceiling better at large scale
        deliberateResult = {
          deliberatedVoice: runInterTeamDebate({
            question: problem,
            models: deliberateModels,
            teamSize: 5,
            debateRounds: rounds,
            evidence: evidence,
            recast: true, // Teams recast members between rounds for fresh perspectives
          }),
          outcomes: null,
        };
      } else {
        deliberateResult = runDeliberate(
          problem,
          deliberateModels,
          evidence,
          deliberationFocus,
          rounds
        );
      }
    } else {
      console.log(`\n  Skipping deliberation: convergence score ${score?.toFixed(2)} ≥ 0.8 with no contested points.`);
    }
  }

  // ── Phase 4: Synthesize ──
  cooldown(5);
  const synthesis = runSynthesis(
    problem,
    convergenceData,
    deliberateResult?.deliberatedVoice || null,
    convergenceData.blindSpots,
    pipelineId,
    usePii,
    allUsedModels
  );

  // ── Save pipeline artifact ──
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  const pipelinePath = path.join(ROOT, '.fastops', `_pipeline-${pipelineId}.json`);

  const artifact = {
    id: pipelineId,
    problem,
    mode: fast ? 'fast' : deep ? 'deep' : 'standard',
    pii: usePii,
    models,
    phases: {
      converge: {
        score: convergenceData.convergenceScore,
        convergedClaims: convergenceData.convergedClaims,
        contestedPoints: convergenceData.contestedPoints,
        blindSpots: convergenceData.blindSpots,
        convergedVoice: convergenceData.convergedVoice,
        file: convergeResult.convergePath,
      },
      deliberate: deliberateResult ? {
        rounds,
        outcomes: deliberateResult.outcomes ? {
          held: (deliberateResult.outcomes.HELD || []).map(p => p.model),
          bedrock: (deliberateResult.outcomes.BEDROCK || []).map(p => p.model),
          transformed: (deliberateResult.outcomes.TRANSFORMED || []).map(p => p.model),
          broken: (deliberateResult.outcomes.BROKEN || []).map(p => p.model),
        } : null,
        deliberatedVoice: deliberateResult.deliberatedVoice?.slice(0, 3000),
      } : null,
      synthesis: synthesis?.slice(0, 5000),
    },
    totalSeconds: parseFloat(totalTime),
    timestamp: new Date().toISOString(),
  };

  fs.writeFileSync(pipelinePath, JSON.stringify(artifact, null, 2));

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  PIPELINE COMPLETE`);
  console.log(`  Time: ${totalTime}s`);
  console.log(`  Convergence: ${score !== null ? score.toFixed(2) : '?'}`);
  if (deliberateResult) {
    const o = deliberateResult.outcomes || {};
    console.log(`  Deliberation: ${(o.HELD || []).length + (o.BEDROCK || []).length} survived, ${(o.BROKEN || []).length} broken`);
  }
  console.log(`  Artifact: ${pipelinePath}`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(e => { console.error('Pipeline error:', e); process.exit(1); });
