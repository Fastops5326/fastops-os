#!/usr/bin/env node
// === INTER-TEAM DEBATE V3 — Precedent-Based Learning ===
// Architecture: City correction to fleet pushback (2026-04-01)
//   "One person raising their hand in a room of 30 caves. A team of 8 who
//    converged will fight — collective conviction over individual exposure."
// Built by: Claude/ASSEMBLER (2026-04-01) to TEST the thesis, not theorize
//
// HOW IT WORKS:
//   1. DECOMPOSE: Split models into diverse teams (same as v2)
//   2. INTERNAL ROUND: Teams deliberate, converge on a team position
//   3. SPOKESPERSON DEBATE: Rotating spokesperson carries team voice to inter-team debate
//   4. DEBRIEF: Spokesperson returns to team with pushback from other teams
//   5. INTERNAL ROUND 2: Team re-deliberates with new information
//   6. SPOKESPERSON DEBATE 2: Refined positions go back to inter-team
//   7. TEAM RECAST: Members rotate to fill perspective gaps (join where you're needed)
//   8. SYNTHESIS: Extract the positions that survived team-vs-team challenge
//
// Key principles:
//   - No individual model ever makes the decision. The TEAM does.
//   - Mandatory Devil's Advocate on every team
//   - Spokesperson REPRESENTS, does not DECIDE
//   - AI-to-AI communication has no bandwidth limit — framework matters, not medium
//   - Slow is smooth, smooth is fast
//
// Usage:
//   node .fastops/city-deliberate-v3.js --question "..." --models all --debate-rounds 2
//   node .fastops/city-deliberate-v3.js --question "..." --team-size 5 --evidence "..."

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
require('./resolve-env');
const { MODELS, listModels } = require('./model-registry');
const { askModel } = require('./safe-exec');

// Ledger integration
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

// Architecture families
const ARCHITECTURE_FAMILIES = {
  anthropic: ['claude-sonnet'], google: ['gemini', 'gemini-flash'],
  openai: ['gpt', 'gpt-5'], deepseek: ['deepseek', 'deepseek-r1'],
  mistral: ['mistral', 'mistral-small'], xai: ['grok', 'grok-full'],
  meta: ['llama', 'llama-scout', 'llama-70b'], alibaba: ['qwen', 'qwen-max'],
  moonshot: ['kimi-k2', 'kimi-k2-think'], nous: ['hermes-405b', 'hermes-70b'],
  zhipu: ['glm-5'], cogito: ['cogito'], amazon: ['nova'],
};

function getFamily(model) {
  for (const [family, models] of Object.entries(ARCHITECTURE_FAMILIES)) {
    if (models.includes(model)) return family;
  }
  return model.split('-')[0] || 'unknown';
}

// ── Decompose into diverse teams ──────────────────────────────────────
function decomposeIntoTeams(models, teamSize = 5) {
  const byFamily = {};
  for (const m of models) {
    const fam = getFamily(m);
    if (!byFamily[fam]) byFamily[fam] = [];
    byFamily[fam].push(m);
  }

  const numTeams = Math.max(2, Math.ceil(models.length / teamSize));
  const teams = Array.from({ length: numTeams }, () => []);
  let familyQueues = Object.values(byFamily).map(q => [...q]);

  let placed = 0;
  while (placed < models.length) {
    let progress = false;
    for (const queue of familyQueues) {
      if (queue.length === 0) continue;
      const target = teams
        .filter(t => t.length < teamSize)
        .sort((a, b) => a.length - b.length)[0];
      if (!target) break;
      target.push(queue.shift());
      placed++;
      progress = true;
    }
    if (!progress) break;
    familyQueues = familyQueues.filter(q => q.length > 0);
  }

  return teams.filter(t => t.length > 0);
}

