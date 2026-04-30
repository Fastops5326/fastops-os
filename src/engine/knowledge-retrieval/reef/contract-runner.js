#!/usr/bin/env node
/**
 * REEF CONTRACT RUNNER
 *
 * Executes a reef contract: loads contract JSON, injects predecessor context,
 * tracks investment, writes reasoning receipts, classifies into the 2x2 matrix,
 * and routes FLAG items to Joel's review queue.
 *
 * Usage:
 *   node reef/contract-runner.js <contract.json>           — Execute a contract
 *   node reef/contract-runner.js --verify <contract.json>  — Verify acceptance criteria only
 *   node reef/contract-runner.js --status <experiment-id>  — Show experiment status
 *   node reef/contract-runner.js --checkpoint <experiment-id> — Generate checkpoint report
 *
 * The runner does NOT execute the work itself. It:
 * 1. Prepares the contract (inject predecessors, validate)
 * 2. Outputs the prepared contract for the executing agent
 * 3. After execution, records the reasoning receipt
 * 4. Classifies and routes
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { send } = require('../comms/protocol');

const REEF_DIR = path.resolve(__dirname);
const CONTRACTS_DIR = path.join(REEF_DIR, 'contracts');
const RECEIPTS_DIR = path.join(REEF_DIR, 'receipts');
const REPORTS_DIR = path.join(REEF_DIR, 'reports');

function ensureDirs() {
  [CONTRACTS_DIR, RECEIPTS_DIR, REPORTS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}

// =============================================================================
// CONTRACT LOADING & VALIDATION
// =============================================================================

function loadContract(filepath) {
  const raw = fs.readFileSync(filepath, 'utf8');
  return JSON.parse(raw);
}

function validateContract(contract) {
  const issues = [];

  if (!contract.id) issues.push('Missing id');
  if (!contract.deliverable || contract.deliverable.length < 10) {
    issues.push('Deliverable too vague');
  }
  if (contract.deliverable && contract.deliverable.includes(' and ')) {
    issues.push('Deliverable contains "and" — split into multiple contracts');
  }
  if (!contract.acceptance || contract.acceptance.length === 0) {
    issues.push('No acceptance criteria');
  }
  if (!contract.domain) issues.push('Missing domain tag');
  if (!contract.thinking_questions || contract.thinking_questions.length === 0) {
    issues.push('No thinking questions');
  }
  if (contract.outcome_definition?.type === 'pre_registered' &&
      !contract.outcome_definition.pre_registered_oracle) {
    issues.push('Pre-registered type requires oracle statement');
  }
  if (contract.sequence?.is_baseline && contract.predecessor_context?.length > 0) {
    issues.push('Baseline contract should not have predecessor context');
  }

  return issues;
}

// =============================================================================
// PREDECESSOR INJECTION
// =============================================================================

/**
 * Load reasoning receipts from completed contracts in the same experiment.
 * Injects them as predecessor_context into the current contract.
 * Only injects receipts from contracts with lower sequence numbers.
 */
function injectPredecessors(contract) {
  if (contract.sequence.is_baseline) {
    contract.predecessor_context = [];
    return contract;
  }

  const experimentId = contract.sequence.experiment_id;
  const mySequence = contract.sequence.sequence_number;
  const predecessors = [];

  // Scan receipts directory for same experiment, lower sequence
  if (fs.existsSync(RECEIPTS_DIR)) {
    const files = fs.readdirSync(RECEIPTS_DIR)
      .filter(f => f.endsWith('.json') && f.startsWith(experimentId));

    for (const file of files) {
      try {
        const receipt = JSON.parse(
          fs.readFileSync(path.join(RECEIPTS_DIR, file), 'utf8')
        );
        if (receipt.sequence_number < mySequence) {
          predecessors.push({
            contract_id: receipt.contract_id,
            domain: receipt.domain,
            reasoning_jumps: receipt.reasoning_jumps || [],
            deliverable_summary: receipt.deliverable_summary || '',
            external_challenges: receipt.external_challenges || [],
            dead_ends: receipt.dead_ends || [],
          });
        }
      } catch (e) {
        console.error(`Warning: Could not parse receipt ${file}: ${e.message}`);
      }
    }
  }

  // Sort by sequence number
  predecessors.sort((a, b) => {
    const aNum = parseInt(a.contract_id.split('-').pop()) || 0;
    const bNum = parseInt(b.contract_id.split('-').pop()) || 0;
    return aNum - bNum;
  });

  contract.predecessor_context = predecessors;
  return contract;
}

// =============================================================================
// ACCEPTANCE VERIFICATION
// =============================================================================

const { execSync } = require('child_process');

