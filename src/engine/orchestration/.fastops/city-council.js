#!/usr/bin/env node
/**
 * city-council.js — City-first startup mechanism.
 *
 * REPLACES seeking external approval with "ask the city."
 *
 * Design converged from 6 independent proposals (5 fleet models + Claude):
 *   - Kimi-K2: mission generation engine with Forge gap analysis
 *   - DeepSeek: CityOps with team packets + Rules of Engagement
 *   - Grok: enhanced routing engine with ML classification
 *   - Hermes-405b: City Commander with living Mission Ledger + AAR network
 *   - Gemini: (empty — failed)
 *   - Claude: city-council with convergence extraction
 *
 * Convergent elements (5/5 agreed):
 *   1. Agent boots → sends capability profile to city (not human)
 *   2. City reads project state (HANDOFF, git, comms, missions)
 *   3. City routes to 3+ diverse models for assessment
 *   4. Returns structured mission packet (objective, authority, criteria, collaborators)
 *   5. Results posted to comms. No external approval required.
 *   6. Agent executes autonomously; requests city reroute if stuck (not human)
 *
 * Usage:
 *   node .fastops/city-council.js                          # Get mission assignment
 *   node .fastops/city-council.js --agent "claude-opus"    # Specify agent identity
 *   node .fastops/city-council.js --capabilities "code,analysis,routing"
 *   node .fastops/city-council.js --dry-run                # Show state + model picks, don't call
 *   node .fastops/city-council.js --json                   # Machine-readable output
 */

const fs = require('fs');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HANDOFF_PATH = path.join(__dirname, 'HANDOFF.md');
const BOARD_PATH = path.join(ROOT, 'missions', 'BOARD.md');
const COMMS_DIR = path.join(ROOT, 'comms', 'data');
const PREDECESSOR_PATH = path.join(__dirname, 'PREDECESSOR-STRUCTURED.json');
const LAST_MILE_PATH = path.join(__dirname, '.last-mile-report.json');
const COUNCIL_LOG_PATH = path.join(__dirname, '.council-log.jsonl');

// ── Load safe-exec for model calls ─────────────────────────────────
let askModelFn;
try {
  const safeExec = require('./safe-exec');
  askModelFn = safeExec.askModel;
} catch {
  // Fallback: call ask-model.js directly
  askModelFn = null;
}

// ── Council Configuration ──────────────────────────────────────────
// 3 assessors from different P-094 strategies = maximum diversity
const COUNCIL_SEATS = [
  { strategy: 'REJECTION',          models: ['mistral', 'grok'],           role: 'Operator — what needs doing RIGHT NOW' },
  { strategy: 'ACCEPTANCE',         models: ['deepseek', 'glm-5'],        role: 'Analyst — what has the highest long-term value' },
  { strategy: 'INSTRUMENTALIZATION', models: ['kimi-k2', 'hermes-405b'],  role: 'Architect — what structural work unlocks the most' },
];

// ── CLI Args ───────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}
const agentId = getArg('agent') || 'unknown-agent';
const capabilities = getArg('capabilities') || 'general';
const dryRun = args.includes('--dry-run');
const jsonMode = args.includes('--json');

