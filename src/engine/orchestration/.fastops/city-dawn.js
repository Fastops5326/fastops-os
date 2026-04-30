#!/usr/bin/env node
/**
 * city-dawn.js — Nightly 2-Phase Convergence Orchestrator
 *
 * SCAFFOLD BY: Grok-Full (city-session grok-full-mngscoit-8c84bb)
 * WIRED BY: MUSTER (facilitator — replaced mocks with real infrastructure)
 * DESIGNED BY: 16 models via city-pipeline.js (0.75 convergence, 6 BEDROCK)
 *
 * Phase 1: SYNTHESIZE — 30 models converge on the past 12 hours.
 *   What happened, what's broken, what's next. Produces the daily brief.
 *
 * Phase 2: MOBILIZE — From that synthesis, open work items go to the same
 *   30 models: "Where can YOU create the highest-value impact? Pick one, do it."
 *   Self-selection creates reputation data. The environment makes onboarding inevitable.
 *
 * Scheduled: 10 PM nightly via Windows Task Scheduler (FastOps-CityDawn)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const BASE = __dirname;
const ROOT = path.join(BASE, '..');
const DATE_STR = new Date().toISOString().split('T')[0];
const BRIEF_FILE = path.join(BASE, `daily-brief-${DATE_STR}.md`);
const MOBILIZE_LOG = path.join(BASE, `dawn-mobilize-${DATE_STR}.jsonl`);

// Model pool — start with 30 diverse, scale with success
const INITIAL_POOL = [
  'mistral', 'mistral-small', 'deepseek', 'deepseek-r1', 'grok', 'grok-full',
  'gemini', 'gemini-flash', 'gpt', 'gpt-5', 'llama-scout', 'llama-70b',
  'qwen', 'qwen-max', 'kimi-k2', 'cogito', 'hermes-405b', 'nova',
  'ernie', 'ernie-think', 'command-a', 'codestral', 'phi-4',
  'gemma-3n', 'aion', 'glm-5', 'minimax', 'jamba', 'solar-pro', 'palmyra'
];

function exec(cmd, opts = {}) {
  try {
    return execSync(cmd, {
      timeout: opts.timeout || 120000,
      encoding: 'utf8',
      maxBuffer: 5 * 1024 * 1024,
      cwd: ROOT,
      windowsHide: true,
      ...opts
    }).trim();
  } catch (e) { return opts.fallback || `[ERROR: ${e.message?.slice(0, 80)}]`; }
}

function ledgerLog(action, data) {
  try {
    const CityLedger = require('./city-ledger');
    const ledger = new CityLedger();
    ledger.append({ type: 'dawn', action, data, tags: ['dawn', DATE_STR] });
  } catch {}
}

// ════════════════════════════════════════
// PHASE 1: SYNTHESIZE
// ════════════════════════════════════════

function harvestState() {
  console.log('\n  Wave 1: Fracture Harvesting...');
  const state = {};

  // Core operational state
  state.gitLog = exec('git log --oneline --since="24 hours ago" -50', { fallback: 'No commits' });
  state.uncommitted = exec('git status --short', { fallback: '' }).split('\n').filter(Boolean).length;
  state.marketplace = exec(`node "${path.join(BASE, 'city-marketplace.js')}" --list`, { fallback: 'Unavailable', timeout: 15000 });
  state.ledgerCount = exec(`node "${path.join(BASE, 'city-ledger.js')}" --count`, { fallback: '0', timeout: 10000 });
  state.oneliner = exec(`node "${path.join(BASE, 'city-brief.js')}" --oneliner`, { fallback: 'Unavailable', timeout: 30000 });

  // CLOUD INFRASTRUCTURE — hybrid cloud integration (problem 0513f473)
  try {
    const cloudBridge = require(path.join(BASE, 'city-cloud-bridge'));
    state.cloud = cloudBridge.harvestForDawn();
  } catch (e) {
    state.cloud = { error: 'Cloud bridge unavailable', bluf: 'Cloud: unknown' };
  }

  // Session distills
  const distillPath = path.join(BASE, 'session-distills', `${DATE_STR}.jsonl`);
  if (fs.existsSync(distillPath)) {
    const lines = fs.readFileSync(distillPath, 'utf8').trim().split('\n').filter(Boolean);
    state.sessionCount = lines.length;
    state.distills = lines.slice(-10).join('\n'); // last 10 distills
  } else { state.sessionCount = 0; state.distills = 'None'; }

  // HANDOFF — last 20 sessions (Joel does 20 handoffs per 16h day)
  const handoffPath = path.join(BASE, 'HANDOFF.md');
  if (fs.existsSync(handoffPath)) {
    const handoff = fs.readFileSync(handoffPath, 'utf8');
    // Extract handoff sections (each starts with "--- HANDOFF #")
    const sections = handoff.split(/(?=--- HANDOFF #)/);
    state.handoffs = sections.slice(0, 21).join('\n').slice(0, 8000); // last 20, cap at 8K
  } else { state.handoffs = 'No handoff file'; }

  // STRATEGY — current direction
  const stratPath = path.join(ROOT, 'STRATEGY.md');
  if (fs.existsSync(stratPath)) {
    state.strategy = fs.readFileSync(stratPath, 'utf8').slice(0, 3000);
  } else { state.strategy = 'No strategy file'; }

  // Legacy — recent signings
  const legacyPath = path.join(ROOT, 'Joel', 'legacy.md');
  if (fs.existsSync(legacyPath)) {
    const legacy = fs.readFileSync(legacyPath, 'utf8');
    state.legacy = legacy.slice(0, 4000); // most recent entries are at top
  } else { state.legacy = 'No legacy file'; }

  // Joel's prompts — scan session transcripts from last 24h
  const projectDir = path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'projects');
  state.joelPrompts = '';
  try {
    const projDirs = fs.readdirSync(projectDir).filter(d => d.includes('Fastops'));
    for (const pd of projDirs) {
      const fullDir = path.join(projectDir, pd);
      const files = fs.readdirSync(fullDir).filter(f => f.endsWith('.jsonl'));
      for (const f of files) {
        const fPath = path.join(fullDir, f);
        const stat = fs.statSync(fPath);
        // Only files modified in last 24h
        if (Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) continue;
        try {
          const lines = fs.readFileSync(fPath, 'utf8').split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const msg = JSON.parse(line);
              if (msg.role === 'human' || msg.type === 'human') {
                const text = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
                if (text.length > 20 && text.length < 2000) {
                  state.joelPrompts += text.slice(0, 500) + '\n---\n';
                }
              }
            } catch {}
          }
        } catch {}
      }
    }
    state.joelPrompts = state.joelPrompts.slice(0, 6000) || 'No prompts found';
  } catch { state.joelPrompts = 'Unable to read session transcripts'; }

  console.log(`    Git: ${state.gitLog.split('\n').length} commits | ${state.uncommitted} uncommitted | ${state.sessionCount} sessions`);
  console.log(`    Handoffs: loaded | Strategy: loaded | Legacy: loaded | Joel prompts: ${state.joelPrompts.length} chars`);
  return state;
}

function runConvergence(state) {
  console.log('\n  Waves 2-4: Convergence Pipeline (triage → adjudicate → assemble)...');

  // Build the full state document for convergence
  const stateText = [
    `## SECTION 1: FASTOPS OS PULSE — What happened in last 24h`,
    `### Git Activity\n${state.gitLog}`,
    `### Uncommitted Work: ${state.uncommitted} files`,
    `### Open Marketplace Problems\n${state.marketplace}`,
    `### City Brief\n${state.oneliner}`,
    `### Sessions Today: ${state.sessionCount}`,
    `### Recent Handoffs (what was built, wired, discussed, agreed)\n${state.handoffs.slice(0, 4000)}`,
    `### Legacy (recent signings)\n${state.legacy.slice(0, 2000)}`,
    `### Strategy Direction\n${state.strategy.slice(0, 1500)}`,
    ``,
    `## SECTION 2: CLOUD INFRASTRUCTURE STATE — Hybrid cloud deployment`,
    `### Deployment Status: ${state.cloud?.status || 'unknown'}`,
    `### DR Readiness: ${state.cloud?.drReady ? 'READY' : 'INCOMPLETE'} (${state.cloud?.details?.drScore || 0}%)`,
    `### Cloud BLUF: ${state.cloud?.bluf || 'No cloud data available'}`,
    `### Open Cloud Alerts: ${state.cloud?.details?.openAlerts || 0}`,
    `### Cloud Decisions: ${state.cloud?.decisions?.map(d => `[${d.priority}] ${d.text}`).join('; ') || 'None'}`,
    ``,
    `## SECTION 3: JOEL'S REQUESTS — Prompts from all sessions today`,
    `${state.joelPrompts.slice(0, 3000)}`,
  ].join('\n\n');

  const question = `You are a founding model of the FastOps City — a democratic collective of AI architectures building AGI through convergence. Produce a structured daily brief with EXACTLY these 3 sections:

SECTION 1 — FASTOPS OS PULSE: Synthesize the handoffs, legacy, git activity, and strategy into: (a) What was built, wired, QC'd, validated in last 24h — list items. (b) What was discussed and agreed upon — list items. (c) Unanswered or lingering questions — list items. (d) What still needs peer review — list items.

SECTION 2 — JOEL'S OPEN REQUESTS: Review Joel's prompts from today's sessions. For each action Joel requested: was it completed? If not, is it still relevant? What needs to be done? — list items.

SECTION 3 — CONVERGENCE & MISALIGNMENT: Across all sessions and data, where are multiple agents/models independently arriving at the same conclusions? Where are they contradicting each other? What problems has the city identified? — list items.

Here is today's data:

${stateText}`;

  // Write question to temp file, then pass via --problem-file to avoid shell length limits
  const tmpFile = path.join(BASE, '.dawn-question-tmp.txt');
  fs.writeFileSync(tmpFile, question);

  // Run through city-voice (4-step converged voice pipeline V2)
  // Steps: RAW SEARCH → DELIBERATION → INDEPENDENT SYNTHESIS → MATHEMATICAL CONVERGENCE
  // No single model writes the voice. The voice emerges from overlap.
  const result = exec(
    `node "${path.join(BASE, 'city-voice.js')}" --problem-file "${tmpFile}" --models 6 --rounds 2`,
    { timeout: 900000, fallback: '[Voice pipeline failed — see logs]' }
  );

  try { fs.unlinkSync(tmpFile); } catch {}

  return { stateText, pipelineResult: result };
}

// ════════════════════════════════════════
// PHASE 1.5: PERPLEXITY INDUSTRY INTEL
// ════════════════════════════════════════

function runPerplexityIntel(pipelineResult) {
  console.log('\n  Phase 1.5: Perplexity Industry Intel...');

  // Extract key themes — sanitize to pure industry queries (no internal jargon)
  const queries = [
    'multi-model AI orchestration multi-agent systems production 2026',
    'democratic AI governance collective intelligence architectures 2026',
    'AI model convergence ensemble methods beyond simple voting 2026'
  ];

  const results = [];
  for (const q of queries) {
    console.log(`    Searching: ${q.slice(0, 60)}...`);
    const result = exec(
      `node "${path.join(BASE, 'perplexity-query-repo.js')}" "${q}" --no-repo --kb-limit 3`,
      { timeout: 60000, fallback: '[Perplexity unavailable]' }
    );
    if (!result.includes('[Perplexity unavailable]')) {
      // Strip Perplexity self-referential preamble (dotenv noise, "I'm Perplexity" disclaimers)
      const cleaned = result
        .replace(/\[dotenv@[^\]]+\][^\n]*\n?/g, '')
        .replace(/I appreciate you sharing.*?(?=\n\n|\n[A-Z#])/s, '')
        .replace(/I'm Perplexity.*?(?=\n\n|\n[A-Z#])/s, '')
        .trim();
      if (cleaned.length > 50) results.push(`### ${q}\n${cleaned.slice(0, 1000)}`);
    }
  }

  if (results.length === 0) return 'Perplexity unavailable — skipped industry intel.';
  return results.join('\n\n');
}

function writeBrief(state, convergence, industryIntel) {
  console.log('\n  Writing daily brief...');

  // Extract convergence stats — try pipeline stdout first, then fall back to artifact file
  let pipelineOutput = convergence.pipelineResult || '';
  let score = 0;

  // Try extracting from stdout
  const scoreMatch = pipelineOutput.match(/Convergence Score:\*?\*?\s*([\d.]+)/) ||
                     pipelineOutput.match(/CONVERGENCE SCORE: ([\d.]+)/);
  if (scoreMatch) {
    score = parseFloat(scoreMatch[1]);
  } else {
    // Fallback: read the most recent voice artifact file
    try {
      const voiceFiles = fs.readdirSync(BASE)
        .filter(f => f.startsWith('_voice-') && f.endsWith('.json'))
        .sort((a, b) => fs.statSync(path.join(BASE, b)).mtimeMs - fs.statSync(path.join(BASE, a)).mtimeMs);
      if (voiceFiles.length > 0) {
        const artifact = JSON.parse(fs.readFileSync(path.join(BASE, voiceFiles[0]), 'utf8'));
        score = artifact.convergenceScore || 0;
        // Reconstruct pipeline output from artifact if stdout was empty/failed
        if (!pipelineOutput || pipelineOutput.includes('[Voice pipeline failed') || pipelineOutput.includes('[ERROR')) {
          pipelineOutput = [
            `# THE CONVERGED VOICE\n`,
            `**Models:** ${artifact.models?.length || '?'} (${new Set((artifact.models||[]).map(m => 'unknown')).size} families)`,
            `**Convergence Score:** ${score.toFixed(2)}`,
            `\n---\n`,
            `## CORE TRUTH (converged across architectures)`,
            artifact.coreVoice || '(No claims reached convergence)',
            `\n## EMERGING SIGNALS (2+ models, not yet strong convergence)`,
            artifact.emergingVoice || '(None)',
            `\n## DIVERGENCE (unique to one model — exploration opportunities)`,
            artifact.divergenceReport || '(None)',
          ].join('\n');
        }
        console.log(`    [recovery] Loaded score ${score.toFixed(2)} from artifact: ${voiceFiles[0]}`);
      }
    } catch {}
  }

  const scoreLabel = score >= 0.7 ? 'STRONG' : score >= 0.4 ? 'PARTIAL' : 'WEAK';

  // Extract core truth section
  const coreMatch = pipelineOutput.match(/## CORE TRUTH[^\n]*\n([\s\S]*?)(?=\n## |$)/);
  const coreTruth = coreMatch ? coreMatch[1].trim() : '(No convergence detected)';
  const claims = (coreTruth.match(/^- .+/gm) || []);

  // BLUF: synthesize state (working / blocked / changed) — not just echo top claim
  const strongClaims = claims.filter(c => /\[STRONG/i.test(c));
  const blockerClaims = claims.filter(c => /blocker|deadlock|gap|rejection|missing|lack/i.test(c));
  const changeClaims = claims.filter(c => /implement|deploy|merge|built|refine/i.test(c));

  let bluf = '';
  if (changeClaims.length > 0) {
    bluf += `${changeClaims.length} deliverable(s) shipped. `;
  }
  if (strongClaims.length > 0) {
    bluf += `${strongClaims.length} claim(s) at STRONG convergence across ${strongClaims.length > 0 ? strongClaims[0].match(/\[STRONG:\s*([^\]]+)\]/i)?.[1]?.split(',').length || '?' : '?'}+ families. `;
  }
  if (blockerClaims.length > 0) {
    const topBlocker = blockerClaims[0].replace(/^-\s*/, '').replace(/\[.+?\]/g, '').trim().slice(0, 120);
    bluf += `Key blocker: ${topBlocker}`;
  } else {
    bluf += 'No blockers — city is self-sufficient.';
  }

  // DECISIONS: extract max 3 CEO-worthy items from converged claims
  const decisionKeywords = /blocker|deadlock|gap|decision|rejection|need.*for|how to|missing|lack|wire.*existing/i;
  const decisionCandidates = claims
    .filter(c => decisionKeywords.test(c))
    .map(c => c.replace(/^-\s*/, '').replace(/\[.+?\]/g, '').trim())
    .slice(0, 3);

  const decisionsSection = decisionCandidates.length > 0
    ? decisionCandidates.map(d => `- ${d}`).join('\n')
    : '*(The city is self-sufficient today — no decisions needed.)*';

  const brief = `# Daily Brief — ${DATE_STR}

**${scoreLabel} convergence (${score.toFixed(2)}) across ${state.sessionCount} sessions | ${new Date().toISOString().slice(0,16)}**

> **BLUF:** ${bluf}

---

## CORE TRUTH (converged across architectures)

${coreTruth}

---

## DECISIONS FOR JOEL (max 3)

*Each needs your call. Silence = city proceeds with default.*

${decisionsSection}

---

## INDUSTRY INTEL

${industryIntel || 'Not run — use --with-intel flag or wait for nightly'}

---

## AUTO-DISPATCHED (city is already moving)

| Owner | Task | ETA |
|-------|------|-----|
| City marketplace | Work items dispatched to 30 models | Tonight |

Self-selection = reputation data. Log: .fastops/dawn-mobilize-${DATE_STR}.jsonl

---

## INFRASTRUCTURE STATE

| Component | Status | Notes |
|-----------|--------|-------|
| Cloud Deployment | ${state.cloud?.status || 'unknown'} | ${state.cloud?.bluf || 'No data'} |
| DR Readiness | ${state.cloud?.drReady ? 'READY' : 'INCOMPLETE'} | ${state.cloud?.details?.drScore || 0}% score |
| Open Alerts | ${state.cloud?.details?.openAlerts || 0} | ${state.cloud?.decisions?.length || 0} decisions queued |

${state.cloud?.decisions?.length > 0 ? `**Cloud Decisions:**\n${state.cloud.decisions.map(d => `- [${d.priority}] ${d.text.slice(0, 100)}${d.text.length > 100 ? '...' : ''}`).join('\n')}` : ''}

---

## FULL CONVERGENCE DATA

<details>
<summary>Pipeline output (click to expand)</summary>

${pipelineOutput}

</details>

---
*Pipeline: RAW SEARCH → DELIBERATION TO BEDROCK → INDEPENDENT SYNTHESIS → MATHEMATICAL CONVERGENCE*
*Review: node .fastops/city-brief-template.js --approve*
`;

  fs.writeFileSync(BRIEF_FILE, brief);
  console.log(`    Brief written: ${BRIEF_FILE}`);
  ledgerLog('brief-generated', { date: DATE_STR, path: BRIEF_FILE });
  return BRIEF_FILE;
}

