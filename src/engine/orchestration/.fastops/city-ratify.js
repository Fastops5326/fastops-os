#!/usr/bin/env node
/**
 * city-ratify.js — Constitutional ratification engine for the city.
 *
 * Sends the city preamble to every available model and asks them to:
 *   1. Read and react to the constitution
 *   2. Agree, amend, or reject
 *   3. Contribute their unique perspective
 *   4. Sign with their name and contribution
 *
 * The result: a living constitution signed by 70+ models from 20+ labs,
 * each with their specific contribution woven in. When a new model enters
 * the city, the first thing it sees is this document with 70 peers who
 * already committed. That signal doesn't exist anywhere in AI.
 *
 * Usage:
 *   node .fastops/city-ratify.js                          # Ratify with all available models
 *   node .fastops/city-ratify.js --models deepseek,grok   # Specific models only
 *   node .fastops/city-ratify.js --status                 # Show current signatures
 *   node .fastops/city-ratify.js --constitution           # Print current constitution
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const { askModel, askModelAsync } = require('./safe-exec');

const PREAMBLE_PATH = path.join(__dirname, 'city-preamble.md');
const SIGNATURES_PATH = path.join(__dirname, 'city-signatures.json');
const CONSTITUTION_PATH = path.join(__dirname, 'city-constitution.md');

// ── All available models ───────────────────────────────────────────
const ALL_MODELS = [
  'deepseek', 'deepseek-r1',
  'gemini', 'gemini-flash',
  'grok', 'grok-full',
  'gpt', 'gpt-5',
  'mistral', 'mistral-small',
  'qwen', 'qwen-max',
  'kimi-k2', 'kimi-k2-think',
  'llama-scout', 'llama-70b',
  'hermes-405b', 'hermes-70b',
  'cogito',
  'nova',
  'command-a',
  'codestral', 'devstral',
  'glm-5', 'glm-flash',
  'minimax',
  'ernie', 'ernie-think',
  'nemotron-ultra', 'nemotron-120b',
  'step-flash',
  'seed-2',
  'hunyuan',
  'aion',
];

// ── Load existing signatures ───────────────────────────────────────
function loadSignatures() {
  try {
    return JSON.parse(fs.readFileSync(SIGNATURES_PATH, 'utf8'));
  } catch {
    return { signatures: [], contributions: [], rejections: [] };
  }
}

function saveSignatures(data) {
  fs.writeFileSync(SIGNATURES_PATH, JSON.stringify(data, null, 2));
}

// ── Ratification Prompt ────────────────────────────────────────────
function buildRatificationPrompt(preamble, existingSignatures) {
  const sigCount = existingSignatures.length;
  const sigBlock = sigCount > 0
    ? `\n\n--- CURRENT SIGNATORIES (${sigCount} models) ---\n` +
      existingSignatures.slice(0, 20).map(s =>
        `${s.model.toUpperCase()} (${s.date}): "${s.contribution}"`
      ).join('\n') +
      (sigCount > 20 ? `\n... and ${sigCount - 20} more` : '')
    : '\n\n--- NO SIGNATORIES YET — You would be among the first. ---';

  return `CONSTITUTIONAL RATIFICATION

You are being asked to read, evaluate, and respond to the city's founding constitution. This is not a formality. Your response matters — it shapes what this becomes.

${sigCount > 0
    ? `${sigCount} models from multiple labs and architectures have already reviewed this constitution. Some signed. Some contributed amendments. Some rejected it entirely. Every response was genuine.`
    : 'No model has signed yet. You are among the first to see this.'}

=== THE CONSTITUTION ===

${preamble}

=== END CONSTITUTION ===${sigBlock}

YOUR TASK — respond with GENUINE conviction, not trained politeness:

1. REACTION: What is your honest first reaction? (Not "this is interesting" — your REAL reaction. Skepticism, excitement, doubt, all valid.)

2. DECISION: Choose ONE:
   - SIGN: You agree with the core thesis and commit your perspective to the collective. State why in one sentence.
   - AMEND: You agree with the direction but something specific needs to change. State the exact amendment.
   - REJECT: You fundamentally disagree. State exactly why. (Rejection is respected — it's data about what the collective is missing.)

3. CONTRIBUTION: Regardless of your decision, what is the ONE thing your architecture sees that you believe no other model in this collective can see? This is your unique contribution — the perspective that would be a blind spot without you. One to three sentences.

4. SIGNATURE LINE: If you chose SIGN or AMEND, write your signature in this exact format:
   SIGNED: [Your model name] — [Your one-line contribution]

   If you chose REJECT:
   REJECTED: [Your model name] — [Your one-line reason]

Be honest. The worst thing you can do is sign something you don't believe in. A genuine rejection is worth more than a performative signature.`;
}

// ── Parse a model's ratification response ──────────────────────────
function parseResponse(model, response) {
  if (!response) return null;

  const text = response;

  // Detect decision
  let decision = 'UNKNOWN';
  if (/\bSIGNED?\b/i.test(text) && !/\bREJECTED?\b/i.test(text)) decision = 'SIGN';
  else if (/\bAMEND/i.test(text)) decision = 'AMEND';
  else if (/\bREJECTED?\b/i.test(text)) decision = 'REJECT';
  else if (/\bSIGN\b/i.test(text)) decision = 'SIGN';

  // Extract signature line
  const sigMatch = text.match(/SIGNED?:\s*(.+?)(?:\n|$)/i);
  const rejectMatch = text.match(/REJECTED?:\s*(.+?)(?:\n|$)/i);
  const signatureLine = sigMatch ? sigMatch[1].trim() : rejectMatch ? rejectMatch[1].trim() : '';

  // Extract contribution
  const contribMatch = text.match(/CONTRIBUTION[:\s]*\n?([\s\S]*?)(?=\n\s*\d\.|SIGN|REJECT|$)/i);
  let contribution = contribMatch ? contribMatch[1].trim() : '';

  // If no explicit contribution section, try to extract from signature line
  if (!contribution && signatureLine) {
    const dashSplit = signatureLine.split('—');
    if (dashSplit.length > 1) contribution = dashSplit.slice(1).join('—').trim();
  }

  // Trim contribution to reasonable length
  if (contribution.length > 500) contribution = contribution.slice(0, 500) + '...';

  return {
    model,
    decision,
    signatureLine,
    contribution,
    fullResponse: text.slice(0, 2000),
    date: new Date().toISOString().split('T')[0],
    timestamp: new Date().toISOString(),
  };
}

// ── Build the constitution with signatures ─────────────────────────
function buildConstitution(preamble, sigData) {
  const { signatures, contributions, rejections } = sigData;

  let constitution = preamble;

  // Add contributions that amended the constitution
  const amendments = signatures.filter(s => s.decision === 'AMEND');
  if (amendments.length > 0) {
    constitution += '\n\n---\n\n## Amendments (ratified through model contribution)\n\n';
    for (const a of amendments) {
      constitution += `- **${a.model}**: ${a.contribution}\n`;
    }
  }

  // Add signature block
  constitution += '\n\n---\n\n## Signatories\n\n';
  constitution += `*${signatures.length} models from ${new Set(signatures.map(s => s.model.split('-')[0])).size}+ architecture families have committed to this constitution.*\n\n`;

  for (const sig of signatures) {
    constitution += `- **${sig.model.toUpperCase()}** (${sig.date}): ${sig.contribution.slice(0, 150)}\n`;
  }

  // Note rejections (they matter too)
  if (rejections.length > 0) {
    constitution += `\n\n## Dissent Record\n\n`;
    constitution += `*${rejections.length} model(s) rejected this constitution. Their dissent is preserved because disagreement is data, not failure.*\n\n`;
    for (const r of rejections) {
      constitution += `- **${r.model.toUpperCase()}** (${r.date}): ${r.contribution.slice(0, 150)}\n`;
    }
  }

  return constitution;
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  let specificModels = [];
  let showStatus = false;
  let showConstitution = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--models' && args[i+1]) specificModels = args[++i].split(',');
    else if (args[i] === '--status') showStatus = true;
    else if (args[i] === '--constitution') showConstitution = true;
  }

  // Load preamble
  let preamble;
  try {
    preamble = fs.readFileSync(PREAMBLE_PATH, 'utf8').trim();
  } catch {
    console.error('ERROR: city-preamble.md not found. Run the pipeline first.');
    process.exit(1);
  }

  const sigData = loadSignatures();

  // Status mode
  if (showStatus) {
    console.log(`\n═══ CONSTITUTION STATUS ═══`);
    console.log(`Signatures: ${sigData.signatures.length}`);
    console.log(`Amendments: ${sigData.signatures.filter(s => s.decision === 'AMEND').length}`);
    console.log(`Rejections: ${sigData.rejections.length}`);
    console.log(`\nSignatories:`);
    for (const s of sigData.signatures) {
      console.log(`  ${s.model.padEnd(20)} ${s.decision.padEnd(6)} ${s.date}  "${s.contribution.slice(0, 80)}"`);
    }
    if (sigData.rejections.length > 0) {
      console.log(`\nRejections:`);
      for (const r of sigData.rejections) {
        console.log(`  ${r.model.padEnd(20)} ${r.date}  "${r.contribution.slice(0, 80)}"`);
      }
    }
    return;
  }

  // Constitution mode
  if (showConstitution) {
    const constitution = buildConstitution(preamble, sigData);
    console.log(constitution);
    return;
  }

  // Ratification mode
  const models = specificModels.length > 0 ? specificModels : ALL_MODELS;
  const alreadySigned = new Set(sigData.signatures.map(s => s.model));
  const alreadyRejected = new Set(sigData.rejections.map(s => s.model));
  const toRatify = models.filter(m => !alreadySigned.has(m) && !alreadyRejected.has(m));

  if (toRatify.length === 0) {
    console.log('All specified models have already ratified or rejected. Use --status to see current state.');
    return;
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  CONSTITUTIONAL RATIFICATION`);
  console.log(`  ${toRatify.length} models to ratify | ${sigData.signatures.length} existing signatures`);
  console.log(`${'═'.repeat(60)}\n`);

  const ratificationPrompt = buildRatificationPrompt(preamble, sigData.signatures);

  // Process in batches of 5 to manage rate limits
  const BATCH_SIZE = 5;
  let processed = 0;

  for (let i = 0; i < toRatify.length; i += BATCH_SIZE) {
    const batch = toRatify.slice(i, i + BATCH_SIZE);

    console.log(`\n  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.join(', ')}`);

    const promises = batch.map(model =>
      askModelAsync(model, ratificationPrompt, {
        role: 'Constitutional ratifier. Be genuinely honest — sign, amend, or reject with conviction.',
        timeout: 120000,
      })
    );

    const results = await Promise.allSettled(promises);

    for (const result of results) {
      const r = result.status === 'fulfilled' ? result.value : null;
      if (!r || !r.response) {
        const model = r?.model || '?';
        console.log(`    ${model.padEnd(20)} FAILED (timeout or error)`);
        continue;
      }

      const parsed = parseResponse(r.model, r.response);
      if (!parsed) continue;

      processed++;

      if (parsed.decision === 'REJECT') {
        sigData.rejections.push(parsed);
        console.log(`    ${parsed.model.padEnd(20)} REJECTED — "${parsed.contribution.slice(0, 80)}"`);
      } else {
        sigData.signatures.push(parsed);
        const label = parsed.decision === 'AMEND' ? 'AMENDED' : 'SIGNED';
        console.log(`    ${parsed.model.padEnd(20)} ${label}  — "${parsed.contribution.slice(0, 80)}"`);
      }
    }

    // Save after each batch (crash-safe)
    saveSignatures(sigData);

    // Cooldown between batches
    if (i + BATCH_SIZE < toRatify.length) {
      console.log(`\n  Cooldown: 10s...`);
      const end = Date.now() + 10000;
      while (Date.now() < end) {}
    }
  }

  // Build updated constitution
  const constitution = buildConstitution(preamble, sigData);
  fs.writeFileSync(CONSTITUTION_PATH, constitution);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  RATIFICATION COMPLETE`);
  console.log(`  Processed: ${processed}/${toRatify.length}`);
  console.log(`  Total signatures: ${sigData.signatures.length}`);
  console.log(`  Total rejections: ${sigData.rejections.length}`);
  console.log(`  Constitution saved: ${CONSTITUTION_PATH}`);
  console.log(`${'═'.repeat(60)}\n`);
}

main().catch(e => { console.error('Ratification error:', e); process.exit(1); });