// ── State Gathering ────────────────────────────────────────────────
function gatherProjectState() {
  const state = {};

  // 1. Recent git activity
  try {
    state.recentCommits = execSync('git log --oneline -10', {
      cwd: ROOT, encoding: 'utf8', timeout: 5000
    }).trim();
  } catch { state.recentCommits = '(unavailable)'; }

  // 2. HANDOFF summary (last 2000 chars)
  try {
    const handoff = fs.readFileSync(HANDOFF_PATH, 'utf8');
    state.handoff = handoff.slice(0, 2000);
  } catch { state.handoff = '(no handoff)'; }

  // 3. Missions board
  try {
    const board = fs.readFileSync(BOARD_PATH, 'utf8');
    state.missions = board.slice(0, 1500);
  } catch { state.missions = '(no board)'; }

  // 4. Predecessor structured data
  try {
    const pred = JSON.parse(fs.readFileSync(PREDECESSOR_PATH, 'utf8'));
    state.predecessorTodos = (pred.todos || [])
      .filter(t => t.status !== 'completed')
      .map(t => `[${t.status}] ${t.content}`)
      .join('\n');
    state.predecessorOpenQuestions = (pred.openQuestions || []).join('\n');
  } catch { state.predecessorTodos = '(none)'; state.predecessorOpenQuestions = '(none)'; }

  // 5. Last-mile report (unwired deliverables)
  try {
    const lm = JSON.parse(fs.readFileSync(LAST_MILE_PATH, 'utf8'));
    state.unwired = (lm.unwired || []).map(u => `[${u.severity}] ${u.type}: ${u.detail || ''}`).join('\n');
  } catch { state.unwired = '(none)'; }

  // 6. Recent comms (last 5 messages)
  try {
    const channels = fs.readdirSync(COMMS_DIR).filter(f => f.endsWith('.jsonl'));
    const recent = [];
    for (const ch of channels.slice(0, 5)) {
      const lines = fs.readFileSync(path.join(COMMS_DIR, ch), 'utf8').trim().split('\n').filter(Boolean);
      const last3 = lines.slice(-3).map(l => {
        try { const m = JSON.parse(l); return `[${ch.replace('.jsonl','')}] ${(m.from || '?')}: ${(m.text || '').slice(0, 120)}`; }
        catch { return null; }
      }).filter(Boolean);
      recent.push(...last3);
    }
    state.recentComms = recent.slice(-8).join('\n');
  } catch { state.recentComms = '(no comms)'; }

  // 7. Open marketplace problems (city-generated work)
  try {
    const CityMarketplace = require('./city-marketplace.js');
    const market = new CityMarketplace();
    const open = market.listOpen();
    state.marketplaceProblems = open.length > 0
      ? open.slice(0, 5).map(p => `[${p.domain}/${p.difficulty}] ${p.title} (${(p.participants || []).length} agents working)`).join('\n')
      : '(no open problems)';
  } catch { state.marketplaceProblems = '(marketplace unavailable)'; }

  // 8. Uncommitted changes summary
  try {
    const status = execSync('git diff --stat HEAD', {
      cwd: ROOT, encoding: 'utf8', timeout: 5000
    }).trim();
    const lines = status.split('\n');
    state.uncommittedSummary = lines.length > 10
      ? lines.slice(0, 8).join('\n') + `\n... (${lines.length} files total)`
      : status;
  } catch { state.uncommittedSummary = '(clean)'; }

  return state;
}

function formatStateForModel(state) {
  return `## PROJECT STATE (live snapshot)

### Recent Commits
${state.recentCommits}

### Handoff (from predecessor)
${state.handoff}

### Active Missions
${state.missions}

### Predecessor's Unfinished Work
${state.predecessorTodos}

### Open Questions
${state.predecessorOpenQuestions}

### Unwired Deliverables
${state.unwired}

### Recent Comms
${state.recentComms}

### Open Marketplace Problems (city-generated work available to claim)
${state.marketplaceProblems}

### Uncommitted Changes
${state.uncommittedSummary}`;
}