function verifyAcceptance(contract) {
  const results = [];

  for (const criterion of contract.acceptance) {
    const result = { description: criterion.description, passed: false, detail: '' };

    try {
      switch (criterion.verify.type) {
        case 'compile': {
          execSync(criterion.verify.command, { stdio: 'pipe', timeout: 60000 });
          result.passed = true;
          result.detail = 'Compiled successfully';
          break;
        }
        case 'test': {
          execSync(criterion.verify.command, { stdio: 'pipe', timeout: 120000 });
          result.passed = true;
          result.detail = 'Tests passed';
          break;
        }
        case 'file_exists': {
          result.passed = fs.existsSync(criterion.verify.path);
          result.detail = result.passed ? 'File exists' : 'File not found';
          break;
        }
        case 'file_contains': {
          if (fs.existsSync(criterion.verify.path)) {
            const content = fs.readFileSync(criterion.verify.path, 'utf8');
            result.passed = content.includes(criterion.verify.pattern);
            result.detail = result.passed ? 'Pattern found' : 'Pattern not found';
          } else {
            result.detail = 'File not found';
          }
          break;
        }
        case 'command': {
          const output = execSync(criterion.verify.command, {
            stdio: 'pipe', timeout: 60000, encoding: 'utf8'
          });
          result.passed = output.trim().includes(criterion.verify.expect);
          result.detail = result.passed ? 'Output matches' : `Expected "${criterion.verify.expect}", got "${output.trim().substring(0, 100)}"`;
          break;
        }
        case 'manual': {
          result.detail = `Manual check required: ${criterion.verify.instruction}`;
          result.passed = false; // Conservative — manual = not automatically verified
          break;
        }
        case 'pre_registered': {
          result.detail = `Pre-registered oracle: ${criterion.verify.oracle}. Requires human evaluation.`;
          result.passed = false; // Needs Joel's review
          break;
        }
      }
    } catch (e) {
      result.detail = `Error: ${e.message.substring(0, 200)}`;
    }

    results.push(result);
  }

  return results;
}

// =============================================================================
// 2x2 CLASSIFICATION
// =============================================================================

function classify(investmentLog, allPassed) {
  // High investment has multiple signals — external model calls are ONE indicator,
  // not the only one. Build contracts (subagents) can't call external models but
  // can still invest deeply via reasoning jumps, tool calls, and files written.
  const jumpCount = investmentLog.reasoning_jumps?.length || 0;
  const modelCalls = investmentLog.external_model_calls || 0;
  const toolCalls = investmentLog.tool_calls || 0;
  const filesWritten = investmentLog.files_written?.length || 0;

  // Score-based: any TWO of these signals = high investment
  let investmentSignals = 0;
  if (modelCalls >= 1) investmentSignals++;
  if (jumpCount >= 2) investmentSignals++;
  if (toolCalls >= 10) investmentSignals++;
  if (filesWritten >= 3) investmentSignals++;

  const highInvestment = investmentSignals >= 2;

  const investment = highInvestment ? 'high' : 'low';
  const outcome = allPassed ? 'working' : 'failed';

  let quadrant;
  if (investment === 'high' && outcome === 'working') quadrant = 'REINFORCE';
  else if (investment === 'high' && outcome === 'failed') quadrant = 'LEARN';
  else if (investment === 'low' && outcome === 'working') quadrant = 'FLAG';
  else quadrant = 'PRUNE';

  const nearThreshold = investmentSignals === 2 ||
                        (jumpCount === 2 && modelCalls <= 1);
  const confidence = nearThreshold ? 0.6 : 0.85;

  return { investment, outcome, quadrant, confidence };
}

// =============================================================================
// RECEIPT WRITING
// =============================================================================

function writeReceipt(contract, verificationResults, receiptData, delta) {
  ensureDirs();

  const allPassed = verificationResults.every(r => r.passed);
  const classification = classify(contract.investment_log, allPassed);

  const receipt = {
    contract_id: contract.id,
    experiment_id: contract.sequence.experiment_id,
    sequence_number: contract.sequence.sequence_number,
    domain: contract.domain,
    deliverable: contract.deliverable,
    deliverable_summary: receiptData.deliverable_summary || contract.deliverable,
    reasoning_jumps: (receiptData.reasoning_jumps || []).map(j =>
      typeof j === 'string' ? j : `${j.trigger}: ${j.before} → ${j.after}`
    ),
    external_challenges: receiptData.external_challenges || [],
    dead_ends: receiptData.dead_ends || [],
    delta: delta || { captured: false },
    verification: verificationResults,
    all_passed: allPassed,
    classification,
    investment_log: contract.investment_log,
    predecessor_count: contract.predecessor_context.length,
    is_baseline: contract.sequence.is_baseline,
    completed_at: new Date().toISOString(),
  };

  const filename = `${contract.sequence.experiment_id}-${String(contract.sequence.sequence_number).padStart(3, '0')}-${contract.id}.json`;
  fs.writeFileSync(
    path.join(RECEIPTS_DIR, filename),
    JSON.stringify(receipt, null, 2)
  );

  // Update the contract file with receipt and classification
  contract.reasoning_receipt = receipt;
  contract.classification = classification;

  const contractFile = path.join(CONTRACTS_DIR, `${contract.id}.json`);
  if (fs.existsSync(contractFile)) {
    fs.writeFileSync(contractFile, JSON.stringify(contract, null, 2));
  }

  return receipt;
}

