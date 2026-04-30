#!/usr/bin/env node
/**
 * city-qc.js — Two-stage adversarial code review with convergence filtering.
 *
 * Stage 1: N models review source files for bugs (different architectures = different blind spots)
 * Stage 2: M different models verify Stage 1 findings against actual code (false positive filter)
 *
 * The thesis: reviewers who see actual code find real bugs. Cross-architecture convergence
 * separates signal from noise. Two stages reduce false positives because Stage 2 reviewers
 * have a DIFFERENT task (verify claims) than Stage 1 (find bugs).
 *
 * Usage:
 *   node .fastops/city-qc.js --files src/a.js src/b.js
 *   node .fastops/city-qc.js --files src/*.js --stage1-count 15 --stage2-count 5
 *   node .fastops/city-qc.js --files src/*.js --stage1-only
 *   node .fastops/city-qc.js --resume <results-file>   # Resume from Stage 1 results
 *
 * Designed by the city + Claude (Opus 4.6) after proving that:
 * - Reviewers without code produce 10+ false positives (DeepSeek-R1 round 1)
 * - Reviewers with code produce 4 real bugs + 3 false positives (round 2)
 * - 2/3 reviewers shared a NATS wildcard training bias — cross-architecture catches this
 * - Stage 2 verification is what the orchestrator did manually — now automated
 */

const fs = require('fs');
const path = require('path');
const { askModelAsync } = require('./safe-exec');

const ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(__dirname, '.qc-results');
if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true });

// ── Architecture families — maximize diversity in each stage ──────
// Models in the same family share training biases. Stages should span families.
const ARCH_FAMILIES = {
  google:    ['gemini', 'gemini-flash', 'gemma-3n'],
  xai:       ['grok', 'grok-full'],
  deepseek:  ['deepseek', 'deepseek-r1', 'deepseek-v3.2', 'deepseek-r1t2'],
  openai:    ['gpt', 'gpt-5'],
  alibaba:   ['qwen', 'qwen-max', 'qwen-max-think', 'qwen-coder', 'qwen-32b', 'qwen-30b', 'qwen-235b', 'qwq'],
  mistral:   ['mistral', 'mistral-small', 'codestral', 'devstral'],
  meta:      ['llama', 'llama-scout', 'llama-70b'],
  nvidia:    ['nemotron-120b', 'nemotron-nano', 'nemotron-ultra'],
  moonshot:  ['kimi-k2', 'kimi-k2-think'],
  inception: ['mercury', 'mercury-coder'],
  baidu:     ['ernie', 'ernie-think'],
  nous:      ['hermes-405b', 'hermes-70b'],
  zhipu:     ['glm-5', 'glm-flash'],
  cohere:    ['command-a'],
  minimax:   ['minimax', 'minimax-m2.7'],
  bytedance: ['seed-2'],
  writer:    ['palmyra'],
  ai21:      ['jamba'],
  upstage:   ['solar-pro'],
  ibm:       ['granite'],
  liquid:    ['lfm'],
  microsoft: ['phi-4'],
  amazon:    ['nova'],
  tencent:   ['hunyuan'],
  cogito:    ['cogito'],
  aion:      ['aion', 'aion-mini'],
  perplexity:['sonar', 'sonar-pro', 'sonar-reasoning-pro'],
};

// Invert: model → family
const MODEL_FAMILY = {};
for (const [family, models] of Object.entries(ARCH_FAMILIES)) {
  for (const m of models) MODEL_FAMILY[m] = family;
}

// ── Select diverse models ────────────────────────────────────────────
// Pick one model per family, randomize order, take N
function selectDiverse(count, exclude = []) {
  const excludeFamilies = new Set(exclude.map(m => MODEL_FAMILY[m]).filter(Boolean));
  const candidates = [];

  for (const [family, models] of Object.entries(ARCH_FAMILIES)) {
    if (excludeFamilies.has(family)) continue;
    // Prefer first model in each family (usually the strongest)
    const available = models.filter(m => !exclude.includes(m));
    if (available.length > 0) candidates.push({ family, model: available[0] });
  }

  // Shuffle for randomness
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }

  return candidates.slice(0, count).map(c => c.model);
}

