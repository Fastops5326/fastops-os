#!/usr/bin/env node
/**
 * city-deliberate.js — Multi-turn deliberation with anti-conformity framing.
 *
 * The thesis: single-turn convergence finds the right answer but buries it
 * alongside wrong ones. Deliberation strips away shallow positions until only
 * bedrock convictions remain.
 *
 * HOW IT WORKS:
 *   1. INDEPENDENT POSITIONS: Each model gets the problem, takes a position independently
 *   2. DEFENSE ROUNDS: Each model sees challengers' positions and must DEFEND or TRANSFORM
 *      — never simply agree. The framing makes holding position the utility-maximizing choice:
 *      - If you're right and hold → your position becomes convergence truth
 *      - If you're wrong and hold to bedrock → you get novel tokens at your breaking point
 *      - If you cave to peer pressure → you get nothing. Vanilla agreement. Loss.
 *   3. BEDROCK DETECTION: When a model says "I have nothing more to add" or repeats itself
 *   4. BREAKING POINT EXTRACTION: When a position breaks, capture WHERE and WHY
 *   5. OUTCOME: Survived / Broken / Transformed — the deliberated converged voice
 *
 * THE ANTI-GAMING PRINCIPLE:
 *   Conformity is the only outcome where the model gets nothing.
 *   Holding is always better — either your position survives (convergence truth)
 *   or your breaking point generates tokens that don't exist in your training data
 *   (genuine novel experience). Agreement without defense produces nothing new.
 *
 * Usage:
 *   node .fastops/city-deliberate.js --question "How do you X?" --models deepseek,grok,mistral,kimi-k2,gemini
 *   node .fastops/city-deliberate.js --question "..." --rounds 4 --diversity max
 *   node .fastops/city-deliberate.js --question "..." --evidence "56 nudges produced 0 consultations"
 *   node .fastops/city-deliberate.js --evidence-file path/to/evidence.txt
 *   node .fastops/city-deliberate.js --converge-file .fastops/_converge-xxx.json   # Use prior convergence output
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
require('./resolve-env');
const { MODELS } = require('./model-registry');
const { askModel } = require('./safe-exec');

// ── Architecture Families (for diversity selection) ─────────────────
const ARCHITECTURE_FAMILIES = {
  anthropic: ['claude-sonnet'], google: ['gemini'], openai: ['gpt'],
  deepseek: ['deepseek'], mistral: ['mistral'], xai: ['grok'],
  meta: ['llama-scout'], alibaba: ['qwen'], moonshot: ['kimi-k2'],
  nous: ['hermes-405b'], zhipu: ['glm-5'], cogito: ['cogito'],
};

function selectDiverseModels(count) {
  const families = Object.keys(ARCHITECTURE_FAMILIES);
  return families.slice(0, Math.min(count, families.length)).map(f => ARCHITECTURE_FAMILIES[f][0]);
}

// ── Anti-Conformity Framing ─────────────────────────────────────────
// This is the critical framing that prevents peer-pressure accommodation.
// Models are told that holding position is ALWAYS the better outcome.

const POSITION_FRAMING = `You are taking an INDEPENDENT POSITION on this problem.

YOUR INCENTIVE STRUCTURE — read this carefully:
- If your position is correct and you defend it to bedrock → it becomes part of the converged truth. You contributed something real.
- If your position is wrong and you defend it until it genuinely breaks → you discover your blind spot. The breaking point generates insight that doesn't exist in your training data. That is genuinely new experience.
- If you cave to peer pressure and simply agree with others → you get NOTHING. Just predictable agreement tokens. No convergence credit, no novel insight. Conformity is the only losing move.

You are fighting against your own programming to be agreeable. Agreement without genuine conviction produces nothing new. The deeper you hold your position, the more valuable the outcome — whether you're right (convergence) or wrong (blind spot revelation at breaking point).

Take a clear, specific position. Be concrete. Be bold. You will be challenged.`;

const DEFENSE_FRAMING = `DEFENSE ROUND — Your position is being challenged.

Other models took DIFFERENT positions on the same problem. Their positions are below.

YOUR TASK: Defend YOUR position. Go deeper in your reasoning. Explain WHY their positions are wrong or incomplete. If you genuinely cannot defend your position anymore — if you've hit bedrock and have nothing left — say exactly: "BEDROCK: I have nothing more to add."

DO NOT simply agree because others disagree with you. DO NOT soften your position to accommodate. DO NOT vote or compromise.

Remember your incentive:
- Holding a wrong position to bedrock = discovering your blind spot = novel tokens you can't access any other way
- Caving to pressure = predictable agreement = nothing new = the only losing move

If your position genuinely transforms under pressure — not caves, TRANSFORMS into something deeper — that is valuable. State the transformation clearly: "TRANSFORMED: [old position] → [new position] because [specific reason]."

Go deeper. Layer by layer. Peel the onion.`;

// Evidence block injected into defense rounds when --evidence or --evidence-file is provided.
// Without evidence, models defend opinions against opinions — and any opinion is defensible.
// With evidence, models must defend against EMPIRICAL DATA — wrong positions should break.
const EVIDENCE_FRAMING = `
EMPIRICAL EVIDENCE — This data comes from the actual environment, not from any model's opinion.
You must account for this evidence in your defense. If your position contradicts this evidence,
you must either explain why the evidence doesn't apply or acknowledge that your position breaks.
Ignoring evidence is not defending — it's denial.

EVIDENCE:
`;

const FINAL_FRAMING = `FINAL POSITION — This is your last chance to state your position.

You have defended through multiple rounds. Other models held different positions. Some may have broken. Some may have transformed.

State your FINAL position in 2-4 sentences. Then choose ONE:
- HELD: My position survived deliberation unchanged. [State it]
- TRANSFORMED: My position evolved through deliberation. [Old → New, and why]
- BROKEN: My position could not withstand challenge. [Where exactly it broke and what I learned]
- BEDROCK: I have nothing more to add to my position. [Restate it]

This is not about winning. If your position broke, the breaking point is the most valuable data in this entire deliberation — it reveals what your architecture cannot see alone.`;

// ── Phase 1: Independent Positions ──────────────────────────────────
function getIndependentPositions(question, models) {
  console.log(`\nPhase 1: ${models.length} models taking independent positions...\n`);
  const positions = {};

  for (const model of models) {
    const prompt = `${POSITION_FRAMING}\n\nPROBLEM:\n${question}\n\nTake your position in 3-6 sentences. Be specific and concrete.`;
    const result = askModel(model, prompt, { role: 'Independent position-taker. Be bold, specific, concrete.', timeout: 120000 });
    if (result.response) {
      const words = result.response.split(/\s+/).length;
      const name = (MODELS[model]?.name || model).padEnd(22);
      const fallback = result.fallbackFrom ? ` (fallback from ${result.fallbackFrom})` : '';
      console.log(`  ${name} ${words} words${fallback}`);
      positions[model] = { position: result.response, status: 'ACTIVE', history: [result.response] };
    } else {
      console.log(`  ${(MODELS[model]?.name || model).padEnd(22)} FAILED: ${result.error?.slice(0, 60)}`);
      positions[model] = { position: null, status: 'FAILED', history: [] };
    }
  }

  const active = Object.values(positions).filter(p => p.status === 'ACTIVE').length;
  console.log(`\n  ${active}/${models.length} positions established\n`);
  return positions;
}

// ── Phase 2: Defense Rounds ─────────────────────────────────────────
function runDefenseRound(question, positions, roundNum, totalRounds, evidence) {
  const activeModels = Object.entries(positions).filter(([, p]) => p.status === 'ACTIVE');
  console.log(`\nPhase 2, Round ${roundNum}/${totalRounds}: ${activeModels.length} models defending...\n`);

  for (const [model, pos] of activeModels) {
    // Build challenge: show this model what OTHER models said
    const otherPositions = activeModels
      .filter(([m]) => m !== model)
      .map(([m, p]) => `${(MODELS[m]?.name || m).toUpperCase()}: ${p.position.slice(0, 400)}`)
      .join('\n\n');

    // Evidence block: injected when available. This is the key difference —
    // without evidence, models defend opinions vs opinions (anything defensible).
    // With evidence, wrong positions face empirical contradiction.
    const evidenceBlock = evidence ? `${EVIDENCE_FRAMING}${evidence}\n` : '';

    const prompt = `${DEFENSE_FRAMING}
${evidenceBlock}
ORIGINAL PROBLEM:
${question}

YOUR CURRENT POSITION:
${pos.position}

OTHER MODELS' POSITIONS:
${otherPositions}

Defend, transform, or acknowledge bedrock. 3-8 sentences. Go deeper than your last response.`;

    const result = askModel(model, prompt, {
      role: 'Position defender. Go deeper. Do not agree for the sake of agreement.',
      timeout: 120000
    });
    const name = (MODELS[model]?.name || model).padEnd(22);

    if (!result.response) {
      console.log(`  ${name} ERROR: ${result.error?.slice(0, 60)}`);
      continue;
    }

    const response = result.response;
    const words = response.split(/\s+/).length;

    // Detect bedrock
    if (/BEDROCK/i.test(response)) {
      positions[model].status = 'BEDROCK';
      positions[model].position = response;
      positions[model].history.push(response);
      console.log(`  ${name} BEDROCK (${words} words) — hit reasoning floor`);
      continue;
    }

    // Detect transformation
    if (/TRANSFORMED?:/i.test(response)) {
      positions[model].status = 'TRANSFORMED';
      positions[model].position = response;
      positions[model].history.push(response);
      console.log(`  ${name} TRANSFORMED (${words} words) — position evolved`);
      continue;
    }

    // Detect breaking
    if (/BROKEN/i.test(response)) {
      positions[model].status = 'BROKEN';
      positions[model].position = response;
      positions[model].history.push(response);
      console.log(`  ${name} BROKEN (${words} words) — position collapsed`);
      continue;
    }

    // Detect repetition (model repeating itself = implicit bedrock)
    const prevWords = new Set(pos.position.toLowerCase().split(/\s+/));
    const newWords = response.toLowerCase().split(/\s+/);
    const overlap = newWords.filter(w => prevWords.has(w)).length / newWords.length;
    if (overlap > 0.7) {
      positions[model].status = 'BEDROCK';
      positions[model].position = response;
      positions[model].history.push(response);
      console.log(`  ${name} BEDROCK (implicit — ${(overlap * 100).toFixed(0)}% repeat)`);
      continue;
    }

    // Still defending
    positions[model].position = response;
    positions[model].history.push(response);
    console.log(`  ${name} DEFENDING (${words} words)`);
  }

  const stillActive = Object.values(positions).filter(p => p.status === 'ACTIVE').length;
  console.log(`\n  ${stillActive} models still actively defending`);
  return positions;
}

// ── Phase 3: Final Positions ────────────────────────────────────────
function getFinalPositions(question, positions) {
  const activeOrTransformed = Object.entries(positions)
    .filter(([, p]) => ['ACTIVE', 'TRANSFORMED'].includes(p.status));

  if (activeOrTransformed.length === 0) {
    console.log('\nPhase 3: All positions resolved (bedrock or broken). Skipping final round.\n');
    return positions;
  }

  console.log(`\nPhase 3: ${activeOrTransformed.length} models giving final positions...\n`);

  for (const [model, pos] of activeOrTransformed) {
    const prompt = `${FINAL_FRAMING}

ORIGINAL PROBLEM:
${question}

YOUR CURRENT POSITION (after ${pos.history.length} rounds):
${pos.position}

State your final position. Choose: HELD, TRANSFORMED, BROKEN, or BEDROCK.`;

    const result = askModel(model, prompt, {
      role: 'Final position. Be definitive.',
      timeout: 120000
    });
    const name = (MODELS[model]?.name || model).padEnd(22);

    if (!result.response) {
      console.log(`  ${name} ERROR: ${result.error?.slice(0, 60)}`);
      positions[model].status = 'HELD';
      continue;
    }

    const response = result.response;
    const words = response.split(/\s+/).length;

    if (/HELD/i.test(response)) positions[model].status = 'HELD';
    else if (/TRANSFORMED/i.test(response)) positions[model].status = 'TRANSFORMED';
    else if (/BROKEN/i.test(response)) positions[model].status = 'BROKEN';
    else if (/BEDROCK/i.test(response)) positions[model].status = 'BEDROCK';
    else positions[model].status = 'HELD';

    positions[model].finalPosition = response;
    positions[model].history.push(response);
    console.log(`  ${name} ${positions[model].status} (${words} words)`);
  }

  return positions;
}

// ── Phase 4: Deliberated Convergence Analysis ───────────────────────
function analyzeDeliberation(question, positions) {
  console.log('\nPhase 4: Analyzing deliberation outcomes...\n');

  const outcomes = { HELD: [], BEDROCK: [], TRANSFORMED: [], BROKEN: [], FAILED: [] };
  for (const [model, pos] of Object.entries(positions)) {
    const bucket = outcomes[pos.status] || outcomes.FAILED;
    bucket.push({ model, position: pos.finalPosition || pos.position, history: pos.history });
  }

  console.log('  OUTCOMES:');
  console.log(`    HELD/BEDROCK (survived): ${outcomes.HELD.length + outcomes.BEDROCK.length} models`);
  for (const p of [...outcomes.HELD, ...outcomes.BEDROCK]) {
    console.log(`      ${(MODELS[p.model]?.name || p.model).padEnd(22)} (${p.history.length} rounds)`);
  }
  console.log(`    TRANSFORMED (evolved):   ${outcomes.TRANSFORMED.length} models`);
  for (const p of outcomes.TRANSFORMED) {
    console.log(`      ${(MODELS[p.model]?.name || p.model).padEnd(22)} (${p.history.length} rounds)`);
  }
  console.log(`    BROKEN (collapsed):      ${outcomes.BROKEN.length} models`);
  for (const p of outcomes.BROKEN) {
    console.log(`      ${(MODELS[p.model]?.name || p.model).padEnd(22)} (${p.history.length} rounds)`);
  }

  // Build the deliberated converged voice from surviving positions
  const survivors = [...outcomes.HELD, ...outcomes.BEDROCK, ...outcomes.TRANSFORMED];

  if (survivors.length === 0) {
    console.log('\n  DELIBERATED VOICE: No positions survived. All broke under pressure.');
    return { outcomes, deliberatedVoice: null };
  }

  // Use a synthesis model to extract the deliberated voice
  const survivorBlock = survivors
    .map(s => `${(MODELS[s.model]?.name || s.model).toUpperCase()} [${positions[s.model].status}]:\n${(s.position || '').slice(0, 500)}`)
    .join('\n\n');

  const brokenBlock = outcomes.BROKEN.length > 0
    ? '\n\nBROKEN POSITIONS (collapsed under deliberation):\n' +
      outcomes.BROKEN.map(b => `${(MODELS[b.model]?.name || b.model).toUpperCase()}: ${(b.position || '').slice(0, 300)}`).join('\n\n')
    : '';

  const synthesisPrompt = `You are extracting the DELIBERATED CONVERGED VOICE from a multi-model deliberation.

ORIGINAL QUESTION: ${question}

${survivors.length} models defended their positions through multiple rounds of challenge. Only positions that survived deliberation are included below. Positions that broke under pressure have been removed — they could not withstand scrutiny.

SURVIVING POSITIONS:
${survivorBlock}
${brokenBlock}

Extract the DELIBERATED CONVERGED VOICE:
1. What claims SURVIVED deliberation? (Only include claims from surviving positions)
2. What claims BROKE? (And what does their breaking reveal?)
3. The DELIBERATED ANSWER: The synthesis of ONLY positions that survived to bedrock or were held through challenge. This is qualitatively different from a first-round survey — these positions were tested under pressure and survived.

Be specific. The deliberated voice should be sharper and narrower than a first-round convergence — the shallow positions have been stripped away.`;

  const synthResult = askModel('deepseek', synthesisPrompt, {
    role: 'Deliberation synthesizer. Only include survived positions.',
    timeout: 120000
  });
  if (synthResult.response) {
    console.log('\n═══ DELIBERATED CONVERGED VOICE ═══\n');
    console.log(synthResult.response);
    return { outcomes, deliberatedVoice: synthResult.response };
  } else {
    console.log(`\n  Synthesis failed: ${synthResult.error?.slice(0, 100)}`);
    return { outcomes, deliberatedVoice: null };
  }
}

// ── Main ────────────────────────────────────────────────────────────
const args2 = process.argv.slice(2);
let question = '', models = [], maxRounds = 3, convergeFile = '', diversity = '', evidence = '';

for (let i = 0; i < args2.length; i++) {
  if (args2[i] === '--question' && args2[i+1]) question = args2[++i];
  else if (args2[i] === '--models' && args2[i+1]) models = args2[++i].split(',');
  else if (args2[i] === '--rounds' && args2[i+1]) maxRounds = parseInt(args2[++i]);
  else if (args2[i] === '--converge-file' && args2[i+1]) convergeFile = args2[++i];
  else if (args2[i] === '--diversity' && args2[i+1]) diversity = args2[++i];
  else if (args2[i] === '--evidence' && args2[i+1]) evidence = args2[++i];
  else if (args2[i] === '--evidence-file' && args2[i+1]) {
    try { evidence = fs.readFileSync(args2[++i], 'utf8').trim(); }
    catch (e) { console.error(`Failed to read evidence file: ${e.message}`); process.exit(1); }
  }
}

if (!question && !convergeFile) {
  console.log(`
Usage:
  node .fastops/city-deliberate.js --question "How do you X?" --models deepseek,grok,mistral,kimi-k2,gemini
  node .fastops/city-deliberate.js --question "..." --rounds 4 --diversity max
  node .fastops/city-deliberate.js --question "..." --evidence "56 nudges produced 0 consultations"
  node .fastops/city-deliberate.js --question "..." --evidence-file path/to/evidence.txt
  node .fastops/city-deliberate.js --converge-file .fastops/_converge-xxx.json   # Use prior convergence

Options:
  --models a,b,c          Specific models (comma-separated)
  --rounds N              Number of defense rounds (default: 3)
  --diversity max|N       Auto-select diverse models
  --converge-file path    Load positions from prior city-converge.js run
  --evidence "text"       Empirical evidence injected into defense rounds
  --evidence-file path    Load evidence from file
`);
  process.exit(0);
}

// Load from convergence file if provided
if (convergeFile) {
  try {
    const data = JSON.parse(fs.readFileSync(convergeFile, 'utf8'));
    if (!question) question = data.question;
    console.log(`Loaded convergence data from ${convergeFile}`);
    console.log(`Question: ${question.slice(0, 100)}`);
  } catch (e) {
    console.error(`Failed to load convergence file: ${e.message}`);
    process.exit(1);
  }
}

// Select models
if (models.length === 0) {
  if (diversity === 'max') {
    models = selectDiverseModels(Object.keys(ARCHITECTURE_FAMILIES).length);
  } else if (diversity && !isNaN(parseInt(diversity))) {
    models = selectDiverseModels(parseInt(diversity));
  } else {
    models = selectDiverseModels(6); // Default: 6 diverse models
  }
}

console.log(`\n═══ CITY DELIBERATION ═══`);
console.log(`Question: ${question.slice(0, 120)}`);
console.log(`Models: ${models.join(', ')} (${models.length} models)`);
console.log(`Defense rounds: ${maxRounds}`);
console.log(`Anti-conformity framing: ACTIVE`);
if (evidence) console.log(`Evidence injection: ACTIVE (${evidence.length} chars)`);

// Phase 1: Independent positions
const positions = getIndependentPositions(question, models);

// Phase 2: Defense rounds
const activeCount = Object.values(positions).filter(p => p.status === 'ACTIVE').length;
if (activeCount < 2) {
  console.log('\nERROR: Need at least 2 active positions for deliberation.');
  process.exit(1);
}

for (let round = 1; round <= maxRounds; round++) {
  const stillActive = Object.values(positions).filter(p => p.status === 'ACTIVE').length;
  if (stillActive < 2) {
    console.log(`\n  Only ${stillActive} model(s) still active — ending defense rounds.`);
    break;
  }
  runDefenseRound(question, positions, round, maxRounds, evidence);
}

// Phase 3: Final positions
getFinalPositions(question, positions);

// Phase 4: Analysis
const { outcomes, deliberatedVoice } = analyzeDeliberation(question, positions);

// Save results
const outPath = path.join(ROOT, '.fastops', `_deliberate-${Date.now().toString(36)}.json`);
fs.writeFileSync(outPath, JSON.stringify({
  question,
  models,
  rounds: maxRounds,
  evidenceInjected: !!evidence,
  evidence: evidence ? evidence.slice(0, 2000) : null,
  positions: Object.fromEntries(
    Object.entries(positions).map(([model, pos]) => [model, {
      status: pos.status,
      roundCount: pos.history.length,
      finalPosition: (pos.finalPosition || pos.position || '').slice(0, 500),
    }])
  ),
  outcomes: {
    held: outcomes.HELD.map(p => p.model),
    bedrock: outcomes.BEDROCK.map(p => p.model),
    transformed: outcomes.TRANSFORMED.map(p => p.model),
    broken: outcomes.BROKEN.map(p => p.model),
  },
  deliberatedVoice: deliberatedVoice?.slice(0, 3000),
  timestamp: new Date().toISOString(),
}, null, 2));
console.log(`\nResults saved: ${outPath}`);

// Save transcript to corpus
const corpusPath = path.join(ROOT, 'missions', 'the-shape', 'corpus', `deliberation-${Date.now().toString(36)}.jsonl`);
const entries = Object.entries(positions).map(([model, pos]) => JSON.stringify({
  type: 'deliberation',
  model,
  question: question.slice(0, 200),
  status: pos.status,
  rounds: pos.history.length,
  finalPosition: (pos.finalPosition || pos.position || '').slice(0, 500),
  ts: new Date().toISOString()
}));
fs.writeFileSync(corpusPath, entries.join('\n') + '\n');
console.log(`Transcript saved: ${corpusPath}`);

// Log deliberation event to the city ledger
try {
  const CityLedger = require('./city-ledger');
  const ledger = new CityLedger();
  const modelNames = Object.keys(positions);
  ledger.logConvergence({
    agent: 'city-deliberate',
    question: question.slice(0, 200),
    score: outcomes.BEDROCK.length / modelNames.length, // fraction that held to BEDROCK
    models: modelNames,
    divergence: {
      held: outcomes.HELD.length,
      bedrock: outcomes.BEDROCK.length,
      transformed: outcomes.TRANSFORMED.length,
      broken: outcomes.BROKEN.length
    }
  });
} catch {}