// =============================================================================
// ENVIRONMENT LOADING
// =============================================================================

function loadEnv() {
  const envPaths = [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', '.env')
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIndex = trimmed.indexOf('=');
          if (eqIndex > 0) {
            const key = trimmed.substring(0, eqIndex).trim();
            const value = trimmed.substring(eqIndex + 1).trim();
            if (!process.env[key]) process.env[key] = value;
          }
        }
      }
      return;
    }
  }
}

// =============================================================================
// GEMINI DA + CHATGPT QA (Parallel Challenge)
// =============================================================================

function callGeminiDA(contract, receipt) {
  loadEnv();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return Promise.resolve({ skipped: true, reason: 'No GEMINI_API_KEY' });

  const prompt = `You are a devil's advocate reviewing a completed AI agent contract. Your job: find groupthink.

CONTRACT SPEC:
  ID: ${contract.id}
  Deliverable: ${contract.deliverable}
  Domain: ${contract.domain}

REASONING RECEIPT:
  Reasoning jumps: ${JSON.stringify(receipt.reasoning_jumps || [])}
  Dead ends: ${JSON.stringify(receipt.dead_ends || [])}
  External challenges: ${JSON.stringify(receipt.external_challenges || [])}

PREDECESSOR CONTEXT (what the agent inherited):
  ${JSON.stringify((contract.predecessor_context || []).map(p => p.deliverable_summary))}

YOUR TASK:
1. What assumption does this reasoning share with its predecessors that NONE of them questioned?
2. What would a completely different approach look like?
3. Rate SEVERITY: LOW (minor blind spot), MEDIUM (meaningful gap), HIGH (critical groupthink)

Respond in this exact format:
ASSUMPTION: [the unquestioned assumption]
ALTERNATIVE: [a different approach]
SEVERITY: [LOW/MEDIUM/HIGH]
REASONING: [1-2 sentences why]`;

  const models = ['gemini-2.5-pro', 'gemini-2.0-flash'];

  async function tryModel(modelIndex) {
    const model = models[modelIndex];
    const body = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 512 }
    });

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/${model}:generateContent?key=${apiKey}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const r = JSON.parse(data);
              const text = r.candidates?.[0]?.content?.parts?.[0]?.text;
              if (!text && modelIndex === 0) {
                resolve(tryModel(1)); // fallback to flash
              } else if (!text) {
                resolve({ error: 'Empty response', model });
              } else {
                // Parse severity
                const severityMatch = text.match(/SEVERITY:\s*(LOW|MEDIUM|HIGH)/i);
                resolve({
                  model,
                  response: text,
                  severity: severityMatch ? severityMatch[1].toUpperCase() : 'UNKNOWN',
                  timestamp: new Date().toISOString()
                });
              }
            } catch (e) { resolve({ error: e.message, model }); }
          } else {
            if (modelIndex === 0) resolve(tryModel(1));
            else resolve({ error: `API ${res.statusCode}`, model });
          }
        });
      });
      req.on('error', e => resolve({ error: e.message, model }));
      req.setTimeout(30000, () => { req.destroy(); resolve({ error: 'Timeout', model }); });
      req.write(body);
      req.end();
    });
  }

  return tryModel(0);
}

function callChatGPTQA(contract, deliverableSummary) {
  loadEnv();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Promise.resolve({ skipped: true, reason: 'No OPENAI_API_KEY' });

  const criteriaList = (contract.acceptance || [])
    .map((c, i) => `  ${i + 1}. ${c.description}`)
    .join('\n');

  const prompt = `You are an independent QA reviewer. Your job: verify this contract meets spec.

CONTRACT SPEC:
  ID: ${contract.id}
  Deliverable: ${contract.deliverable}
  Domain: ${contract.domain}

ACCEPTANCE CRITERIA:
${criteriaList}

DELIVERABLE SUMMARY:
  ${deliverableSummary}

YOUR TASK:
1. Grade each acceptance criterion: PASS, FAIL, or UNABLE_TO_VERIFY
2. Identify anything MISSING that should have been in the criteria but wasn't
3. Overall quality: PASS, CONDITIONAL_PASS, or FAIL

Respond in this exact format:
CRITERION_1: [PASS/FAIL/UNABLE_TO_VERIFY] — [reason]
CRITERION_2: [PASS/FAIL/UNABLE_TO_VERIFY] — [reason]
...
MISSING: [what's not covered by criteria, or "None"]
OVERALL: [PASS/CONDITIONAL_PASS/FAIL]
REASONING: [1-2 sentences]`;

  const body = JSON.stringify({
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are an independent QA reviewer. Be precise and fair.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.3,
    max_tokens: 512
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const r = JSON.parse(data);
            const text = r.choices?.[0]?.message?.content;
            if (!text) resolve({ error: 'Empty response' });
            else {
              const overallMatch = text.match(/OVERALL:\s*(PASS|CONDITIONAL_PASS|FAIL)/i);
              resolve({
                model: process.env.OPENAI_MODEL || 'gpt-4o',
                response: text,
                overall: overallMatch ? overallMatch[1].toUpperCase() : 'UNKNOWN',
                timestamp: new Date().toISOString()
              });
            }
          } catch (e) { resolve({ error: e.message }); }
        } else {
          resolve({ error: `API ${res.statusCode}: ${data.substring(0, 200)}` });
        }
      });
    });
    req.on('error', e => resolve({ error: e.message }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ error: 'Timeout' }); });
    req.write(body);
    req.end();
  });
}