// ── Stage 1: Find bugs ──────────────────────────────────────────────
const STAGE1_PROMPT = `You are a senior systems engineer performing adversarial code review. The attached files were written by different developers who did not see each other's code. Your job: find where their assumptions diverge and things ACTUALLY break.

RULES:
- Only flag issues you can PROVE from the attached code. No speculation about what "might" happen.
- For each issue, cite the EXACT filename, line number, and the code.
- Distinguish CRITICAL (will crash, lose data, or break integration) from MINOR (suboptimal but works).
- If something looks suspicious but is actually handled correctly in the code, say "NOT A BUG" and explain why.

OUTPUT FORMAT (strict — one JSON array):
[
  {
    "id": 1,
    "severity": "CRITICAL" or "MINOR",
    "title": "Short description",
    "file": "filename.js",
    "line": 42,
    "code": "the problematic code snippet",
    "explanation": "What breaks and why",
    "fix": "How to fix it"
  }
]

Return ONLY the JSON array. No markdown fences, no preamble.`;

// ── Stage 2: Verify findings ────────────────────────────────────────
function buildStage2Prompt(findings) {
  return `You are a senior systems engineer performing VERIFICATION of code review findings. Other reviewers flagged potential bugs in the attached code. Your job: check each claim against the ACTUAL CODE and determine if it's real or a false positive.

For each finding below, read the cited file and line, then verdict: CONFIRMED (the bug is real) or FALSE_POSITIVE (the code actually handles this correctly).

FINDINGS TO VERIFY:
${findings.map((f, i) => `
[Finding ${i + 1}] ${f.severity}: ${f.title}
  File: ${f.file}, Line: ${f.line}
  Code: ${f.code}
  Claim: ${f.explanation}
`).join('\n')}

OUTPUT FORMAT (strict — one JSON array):
[
  {
    "findingId": 1,
    "verdict": "CONFIRMED" or "FALSE_POSITIVE",
    "evidence": "Quote the exact code that proves your verdict",
    "explanation": "Why this is real or why the reviewer was wrong"
  }
]

Return ONLY the JSON array. No markdown fences, no preamble.`;
}