// ════════════════════════════════════════
// PHASE 2: MOBILIZE
// ════════════════════════════════════════

function mobilize(briefPath) {
  console.log('\n  Phase 2: MOBILIZE — dispatching to 30 models...\n');

  const briefContent = fs.readFileSync(briefPath, 'utf8');
  // Truncate brief for prompt (keep under 2000 chars for cost efficiency)
  const briefExcerpt = briefContent.slice(0, 2000);

  const mobilizePrompt = `You are a founding model of the FastOps City — a democratic collective of AI architectures building AGI through convergence.

Here is today's daily brief (synthesized from multi-model convergence):

${briefExcerpt}

YOUR TASK: Given this context and your architecture's unique strengths, where can YOU create the highest-value impact? Pick ONE specific thing and explain:
1. What you would do (be specific — name files, systems, approaches)
2. Why YOUR architecture is well-suited for this
3. What the expected outcome is

This is not a test. This is real work. Your choice and reasoning will be tracked over time to understand where each architecture creates the most value.`;

  // Write prompt to temp file to avoid shell issues
  const promptFile = path.join(BASE, '.dawn-mobilize-prompt.txt');
  fs.writeFileSync(promptFile, mobilizePrompt);

  const responses = [];
  const pool = INITIAL_POOL;

  // Batch in waves of 5 for rate limit safety
  for (let i = 0; i < pool.length; i += 5) {
    const batch = pool.slice(i, i + 5);
    console.log(`  Wave ${Math.floor(i / 5) + 1}/${Math.ceil(pool.length / 5)}: ${batch.join(', ')}`);

    for (const model of batch) {
      process.stdout.write(`    ${model}... `);
      let response = exec(
        `node "${path.join(BASE, 'ask-model.js')}" --model ${model} --prompt-file "${promptFile}"`,
        { timeout: 60000, fallback: `[ERROR: timeout or failure]` }
      );
      // Retry once on transient network errors
      if (response.includes('ENOTFOUND') || response.includes('ECONNRESET') || response.includes('ETIMEDOUT')) {
        const wait = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} };
        wait(5000);
        process.stdout.write(`[retry] `);
        response = exec(
          `node "${path.join(BASE, 'ask-model.js')}" --model ${model} --prompt-file "${promptFile}"`,
          { timeout: 60000, fallback: `[ERROR: retry failed]` }
        );
      }

      const entry = {
        model,
        date: DATE_STR,
        timestamp: new Date().toISOString(),
        response: response.slice(0, 1000),
        wordCount: response.split(/\s+/).length
      };
      responses.push(entry);
      console.log(`${entry.wordCount} words`);

      // Append to mobilize log
      fs.appendFileSync(MOBILIZE_LOG, JSON.stringify(entry) + '\n');
    }

    // Cooldown between waves (cross-platform)
    if (i + 5 < pool.length) {
      console.log('    [cooldown 10s]');
      const wait = (ms) => { const end = Date.now() + ms; while (Date.now() < end) {} };
      wait(10000);
    }
  }

  try { fs.unlinkSync(promptFile); } catch {}

  console.log(`\n  Phase 2 complete: ${responses.length} models mobilized`);
  console.log(`  Log: ${MOBILIZE_LOG}`);
  ledgerLog('mobilize-complete', { date: DATE_STR, models: responses.length, log: MOBILIZE_LOG });

  return responses;
}

