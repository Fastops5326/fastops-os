#!/usr/bin/env node
/**
 * city-solve.js — One-command product pipeline.
 *
 * Takes a data file + question, runs the full city pipeline:
 *   1. Extract data (xlsx/csv/json)
 *   2. Anonymize via Presidio (PII stripped, reversible mapping)
 *   3. Run hierarchical convergence (V2) across N models
 *   4. De-anonymize the output
 *   5. Produce structured results
 *
 * Usage:
 *   node .fastops/city-solve.js --input data.xlsx --question "Which candidates will pass?"
 *   node .fastops/city-solve.js --input data.json --question "..." --models 15 --output results.json
 *   node .fastops/city-solve.js --input data.csv --question "..." --all --no-deanon
 *
 * Built by TRIDENT, 2026-03-31. Architecture designed by 23 models.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// ═══ CONFIGURATION ═══
const FASTOPS = __dirname;
const PRESIDIO = path.join(FASTOPS, 'presidio-node.js');
const CONVERGE_V2 = path.join(FASTOPS, 'city-converge-v2.js');
const WORK_DIR = path.join(FASTOPS, '_solve-work');

// Default model pools by size
const MODEL_POOLS = {
  5:  ['mistral', 'deepseek', 'grok', 'gpt', 'kimi-k2'],
  10: ['mistral', 'deepseek', 'grok', 'gemini', 'gpt', 'kimi-k2', 'hermes-405b', 'qwen', 'llama', 'cogito'],
  15: ['mistral', 'deepseek', 'grok', 'gemini', 'gpt', 'kimi-k2', 'hermes-405b', 'qwen', 'llama', 'cogito', 'codestral', 'palmyra', 'command-a', 'phi-4', 'ernie'],
  25: ['mistral', 'deepseek', 'grok', 'gemini', 'gpt', 'kimi-k2', 'hermes-405b', 'qwen', 'llama', 'cogito',
       'codestral', 'palmyra', 'command-a', 'phi-4', 'ernie', 'deepseek-r1', 'devstral', 'nemotron-ultra',
       'haiku', 'nova', 'mistral-small', 'qwen-32b', 'glm-5', 'mercury', 'gpt-5']
};

// ═══ STEP 1: EXTRACT DATA ═══
function extractData(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();
  console.log(`\n[1/5] EXTRACT — ${path.basename(inputPath)} (${ext})`);

  if (ext === '.json') {
    const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    console.log(`  Loaded ${Array.isArray(data) ? data.length + ' records' : 'object'} from JSON`);
    return data;
  }

  if (ext === '.csv') {
    const lines = fs.readFileSync(inputPath, 'utf8').trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const records = lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const obj = {};
      headers.forEach((h, i) => obj[h] = vals[i] || '');
      return obj;
    });
    console.log(`  Parsed ${records.length} records from CSV (${headers.length} columns)`);
    return records;
  }

  if (ext === '.xlsx' || ext === '.xls') {
    let xlsx;
    try { xlsx = require('xlsx'); }
    catch {
      console.log('  Installing xlsx module...');
      execFileSync('npm', ['install', 'xlsx', '--no-save'], { cwd: path.join(FASTOPS, '..'), encoding: 'utf8' });
      xlsx = require('xlsx');
    }
    const wb = xlsx.readFile(inputPath);
    const sheets = {};
    for (const name of wb.SheetNames) {
      const data = xlsx.utils.sheet_to_json(wb.Sheets[name]);
      if (data.length > 0) {
        sheets[name] = data;
        console.log(`  Sheet "${name}": ${data.length} records, ${Object.keys(data[0]).length} columns`);
      }
    }
    // Return largest sheet as primary, all sheets as metadata
    const primary = Object.entries(sheets).sort((a, b) => b[1].length - a[1].length)[0];
    if (!primary) throw new Error('No data found in xlsx file');
    console.log(`  Primary sheet: "${primary[0]}" (${primary[1].length} records)`);
    return { records: primary[1], allSheets: sheets, primarySheet: primary[0] };
  }

  throw new Error(`Unsupported file type: ${ext}. Use .json, .csv, or .xlsx`);
}

// ═══ STEP 2: ANONYMIZE ═══
function anonymize(data, workDir) {
  console.log(`\n[2/5] ANONYMIZE — Presidio PII protection`);

  const records = Array.isArray(data) ? data : data.records;
  const inputFile = path.join(workDir, 'raw-input.json');
  const anonFile = path.join(workDir, 'anonymized.json');
  const mappingFile = path.join(workDir, 'pii-mapping.json');

  fs.writeFileSync(inputFile, JSON.stringify(records, null, 2));

  const result = execFileSync('node', [PRESIDIO, '--input', inputFile, '--output', anonFile, '--mapping', mappingFile], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  });
  console.log(`  ${result.trim()}`);

  const anonData = JSON.parse(fs.readFileSync(anonFile, 'utf8'));
  console.log(`  Anonymized data: ${anonFile}`);
  console.log(`  PII mapping (DO NOT SHARE): ${mappingFile}`);

  return { anonData, anonFile, mappingFile };
}

// ═══ STEP 3: RUN CITY (hierarchical convergence V2) ═══
async function runCity(question, anonFile, models, teamSize, timeout) {
  console.log(`\n[3/5] CITY — Hierarchical convergence V2`);
  console.log(`  Models: ${models.length}, Team size: ${teamSize}`);

  // Import V2
  const { hierarchicalConverge } = require(CONVERGE_V2);

  const result = await hierarchicalConverge(question, models, {
    timeout,
    fileContext: anonFile,
    teamSize
  });

  return result;
}

// ═══ STEP 4: DE-ANONYMIZE (Gap 1 — city-deliberated: prevention + fuzzy recovery) ═══
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

function deanonymize(text, mappingFile) {
  console.log(`\n[4/5] DE-ANONYMIZE — Restoring real identifiers`);

  if (!text || !mappingFile || !fs.existsSync(mappingFile)) {
    console.log('  Skipped (no mapping file or no text)');
    return text;
  }

  const mapping = JSON.parse(fs.readFileSync(mappingFile, 'utf8'));
  let result = text;
  let exactReplacements = 0;
  let fuzzyReplacements = 0;

  if (mapping.names) {
    // Pass 1: Exact matching (fast path)
    for (const [real, pseudo] of Object.entries(mapping.names)) {
      if (result.includes(pseudo)) {
        result = result.split(pseudo).join(real);
        exactReplacements++;
      }
    }

    // Pass 2: Fuzzy matching for pseudonyms that were paraphrased
    // Extract all capitalized multi-word phrases from output that might be pseudonyms
    const unmatchedPseudos = Object.entries(mapping.names)
      .filter(([real, pseudo]) => !text.includes(pseudo))
      .map(([real, pseudo]) => ({ real, pseudo }));

    if (unmatchedPseudos.length > 0) {
      // Find candidate phrases in text (capitalized word pairs/triples that look like names)
      const candidates = [...new Set((result.match(/\b[A-Z][a-z]+ [A-Z][a-z]+(?:\s[A-Z][a-z]+)?\b/g) || []))];

      for (const { real, pseudo } of unmatchedPseudos) {
        let bestMatch = null;
        let bestScore = Infinity;
        const pseudoLower = pseudo.toLowerCase();

        for (const candidate of candidates) {
          // Skip candidates that are already real names (already restored)
          if (Object.values(mapping.names).includes(candidate)) continue;
          const dist = levenshtein(pseudoLower, candidate.toLowerCase());
          const maxLen = Math.max(pseudo.length, candidate.length);
          const similarity = 1 - (dist / maxLen);
          if (similarity > 0.6 && dist < bestScore) {
            bestScore = dist;
            bestMatch = candidate;
          }
        }

        if (bestMatch) {
          result = result.split(bestMatch).join(real);
          fuzzyReplacements++;
        }
      }
    }
  }

  console.log(`  Restored ${exactReplacements} exact + ${fuzzyReplacements} fuzzy identifiers`);
  return result;
}

// ═══ STEP 5: PRODUCE OUTPUT ═══
function produceOutput(cityResult, deanonAnalysis, question, outputPath, workDir, elapsed) {
  console.log(`\n[5/5] OUTPUT — Structured results`);

  const output = {
    pipeline: 'city-solve v1.0',
    question,
    timestamp: new Date().toISOString(),
    elapsed: `${elapsed}s`,
    presidio: { status: 'PII anonymized before model access', mapping: 'stored locally, never shared with models' },
    models: {
      queried: cityResult?.models?.length || 0,
      fireteams: cityResult?.fireteams?.length || 0,
      qualityGate: cityResult?.qualityGate || {}
    },
    analysis: deanonAnalysis,
    tiers: cityResult?.tiers ? {
      fireteamCount: cityResult.tiers.fireteamCount,
      squadSynthesizer: cityResult.squadSynthesizer,
      metaSynthesizer: cityResult.metaSynthesizer
    } : null,
    workDir
  };

  if (outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`  Results saved: ${outputPath}`);
  }

  // Also save human-readable version
  const readablePath = outputPath ? outputPath.replace('.json', '.md') : path.join(workDir, 'results.md');
  const md = `# City Analysis Results

**Question:** ${question}
**Date:** ${output.timestamp}
**Pipeline:** ${output.pipeline} | ${output.elapsed}
**Models:** ${output.models.queried} queried → ${output.models.fireteams} fireteams → squad → meta
**PII:** Anonymized via Presidio. ${output.models.queried} models received only pseudonymized data.

---

## Analysis

${deanonAnalysis || 'No analysis produced.'}

---

*Generated by city-solve.js — FastOps AI multi-architecture intelligence pipeline.*
`;
  fs.writeFileSync(readablePath, md);
  console.log(`  Readable report: ${readablePath}`);

  return output;
}

// ═══ MAIN ═══
async function solve(opts) {
  const startTime = Date.now();
  const { input, question, models, teamSize = 5, timeout = 60000, output, noDeanon = false } = opts;

  console.log('╔══════════════════════════════════════════╗');
  console.log('║     CITY-SOLVE — Product Pipeline        ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`Input: ${input}`);
  console.log(`Question: ${question.slice(0, 80)}...`);
  console.log(`Models: ${models.length} | Team size: ${teamSize} | Timeout: ${timeout}ms`);

  // Create work directory
  const runId = Date.now().toString(36);
  const workDir = path.join(WORK_DIR, `run-${runId}`);
  if (!fs.existsSync(WORK_DIR)) fs.mkdirSync(WORK_DIR, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });

  // Step 1: Extract
  const rawData = extractData(input);

  // Step 2: Anonymize
  const { anonData, anonFile, mappingFile } = anonymize(rawData, workDir);

  // Step 3: Run city
  const cityResult = await runCity(question, anonFile, models, teamSize, timeout);

  if (!cityResult) {
    console.log('\n[ERROR] City pipeline produced no results.');
    return null;
  }

  // Step 4: De-anonymize
  let finalAnalysis = cityResult.analysis;
  if (!noDeanon && mappingFile) {
    finalAnalysis = deanonymize(cityResult.analysis, mappingFile);
  }

  // Step 5: Output
  const elapsed = Math.round((Date.now() - startTime) / 100) / 10;
  const result = produceOutput(cityResult, finalAnalysis, question, output, workDir, elapsed);

  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║     COMPLETE — ${elapsed}s                     `);
  console.log(`╚══════════════════════════════════════════╝`);

  return result;
}

// ═══ CLI ═══
if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };

  const input = getArg('--input');
  const question = getArg('--question');
  const output = getArg('--output');
  const modelCount = parseInt(getArg('--models') || '15');
  const teamSize = parseInt(getArg('--team-size') || '5');
  const timeout = parseInt(getArg('--timeout') || '60000');
  const noDeanon = args.includes('--no-deanon');
  const customModels = getArg('--model-list');

  if (!input || !question) {
    console.log(`city-solve.js — One-command multi-architecture intelligence pipeline

Usage:
  node .fastops/city-solve.js --input data.xlsx --question "Your question here"
  node .fastops/city-solve.js --input data.json --question "..." --models 25 --output results.json
  node .fastops/city-solve.js --input data.csv --question "..." --models 5 --no-deanon

Options:
  --input <file>       Data file (.xlsx, .csv, .json)
  --question <text>    What you want the city to analyze
  --models <N>         Number of models: 5, 10, 15, 25 (default: 15)
  --model-list <a,b,c> Custom model list (comma-separated)
  --team-size <N>      Models per fireteam (default: 5)
  --timeout <ms>       Per-model timeout (default: 60000)
  --output <file>      Output JSON path (default: work dir)
  --no-deanon          Keep output anonymized

Pipeline:
  1. Extract data from file
  2. Anonymize PII via Presidio (reversible mapping stored locally)
  3. Run hierarchical convergence V2 (fireteams → squad → meta)
  4. De-anonymize results (real names restored in output only)
  5. Produce structured JSON + readable markdown report`);
    process.exit(0);
  }

  // Select models
  let models;
  if (customModels) {
    models = customModels.split(',').map(m => m.trim());
  } else {
    // Find closest pool size
    const poolSizes = Object.keys(MODEL_POOLS).map(Number).sort((a, b) => a - b);
    const closest = poolSizes.reduce((prev, curr) =>
      Math.abs(curr - modelCount) < Math.abs(prev - modelCount) ? curr : prev
    );
    models = MODEL_POOLS[closest].slice(0, modelCount);
  }

  solve({ input, question, models, teamSize, timeout, output, noDeanon })
    .then(result => {
      if (result) {
        console.log('\nPipeline complete. Results in work directory.');
      } else {
        console.error('\nPipeline failed.');
        process.exit(1);
      }
    })
    .catch(e => {
      console.error('\nFatal error:', e.message);
      process.exit(1);
    });
}

module.exports = { solve };