// ── Parse JSON from model response ───────────────────────────────────
function parseJSON(text) {
  if (!text) return null;
  // Strip markdown fences if present
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  // Find first [ and last ]
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

// ── Run Stage 1 ─────────────────────────────────────────────────────
async function runStage1(files, models, concurrency = 5) {
  console.log(`\n=== STAGE 1: CODE REVIEW (${models.length} reviewers) ===\n`);
  console.log(`Files: ${files.map(f => path.basename(f)).join(', ')}`);
  console.log(`Reviewers: ${models.join(', ')}\n`);

  const results = [];
  const batches = [];
  for (let i = 0; i < models.length; i += concurrency) {
    batches.push(models.slice(i, i + concurrency));
  }

  for (const batch of batches) {
    const promises = batch.map(model => {
      console.log(`  [S1] Querying ${model}...`);
      return askModelAsync(model, STAGE1_PROMPT, { files, timeout: 180000 })
        .then(r => {
          const findings = parseJSON(r.response);
          const count = findings ? findings.length : 0;
          console.log(`  [S1] ${r.model}: ${count} findings (${r.elapsed || '?'}s)`);
          return { model: r.model, findings: findings || [], raw: r.response, error: r.error };
        });
    });
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
  }

  return results;
}

// ── Convergence filter: cluster similar findings ─────────────────────
function clusterFindings(stage1Results) {
  const allFindings = [];
  for (const r of stage1Results) {
    if (!r.findings) continue;
    for (const f of r.findings) {
      allFindings.push({ ...f, reviewer: r.model, family: MODEL_FAMILY[r.model] || 'unknown' });
    }
  }

  // Cluster by semantic similarity: file match OR keyword overlap in title+explanation
  const clusters = [];

  function similarity(a, b) {
    // Combine title + explanation for richer matching
    const textA = `${a.title || ''} ${a.explanation || ''}`.toLowerCase();
    const textB = `${b.title || ''} ${b.explanation || ''}`.toLowerCase();
    const wordsA = new Set(textA.split(/\s+/).filter(w => w.length > 2));
    const wordsB = textB.split(/\s+/).filter(w => w.length > 2);
    const overlap = wordsB.filter(w => wordsA.has(w)).length;
    const total = Math.max(wordsA.size, wordsB.length);
    return total > 0 ? overlap / total : 0;
  }

  for (const finding of allFindings) {
    let bestCluster = null;
    let bestScore = 0;
    for (const cluster of clusters) {
      const rep = cluster[0];
      // Same file is a strong signal
      const sameFile = (rep.file || '').replace(/.*[\\/]/, '') === (finding.file || '').replace(/.*[\\/]/, '');
      const lineDist = Math.abs((rep.line || 0) - (finding.line || 0));
      const sim = similarity(rep, finding);

      // Match if: same file + close lines + any word overlap, OR high text similarity regardless
      let score = 0;
      if (sameFile && lineDist <= 15 && sim > 0.15) score = sim + 0.3;
      else if (sim > 0.35) score = sim; // Different file but clearly same issue

      if (score > bestScore) {
        bestScore = score;
        bestCluster = cluster;
      }
    }
    if (bestCluster && bestScore > 0.2) {
      bestCluster.push(finding);
    } else {
      clusters.push([finding]);
    }
  }

  // Score clusters: more independent reviewers from different families = higher confidence
  return clusters.map(cluster => {
    const families = new Set(cluster.map(f => f.family));
    const reviewers = cluster.map(f => f.reviewer);
    return {
      representative: cluster[0],
      count: cluster.length,
      families: families.size,
      reviewers,
      confidence: cluster.length === 1 ? 'low' : families.size >= 2 ? 'high' : 'medium',
      allFindings: cluster,
    };
  }).sort((a, b) => b.families - a.families || b.count - a.count);
}

// ── Run Stage 2 ─────────────────────────────────────────────────────
const STAGE2_CHUNK_SIZE = 8; // Max findings per verifier call to avoid output truncation

async function runStage2(files, clusteredFindings, models, concurrency = 3) {
  const toVerify = clusteredFindings.map(c => c.representative);

  // Chunk findings so each verifier call handles ≤ STAGE2_CHUNK_SIZE
  const findingChunks = [];
  for (let i = 0; i < toVerify.length; i += STAGE2_CHUNK_SIZE) {
    findingChunks.push({ findings: toVerify.slice(i, i + STAGE2_CHUNK_SIZE), offset: i });
  }

  console.log(`\n=== STAGE 2: VERIFICATION (${models.length} verifiers, ${toVerify.length} findings in ${findingChunks.length} chunks) ===\n`);
  console.log(`Verifiers: ${models.join(', ')}\n`);

  const allResults = [];

  for (const chunk of findingChunks) {
    const prompt = buildStage2Prompt(chunk.findings);
    console.log(`  --- Chunk: findings ${chunk.offset + 1}-${chunk.offset + chunk.findings.length} ---`);

    const batches = [];
    for (let i = 0; i < models.length; i += concurrency) {
      batches.push(models.slice(i, i + concurrency));
    }

    for (const batch of batches) {
      const promises = batch.map(model => {
        console.log(`  [S2] Querying ${model}...`);
        return askModelAsync(model, prompt, { files, timeout: 180000 })
          .then(r => {
            const verdicts = parseJSON(r.response);
            // Remap findingIds to global indices
            const remapped = (verdicts || []).map(v => ({
              ...v,
              findingId: v.findingId + chunk.offset,
            }));
            const count = remapped.length;
            console.log(`  [S2] ${r.model}: ${count} verdicts (${r.elapsed || '?'}s)`);
            return { model: r.model, verdicts: remapped, raw: r.response, error: r.error };
          });
      });
      const batchResults = await Promise.all(promises);
      allResults.push(...batchResults);
    }
  }

  // Merge per-model results across chunks
  const merged = {};
  for (const r of allResults) {
    if (!merged[r.model]) merged[r.model] = { model: r.model, verdicts: [], raw: '', error: null };
    merged[r.model].verdicts.push(...r.verdicts);
    merged[r.model].raw += r.raw || '';
  }

  return Object.values(merged);
}

// ── Merge Stage 2 verdicts ──────────────────────────────────────────
function mergeVerdicts(clusteredFindings, stage2Results) {
  const merged = clusteredFindings.map((cluster, idx) => {
    const findingId = idx + 1;
    const verdicts = [];
    for (const r of stage2Results) {
      if (!r.verdicts) continue;
      const v = r.verdicts.find(v => v.findingId === findingId);
      if (v) verdicts.push({ ...v, verifier: r.model, family: MODEL_FAMILY[r.model] || 'unknown' });
    }

    const confirmed = verdicts.filter(v => v.verdict === 'CONFIRMED').length;
    const falsePositive = verdicts.filter(v => v.verdict === 'FALSE_POSITIVE').length;
    const total = confirmed + falsePositive;

    let finalVerdict;
    if (total === 0) finalVerdict = 'UNVERIFIED';
    else if (confirmed > falsePositive) finalVerdict = 'CONFIRMED';
    else if (falsePositive > confirmed) finalVerdict = 'FALSE_POSITIVE';
    else finalVerdict = 'DISPUTED';

    return {
      ...cluster,
      verdicts,
      confirmed,
      falsePositive,
      finalVerdict,
    };
  });

  return merged;
}

// ── Print summary ───────────────────────────────────────────────────
function printSummary(merged) {
  console.log('\n' + '='.repeat(60));
  console.log('  FINAL QC REPORT');
  console.log('='.repeat(60) + '\n');

  const confirmed = merged.filter(m => m.finalVerdict === 'CONFIRMED');
  const disputed = merged.filter(m => m.finalVerdict === 'DISPUTED');
  const fp = merged.filter(m => m.finalVerdict === 'FALSE_POSITIVE');
  const unverified = merged.filter(m => m.finalVerdict === 'UNVERIFIED');

  console.log(`CONFIRMED BUGS: ${confirmed.length}`);
  for (const m of confirmed) {
    const r = m.representative;
    console.log(`  [${r.severity}] ${r.title}`);
    console.log(`    File: ${r.file}:${r.line}`);
    console.log(`    Found by: ${m.reviewers.join(', ')} (${m.count} independent, ${m.families} families)`);
    console.log(`    Verified: ${m.confirmed}/${m.confirmed + m.falsePositive}`);
    console.log(`    Fix: ${r.fix}`);
    console.log();
  }

  if (disputed.length > 0) {
    console.log(`\nDISPUTED (needs human review): ${disputed.length}`);
    for (const m of disputed) {
      const r = m.representative;
      console.log(`  [${r.severity}] ${r.title} — ${r.file}:${r.line}`);
      console.log(`    Confirmed: ${m.confirmed}, False positive: ${m.falsePositive}`);
    }
  }

  if (fp.length > 0) {
    console.log(`\nFALSE POSITIVES FILTERED: ${fp.length}`);
    for (const m of fp) {
      const r = m.representative;
      console.log(`  [${r.severity}] ${r.title} — ${r.file}:${r.line}`);
    }
  }

  if (unverified.length > 0) {
    console.log(`\nUNVERIFIED (Stage 2 couldn't parse): ${unverified.length}`);
    for (const m of unverified) {
      const r = m.representative;
      console.log(`  [${r.severity}] ${r.title} — ${r.file}:${r.line}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Total findings: ${merged.length} | Confirmed: ${confirmed.length} | False positives: ${fp.length} | Disputed: ${disputed.length}`);
  console.log('='.repeat(60) + '\n');
}

// ── CLI ─────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  // Parse args
  let files = [];
  let stage1Count = 15;
  let stage2Count = 5;
  let stage1Only = false;
  let resumeFile = null;
  let concurrency = 5;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--files') {
      i++;
      while (i < args.length && !args[i].startsWith('--')) {
        files.push(path.resolve(ROOT, args[i]));
        i++;
      }
      i--; // back up for the -- arg
    } else if (args[i] === '--stage1-count') { stage1Count = parseInt(args[++i]); }
    else if (args[i] === '--stage2-count') { stage2Count = parseInt(args[++i]); }
    else if (args[i] === '--stage1-only') { stage1Only = true; }
    else if (args[i] === '--resume') { resumeFile = args[++i]; }
    else if (args[i] === '--concurrency') { concurrency = parseInt(args[++i]); }
  }

  if (files.length === 0 && !resumeFile) {
    console.error('Usage: node city-qc.js --files file1.js file2.js [--stage1-count 15] [--stage2-count 5]');
    console.error('       node city-qc.js --resume <stage1-results.json>');
    process.exit(1);
  }

  // Verify files exist
  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.error(`File not found: ${f}`);
      process.exit(1);
    }
  }

  const runId = Date.now().toString(36);

  let stage1Results, clusteredFindings;

  if (resumeFile) {
    // Resume from saved Stage 1 results
    console.log(`Resuming from ${resumeFile}...`);
    const saved = JSON.parse(fs.readFileSync(resumeFile, 'utf8'));
    stage1Results = saved.stage1Results;
    clusteredFindings = saved.clusteredFindings;
    files = saved.files || files;
    console.log(`Loaded ${stage1Results.length} reviewers, ${clusteredFindings.length} clustered findings`);
  } else {
    // Stage 1: Select diverse reviewers and run
    const stage1Models = selectDiverse(stage1Count);
    stage1Results = await runStage1(files, stage1Models, concurrency);

    // Cluster findings
    clusteredFindings = clusterFindings(stage1Results);

    console.log(`\n--- STAGE 1 SUMMARY ---`);
    console.log(`Reviewers: ${stage1Results.length} (${stage1Results.filter(r => r.findings.length > 0).length} returned findings)`);
    console.log(`Total raw findings: ${stage1Results.reduce((sum, r) => sum + r.findings.length, 0)}`);
    console.log(`Clustered: ${clusteredFindings.length} unique issues`);
    for (const c of clusteredFindings) {
      const r = c.representative;
      console.log(`  [${c.confidence.toUpperCase()}] ${r.severity}: ${r.title} (${c.count} reviewers, ${c.families} families)`);
    }

    // Save Stage 1 results
    const stage1File = path.join(RESULTS_DIR, `stage1-${runId}.json`);
    fs.writeFileSync(stage1File, JSON.stringify({ files, stage1Results, clusteredFindings, runId }, null, 2));
    console.log(`\nStage 1 saved to: ${stage1File}`);
  }

  if (stage1Only) {
    console.log('\n--stage1-only: Skipping Stage 2.');
    process.exit(0);
  }

  if (clusteredFindings.length === 0) {
    console.log('\nNo findings to verify. Code looks clean across all reviewers.');
    process.exit(0);
  }

  // Stage 2: Select DIFFERENT architectures for verification
  const stage1Models = stage1Results.map(r => r.model);
  const stage2Models = selectDiverse(stage2Count, stage1Models);

  if (stage2Models.length === 0) {
    console.error('No models available for Stage 2 (all families used in Stage 1)');
    process.exit(1);
  }

  const stage2Results = await runStage2(files, clusteredFindings, stage2Models, Math.min(concurrency, stage2Models.length));

  // Merge verdicts
  const merged = mergeVerdicts(clusteredFindings, stage2Results);

  // Save full results
  const fullFile = path.join(RESULTS_DIR, `qc-${runId}.json`);
  fs.writeFileSync(fullFile, JSON.stringify({ files, stage1Results, clusteredFindings, stage2Results, merged, runId }, null, 2));
  console.log(`\nFull results saved to: ${fullFile}`);

  // Print summary
  printSummary(merged);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