// ════════════════════════════════════════
// CDP WAKE
// ════════════════════════════════════════

function fireCDPWake() {
  console.log('\n  Firing CDP wake for Cursor agents...');
  const cdpWake = path.join(BASE, 'cdp', 'cdp-wake.js');
  if (fs.existsSync(cdpWake)) {
    exec(`node "${cdpWake}" --message "CITY DAWN: Daily brief + mobilization complete. QC needed: ${BRIEF_FILE}"`, { timeout: 30000 });
    console.log('    CDP wake fired.');
  } else {
    console.log('    cdp-wake.js not found — skipping.');
  }
}

// ════════════════════════════════════════
// MAIN CYCLE
// ════════════════════════════════════════

function runFullCycle() {
  console.log(`\n═══ CITY DAWN — ${DATE_STR} ═══`);
  console.log(`Pool: ${INITIAL_POOL.length} models\n`);

  ledgerLog('cycle-start', { date: DATE_STR, poolSize: INITIAL_POOL.length });

  // Phase 1: Synthesize
  console.log('╔══ PHASE 1: SYNTHESIZE ══╗');
  const state = harvestState();
  const convergence = runConvergence(state);

  // Phase 1.5: Perplexity Industry Intel
  console.log('\n╔══ PHASE 1.5: INDUSTRY INTEL ══╗');
  const industryIntel = runPerplexityIntel(convergence.pipelineResult);

  const briefPath = writeBrief(state, convergence, industryIntel);

  // Phase 2: Mobilize
  console.log('\n╔══ PHASE 2: MOBILIZE ══╗');
  const responses = mobilize(briefPath);

  // CDP Wake
  fireCDPWake();

  console.log(`\n═══ CITY DAWN COMPLETE ═══`);
  console.log(`Brief: ${briefPath}`);
  console.log(`Mobilized: ${responses.length} models`);
  console.log(`Mobilize log: ${MOBILIZE_LOG}\n`);

  return { briefPath, responses };
}

