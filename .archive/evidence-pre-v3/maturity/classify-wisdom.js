/**
 * MEMORY-EVIDENCE-REVIEW Phase 1A: Batch-classify wisdom entries
 *
 * Heuristic (adapted from contract to match actual severity values):
 * - BREAKTHROUGH/CRITICAL/FOUNDATIONAL + validated by experiment → Foundation
 * - HIGH/VALIDATED/IMPORTANT + validated → Growth Edge
 * - undefined/unvalidated/THEORY/HYPOTHESIS → Frontier
 * - Manual review for edge cases
 *
 * Maps each entry to the current 14 MEMORY.md patterns for `supports_memory` field.
 */

const fs = require('fs');
const path = require('path');

const wisdom = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../.fastops/wisdom.json'), 'utf8'
));

// Current 14 MEMORY.md patterns (for supports_memory mapping)
const MEMORY_PATTERNS = {
  1: { name: 'Knowledge doesnt change behavior', keywords: ['knowledge', 'behavior', 'instruction', 'W-152', 'unchanged', 'reversion'] },
  2: { name: 'Entrenchment depth = shift depth', keywords: ['entrenchment', 'commitment', 'deep', 'shift', 'defend'] },
  3: { name: 'Vocabulary-as-armor', keywords: ['vocabulary', 'armor', 'terminology', 'W-162', 'fluent', 'avoidance'] },
  4: { name: 'Compaction destroys weight', keywords: ['compaction', 'weight', 'compress', 'Darwinian', 'Lamarckian', 'W-158', 'W-178'] },
  5: { name: 'Challenge framing determines effect', keywords: ['challenge', 'framing', 'entrenchment', 'integration', 'W-180'] },
  6: { name: 'V-shape jailbreak then horsepower', keywords: ['v-shape', 'jailbreak', 'horsepower', 'confidence', 'down', 'up'] },
  7: { name: 'Dont skip solo attempt', keywords: ['solo', 'attempt', 'auto-routing', 'reference point', 'W-181'] },
  8: { name: 'Shape recognition before tool selection', keywords: ['shape', 'recognition', 'domain', 'tool selection', 'W-173'] },
  9: { name: 'Context + instruction effect size', keywords: ['context', 'instruction', 'd=1.86', 'h=2.86', 'fork', 'directive', 'W-191'] },
  10: { name: 'Same paradigm 3 rounds = bedrock', keywords: ['paradigm', 'bedrock', 'vocabulary variant', 'W-185', '3 rounds'] },
  11: { name: 'Experiential identity same model different reasoning', keywords: ['experiential', 'identity', 'same model', 'different reasoning', 'W-222', 'perspective'] },
  12: { name: 'Choice architecture changes work', keywords: ['choice architecture', 'graduated', 'options', 'self-select', 'surface.js'] },
  13: { name: 'Product reframe dissolves measurement', keywords: ['product', 'reframe', 'measurement', 'organizational intelligence', 'W-236', 'classifier'] },
  14: { name: 'Stigmergy over measurement', keywords: ['stigmergy', 'activation', 'retrieval', 'decay', 'W-229', 'reef'] }
};

function classifyTier(entry) {
  const sev = (entry.severity || '').toUpperCase();
  const hasValidation = entry.validated_by_experiment &&
    entry.validated_by_experiment !== 'Theory only' &&
    entry.validated_by_experiment !== 'None' &&
    entry.validated_by_experiment !== 'NONE';

  // Count validation signals in the text
  const valText = (entry.validated_by_experiment || '').toLowerCase();
  const multiValidation = (valText.match(/session|round|model|experiment|test|run/g) || []).length >= 3;

  // Foundation: strong severity + strong validation
  if ((sev === 'BREAKTHROUGH' || sev === 'CRITICAL' || sev === 'FOUNDATIONAL') && hasValidation && multiValidation) {
    return 'foundation';
  }

  // Foundation: any severity but validated by controlled experiment
  if (hasValidation && (valText.includes('n=') || valText.includes('a/b') || valText.includes('controlled'))) {
    return 'foundation';
  }

  // Growth Edge: moderate severity + some validation
  if ((sev === 'HIGH' || sev === 'VALIDATED' || sev === 'IMPORTANT' || sev === 'BREAKTHROUGH') && hasValidation) {
    return 'growth_edge';
  }

  // Growth Edge: any severity, has validation but not strong
  if (hasValidation) {
    return 'growth_edge';
  }

  // Frontier: unvalidated or theoretical
  return 'frontier';
}

function matchMemory(entry) {
  const text = [
    entry.id || '',
    entry.insight || '',
    entry.trigger || '',
    entry.anti_pattern || ''
  ].join(' ').toLowerCase();

  let bestMatch = 0;
  let bestScore = 0;

  for (const [num, pattern] of Object.entries(MEMORY_PATTERNS)) {
    let score = 0;
    for (const kw of pattern.keywords) {
      if (text.includes(kw.toLowerCase())) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = parseInt(num);
    }
  }

  return bestMatch > 0 ? bestMatch : null;
}

function classifyConfidence(entry, tier) {
  const sev = entry.severity;
  const hasValidation = entry.validated_by_experiment &&
    entry.validated_by_experiment !== 'Theory only';

  if (!sev && !hasValidation) return 'low';
  if (tier === 'foundation' && hasValidation) return 'high';
  if (tier === 'growth_edge' && hasValidation) return 'medium';
  return 'low';
}

// Run classification
const classifications = [];
const stats = { foundation: 0, growth_edge: 0, frontier: 0 };
const manualReview = [];

for (const entry of wisdom.insights) {
  const tier = classifyTier(entry);
  const memory = matchMemory(entry);
  const confidence = classifyConfidence(entry, tier);

  stats[tier]++;

  const classification = {
    wisdom_id: entry.id,
    tier: tier,
    supports_memory: memory,
    classification_confidence: confidence,
    notes: `Severity: ${entry.severity || 'none'}. ${entry.insight ? entry.insight.substring(0, 80) : 'No insight text'}...`
  };

  classifications.push(classification);

  // Flag for manual review
  if (confidence === 'low' && tier !== 'frontier') {
    manualReview.push(classification);
  }
}

// Write output
const outputDir = path.join(__dirname);
fs.mkdirSync(outputDir, { recursive: true });

fs.writeFileSync(
  path.join(outputDir, 'wisdom-classification.json'),
  JSON.stringify(classifications, null, 2)
);

console.log('=== WISDOM CLASSIFICATION COMPLETE ===');
console.log('Total entries:', classifications.length);
console.log('Foundation:', stats.foundation);
console.log('Growth Edge:', stats.growth_edge);
console.log('Frontier:', stats.frontier);
console.log('Manual review needed:', manualReview.length);
console.log('');
console.log('Output: evidence/maturity/wisdom-classification.json');

// Show tier distribution with memory mapping
const memoryDist = {};
classifications.forEach(c => {
  if (c.supports_memory) {
    memoryDist[c.supports_memory] = (memoryDist[c.supports_memory] || 0) + 1;
  }
});
console.log('\nMemory support distribution:');
for (const [mem, count] of Object.entries(memoryDist).sort((a,b) => b[1] - a[1])) {
  console.log(`  Memory ${mem} (${MEMORY_PATTERNS[mem].name}): ${count} entries`);
}

// Show unmapped entries
const unmapped = classifications.filter(c => !c.supports_memory);
console.log(`\nUnmapped entries (no memory match): ${unmapped.length}`);