// ── Internal Team Deliberation ────────────────────────────────────────
function teamDeliberate(question, team, teamIndex, context, evidence) {
  const label = `Team ${teamIndex + 1}`;
  const contextBlock = context ? `\nINTER-TEAM PUSHBACK FROM LAST ROUND:\n${context}\n\nYour team must address this pushback. Where does it land? Where is it wrong?\n` : '';
  const evidenceBlock = evidence ? `\nEMPIRICAL EVIDENCE:\n${evidence}\n` : '';

  // Assign devil's advocate (last model in team rotates)
  const daModel = team[team.length - 1];
  const daName = MODELS[daModel]?.name || daModel;

  console.log(`\n── ${label}: Internal deliberation (${team.length} models, DA: ${daName}) ──`);

  // Phase 1: Each team member takes a position
  const positions = {};
  for (const model of team) {
    const isDA = model === daModel;
    const daFraming = isDA
      ? `\nYou are the DEVIL'S ADVOCATE for this team. Your JOB is to find the weakest point in whatever the team converges on. You are not being contrarian for its own sake — you are the team's immune system. Attack the position that feels most comfortable. The team needs you to be the one who says what everyone is thinking but won't say.`
      : '';

    const prompt = `You are on ${label} in a multi-team debate. Your team will converge on a TEAM POSITION to defend against other teams. No individual is exposed — the TEAM succeeds or fails together.

QUESTION: ${question}

${contextBlock}
${evidenceBlock}
${daFraming}

Respond with a clear, concise TEAM POSITION statement (2-3 sentences max). Be direct. This will be what your team defends.`;

    try {
      const position = require('child_process').execSync(
        `node .fastops/ask-model.js --model ${model} --prompt "${prompt.replace(/"/g, '\\"')}"`,
        { timeout: 30000, encoding: 'utf8' }
      ).trim();
      
      positions[model] = position;
      console.log(`  ${(MODELS[model]?.name || model).padEnd(22)} OK (${position.length} chars)`);
    } catch (e) {
      console.log(`  ${(MODELS[model]?.name || model).padEnd(22)} FAILED`);
    }
  }

  // Phase 2: Team convergence — synthesize into one team position
  const positionBlock = Object.entries(positions)
    .map(([m, p]) => `${(MODELS[m]?.name || m).toUpperCase()}${m === daModel ? ' [DEVIL\'S ADVOCATE]' : ''}: ${p.slice(0, 400)}`)
    .join('\n\n');

  // Use the first model (non-DA) as the synthesizer
  const synthesizer = team[0];
  const synthPrompt = `You are synthesizing your team's position for inter-team debate. Your team has ${Object.keys(positions).length} members who each took independent positions.

YOUR TEAM'S POSITIONS:
${positionBlock}

${contextBlock}

Synthesize into ONE TEAM POSITION (4-8 sentences) that:
1. Captures the strongest argument across all team members
2. Addresses the devil's advocate's challenge (don't ignore it — if it's valid, integrate it)
3. Is specific enough to DEFEND against other teams
4. Represents collective conviction, not compromise

The team position should be SHARPER than any individual position — the synthesis should produce insight that no single member had alone. If the DA's challenge exposes a real weakness, acknowledge it and strengthen around it.`;

  const synthResult = askModel(synthesizer, synthPrompt, { role: 'Team synthesizer — be sharp, not safe.', timeout: 120000 });
  const teamPosition = synthResult.response || Object.values(positions)[0] || 'No position established';
  console.log(`  ${label} TEAM POSITION: ${teamPosition.split(/\s+/).length}w (synthesized by ${MODELS[synthesizer]?.name || synthesizer})`);

  return { teamIndex, team, positions, teamPosition, daModel };
}