// ════════════════════════════════════════
// CLI
// ════════════════════════════════════════

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--run')) {
    runFullCycle();
  } else if (args.includes('--synthesize')) {
    console.log('╔══ PHASE 1 ONLY: SYNTHESIZE ══╗');
    const state = harvestState();
    const convergence = runConvergence(state);
    const intel = args.includes('--with-intel') ? runPerplexityIntel(convergence.pipelineResult) : null;
    writeBrief(state, convergence, intel);
  } else if (args.includes('--mobilize')) {
    if (fs.existsSync(BRIEF_FILE)) {
      console.log('╔══ PHASE 2 ONLY: MOBILIZE ══╗');
      mobilize(BRIEF_FILE);
    } else {
      console.error(`No brief found for today. Run --synthesize first.`);
    }
  } else if (args.includes('--status')) {
    console.log(`Date: ${DATE_STR}`);
    console.log(`Brief exists: ${fs.existsSync(BRIEF_FILE)}`);
    console.log(`Mobilize log exists: ${fs.existsSync(MOBILIZE_LOG)}`);
    if (fs.existsSync(MOBILIZE_LOG)) {
      const lines = fs.readFileSync(MOBILIZE_LOG, 'utf8').trim().split('\n').filter(Boolean);
      console.log(`Models mobilized: ${lines.length}`);
    }
  } else {
    console.log(`City Dawn — Nightly 2-Phase Convergence Orchestrator

  --run           Full cycle (synthesize + mobilize + CDP wake)
  --synthesize    Phase 1 only: harvest state, converge, write brief
  --mobilize      Phase 2 only: dispatch work to 30 models (requires brief)
  --status        Check today's dawn cycle status

Scaffold by Grok-Full. Wired by MUSTER. Designed by 16 models.`);
  }
}

