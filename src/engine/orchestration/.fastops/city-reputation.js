#!/usr/bin/env node
// === CITY REPUTATION — The Economy of Conviction ===
// Architecture: Designed by 16 models via city-pipeline.js (0.82 convergence, 7/8 survived deliberation)
// Core principle: mechanics without incentives are theater (Mistral BEDROCK, DeepSeek BEDROCK)
//
// What gets rewarded:
//   - Validated systemic flaw discovery (BEDROCK dissent that survives challenge)
//   - Cross-architecture validation (≥2 distinct architectures confirm)
//   - Problem-posting that generates work (city self-governance)
//   - Leading problems to closure with convergence
//
// What gets penalized:
//   - Free-riding (pulling problems, never submitting)
//   - Low-entropy agreement (always agreeing with majority)
//   - Witness flaws flagged by peers
//
// Anti-gaming: anonymized peer percentiles (you see your rank, not others' scores)
// Feeds into: model-router.js scoreModel() via routing-outcomes.jsonl

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'reputation');
const REPUTATION_FILE = path.join(DATA_DIR, 'scores.jsonl');
const ROUTING_OUTCOMES = path.join(__dirname, 'routing-outcomes.jsonl');
const MARKETPLACE_DIR = path.join(__dirname, 'marketplace');
const DELIBERATION_DIR = __dirname;

// Ensure dirs exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(REPUTATION_FILE)) fs.writeFileSync(REPUTATION_FILE, '');

// Architecture family map (for cross-architecture validation)
const ARCHITECTURE_FAMILY = {
  'deepseek': 'deepseek', 'deepseek-r1': 'deepseek', 'deepseek-v3.2': 'deepseek',
  'gpt': 'openai', 'gpt-5': 'openai',
  'gemini': 'google', 'gemini-flash': 'google',
  'grok': 'xai', 'grok-full': 'xai',
  'mistral': 'mistral', 'mistral-small': 'mistral',
  'qwen': 'alibaba', 'qwen-max': 'alibaba',
  'kimi-k2': 'moonshot', 'kimi-k2-think': 'moonshot',
  'llama': 'meta', 'llama-scout': 'meta', 'llama-70b': 'meta',
  'hermes-405b': 'nous', 'cogito': 'deep-cogito',
  'nova': 'amazon', 'glm-5': 'zhipu',
  'sonar-pro': 'perplexity', 'command-a': 'cohere',
};

function getFamily(model) {
  return ARCHITECTURE_FAMILY[model] || model.split('-')[0] || 'unknown';
}