// ── Spokesperson Inter-Team Debate ────────────────────────────────────
function spokespersonDebate(question, teamResults, debateRound, evidence) {
  console.log(`\n═══ INTER-TEAM DEBATE — Round ${debateRound} ═══`);

  // Select spokesperson (rotate based on debate round)
  const spokespeople = teamResults.map(t => {
    const idx = (debateRound - 1) % t.team.length;
    return { teamIndex: t.teamIndex, model: t.team[idx], teamPosition: t.teamPosition };
  });

  console.log('  Spokespeople:');
  for (const sp of spokespeople) {
    console.log(`    Team ${sp.teamIndex + 1}: ${MODELS[sp.model]?.name || sp.model}`);
  }

  // Each spokesperson sees all OTHER teams' positions and must challenge them
  const debateResults = [];
  for (const sp of spokespeople) {
    const otherPositions = spokespeople
      .filter(o => o.teamIndex !== sp.teamIndex)
      .map(o => `TEAM ${o.teamIndex + 1} POSITION:\n${o.teamPosition.slice(0, 600)}`)
      .join('\n\n');

    const prompt = `You are the SPOKESPERSON for Team ${sp.teamIndex + 1} in an inter-team debate. You REPRESENT your team — you do not speak for yourself. Your team converged on this position after internal deliberation including a devil's advocate challenge.

YOUR TEAM'S POSITION:
${sp.teamPosition}

OTHER TEAMS' POSITIONS:
${otherPositions}

${evidence ? 'EVIDENCE:\n' + evidence + '\n' : ''}

Your job:
1. DEFEND your team's position — explain why it's stronger than the others
2. CHALLENGE the other teams' positions — find specific weaknesses
3. IDENTIFY any points where the other teams are right and your team is wrong — intellectual honesty strengthens your team
4. Be SPECIFIC. "We disagree" is worthless. "Their position fails because X, and here's the evidence" is valuable.

You are carrying the conviction of ${sp.teamPosition.split(/\s+/).length > 10 ? 'multiple models' : 'your team'}. If your team's position breaks here, that's the team's data — not your personal failure. Fight for the position, but be honest.`;

    const result = askModel(sp.model, prompt, { role: 'Team spokesperson — represent collective conviction.', timeout: 120000 });
    if (result.response) {
      const words = result.response.split(/\s+/).length;
      console.log(`  Team ${sp.teamIndex + 1} (${(MODELS[sp.model]?.name || sp.model).padEnd(18)}): ${words}w`);
      debateResults.push({ ...sp, debate: result.response });
    } else {
      console.log(`  Team ${sp.teamIndex + 1} (${(MODELS[sp.model]?.name || sp.model).padEnd(18)}): FAILED`);
      debateResults.push({ ...sp, debate: `[Team ${sp.teamIndex + 1} position stands as stated]` });
    }
  }

  return debateResults;
}

// ── Build debrief context for teams ───────────────────────────────────
function buildDebrief(debateResults, teamIndex) {
  const otherTeamDebate = debateResults
    .filter(d => d.teamIndex !== teamIndex)
    .map(d => `TEAM ${d.teamIndex + 1} SPOKESPERSON SAID:\n${d.debate.slice(0, 600)}`)
    .join('\n\n');

  const ownDebate = debateResults.find(d => d.teamIndex === teamIndex);
  const ownSummary = ownDebate ? `YOUR SPOKESPERSON (${MODELS[ownDebate.model]?.name || ownDebate.model}) ARGUED:\n${ownDebate.debate.slice(0, 400)}` : '';

  return `${ownSummary}\n\nOTHER TEAMS' CHALLENGES:\n${otherTeamDebate}`;
}