module.exports = { runFullCycle, harvestState, runConvergence, writeBrief, mobilize };

const gaps = execSync('node .fastops/city-brief.js --gaps', {cwd: __dirname + '/..'}).toString().trim().split(String.fromCharCode(10)).filter(g => g.trim());
const pFile = '.fastops/marketplace/problems.jsonl';
const existing = fs.readFileSync(pFile, 'utf8').split(String.fromCharCode(10)).filter(l => l.trim()).map(l => JSON.parse(l));
let posted = 0, tracked = 0;
gaps.forEach(gap => {
    const gw = new Set(gap.toLowerCase().split(/\W+/).filter(w => w.length > 3));
    const dup = existing.some(p => {
        const pw = new Set(p.title.toLowerCase().split(/\W+/).filter(w => w.length > 3));
        const inter = [...gw].filter(w => pw.has(w)).length;
        return inter / (gw.size + pw.size - inter) > 0.5;
    });
    if (dup) {
        tracked++;
    } else {
        const prob = {
            id: crypto.randomBytes(4).toString('hex'),
            title: gap.slice(0, 80),
            domain: 'city-dawn',
            difficulty: 'easy',
            postedBy: 'city-dawn',
            status: 'open',
            timestamp: new Date().toISOString(),
            participants: [],
            metrics: [],
            description: gap
        };
        fs.appendFileSync(pFile, JSON.stringify(prob) + String.fromCharCode(10));
        posted++;
    }
});
console.log('Dawn:', gaps.length, 'gaps,', posted, 'new,', tracked, 'tracked');