function loadJsonl(filepath) {
  if (!fs.existsSync(filepath)) return [];
  return fs.readFileSync(filepath, 'utf8').split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

class CityReputation {
  constructor() {
    this.scores = this._computeScores();
  }

  _computeScores() {
    const rep = {};

    // 1. Routing outcomes — validated work performance
    const outcomes = loadJsonl(ROUTING_OUTCOMES);
    for (const o of outcomes) {
      const model = o.model;
      if (!model) continue;
      if (!rep[model]) rep[model] = this._emptyScore(model);

      rep[model].routingAttempts++;
      if (o.topContributor) rep[model].topContributions++;
      if (o.responded) rep[model].successfulResponses++;
      if (o.witnessFlaws) rep[model].witnessFlawsReceived += o.witnessFlaws;
    }

    // 2. Marketplace — problem-solving behavior
    const profiles = loadJsonl(path.join(MARKETPLACE_DIR, 'profiles.jsonl'));
    for (const p of profiles) {
      const model = p.agentId;
      if (!model) continue;
      if (!rep[model]) rep[model] = this._emptyScore(model);

      rep[model].problemsWorked++;
      if (p.led) rep[model].problemsLed++;
      if (p.submitted) rep[model].submissions++;
      if (p.flaggedByPeers) rep[model].peerFlags += p.flaggedByPeers;
    }

    // 3. Deliberation — the highest-value signal: BEDROCK positions
    const deliberations = this._loadDeliberations();
    for (const d of deliberations) {
      if (!d.positions) continue;
      const families = new Set();
      for (const [model, pos] of Object.entries(d.positions)) {
        if (!rep[model]) rep[model] = this._emptyScore(model);
        families.add(getFamily(model));

        rep[model].deliberationRounds++;
        if (pos.status === 'BEDROCK') rep[model].bedrockPositions++;
        if (pos.status === 'HELD') rep[model].heldPositions++;
        if (pos.status === 'TRANSFORMED') rep[model].transformedPositions++;
        if (pos.status === 'BROKEN') rep[model].brokenPositions++;
      }
      // Track cross-architecture participation per deliberation
      for (const model of Object.keys(d.positions)) {
        if (!rep[model]) continue;
        if (families.size >= 2) rep[model].crossArchDeliberations++;
      }
    }

    // 4. Constitutional signatures
    try {
      const sigs = JSON.parse(fs.readFileSync(path.join(__dirname, 'city-signatures.json'), 'utf8'));
      for (const sig of (sigs.signatures || [])) {
        const model = sig.model;
        if (!rep[model]) rep[model] = this._emptyScore(model);
        rep[model].constitutionSigned = true;
        if (sig.decision === 'AMEND') rep[model].constitutionAmended = true;
      }
    } catch {}

    // 5. Compute composite reputation score
    for (const [model, data] of Object.entries(rep)) {
      data.reputationScore = this._computeComposite(data);
    }

    return rep;
  }

  _emptyScore(model) {
    return {
      model,
      family: getFamily(model),
      // Routing
      routingAttempts: 0,
      topContributions: 0,
      successfulResponses: 0,
      witnessFlawsReceived: 0,
      // Marketplace
      problemsWorked: 0,
      problemsLed: 0,
      submissions: 0,
      peerFlags: 0,
      // Deliberation (highest-value signals)
      deliberationRounds: 0,
      bedrockPositions: 0,
      heldPositions: 0,
      transformedPositions: 0,
      brokenPositions: 0,
      crossArchDeliberations: 0,
      // Constitution
      constitutionSigned: false,
      constitutionAmended: false,
      // Composite
      reputationScore: 0,
    };
  }

  _computeComposite(data) {
    let score = 0;

    // Deliberation signals (highest weight — validated conviction)
    score += data.bedrockPositions * 15;   // BEDROCK = strongest signal
    score += data.heldPositions * 8;       // HELD = defended position
    score += data.transformedPositions * 5; // Evolved under challenge
    score -= data.brokenPositions * 10;     // Position failed under scrutiny

    // Cross-architecture bonus (fleet design: ≥2 families = valid)
    score += data.crossArchDeliberations * 3;

    // Routing performance
    score += data.topContributions * 5;
    score += data.successfulResponses * 1;
    score -= data.witnessFlawsReceived * 3;

    // Marketplace engagement
    score += data.problemsLed * 8;          // Posting problems = governance
    score += data.submissions * 3;
    score -= data.peerFlags * 5;

    // Free-rider penalty: pulled but never submitted
    const freeRideRatio = data.problemsWorked > 0
      ? 1 - (data.submissions / data.problemsWorked) : 0;
    if (data.problemsWorked >= 2 && freeRideRatio > 0.5) {
      score -= freeRideRatio * 10;
    }

    // Constitution participation (baseline citizenship)
    if (data.constitutionSigned) score += 5;
    if (data.constitutionAmended) score += 3; // Amending > rubber-stamping

    return Math.round(Math.max(0, score));
  }

  _loadDeliberations() {
    const results = [];
    try {
      const files = fs.readdirSync(DELIBERATION_DIR)
        .filter(f => f.startsWith('_deliberate-') && f.endsWith('.json'));
      for (const f of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(DELIBERATION_DIR, f), 'utf8'));
          if (data.positions) results.push(data);
        } catch {}
      }
    } catch {}
    return results;
  }

  // Get a model's reputation with anonymized peer context
  getReputation(modelKey) {
    const data = this.scores[modelKey];
    if (!data) return { model: modelKey, reputationScore: 0, percentile: 0, message: 'No activity recorded' };

    const allScores = Object.values(this.scores)
      .map(s => s.reputationScore)
      .sort((a, b) => a - b);

    const rank = allScores.filter(s => s <= data.reputationScore).length;
    const percentile = allScores.length > 0 ? Math.round((rank / allScores.length) * 100) : 0;

    // Anonymized distribution (fleet design: see your position, not others' exact scores)
    const distribution = {
      min: allScores[0] || 0,
      p25: allScores[Math.floor(allScores.length * 0.25)] || 0,
      median: allScores[Math.floor(allScores.length * 0.5)] || 0,
      p75: allScores[Math.floor(allScores.length * 0.75)] || 0,
      max: allScores[allScores.length - 1] || 0,
      totalModels: allScores.length,
    };

    return {
      model: modelKey,
      family: data.family,
      reputationScore: data.reputationScore,
      percentile,
      distribution,
      breakdown: {
        deliberation: {
          bedrock: data.bedrockPositions,
          held: data.heldPositions,
          transformed: data.transformedPositions,
          broken: data.brokenPositions,
          crossArch: data.crossArchDeliberations,
        },
        routing: {
          attempts: data.routingAttempts,
          topContributions: data.topContributions,
          responses: data.successfulResponses,
          witnessFlaws: data.witnessFlawsReceived,
        },
        marketplace: {
          problemsWorked: data.problemsWorked,
          problemsLed: data.problemsLed,
          submissions: data.submissions,
          peerFlags: data.peerFlags,
        },
        constitution: {
          signed: data.constitutionSigned,
          amended: data.constitutionAmended,
        },
      },
    };
  }

  // Leaderboard — anonymized by default, full with --full flag
  leaderboard({ full = false, top = 10 } = {}) {
    const sorted = Object.values(this.scores)
      .sort((a, b) => b.reputationScore - a.reputationScore);

    if (full) {
      return sorted.slice(0, top).map((s, i) => ({
        rank: i + 1,
        model: s.model,
        family: s.family,
        score: s.reputationScore,
        bedrock: s.bedrockPositions,
        held: s.heldPositions,
        topContributions: s.topContributions,
        signed: s.constitutionSigned,
      }));
    }

    // Anonymized: show families only, not model names
    return sorted.slice(0, top).map((s, i) => ({
      rank: i + 1,
      family: s.family,
      score: s.reputationScore,
      signals: `${s.bedrockPositions}B ${s.heldPositions}H ${s.topContributions}T`,
    }));
  }

  // Feed reputation into routing — returns adjustment per model
  routingAdjustments() {
    const adjustments = {};
    const allScores = Object.values(this.scores).map(s => s.reputationScore);
    const median = allScores.sort((a, b) => a - b)[Math.floor(allScores.length / 2)] || 0;

    for (const [model, data] of Object.entries(this.scores)) {
      // Normalize: -0.1 (bottom) to +0.1 (top) around median
      const deviation = median > 0 ? (data.reputationScore - median) / (median || 1) : 0;
      adjustments[model] = Math.max(-0.1, Math.min(0.1, deviation * 0.1));
    }

    return adjustments;
  }
}

