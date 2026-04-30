#!/usr/bin/env node
/**
 * city-compare.js — Run-to-run comparison tool (Gap 5 — city-aligned).
 *
 * Compares two city-solve or city-converge-v2 result JSONs and outputs:
 *   - New claims (in B but not A)
 *   - Lost claims (in A but not B)
 *   - Convergence score delta
 *   - New divergences
 *   - New blind spots
 *   - Model coverage delta
 *   - Cost delta (if available)
 *
 * Usage:
 *   node .fastops/city-compare.js --a results-15.json --b results-25.json
 *   node .fastops/city-compare.js --a run1.json --b run2.json --output diff.json
 */

const fs = require('fs');
const path = require('path');

function extractModelList(raw) {
  if (Array.isArray(raw.models)) return raw.models;
  if (raw.modelNames) return raw.modelNames;
  if (raw.tiers?.phase1?.responses) return raw.tiers.phase1.responses.map(r => r.model).filter(Boolean);
  return [];
}

function loadResult(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const modelList = extractModelList(raw);
  return {
    path: filePath,
    models: modelList,
    modelCount: modelList.length || raw.models?.queried || 0,
    fireteamCount: raw.fireteams?.length || raw.tiers?.fireteamCount || 0,
    convergenceScore: extractConvergenceScore(raw),
    analysis: raw.analysis || '',
    qualityGate: raw.qualityGate || {},
    costs: raw.costs || null,
    elapsed: raw.elapsed || '?',
    timestamp: raw.timestamp || '?'
  };
}

function extractConvergenceScore(raw) {
  // Check structured fields first
  if (typeof raw.convergenceScore === 'number') return raw.convergenceScore;
  if (raw.tiers?.convergenceScore != null) return raw.tiers.convergenceScore;
  if (raw.qualityGate?.convergenceScore != null) return raw.qualityGate.convergenceScore;
  // Fall back to regex on analysis text — require 0.X format to avoid matching dates
  const text = raw.analysis || '';
  const match = text.match(/convergence\s*score[:\s]*\*?\*?(0\.[0-9]+|1\.0)/i);
  return match ? parseFloat(match[1]) : null;
}

function extractClaims(text) {
  const claims = [];
  // Match lines that look like claims: "- **Something**" or "- Something:"
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/[-*]\s*\*?\*?(.+?)\*?\*?\s*[-—]/);
    if (match) claims.push(match[1].trim().toLowerCase());
  }
  // Also extract any "Bravo Two", "Mike Thirteen" style entity mentions
  const entities = text.match(/\b[A-Z][a-z]+ (?:Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Eleven|Twelve|Thirteen|Fourteen|Fifteen|Sixteen|Seventeen|Eighteen|Nineteen|Twenty|Prime|Gate|Fort|Hub)\b/g) || [];
  return { claims, entities: [...new Set(entities)] };
}