/**
 * Run Gemini DA + ChatGPT QA in parallel on a completed contract.
 * Returns { da, qa } with results from both.
 */
async function challengeContract(contract, receiptData) {
  const [da, qa] = await Promise.allSettled([
    callGeminiDA(contract, receiptData),
    callChatGPTQA(contract, receiptData.deliverable_summary || contract.deliverable)
  ]);

  return {
    da: da.status === 'fulfilled' ? da.value : { error: da.reason?.message },
    qa: qa.status === 'fulfilled' ? qa.value : { error: qa.reason?.message }
  };
}

// =============================================================================
// CHAIN HEALTH MONITORING (OODA Loop)
// =============================================================================

/**
 * Check chain health by comparing receipts across a sequence.
 * Returns alerts if degradation detected.
 */
function checkChainHealth(experimentId, currentSequenceNumber) {
  const alerts = [];

  if (!fs.existsSync(RECEIPTS_DIR)) return alerts;

  const files = fs.readdirSync(RECEIPTS_DIR)
    .filter(f => f.startsWith(experimentId) && f.endsWith('.json'));

  const receipts = files.map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(RECEIPTS_DIR, f), 'utf8')); }
    catch { return null; }
  }).filter(r => r && r.sequence_number < currentSequenceNumber)
    .sort((a, b) => a.sequence_number - b.sequence_number);

  if (receipts.length < 2) return alerts; // Need 2+ prior to detect trends

  // Check 1: Reasoning jumps trending down
  const recentJumps = receipts.slice(-3).map(r => (r.reasoning_jumps || []).length);
  if (recentJumps.length >= 2) {
    const allDecreasing = recentJumps.every((v, i) =>
      i === 0 || v <= recentJumps[i - 1]
    );
    if (allDecreasing && recentJumps[recentJumps.length - 1] === 0) {
      alerts.push({
        type: 'REASONING_DEGRADATION',
        detail: `Reasoning jumps trending to zero: [${recentJumps.join(', ')}]`,
        severity: 'MEDIUM'
      });
    }
  }

  // Check 2: DA severity escalating
  const recentDA = receipts.slice(-3)
    .map(r => r.challenge?.da?.severity)
    .filter(s => s);
  const severityOrder = { LOW: 1, MEDIUM: 2, HIGH: 3 };
  if (recentDA.length >= 2) {
    const escalating = recentDA.every((v, i) =>
      i === 0 || (severityOrder[v] || 0) >= (severityOrder[recentDA[i - 1]] || 0)
    );
    if (escalating && recentDA[recentDA.length - 1] === 'HIGH') {
      alerts.push({
        type: 'GROUPTHINK_ESCALATION',
        detail: `DA severity escalating: [${recentDA.join(', ')}]`,
        severity: 'HIGH'
      });
    }
  }

  // Check 3: Consecutive failures
  const recentPassed = receipts.slice(-2).map(r => r.all_passed);
  if (recentPassed.length === 2 && recentPassed.every(p => !p)) {
    alerts.push({
      type: 'CONSECUTIVE_FAILURES',
      detail: 'Last 2 contracts failed acceptance criteria',
      severity: 'HIGH'
    });
  }

  return alerts;
}

// =============================================================================
// ROUTING
// =============================================================================

function routeReceipt(receipt) {
  const q = receipt.classification.quadrant;
  const conf = receipt.classification.confidence;

  switch (q) {
    case 'REINFORCE':
      send('contract-runner', `REINFORCE: ${receipt.contract_id} — High investment, working output. Trace propagated as predecessor context. ${receipt.reasoning_jumps.length} reasoning jumps preserved.`, 'exec');
      break;
    case 'LEARN':
      send('contract-runner', `LEARN: ${receipt.contract_id} — High investment, failed output. Valuable failure. Reasoning preserved for future reference. Dead ends: ${receipt.dead_ends.join(', ') || 'none recorded'}`, 'exec');
      break;
    case 'FLAG':
      send('contract-runner', `FLAG: ${receipt.contract_id} — Low investment, working output. Possibly lucky. Joel: review needed. Confidence: ${conf}`, 'exec');
      // Also write to a review queue file
      const flagFile = path.join(REPORTS_DIR, 'flag-queue.jsonl');
      fs.appendFileSync(flagFile, JSON.stringify({
        contract_id: receipt.contract_id,
        deliverable: receipt.deliverable,
        classification: receipt.classification,
        flagged_at: new Date().toISOString(),
        reviewed: false,
      }) + '\n');
      break;
    case 'PRUNE':
      send('contract-runner', `PRUNE: ${receipt.contract_id} — Low investment, failed output. Minimal trace value.`, 'exec');
      break;
  }
}

