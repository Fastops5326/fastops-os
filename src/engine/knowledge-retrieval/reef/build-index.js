#!/usr/bin/env node
/**
 * reef/build-index.js — Multi-index builder for reef search
 *
 * Scans 4 knowledge sources with tailored tokenization per type.
 * Outputs reef/index.json for use by reef/search.js.
 *
 * Sources:
 *   knowledge-base.jsonl (principles) — field extraction (trigger, content, anti_pattern)
 *   knowledge-base.jsonl (cases)      — field extraction (problem, solution, outcome)
 *   evidence-index    — keyword extraction (relevance_keywords, predecessor_quote)
 *   agent-outputs/*.md — bigrams on title + first 500 chars
 *   cards/*.json      — exact field extraction (committed_position, wrong_turns)
 *
 * Usage: node reef/build-index.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(__dirname, 'index.json');
const SYNONYMS_PATH = path.join(__dirname, 'synonyms.json');

// --- Tokenization helpers ---

function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function bigrams(tokens) {
  const result = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    result.push(tokens[i] + ' ' + tokens[i + 1]);
  }
  return result;
}

function extractTitle(markdown) {
  const match = markdown.match(/^#{1,2}\s+(.+)$/m);
  return match ? match[1].trim() : '';
}

function extractPreview(markdown, maxLen = 200) {
  const lines = markdown.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const text = lines.slice(0, 5).join(' ').trim();
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

// --- Source indexers ---

function indexWisdom() {
  const entries = [];
  // Primary: read from unified knowledge-base.jsonl (principle nodes)
  const kbPath = path.join(ROOT, '.fastops', 'knowledge-base.jsonl');
  // Fallback: legacy wisdom.json
  const wisdomPath = path.join(ROOT, '.fastops', 'wisdom.json');

  if (fs.existsSync(kbPath)) {
    const lines = fs.readFileSync(kbPath, 'utf8').trim().split('\n');
    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        if (item.type !== 'principle') continue;
        const text = [item.trigger, item.content, item.anti_pattern].filter(Boolean).join(' ');
        const tokens = tokenize(text);
        entries.push({
          source_type: 'wisdom',
          file_path: '.fastops/knowledge-base.jsonl',
          id: item.id || 'unknown',
          title: item.id + ': ' + (item.trigger || item.title || '').slice(0, 80),
          preview: (item.content || '').slice(0, 200),
          tokens,
          bigrams: bigrams(tokens),
          weight: 1.5
        });
      } catch {}
    }
    return entries;
  }

  // Fallback: legacy wisdom.json (deprecated — will be removed)
  if (!fs.existsSync(wisdomPath)) return entries;
  const data = JSON.parse(fs.readFileSync(wisdomPath, 'utf8'));
  const items = data.insights || data;
  for (const item of items) {
    const text = [item.trigger, item.insight, item.anti_pattern].filter(Boolean).join(' ');
    const tokens = tokenize(text);
    entries.push({
      source_type: 'wisdom',
      file_path: '.fastops/wisdom.json',
      id: item.id || 'unknown',
      title: item.id + ': ' + (item.trigger || '').slice(0, 80),
      preview: (item.insight || '').slice(0, 200),
      tokens,
      bigrams: bigrams(tokens),
      weight: 1.5
    });
  }
  return entries;
}

function indexCases() {
  const entries = [];
  const kbPath = path.join(ROOT, '.fastops', 'knowledge-base.jsonl');
  if (!fs.existsSync(kbPath)) return entries;

  const lines = fs.readFileSync(kbPath, 'utf8').trim().split('\n');
  for (const line of lines) {
    try {
      const item = JSON.parse(line);
      if (item.type !== 'case') continue;
      const prob = item.problem || {};
      const sol = item.solution || {};
      const out = item.outcome || {};
      const text = [
        prob.symptom, prob.root_cause, (prob.tags || []).join(' '),
        sol.what_worked, sol.what_failed,
        out.learned, out.result
      ].filter(Boolean).join(' ');
      const tokens = tokenize(text);
      if (tokens.length === 0) continue; // skip empty case nodes
      entries.push({
        source_type: 'case',
        file_path: '.fastops/knowledge-base.jsonl',
        id: item.id || 'unknown',
        title: (item.id || '?') + ': ' + (prob.symptom || sol.what_worked || '').slice(0, 80),
        preview: [prob.symptom, '→', sol.what_worked].filter(Boolean).join(' ').slice(0, 200),
        tokens,
        bigrams: bigrams(tokens),
        weight: 1.2
      });
    } catch {}
  }
  return entries;
}

function indexEvidence() {
  const entries = [];
  const evidencePath = path.join(ROOT, 'evidence', 'mentor', 'evidence-index.json');
  if (!fs.existsSync(evidencePath)) return entries;

  const data = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));

  for (const item of data) {
    const keywords = (item.relevance_keywords || []).join(' ');
    const text = [item.one_line_summary, item.predecessor_quote, keywords, item.technical_domain, item.problem_shape].filter(Boolean).join(' ');
    const tokens = tokenize(text);
    entries.push({
      source_type: 'evidence',
      file_path: 'evidence/mentor/evidence-index.json',
      id: item.id || 'unknown',
      title: item.id + ': ' + (item.one_line_summary || '').slice(0, 80),
      preview: (item.predecessor_quote || item.one_line_summary || '').slice(0, 200),
      tokens,
      bigrams: bigrams(tokens),
      weight: 1.3
    });
  }
  return entries;
}

function indexAgentOutputs() {
  const entries = [];
  const outputsDir = path.join(ROOT, '.agent-outputs');
  if (!fs.existsSync(outputsDir)) return entries;

  const files = fs.readdirSync(outputsDir).filter(f => f.endsWith('.md'));

  for (const file of files) {
    try {
      const fullPath = path.join(outputsDir, file);
      const content = fs.readFileSync(fullPath, 'utf8');
      const first500 = content.slice(0, 500);
      const title = extractTitle(content) || file.replace('.md', '').replace(/-/g, ' ');
      const text = title + ' ' + first500;
      const tokens = tokenize(text);

      entries.push({
        source_type: 'agent-output',
        file_path: '.agent-outputs/' + file,
        id: file.replace('.md', ''),
        title: title.slice(0, 100),
        preview: extractPreview(content),
        tokens,
        bigrams: bigrams(tokens),
        weight: 1.0
      });
    } catch (e) {
      // Skip unreadable files
    }
  }
  return entries;
}

function indexCards() {
  const entries = [];
  const cardsDir = path.join(ROOT, 'environment', 'cards');
  if (!fs.existsSync(cardsDir)) return entries;

  const files = fs.readdirSync(cardsDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const fullPath = path.join(cardsDir, file);
      const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
      const parts = [
        data.committed_position,
        (data.wrong_turns || []).join(' '),
        (data.what_survived || []).join(' '),
        (data.what_was_abandoned || []).join(' '),
        data.agent,
        data.shape,
        data.if_repeated
      ].filter(Boolean);
      const text = parts.join(' ');
      const tokens = tokenize(text);

      entries.push({
        source_type: 'card',
        file_path: 'environment/cards/' + file,
        id: file.replace('.json', ''),
        title: `Session ${data.session || '?'} (${data.agent || 'unknown'}): ${(data.committed_position || '').slice(0, 60)}`,
        preview: (data.committed_position || '').slice(0, 200),
        tokens,
        bigrams: bigrams(tokens),
        weight: 0.8
      });
    } catch (e) {
      // Skip unreadable files
    }
  }
  return entries;
}

// --- Build IDF table ---

function buildIDF(entries) {
  const N = entries.length;
  const df = {};

  for (const entry of entries) {
    const unique = new Set([...entry.tokens, ...entry.bigrams]);
    for (const term of unique) {
      df[term] = (df[term] || 0) + 1;
    }
  }

  const idf = {};
  for (const [term, count] of Object.entries(df)) {
    idf[term] = Math.log((N + 1) / (count + 1)) + 1;
  }
  return idf;
}

// --- Edge Generation (Knowledge Engine MVP) ---

/**
 * Compute cosine similarity between two entries using their TF-IDF vectors.
 * For each entry, build a sparse vector from tokens+bigrams weighted by IDF,
 * then compute cosine similarity.
 */