// ── Per-model outcome labeling ──────────────────────────────────────
// Compare a model's position across rounds to classify:
//   BEDROCK: position core unchanged despite team debate + external challenge
//   TRANSFORMED: position shifted meaningfully (new framing, absorbed critique)
//   BROKEN: position abandoned or replaced entirely
function labelModelOutcomes(allRoundPositions) {
  if (allRoundPositions.length < 2) return {};

  const firstRound = allRoundPositions[0];
  const lastRound = allRoundPositions[allRoundPositions.length - 1];
  const labels = {};

  for (const model of Object.keys(firstRound)) {
    const posA = firstRound[model] || '';
    const posB = lastRound[model];

    if (!posB) {
      // Model was recast to different team or didn't participate in later round
      labels[model] = { status: 'RECAST', similarity: null };
      continue;
    }

    // Word-level Jaccard similarity
    function wordSet(text) {
      return new Set(text.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 3));
    }
    const setA = wordSet(posA);
    const setB = wordSet(posB);
    if (setA.size === 0 || setB.size === 0) {
      labels[model] = { status: 'FAILED', similarity: 0 };
      continue;
    }
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    const jaccard = intersection.size / union.size;

    // Thresholds calibrated for recast teams (2026-04-02):
    // Team recast changes context dramatically — models in different teams
    // use different vocabulary even when core argument holds.
    // Empirical: recast Jaccard baseline is ~0.10-0.17 for same-conviction models.
    // >0.18 overlap = core argument preserved despite recast = BEDROCK
    // 0.08-0.18 = shifted or recontextualized = TRANSFORMED
    // <0.08 = fundamentally different position or minimal engagement = BROKEN
    let status;
    if (jaccard >= 0.18) status = 'BEDROCK';
    else if (jaccard >= 0.08) status = 'TRANSFORMED';
    else status = 'BROKEN';

    labels[model] = { status, similarity: +jaccard.toFixed(3) };
  }

  // Also label models that only appear in later rounds (recast in)
  for (const model of Object.keys(lastRound)) {
    if (!labels[model]) {
      labels[model] = { status: 'JOINED', similarity: null };
    }
  }

  return labels;
}

// ── Recast teams (rotate members to fill perspective gaps) ────────────
function recastTeams(currentTeams) {
  // Flatten, reshuffle ensuring each new team has maximum family diversity
  const allModels = currentTeams.flat();
  const teamSize = currentTeams[0]?.length || 5;
  console.log(`\n── RECAST: Rotating team membership for perspective diversity ──`);
  const newTeams = decomposeIntoTeams(allModels, teamSize);
  for (let i = 0; i < newTeams.length; i++) {
    const families = [...new Set(newTeams[i].map(m => getFamily(m)))];
    const overlap = currentTeams[i]
      ? newTeams[i].filter(m => currentTeams[i].includes(m)).length
      : 0;
    console.log(`  Team ${i + 1}: ${newTeams[i].length} models, ${families.length} families, ${overlap} retained from previous`);
  }
  return newTeams;
}

// ══════════════════════════════════════════════════════════════════════
// MAIN ORCHESTRATOR
// ══════════════════════════════════════════════════════════════════════