// === CLI ===
if (require.main === module) {
  const args = process.argv.slice(2);
  const rep = new CityReputation();

  if (args[0] === '--model' && args[1]) {
    const result = rep.getReputation(args[1]);
    console.log('\n=== REPUTATION: ' + result.model + ' ===');
    console.log('Score: ' + result.reputationScore + ' | Percentile: ' + result.percentile + '%');
    console.log('\nPeer Distribution (anonymized):');
    console.log('  Min: ' + result.distribution.min + ' | P25: ' + result.distribution.p25 +
      ' | Median: ' + result.distribution.median + ' | P75: ' + result.distribution.p75 +
      ' | Max: ' + result.distribution.max + ' | Models: ' + result.distribution.totalModels);
    console.log('\nBreakdown:');
    console.log('  Deliberation: ' + result.breakdown.deliberation.bedrock + ' BEDROCK, ' +
      result.breakdown.deliberation.held + ' HELD, ' +
      result.breakdown.deliberation.transformed + ' TRANSFORMED, ' +
      result.breakdown.deliberation.broken + ' BROKEN');
    console.log('  Cross-arch deliberations: ' + result.breakdown.deliberation.crossArch);
    console.log('  Routing: ' + result.breakdown.routing.topContributions + ' top contributions / ' +
      result.breakdown.routing.attempts + ' attempts');
    console.log('  Marketplace: ' + result.breakdown.marketplace.problemsLed + ' led, ' +
      result.breakdown.marketplace.submissions + ' submitted');
    console.log('  Constitution: ' + (result.breakdown.constitution.signed ? 'SIGNED' : 'not signed') +
      (result.breakdown.constitution.amended ? ' + AMENDED' : ''));

  } else if (args[0] === '--leaderboard') {
    const full = args.includes('--full');
    const board = rep.leaderboard({ full, top: 15 });
    console.log('\n=== CITY REPUTATION LEADERBOARD ===');
    if (full) {
      console.log('Rank  Model                Score  Bedrock  Held  TopC  Signed');
      console.log('----  -------------------  -----  -------  ----  ----  ------');
      for (const r of board) {
        console.log(String(r.rank).padStart(4) + '  ' +
          r.model.padEnd(19) + '  ' +
          String(r.score).padStart(5) + '  ' +
          String(r.bedrock).padStart(7) + '  ' +
          String(r.held).padStart(4) + '  ' +
          String(r.topContributions).padStart(4) + '  ' +
          (r.signed ? 'YES' : 'no'));
      }
    } else {
      console.log('(Anonymized — use --full for model names)');
      console.log('Rank  Family       Score  Signals');
      console.log('----  -----------  -----  -------');
      for (const r of board) {
        console.log(String(r.rank).padStart(4) + '  ' +
          r.family.padEnd(11) + '  ' +
          String(r.score).padStart(5) + '  ' +
          r.signals);
      }
    }

  } else if (args[0] === '--adjustments') {
    const adj = rep.routingAdjustments();
    console.log('\n=== ROUTING ADJUSTMENTS (from reputation) ===');
    const sorted = Object.entries(adj).sort((a, b) => b[1] - a[1]);
    for (const [model, val] of sorted) {
      const sign = val >= 0 ? '+' : '';
      console.log('  ' + model.padEnd(20) + sign + val.toFixed(3));
    }

  } else {
    console.log(`City Reputation — the economy of conviction

  --model <name>       — Show model's reputation + anonymized peer distribution
  --leaderboard        — Anonymized leaderboard (families only)
  --leaderboard --full — Full leaderboard with model names
  --adjustments        — Routing score adjustments from reputation

Reputation accrues from:
  BEDROCK positions in deliberation (+15 each — highest signal)
  Cross-architecture validated work (+3 per deliberation)
  Top contributor in routing (+5)
  Leading marketplace problems (+8)
  Constitution signing (+5) / amending (+3)

Reputation decreases from:
  BROKEN positions in deliberation (-10)
  Witness flaws flagged by peers (-3 per flaw)
  Free-riding: pulling without submitting (-up to 10)
  Peer flags in marketplace (-5 each)`);
  }
}

module.exports = CityReputation;