function extractBlindSpots(text) {
  const spots = [];
  const section = text.match(/blind\s*spot[s]?[\s\S]*?(?=\n#{1,3}\s|\n---|\n\*\*[A-Z]|$)/i);
  if (section) {
    const lines = section[0].split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('*'));
    for (const l of lines) spots.push(l.replace(/^[\s*-]+/, '').trim().toLowerCase());
  }
  return spots;
}

function extractDivergences(text) {
  const divs = [];
  const section = text.match(/divergence\s*map[\s\S]*?(?=\n#{1,3}\s|\n---|\n\*\*convergence|$)/i);
  if (section) {
    const lines = section[0].split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('*'));
    for (const l of lines) divs.push(l.replace(/^[\s*-]+/, '').trim().toLowerCase());
  }
  return divs;
}

function compare(a, b) {
  const aClaims = extractClaims(a.analysis);
  const bClaims = extractClaims(b.analysis);
  const aSpots = extractBlindSpots(a.analysis);
  const bSpots = extractBlindSpots(b.analysis);
  const aDivs = extractDivergences(a.analysis);
  const bDivs = extractDivergences(b.analysis);

  const newClaims = bClaims.claims.filter(c => !aClaims.claims.some(ac => ac.includes(c.slice(0, 20)) || c.includes(ac.slice(0, 20))));
  const lostClaims = aClaims.claims.filter(c => !bClaims.claims.some(bc => bc.includes(c.slice(0, 20)) || c.includes(bc.slice(0, 20))));
  const newEntities = bClaims.entities.filter(e => !aClaims.entities.includes(e));
  const lostEntities = aClaims.entities.filter(e => !bClaims.entities.includes(e));
  const newSpots = bSpots.filter(s => !aSpots.some(as => as.includes(s.slice(0, 20)) || s.includes(as.slice(0, 20))));
  const newDivs = bDivs.filter(d => !aDivs.some(ad => ad.includes(d.slice(0, 20)) || d.includes(ad.slice(0, 20))));

  const newModels = b.models.filter(m => !a.models.includes(m));
  const droppedModels = a.models.filter(m => !b.models.includes(m));

  const scoreDelta = (a.convergenceScore != null && b.convergenceScore != null)
    ? Math.round((b.convergenceScore - a.convergenceScore) * 100) / 100
    : null;

  const costDelta = (a.costs && b.costs)
    ? { a: a.costs.totalCost, b: b.costs.totalCost, delta: Math.round((b.costs.totalCost - a.costs.totalCost) * 100000) / 100000 }
    : null;

  return {
    runA: { path: a.path, models: a.modelCount, fireteams: a.fireteamCount, convergence: a.convergenceScore, elapsed: a.elapsed, timestamp: a.timestamp },
    runB: { path: b.path, models: b.modelCount, fireteams: b.fireteamCount, convergence: b.convergenceScore, elapsed: b.elapsed, timestamp: b.timestamp },
    convergenceScoreDelta: scoreDelta,
    analysisLengthDelta: { a: a.analysis.length, b: b.analysis.length, delta: b.analysis.length - a.analysis.length },
    claims: { new: newClaims, lost: lostClaims, newEntities, lostEntities },
    blindSpots: { new: newSpots },
    divergences: { new: newDivs },
    models: { new: newModels, dropped: droppedModels },
    costs: costDelta
  };
}

function printDiff(diff) {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║     CITY-COMPARE — Run Diff               ║');
  console.log('╚══════════════════════════════════════════╝\n');

  console.log(`Run A: ${diff.runA.models} models, ${diff.runA.fireteams} fireteams, conv ${diff.runA.convergence}, ${diff.runA.elapsed}`);
  console.log(`Run B: ${diff.runB.models} models, ${diff.runB.fireteams} fireteams, conv ${diff.runB.convergence}, ${diff.runB.elapsed}`);

  if (diff.convergenceScoreDelta !== null) {
    const arrow = diff.convergenceScoreDelta > 0 ? '↑' : diff.convergenceScoreDelta < 0 ? '↓' : '=';
    console.log(`\nConvergence: ${diff.runA.convergence} → ${diff.runB.convergence} (${arrow} ${diff.convergenceScoreDelta})`);
  }

  console.log(`Analysis: ${diff.analysisLengthDelta.a} → ${diff.analysisLengthDelta.b} chars (${diff.analysisLengthDelta.delta > 0 ? '+' : ''}${diff.analysisLengthDelta.delta})`);

  if (diff.models.new.length > 0) console.log(`\nNew models: ${diff.models.new.join(', ')}`);
  if (diff.models.dropped.length > 0) console.log(`Dropped models: ${diff.models.dropped.join(', ')}`);

  if (diff.claims.new.length > 0) {
    console.log('\nNEW CLAIMS (in B but not A):');
    for (const c of diff.claims.new) console.log(`  + ${c}`);
  }
  if (diff.claims.lost.length > 0) {
    console.log('\nLOST CLAIMS (in A but not B):');
    for (const c of diff.claims.lost) console.log(`  - ${c}`);
  }
  if (diff.claims.newEntities.length > 0) console.log(`\nNew entities mentioned: ${diff.claims.newEntities.join(', ')}`);
  if (diff.claims.lostEntities.length > 0) console.log(`Lost entities: ${diff.claims.lostEntities.join(', ')}`);

  if (diff.divergences.new.length > 0) {
    console.log('\nNEW DIVERGENCES:');
    for (const d of diff.divergences.new) console.log(`  ⚡ ${d}`);
  }

  if (diff.blindSpots.new.length > 0) {
    console.log('\nNEW BLIND SPOTS:');
    for (const s of diff.blindSpots.new) console.log(`  👁 ${s}`);
  }

  if (diff.costs) {
    console.log(`\nCost: $${diff.costs.a?.toFixed(4)} → $${diff.costs.b?.toFixed(4)} (${diff.costs.delta > 0 ? '+' : ''}$${diff.costs.delta?.toFixed(4)})`);
  }
}

// ═══ CLI ═══
if (require.main === module) {
  const args = process.argv.slice(2);
  const getArg = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };

  const fileA = getArg('--a');
  const fileB = getArg('--b');
  const output = getArg('--output');

  if (!fileA || !fileB) {
    console.log(`city-compare.js — Run-to-run comparison tool

Usage:
  node .fastops/city-compare.js --a results-15.json --b results-25.json
  node .fastops/city-compare.js --a run1.json --b run2.json --output diff.json

Compares two city-solve or city-converge-v2 result JSONs.`);
    process.exit(0);
  }

  const a = loadResult(fileA);
  const b = loadResult(fileB);
  const diff = compare(a, b);

  printDiff(diff);

  if (output) {
    fs.writeFileSync(output, JSON.stringify(diff, null, 2));
    console.log(`\nDiff saved: ${output}`);
  }
}

module.exports = { compare, loadResult };