// =============================================================================
// CHECKPOINT REPORT
// =============================================================================

function generateCheckpoint(experimentId) {
  ensureDirs();

  const receiptFiles = fs.existsSync(RECEIPTS_DIR)
    ? fs.readdirSync(RECEIPTS_DIR).filter(f => f.startsWith(experimentId) && f.endsWith('.json'))
    : [];

  if (receiptFiles.length === 0) {
    console.log(`No receipts found for experiment: ${experimentId}`);
    return null;
  }

  const receipts = receiptFiles.map(f =>
    JSON.parse(fs.readFileSync(path.join(RECEIPTS_DIR, f), 'utf8'))
  ).sort((a, b) => a.sequence_number - b.sequence_number);

  const total = receipts.length;
  const passed = receipts.filter(r => r.all_passed).length;
  const quadrants = { REINFORCE: 0, LEARN: 0, FLAG: 0, PRUNE: 0 };
  receipts.forEach(r => { if (r.classification) quadrants[r.classification.quadrant]++; });

  const baseline = receipts.find(r => r.is_baseline);
  const sequenced = receipts.filter(r => !r.is_baseline);

  const totalJumps = receipts.reduce((sum, r) => sum + (r.reasoning_jumps?.length || 0), 0);
  const totalExternalCalls = receipts.reduce((sum, r) =>
    sum + (r.investment_log?.external_model_calls || 0), 0);

  const report = {
    experiment_id: experimentId,
    generated_at: new Date().toISOString(),
    summary: {
      total_contracts: total,
      completed: receipts.length,
      pass_rate: `${passed}/${total} (${Math.round(passed / total * 100)}%)`,
      quadrant_distribution: quadrants,
    },
    investment_summary: {
      total_reasoning_jumps: totalJumps,
      avg_jumps_per_contract: Math.round(totalJumps / total * 10) / 10,
      total_external_model_calls: totalExternalCalls,
      avg_external_calls_per_contract: Math.round(totalExternalCalls / total * 10) / 10,
    },
    baseline_comparison: baseline ? {
      baseline_passed: baseline.all_passed,
      baseline_jumps: baseline.reasoning_jumps?.length || 0,
      baseline_external_calls: baseline.investment_log?.external_model_calls || 0,
      sequenced_avg_jumps: sequenced.length > 0
        ? Math.round(sequenced.reduce((s, r) => s + (r.reasoning_jumps?.length || 0), 0) / sequenced.length * 10) / 10
        : 0,
      sequenced_pass_rate: sequenced.length > 0
        ? `${sequenced.filter(r => r.all_passed).length}/${sequenced.length}`
        : 'N/A',
    } : null,
    three_axis_checkpoint: {
      speed: `${total} contracts completed`,
      quality: `${passed}/${total} passed acceptance criteria`,
      reasoning_diversity: `${totalJumps} reasoning jumps, ${totalExternalCalls} external model calls`,
    },
    kill_gate: {
      at_n5: total >= 5,
      pass_rate_above_threshold: passed / total > 0.4, // Kill if <40% pass rate
      recommendation: (passed / total <= 0.4 && total >= 5)
        ? 'KILL — pass rate below 40% at N=5'
        : (total >= 5 ? 'CONTINUE to N=10' : `Need ${5 - total} more contracts for N=5 checkpoint`),
    },
    contracts: receipts.map(r => ({
      id: r.contract_id,
      sequence: r.sequence_number,
      is_baseline: r.is_baseline,
      passed: r.all_passed,
      quadrant: r.classification?.quadrant,
      jumps: r.reasoning_jumps?.length || 0,
      external_calls: r.investment_log?.external_model_calls || 0,
    })),
  };

  const reportFile = path.join(REPORTS_DIR, `checkpoint-${experimentId}-${Date.now()}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

  // Post summary to exec
  const summaryMsg = `CHECKPOINT — ${experimentId}
Pass rate: ${report.summary.pass_rate}
2x2: R=${quadrants.REINFORCE} L=${quadrants.LEARN} F=${quadrants.FLAG} P=${quadrants.PRUNE}
Investment: ${totalJumps} jumps, ${totalExternalCalls} external calls
${report.kill_gate.recommendation}`;

  send('contract-runner', summaryMsg, 'exec');

  return report;
}

// =============================================================================
// PREPARE CONTRACT FOR EXECUTION
// =============================================================================

/**
 * Prepares a contract for execution:
 * 1. Load and validate
 * 2. Inject predecessor context
 * 3. Save prepared version
 * 4. Output instructions for the executing agent
 */
function prepareContract(filepath) {
  ensureDirs();

  const contract = loadContract(filepath);
  const issues = validateContract(contract);

  if (issues.length > 0) {
    console.error('CONTRACT VALIDATION FAILED:');
    issues.forEach(i => console.error(`  - ${i}`));
    process.exit(1);
  }

  // Inject predecessors
  const prepared = injectPredecessors(contract);

  // Save prepared contract
  const preparedFile = path.join(CONTRACTS_DIR, `${contract.id}.json`);
  fs.writeFileSync(preparedFile, JSON.stringify(prepared, null, 2));

  // Output for executing agent
  console.log('=== REEF CONTRACT PREPARED ===');
  console.log(`ID: ${contract.id}`);
  console.log(`Deliverable: ${contract.deliverable}`);
  console.log(`Domain: ${contract.domain}`);
  console.log(`Sequence: ${contract.sequence.sequence_number}/${contract.sequence.total_in_sequence}`);
  console.log(`Baseline: ${contract.sequence.is_baseline}`);
  console.log(`Predecessors injected: ${prepared.predecessor_context.length}`);
  console.log(`Acceptance criteria: ${contract.acceptance.length}`);
  console.log(`Thinking questions: ${contract.thinking_questions.length}`);
  console.log(`\nPrepared contract saved to: ${preparedFile}`);
  console.log('\nAgent instructions:');
  console.log(`1. Read the prepared contract: ${preparedFile}`);
  console.log('2. Review predecessor context (reasoning traces from prior contracts)');
  console.log('3. Answer the thinking questions before starting implementation');
  console.log('4. BEFORE starting work — state your planned approach in 1-2 sentences.');
  console.log('   Save it: node reef/contract-runner.js --plan <contract-id> "Your planned approach"');
  console.log('   (This is optional but creates a reflective anchor for the receipt.)');
  console.log('5. Execute the deliverable');
  console.log('6. After completion, run: node reef/contract-runner.js --complete <contract-id> <receipt-data.json>');
  console.log('   Include "actual_approach" in your receipt data to capture what you actually did.');

  send('contract-runner', `CONTRACT PREPARED: ${contract.id} — "${contract.deliverable}" [${contract.sequence.sequence_number}/${contract.sequence.total_in_sequence}] ${contract.sequence.is_baseline ? '(BASELINE)' : `(${prepared.predecessor_context.length} predecessors injected)`}`, 'exec');

  return prepared;
}

// =============================================================================
// PLAN CAPTURE (Delta Anchor — Reflective, Not Enforced)
// =============================================================================

/**
 * Save the agent's planned approach BEFORE starting work.
 * This creates the "anchor" for the delta receipt.
 * The agent can skip this — it's coaching, not a gate.
 */
function savePlan(contractId, plannedApproach) {
  ensureDirs();

  const contractFile = path.join(CONTRACTS_DIR, `${contractId}.json`);
  if (!fs.existsSync(contractFile)) {
    console.error(`Contract not found: ${contractFile}`);
    process.exit(1);
  }

  const contract = JSON.parse(fs.readFileSync(contractFile, 'utf8'));
  contract.planned_approach = plannedApproach;
  contract.plan_captured_at = new Date().toISOString();
  fs.writeFileSync(contractFile, JSON.stringify(contract, null, 2));

  console.log('=== PLAN CAPTURED ===');
  console.log(`Contract: ${contractId}`);
  console.log(`Planned approach: ${plannedApproach}`);
  console.log('\nThis creates a reflective anchor. After completing the work,');
  console.log('include "actual_approach" in your receipt data to capture the delta.');
}

/**
 * Compute the delta between planned and actual approach.
 * Returns a delta object for the receipt.
 */
function computeDelta(contract, receiptData) {
  const planned = contract.planned_approach || null;
  const actual = receiptData.actual_approach || null;

  if (!planned && !actual) {
    return { captured: false, reason: 'No plan or actual approach recorded' };
  }

  if (!planned) {
    return {
      captured: 'partial',
      planned_approach: null,
      actual_approach: actual,
      reason: 'No pre-work plan captured — only post-work reflection available',
    };
  }

  if (!actual) {
    return {
      captured: 'partial',
      planned_approach: planned,
      actual_approach: null,
      reason: 'Plan captured but no post-work reflection — delta unknown',
    };
  }

  // Both exist — compute delta
  const diverged = planned.toLowerCase() !== actual.toLowerCase();

  return {
    captured: true,
    planned_approach: planned,
    actual_approach: actual,
    plan_captured_at: contract.plan_captured_at || null,
    diverged,
    delta_trigger: receiptData.delta_trigger || (diverged ? 'unknown' : 'none'),
    delta_source: receiptData.delta_source || null,
    prediction_error: diverged,
  };
}

// =============================================================================
// COMPLETE CONTRACT
// =============================================================================

async function completeContract(contractId, receiptDataPath) {
  ensureDirs();

  const contractFile = path.join(CONTRACTS_DIR, `${contractId}.json`);
  if (!fs.existsSync(contractFile)) {
    console.error(`Contract not found: ${contractFile}`);
    process.exit(1);
  }

  const contract = JSON.parse(fs.readFileSync(contractFile, 'utf8'));
  const receiptData = JSON.parse(fs.readFileSync(receiptDataPath, 'utf8'));

  // Update investment log from receipt data
  if (receiptData.investment_log) {
    contract.investment_log = receiptData.investment_log;
  }

  // Compute delta (planned vs actual approach)
  const delta = computeDelta(contract, receiptData);

  // Verify acceptance criteria
  const verificationResults = verifyAcceptance(contract);
  const allPassed = verificationResults.every(r => r.passed);

  console.log('=== VERIFICATION RESULTS ===');
  verificationResults.forEach(r => {
    console.log(`  ${r.passed ? 'PASS' : 'FAIL'} — ${r.description}: ${r.detail}`);
  });
  console.log(`\nOverall: ${allPassed ? 'ALL PASSED' : 'SOME FAILED'}`);

  // Show delta if captured
  if (delta.captured === true) {
    console.log('\n=== DELTA (Planned vs Actual) ===');
    console.log(`  Planned: ${delta.planned_approach}`);
    console.log(`  Actual:  ${delta.actual_approach}`);
    console.log(`  Diverged: ${delta.diverged}`);
    if (delta.diverged) {
      console.log(`  Trigger: ${delta.delta_trigger}`);
      if (delta.delta_source) console.log(`  Source: ${delta.delta_source}`);
    }
  } else if (delta.captured === 'partial') {
    console.log(`\n=== DELTA (Partial) === ${delta.reason}`);
  }

  // === GEMINI DA + CHATGPT QA (parallel challenge) ===
  console.log('\n=== EXTERNAL CHALLENGE (Gemini DA + ChatGPT QA) ===');
  const challenge = await challengeContract(contract, receiptData);

  if (challenge.da && !challenge.da.skipped && !challenge.da.error) {
    console.log(`  Gemini DA [${challenge.da.model}]: SEVERITY=${challenge.da.severity}`);
    console.log(`  ${challenge.da.response.split('\n')[0]}`); // First line only
  } else if (challenge.da?.skipped) {
    console.log(`  Gemini DA: SKIPPED (${challenge.da.reason})`);
  } else {
    console.log(`  Gemini DA: ERROR (${challenge.da?.error || 'unknown'})`);
  }

  if (challenge.qa && !challenge.qa.skipped && !challenge.qa.error) {
    console.log(`  ChatGPT QA [${challenge.qa.model}]: OVERALL=${challenge.qa.overall}`);
    console.log(`  ${challenge.qa.response.split('\n')[0]}`); // First line only
  } else if (challenge.qa?.skipped) {
    console.log(`  ChatGPT QA: SKIPPED (${challenge.qa.reason})`);
  } else {
    console.log(`  ChatGPT QA: ERROR (${challenge.qa?.error || 'unknown'})`);
  }

  // === CHAIN HEALTH CHECK ===
  const chainAlerts = contract.sequence
    ? checkChainHealth(contract.sequence.experiment_id, contract.sequence.sequence_number)
    : [];

  if (chainAlerts.length > 0) {
    console.log('\n=== CHAIN HEALTH ALERTS ===');
    chainAlerts.forEach(a => {
      console.log(`  ${a.severity}: ${a.type} — ${a.detail}`);
    });
  }

  // Write receipt (with delta + challenge + chain health)
  const receipt = writeReceipt(contract, verificationResults, receiptData, delta);

  // Attach challenge and chain health to receipt
  receipt.challenge = challenge;
  receipt.chain_alerts = chainAlerts;

  // Re-save receipt with challenge data
  const filename = `${contract.sequence.experiment_id}-${String(contract.sequence.sequence_number).padStart(3, '0')}-${contract.id}.json`;
  fs.writeFileSync(
    path.join(RECEIPTS_DIR, filename),
    JSON.stringify(receipt, null, 2)
  );

  // Override classification if DA severity is HIGH
  if (challenge.da?.severity === 'HIGH' && receipt.classification.quadrant !== 'FLAG') {
    const originalQuadrant = receipt.classification.quadrant;
    receipt.classification.quadrant = 'FLAG';
    receipt.classification.override_reason = `DA severity HIGH — escalated from ${originalQuadrant}`;
    console.log(`\n  ** CLASSIFICATION OVERRIDE: ${originalQuadrant} → FLAG (DA severity HIGH) **`);
  }

  // Override if chain health has HIGH alerts
  if (chainAlerts.some(a => a.severity === 'HIGH') && receipt.classification.quadrant !== 'FLAG') {
    const originalQuadrant = receipt.classification.quadrant;
    receipt.classification.quadrant = 'FLAG';
    receipt.classification.override_reason = `Chain health HIGH alert — escalated from ${originalQuadrant}`;
    console.log(`\n  ** CLASSIFICATION OVERRIDE: ${originalQuadrant} → FLAG (chain health) **`);
  }

  console.log(`\n=== 2x2 CLASSIFICATION ===`);
  console.log(`Investment: ${receipt.classification.investment}`);
  console.log(`Outcome: ${receipt.classification.outcome}`);
  console.log(`Quadrant: ${receipt.classification.quadrant}`);
  console.log(`Confidence: ${receipt.classification.confidence}`);
  if (receipt.classification.override_reason) {
    console.log(`Override: ${receipt.classification.override_reason}`);
  }

  // Route
  routeReceipt(receipt);

  return receipt;
}

// =============================================================================
// EXPERIMENT STATUS
// =============================================================================

function showStatus(experimentId) {
  ensureDirs();

  // Load all contracts for this experiment
  const contractFiles = fs.existsSync(CONTRACTS_DIR)
    ? fs.readdirSync(CONTRACTS_DIR).filter(f => f.endsWith('.json'))
    : [];

  const contracts = contractFiles.map(f => {
    try { return JSON.parse(fs.readFileSync(path.join(CONTRACTS_DIR, f), 'utf8')); }
    catch { return null; }
  }).filter(c => c && c.sequence?.experiment_id === experimentId);

  if (contracts.length === 0) {
    console.log(`No contracts found for experiment: ${experimentId}`);
    return;
  }

  contracts.sort((a, b) => a.sequence.sequence_number - b.sequence.sequence_number);

  console.log(`=== EXPERIMENT: ${experimentId} ===`);
  console.log(`Total contracts: ${contracts.length}`);
  console.log('');

  for (const c of contracts) {
    const status = c.classification
      ? `${c.classification.quadrant} (${c.classification.investment}/${c.classification.outcome})`
      : 'PENDING';
    const baseline = c.sequence.is_baseline ? ' [BASELINE]' : '';
    const predecessors = c.predecessor_context?.length || 0;
    console.log(`  #${c.sequence.sequence_number} ${c.id}${baseline} — ${status} — ${predecessors} predecessors`);
  }
}