function cosineSimilarity(entryA, entryB, idf) {
  const vecA = {};
  for (const t of entryA.tokens) vecA[t] = (vecA[t] || 0) + (idf[t] || 1);
  for (const b of entryA.bigrams) vecA[b] = (vecA[b] || 0) + (idf[b] || 1);

  const vecB = {};
  for (const t of entryB.tokens) vecB[t] = (vecB[t] || 0) + (idf[t] || 1);
  for (const b of entryB.bigrams) vecB[b] = (vecB[b] || 0) + (idf[b] || 1);

  // Dot product
  let dot = 0;
  for (const term of Object.keys(vecA)) {
    if (vecB[term]) dot += vecA[term] * vecB[term];
  }
  if (dot === 0) return 0;

  // Magnitudes
  let magA = 0, magB = 0;
  for (const v of Object.values(vecA)) magA += v * v;
  for (const v of Object.values(vecB)) magB += v * v;

  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * For each entry, find the top N most similar entries.
 * Returns an array of edges: {source, target, similarity, type}
 * Default-to-graph: entries are BORN connected.
 */
function generateEdges(entries, idf, topN = 3) {
  console.log('  Generating edges (default-to-graph)...');
  const edges = [];
  const totalPairs = entries.length;
  let processed = 0;

  for (let i = 0; i < entries.length; i++) {
    const scores = [];
    for (let j = 0; j < entries.length; j++) {
      if (i === j) continue;
      // Skip same-source comparisons for diversity (wisdom shouldn't only link to wisdom)
      const sim = cosineSimilarity(entries[i], entries[j], idf);
      if (sim > 0.05) { // Minimum threshold to avoid noise
        scores.push({ target_idx: j, similarity: Math.round(sim * 1000) / 1000 });
      }
    }
    // Sort by similarity, take top N
    scores.sort((a, b) => b.similarity - a.similarity);
    const topEdges = scores.slice(0, topN);

    for (const edge of topEdges) {
      edges.push({
        source: entries[i].id,
        target: entries[edge.target_idx].id,
        similarity: edge.similarity,
        type: 'related', // Provisional — outcome validation upgrades to 'supports'/'contradicts'
        outcome_validated: false,
        fitness: 0.0,
        created_session: 124
      });
    }

    processed++;
    if (processed % 200 === 0) {
      console.log(`    ${processed}/${totalPairs} entries processed...`);
    }
  }

  console.log(`  ${edges.length} edges generated (avg ${(edges.length / entries.length).toFixed(1)} per entry)`);
  return edges;
}

// --- Main ---

function main() {
  console.log('Building reef index...');

  const wisdom = indexWisdom();
  console.log(`  principles: ${wisdom.length} entries`);

  const cases = indexCases();
  console.log(`  cases: ${cases.length} entries`);

  const evidence = indexEvidence();
  console.log(`  evidence-index: ${evidence.length} entries`);

  const outputs = indexAgentOutputs();
  console.log(`  agent-outputs: ${outputs.length} entries`);

  const cards = indexCards();
  console.log(`  cards: ${cards.length} entries`);

  const allEntries = [...wisdom, ...cases, ...evidence, ...outputs, ...cards];
  console.log(`  TOTAL: ${allEntries.length} entries`);

  const idf = buildIDF(allEntries);
  console.log(`  IDF vocabulary: ${Object.keys(idf).length} terms`);

  // Load synonym groups
  let synonymGroups = [];
  if (fs.existsSync(SYNONYMS_PATH)) {
    const synData = JSON.parse(fs.readFileSync(SYNONYMS_PATH, 'utf8'));
    synonymGroups = synData.groups || [];
    console.log(`  Synonym groups: ${synonymGroups.length}`);
  }

  // Generate edges (Knowledge Engine MVP — default-to-graph)
  const edges = generateEdges(allEntries, idf, 3);

  // Build edge lookup for fast access during search
  const edgeMap = {};
  for (const edge of edges) {
    if (!edgeMap[edge.source]) edgeMap[edge.source] = [];
    edgeMap[edge.source].push(edge);
  }

  const index = {
    built_at: new Date().toISOString(),
    entry_count: allEntries.length,
    edge_count: edges.length,
    sources: {
      wisdom: wisdom.length,
      case: cases.length,
      evidence: evidence.length,
      'agent-output': outputs.length,
      card: cards.length
    },
    idf,
    entries: allEntries,
    edges: edgeMap,
    synonym_groups: synonymGroups
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(index, null, 2));
  const stats = fs.statSync(OUTPUT);
  console.log(`\nIndex written to ${OUTPUT} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`  ${allEntries.length} entries, ${edges.length} edges`);
  console.log(`  Average edges per entry: ${(edges.length / allEntries.length).toFixed(1)}`);
}

main();