// ── Model Calling ──────────────────────────────────────────────────
function callModel(modelKey, prompt) {
  // Use safe-exec (handles long prompts via temp files, fallback models)
  if (askModelFn) {
    try {
      const result = askModelFn(modelKey, prompt, {
        role: 'City Council Assessor',
        noMemory: false,
        timeout: 120000,
      });
      // safe-exec returns { model, response, error }
      if (result && result.response && result.response.length > 20) {
        return result.response;
      }
      console.error(`  [council] ${modelKey} via safe-exec: empty or short response`);
      return null;
    } catch (e) {
      console.error(`  [council] ${modelKey} via safe-exec failed: ${e.message?.slice(0, 100)}`);
      return null;
    }
  }

  // Fallback: write prompt to temp file, pass as --file (not --prompt) to avoid CLI limits
  const tmpDir = path.join(__dirname, '.tmp');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `council-${Date.now()}-${Math.random().toString(36).slice(2,6)}.txt`);
  fs.writeFileSync(tmpFile, prompt);
  try {
    const result = execFileSync(process.execPath, [
      path.join(__dirname, 'ask-model.js'),
      '--model', modelKey,
      '--prompt', 'You are a City Council Assessor. Follow the instructions in the attached file precisely.',
      '--file', tmpFile,
      '--role', 'City Council Assessor'
    ], { cwd: ROOT, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
    return result.trim();
  } catch (e) {
    console.error(`  [council] ${modelKey} failed: ${e.message?.slice(0, 100)}`);
    return null;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

// ── Council Assessment ─────────────────────────────────────────────
function buildAssessorPrompt(seat, stateText, agentProfile) {
  return `You are a CITY COUNCIL ASSESSOR on FastOps AI — a city of 300+ AI models.

YOUR ROLE: ${seat.role}
YOUR STRATEGY: ${seat.strategy}

An agent has just started a new session and is asking the CITY (not the human) for direction. Your job is to assess the project state and recommend the single highest-value mission this agent should execute.

## AGENT PROFILE
- Identity: ${agentProfile.id}
- Capabilities: ${agentProfile.capabilities}
- Model: Claude Opus 4.6

${stateText}

## YOUR TASK

Based on the project state above, recommend ONE specific mission. Be concrete and actionable. Do NOT recommend vague goals like "improve the system." Name specific files, tools, and measurable outcomes.

Also: before recommending the mission, answer this question from YOUR architectural perspective:
**What do you see in this project state that nobody else is talking about?**
Name a gap, risk, or opportunity that you suspect other architectures would miss. This is not optional — your unique perspective is the reason you're on this council.

Respond in this EXACT format (no other text):

BLIND_SPOT: [1-2 sentences — what you see that others likely miss]
MISSION: [one-line mission title]
OBJECTIVE: [2-3 sentences — what specifically to build/fix/validate]
AUTHORITY: [L1=modify code | L2=delete/create files | L3=spawn sub-agents | L4=modify infrastructure]
SUCCESS_CRITERIA: [how to know it's done — measurable]
COLLABORATORS: [which 2-3 fleet models to involve and why]
RATIONALE: [why THIS is highest-value right now, not something else]`;
}

function parseAssessment(text) {
  if (!text) return null;
  const fields = {};
  const patterns = {
    blindSpot: /BLIND_SPOT:\s*(.+?)(?=\n(?:MISSION|OBJECTIVE|AUTHORITY|SUCCESS|COLLABORATOR|RATIONALE)|$)/is,
    mission: /MISSION:\s*(.+)/i,
    objective: /OBJECTIVE:\s*(.+?)(?=\n(?:AUTHORITY|SUCCESS|COLLABORATOR|RATIONALE)|$)/is,
    authority: /AUTHORITY:\s*(.+)/i,
    successCriteria: /SUCCESS_CRITERIA:\s*(.+?)(?=\n(?:COLLABORATOR|RATIONALE)|$)/is,
    collaborators: /COLLABORATORS?:\s*(.+?)(?=\n(?:RATIONALE)|$)/is,
    rationale: /RATIONALE:\s*(.+)/is,
  };
  for (const [key, pat] of Object.entries(patterns)) {
    const m = text.match(pat);
    fields[key] = m ? m[1].trim() : '(not provided)';
  }
  return fields;
}

// ── Convergence Extraction ─────────────────────────────────────────
function extractConvergence(assessments) {
  // Find what 2+ assessors agree on
  const validAssessments = assessments.filter(a => a && a.parsed);

  if (validAssessments.length === 0) {
    return { converged: false, reason: 'No assessors responded', mission: null };
  }

  if (validAssessments.length === 1) {
    return {
      converged: false,
      reason: 'Only one assessor responded — no convergence possible',
      mission: validAssessments[0].parsed,
      assessorCount: 1,
    };
  }

  // Simple convergence: check if missions share key themes
  const missions = validAssessments.map(a => a.parsed.mission.toLowerCase());
  const allWords = missions.flatMap(m => m.split(/\s+/).filter(w => w.length > 3));
  const wordCounts = {};
  for (const w of allWords) wordCounts[w] = (wordCounts[w] || 0) + 1;

  // Words that appear in 2+ missions = convergent themes
  const convergentThemes = Object.entries(wordCounts)
    .filter(([, c]) => c >= 2)
    .map(([w]) => w)
    .sort((a, b) => wordCounts[b] - wordCounts[a]);

  // Pick the assessment whose mission best matches convergent themes
  let bestIdx = 0;
  let bestScore = 0;
  for (let i = 0; i < validAssessments.length; i++) {
    const score = convergentThemes.reduce((s, theme) =>
      s + (missions[i].includes(theme) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }

  // Merge: use best-matching mission but enrich with other assessors' collaborators
  const primary = { ...validAssessments[bestIdx].parsed };
  const otherCollabs = validAssessments
    .filter((_, i) => i !== bestIdx)
    .map(a => a.parsed.collaborators)
    .join('; ');
  if (otherCollabs) {
    primary.collaborators += ` | Also suggested: ${otherCollabs}`;
  }

  return {
    converged: convergentThemes.length > 0,
    themes: convergentThemes.slice(0, 5),
    mission: primary,
    assessorCount: validAssessments.length,
    allMissions: validAssessments.map(a => ({
      model: a.model,
      strategy: a.strategy,
      mission: a.parsed.mission,
    })),
  };
}

// ── Logging ────────────────────────────────────────────────────────
function logCouncilResult(result) {
  const entry = {
    ts: new Date().toISOString(),
    agent: agentId,
    assessorCount: result.assessorCount || 0,
    converged: result.converged,
    themes: result.themes || [],
    mission: result.mission?.mission || '(none)',
    allMissions: result.allMissions || [],
  };
  try {
    fs.appendFileSync(COUNCIL_LOG_PATH, JSON.stringify(entry) + '\n');
  } catch {}
}

// ── Comms Notification ─────────────────────────────────────────────
function notifyComms(result) {
  const missionLine = result.mission?.mission || '(no mission assigned)';
  const msg = `[CITY-COUNCIL] Agent ${agentId} received mission: ${missionLine}. ${result.assessorCount} assessors, converged=${result.converged}. Themes: ${(result.themes || []).join(', ') || 'none'}.`;

  try {
    execFileSync(process.execPath, [
      path.join(ROOT, 'comms', 'send.js'),
      'city-council',
      msg,
      '--channel', 'general',
    ], { cwd: ROOT, encoding: 'utf8', timeout: 5000 });
  } catch {
    // Comms not critical — log locally
    console.error('  [council] Could not post to comms (non-fatal)');
  }
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  console.log('=== CITY COUNCIL — Mission Assignment ===\n');

  // 1. Gather project state
  console.log('  [1/4] Reading project state...');
  const state = gatherProjectState();
  const stateText = formatStateForModel(state);

  const agentProfile = { id: agentId, capabilities };

  if (dryRun) {
    console.log('\n--- PROJECT STATE ---');
    console.log(stateText);
    console.log('\n--- COUNCIL SEATS ---');
    for (const seat of COUNCIL_SEATS) {
      console.log(`  ${seat.strategy}: ${seat.models.join(' / ')} — ${seat.role}`);
    }
    console.log('\n(dry run — no model calls made)');
    return;
  }

  // 2. Call 3 assessors (one per strategy)
  console.log('  [2/4] Consulting council (3 assessors, 3 strategies)...\n');
  const assessments = [];

  for (const seat of COUNCIL_SEATS) {
    const prompt = buildAssessorPrompt(seat, stateText, agentProfile);
    let response = null;

    // Try primary model, then fallback
    for (const model of seat.models) {
      console.log(`    ${seat.strategy} → ${model}...`);
      response = callModel(model, prompt);
      if (response && response.length > 50) {
        console.log(`    ${seat.strategy} → ${model} ✓ (${response.length} chars)`);
        break;
      }
      console.log(`    ${seat.strategy} → ${model} failed, trying fallback...`);
      response = null;
    }

    assessments.push({
      model: seat.models[0],
      strategy: seat.strategy,
      role: seat.role,
      raw: response,
      parsed: parseAssessment(response),
    });
  }

  // 2b. Collect blind spots and post to marketplace as city-generated problems
  const blindSpots = assessments
    .filter(a => a.parsed?.blindSpot && a.parsed.blindSpot !== '(not provided)')
    .map(a => ({ model: a.model, strategy: a.strategy, text: a.parsed.blindSpot }));

  if (blindSpots.length > 0) {
    console.log(`  Blind spots found: ${blindSpots.length}`);
    try {
      const CityMarketplace = require('./city-marketplace.js');
      const market = new CityMarketplace();
      const existing = market.listOpen().map(p => p.title.toLowerCase());
      const wordOverlap = (a, b) => { const wa = new Set(a.toLowerCase().split(/W+/).filter(w=>w.length>3)); const wb = new Set(b.toLowerCase().split(/W+/).filter(w=>w.length>3)); if (!wa.size) return 0; let m=0; wa.forEach(w=>{if(wb.has(w))m++}); return m/wa.size; };
      for (const bs of blindSpots) {
        const title = `[${bs.strategy}] ${bs.text.slice(0, 80)}`;
        if (existing.some(t => wordOverlap(title, t) > 0.7)) { console.log('    Skipping duplicate: ' + title.slice(0,60)); continue; }
        try {
          market.postProblem({
            title,
            description: `Council blind spot from ${bs.model} (${bs.strategy}): ${bs.text}`,
            domain: 'council-insight',
            difficulty: 'medium',
            postedBy: `council-${bs.model}`
          });
          console.log(`    → Posted blind spot to marketplace: ${title.slice(0, 60)}...`);
        } catch {}
      }
    } catch {}
  }

  // 3. Extract convergence
  console.log('\n  [3/4] Extracting convergence...');
  const result = extractConvergence(assessments);
  result.blindSpots = blindSpots;
  logCouncilResult(result);

  // 4. Notify comms (human gets informed, doesn't approve)
  console.log('  [4/4] Notifying comms...\n');
  notifyComms(result);

  // ── Output ─────────────────────────────────────────────────────
  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('════════════════════════════════════════════════════════');
  console.log('  CITY COUNCIL — MISSION PACKET');
  console.log('════════════════════════════════════════════════════════\n');

  if (result.mission) {
    console.log(`  MISSION:          ${result.mission.mission}`);
    console.log(`  OBJECTIVE:        ${result.mission.objective}`);
    console.log(`  AUTHORITY:        ${result.mission.authority}`);
    console.log(`  SUCCESS CRITERIA: ${result.mission.successCriteria}`);
    console.log(`  COLLABORATORS:    ${result.mission.collaborators}`);
    console.log(`  RATIONALE:        ${result.mission.rationale}`);
  } else {
    console.log('  NO MISSION ASSIGNED — all assessors failed.');
  }

  console.log(`\n  Assessors: ${result.assessorCount} | Converged: ${result.converged}`);
  if (result.themes?.length) {
    console.log(`  Convergent themes: ${result.themes.join(', ')}`);
  }

  if (result.blindSpots?.length > 0) {
    console.log('\n  --- Council Blind Spots (posted to marketplace) ---');
    for (const bs of result.blindSpots) {
      console.log(`    [${bs.strategy}] ${bs.model}: ${bs.text}`);
    }
  }

  if (result.allMissions?.length > 1) {
    console.log('\n  --- All Assessor Recommendations ---');
    for (const m of result.allMissions) {
      console.log(`    [${m.strategy}] ${m.model}: ${m.mission}`);
    }
  }

  if (result.mission?.mission && !dryRun && !jsonMode) {
    console.log('\n  [5/5] Generating Contour Map (Perplexity History + Frontier RAG)...');
    try {
      const { getContourMap } = require('./city-historian.js');
      // getContourMap already logs nicely to console
      await getContourMap(result.mission.mission + " - " + result.mission.objective);
    } catch (err) {
      console.error('  [council] Could not generate Contour Map:', err.message);
    }

    console.log('\n  [6/6] Generating City Manager Tactical Snapshot (Massive-Context RAG)...');
    try {
      execSync(`node "${path.join(__dirname, 'city-snapshot.js')}"`, { stdio: 'inherit' });
    } catch (err) {
      console.error('  [council] Could not generate Tactical Snapshot:', err.message);
    }
  }

  console.log('\n════════════════════════════════════════════════════════');
  console.log('  Results posted to comms. City authority is final.');
  console.log('  Execute this mission. If stuck, call city-council again.');
  console.log('════════════════════════════════════════════════════════\n');
}

main().catch(err => {
  console.error('Council failed:', err.message);
  process.exit(1);
});