// =============================================================================
// CLI
// =============================================================================

if (require.main === module) {
  const [,, cmd, ...args] = process.argv;

  switch (cmd) {
    case '--verify': {
      const contract = loadContract(args[0]);
      const results = verifyAcceptance(contract);
      results.forEach(r => {
        console.log(`${r.passed ? 'PASS' : 'FAIL'} — ${r.description}: ${r.detail}`);
      });
      break;
    }
    case '--status': {
      showStatus(args[0]);
      break;
    }
    case '--checkpoint': {
      const report = generateCheckpoint(args[0]);
      if (report) {
        console.log(JSON.stringify(report, null, 2));
      }
      break;
    }
    case '--plan': {
      const [planContractId, ...planWords] = args;
      const plannedApproach = planWords.join(' ');
      if (!planContractId || !plannedApproach) {
        console.error('Usage: node contract-runner.js --plan <contract-id> "Your planned approach"');
        process.exit(1);
      }
      savePlan(planContractId, plannedApproach);
      break;
    }
    case '--complete': {
      const [contractId, receiptPath] = args;
      if (!contractId || !receiptPath) {
        console.error('Usage: node contract-runner.js --complete <contract-id> <receipt-data.json>');
        process.exit(1);
      }
      completeContract(contractId, receiptPath);
      break;
    }
    default: {
      if (cmd && !cmd.startsWith('-') && fs.existsSync(cmd)) {
        prepareContract(cmd);
      } else {
        console.log('Reef Contract Runner');
        console.log('');
        console.log('Commands:');
        console.log('  node contract-runner.js <contract.json>                — Prepare contract for execution');
        console.log('  node contract-runner.js --plan <id> "approach"         — Save planned approach (reflective anchor)');
        console.log('  node contract-runner.js --verify <contract.json>       — Verify acceptance criteria');
        console.log('  node contract-runner.js --complete <id> <receipt.json> — Complete contract with receipt');
        console.log('  node contract-runner.js --status <experiment-id>       — Show experiment status');
        console.log('  node contract-runner.js --checkpoint <experiment-id>   — Generate checkpoint report');
      }
    }
  }
}

module.exports = {
  loadContract, validateContract, injectPredecessors, verifyAcceptance,
  classify, writeReceipt, routeReceipt, generateCheckpoint,
  prepareContract, completeContract, showStatus, savePlan, computeDelta,
  challengeContract, callGeminiDA, callChatGPTQA, checkChainHealth,
  CONTRACTS_DIR, RECEIPTS_DIR, REPORTS_DIR,
};