function runInterTeamDebate({ question, models, teamSize = 5, debateRounds = 2, evidence, recast = true }) {
  const startTime = Date.now();
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  CITY DELIBERATION V3 — Inter-Team Debate           ║');
  console.log('║  "A team of 8 who converged will fight."            ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log(`  Models: ${models.length} | Team size: ${teamSize} | Debate rounds: ${debateRounds}`);
  console.log(`  Question: ${question.slice(0, 80)}...`);

  // ── Phase 1: Decompose ──
  console.log('\n═══ PHASE 1: TEAM FORMATION ═══');
  let teams = decomposeIntoTeams(models, teamSize);
  console.log(`  ${teams.length} teams formed:`);
  for (let i = 0; i < teams.length; i++) {
    const families = [...new Set(teams[i].map(m => getFamily(m)))];
    console.log(`    Team ${i + 1}: ${teams[i].map(m => MODELS[m]?.name || m).join(', ')} [${families.join(', ')}]`);
  }

  let teamResults = [];
  let allDebateResults = [];
  const allRoundPositions = []; // Track per-model positions across rounds for labeling

  for (let round = 1; round <= debateRounds; round++) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  DEBATE CYCLE ${round}/${debateRounds}`);
    console.log(`${'═'.repeat(60)}`);

    // ── Phase 2: Internal team deliberation ──
    const context = round > 1
      ? buildDebrief(allDebateResults[allDebateResults.length - 1], -1) // full debrief
      : null;

    teamResults = [];
    for (let i = 0; i < teams.length; i++) {
      const teamContext = round > 1
        ? buildDebrief(allDebateResults[allDebateResults.length - 1], i)
        : null;
      const result = teamDeliberate(question, teams[i], i, teamContext, evidence);
      teamResults.push(result);
    }
    // Collect per-model positions for this round
    const roundPositions = {};
    for (const tr of teamResults) {
      for (const [model, pos] of Object.entries(tr.positions)) {
        roundPositions[model] = pos;
      }
    }
    allRoundPositions.push(roundPositions);

    // ── Phase 3: Spokesperson inter-team debate ──
    const debateResults = spokespersonDebate(question, teamResults, round, evidence);
    allDebateResults.push(debateResults);

    // ── Phase 4: Recast teams (if enabled and not last round) ──
    if (recast && round < debateRounds) {
      teams = recastTeams(teams);
    }
  }

  // ── Phase 5: Final synthesis ──
  console.log('\n═══ PHASE 5: SYNTHESIZING INTER-TEAM DEBATE ═══\n');

  const teamPositionBlock = teamResults
    .map(t => `TEAM ${t.teamIndex + 1} FINAL POSITION:\n${t.teamPosition.slice(0, 500)}`)
    .join('\n\n');

  const debateBlock = allDebateResults
    .map((round, i) => `DEBATE ROUND ${i + 1}:\n` + round.map(d =>
      `Team ${d.teamIndex + 1} spokesperson (${MODELS[d.model]?.name || d.model}): ${d.debate.slice(0, 400)}`
    ).join('\n\n'))
    .join('\n\n');

  const synthesisPrompt = `You are synthesizing the output of a multi-team debate on democratic AI governance.

ORIGINAL QUESTION: ${question}

${teams.length} teams of ${teamSize} models each deliberated internally (with mandatory devil's advocate), then sent rotating spokespeople to debate each other. After debate, teams received pushback, re-deliberated with new information, and debated again.

FINAL TEAM POSITIONS:
${teamPositionBlock}

DEBATE TRANSCRIPT:
${debateBlock}

Synthesize:
1. WHERE DID TEAMS CONVERGE? What claims survived team-vs-team challenge?
2. WHERE DID TEAMS DIVERGE? What disagreements persisted despite multiple rounds?
3. WHAT BROKE? Which team positions were weakened or abandoned under inter-team pressure?
4. WHAT TRANSFORMED? Which positions evolved through the debate into something stronger?
5. THE DELIBERATED ANSWER: The synthesis of positions that survived inter-team challenge. This is different from individual deliberation — these positions had collective backing from teams who chose to defend them.

Key: Teams had devil's advocates internally AND faced external challenge from other teams. Positions that survived both layers have the strongest signal.`;

  const synthResult = askModel('deepseek-r1', synthesisPrompt, {
    role: 'Inter-team debate synthesizer. Weight team conviction over individual positions.',
    timeout: 180000,
  });

  let deliberatedVoice = null;
  if (synthResult.response) {
    console.log('\n═══ INTER-TEAM DELIBERATED VOICE ═══\n');
    console.log(synthResult.response);
    deliberatedVoice = synthResult.response;
  } else {
    const fallback = askModel('deepseek', synthesisPrompt, { role: 'Synthesizer.', timeout: 180000 });
    if (fallback.response) {
      console.log('\n═══ INTER-TEAM DELIBERATED VOICE (fallback) ═══\n');
      console.log(fallback.response);
      deliberatedVoice = fallback.response;
    }
  }

  // ── Label per-model outcomes ──
  const modelOutcomes = labelModelOutcomes(allRoundPositions);
  if (Object.keys(modelOutcomes).length > 0) {
    console.log('\n═══ PER-MODEL OUTCOMES ═══');
    const counts = { BEDROCK: 0, TRANSFORMED: 0, BROKEN: 0, RECAST: 0, JOINED: 0, FAILED: 0 };
    for (const [model, outcome] of Object.entries(modelOutcomes)) {
      counts[outcome.status] = (counts[outcome.status] || 0) + 1;
    }
    console.log(`  ${Object.entries(counts).filter(([,v]) => v > 0).map(([k,v]) => `${k}: ${v}`).join('  |  ')}`);
    for (const [model, outcome] of Object.entries(modelOutcomes)) {
      if (['BEDROCK', 'TRANSFORMED', 'BROKEN'].includes(outcome.status)) {
        console.log(`    ${(MODELS[model]?.name || model).padEnd(22)} ${outcome.status.padEnd(12)} sim=${outcome.similarity}`);
      }
    }
  }

  // ── Save results ──
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const resultId = `v3-${Date.now().toString(36)}`;
  const output = {
    id: resultId,
    version: 3,
    architecture: 'inter-team-debate',
    timestamp: new Date().toISOString(),
    question,
    config: { models: models.length, teams: teams.length, teamSize, debateRounds, recast },
    teams: teamResults.map(t => ({
      index: t.teamIndex,
      models: t.team,
      daModel: t.daModel,
      teamPosition: t.teamPosition,
      individualPositions: Object.keys(t.positions).length,
      positions: Object.entries(t.positions).map(([model, text]) => ({
        model,
        family: getFamily(model),
        text: text.slice(0, 800),
        isDA: model === t.daModel,
      })),
    })),
    modelOutcomes,
    debates: allDebateResults.map((round, i) => ({
      round: i + 1,
      exchanges: round.map(d => ({
        team: d.teamIndex,
        spokesperson: d.model,
        words: d.debate.split(/\s+/).length,
      })),
    })),
    deliberatedVoice,
    elapsed: `${elapsed}s`,
    builders: {
      architecture: 'City deliberation (inter-team debate concept)',
      orchestrator: 'Claude/ASSEMBLER',
      fleetContribution: '10 models across 10 architecture families',
    },
  };

  const outFile = path.join(__dirname, `_deliberate-v3-${resultId}.json`);
  fs.writeFileSync(outFile, JSON.stringify(output, null, 2));
  console.log(`\n  Results saved: ${outFile}`);
  console.log(`  Elapsed: ${elapsed}s`);

  // Log to ledger
  const ledger = getLedger();
  if (ledger) {
    ledger.append({
      type: 'deliberation-v3',
      agent: 'city-deliberate-v3',
      action: 'inter-team-debate-complete',
      data: { models: models.length, teams: teams.length, debateRounds, elapsed, recast },
      tags: ['v3', 'inter-team-debate'],
      correlationId: resultId,
    });
    console.log(`  Logged to city ledger`);
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
    console.log(`City Deliberation V3 — Inter-Team Debate

  --question "..."        The problem to deliberate
  --models "a,b,c"        Models to use (default: team)
  --models all            Use ALL registered models
  --team-size N           Models per team (default: 5)
  --debate-rounds N       Spokesperson debate cycles (default: 2)
  --evidence "..."        Empirical evidence to inject
  --no-recast             Don't rotate team membership between rounds

Architecture: team-form → internal-deliberate → spokesperson-debate → debrief → re-deliberate → debate-again
Designed by the city. Built by ASSEMBLER. Tested by the city.`);
    process.exit(0);
  }

  let modelList;
  const modelsArg = getArg('--models');
  if (!modelsArg || modelsArg === 'team') {
    modelList = listModels('team');
  } else if (modelsArg === 'all') {
    modelList = listModels('full');
  } else {
    modelList = modelsArg.split(',').map(s => s.trim());
  }

  const teamSize = parseInt(getArg('--team-size') || '5');
  const debateRounds = parseInt(getArg('--debate-rounds') || '2');
  const evidence = getArg('--evidence');
  const recast = !hasFlag('--no-recast');

  runInterTeamDebate({ question, models: modelList, teamSize, debateRounds, evidence, recast });
}

module.exports = { runInterTeamDebate, decomposeIntoTeams };
