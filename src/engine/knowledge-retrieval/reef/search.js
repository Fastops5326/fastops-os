#!/usr/bin/env node
/**
 * reef/search.js — Enhanced TF-IDF search over 1,300+ knowledge entries
 *
 * Features:
 *   - Multi-index (wisdom, evidence, agent-outputs, cards)
 *   - Synonym expansion (~50 domain term groups)
 *   - Bigram matching for compound terms
 *   - Source-type weighting (wisdom 1.5x > evidence 1.3x > outputs 1.0x > cards 0.8x)
 *   - <2 seconds, zero external dependencies
 *
 * Usage: node reef/search.js "keywords"
 * Returns: top 5 results with source_type, file_path, title, preview, score
 */

const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.join(__dirname, 'index.json');

function tokenize(text) {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);
}

function expandWithSynonyms(tokens, synonymGroups) {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    for (const group of synonymGroups) {
      const lowerGroup = group.map(s => s.toLowerCase());
      if (lowerGroup.includes(token)) {
        for (const synonym of lowerGroup) {
          expanded.add(synonym);
        }
      }
    }
  }
  return [...expanded];
}

function makeBigrams(tokens) {
  const result = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    result.push(tokens[i] + ' ' + tokens[i + 1]);
  }
  return result;
}

function search(query, index, topN = 5) {
  const rawTokens = tokenize(query);
  const expanded = expandWithSynonyms(rawTokens, index.synonym_groups || []);
  const queryBigrams = makeBigrams(rawTokens);
  const allQueryTerms = [...expanded, ...queryBigrams];

  // Build query TF
  const queryTF = {};
  for (const term of allQueryTerms) {
    queryTF[term] = (queryTF[term] || 0) + 1;
  }

  // First pass: compute base scores for all entries
  const scoreMap = {};

  for (const entry of index.entries) {
    const docTerms = {};
    for (const t of entry.tokens) docTerms[t] = (docTerms[t] || 0) + 1;
    for (const b of entry.bigrams) docTerms[b] = (docTerms[b] || 0) + 1;

    let score = 0;
    let matchedTerms = 0;

    for (const [term, qf] of Object.entries(queryTF)) {
      const df = docTerms[term] || 0;
      if (df > 0) {
        const idf = index.idf[term] || 1;
        score += qf * df * idf;
        matchedTerms++;
      }
    }

    if (score > 0) {
      score *= (entry.weight || 1.0);
      const coverage = matchedTerms / allQueryTerms.length;
      score *= (1 + coverage);
      scoreMap[entry.id] = score;
    }
  }

  // Second pass: edge-boosted scoring (Knowledge Engine)
  // If an entry's RELATED entries also match the query, boost the entry.
  // Connected knowledge surfaces together — the graph amplifies relevance.
  const edges = index.edges || {};
  const EDGE_BOOST = 0.15; // 15% boost per matching related entry

  const results = [];

  for (const entry of index.entries) {
    const baseScore = scoreMap[entry.id];
    if (!baseScore) continue;

    let edgeBoost = 0;
    const entryEdges = edges[entry.id] || [];
    const relatedIds = [];

    for (const edge of entryEdges) {
      if (scoreMap[edge.target]) {
        // Related entry also matches — boost proportionally to similarity
        edgeBoost += EDGE_BOOST * edge.similarity;
        relatedIds.push(edge.target);
      }
      // Outcome-validated edges get extra boost
      if (edge.outcome_validated && edge.fitness > 0) {
        edgeBoost += 0.05 * edge.fitness;
      }
    }

    const finalScore = baseScore * (1 + edgeBoost);

    results.push({
      source_type: entry.source_type,
      file_path: entry.file_path,
      id: entry.id,
      title: entry.title,
      preview: entry.preview,
      score: Math.round(finalScore * 100) / 100,
      related: relatedIds.length > 0 ? relatedIds : undefined,
      edge_boost: edgeBoost > 0 ? Math.round(edgeBoost * 100) / 100 : undefined
    });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topN);
}

function main() {
  const query = process.argv.slice(2).join(' ');
  if (!query) {
    console.error('Usage: node reef/search.js "keywords"');
    process.exit(1);
  }

  if (!fs.existsSync(INDEX_PATH)) {
    console.error('Index not found. Run: node reef/build-index.js');
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
  const results = search(query, index);

  if (results.length === 0) {
    console.log('No results found for: ' + query);
    process.exit(0);
  }

  // Output as structured results
  const edgeCount = index.edge_count || 0;
  console.log(`\nReef Search: "${query}" (${index.entry_count} entries, ${edgeCount} edges)\n`);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    console.log(`${i + 1}. [${r.source_type}] ${r.title}`);
    const boostStr = r.edge_boost ? ` | Edge boost: +${r.edge_boost}` : '';
    console.log(`   Score: ${r.score}${boostStr} | File: ${r.file_path}`);
    console.log(`   ${r.preview}`);
    if (r.related && r.related.length > 0) {
      console.log(`   Related: ${r.related.join(', ')}`);
    }
    console.log('');
  }

  // Also output JSON for programmatic use (when piped)
  if (!process.stdout.isTTY) {
    console.log(JSON.stringify(results, null, 2));
  }
}

/**
 * searchViaServer — Fast path using persistent search daemon.
 * Returns a Promise that resolves to { results, latency_ms } or null on failure.
 * Caller should fall back to direct search() on null.
 */
function searchViaServer(query, topN = 3) {
  const PORT_FILE = path.join(__dirname, '..', '.fastops', '.search-server-port');
  const PID_FILE = path.join(__dirname, '..', '.fastops', '.search-server-pid');

  return new Promise((resolve) => {
    let port;
    try {
      port = parseInt(fs.readFileSync(PORT_FILE, 'utf8').trim(), 10);
      if (!port || isNaN(port)) { resolve(null); return; }

      // Check if PID is still alive (stale port file guard)
      const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
      try { process.kill(pid, 0); } catch { resolve(null); return; }
    } catch {
      resolve(null);
      return;
    }

    const postData = JSON.stringify({ query, topN });
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/search',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
      timeout: 200 // 200ms max — if slower than direct, bail
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(postData);
    req.end();
  });
}

/**
 * startServer — Spawn the search daemon in background if not running.
 * Returns the port number or null.
 */
function startServer() {
  const PORT_FILE = path.join(__dirname, '..', '.fastops', '.search-server-port');
  const PID_FILE = path.join(__dirname, '..', '.fastops', '.search-server-pid');

  // Check if already running
  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    process.kill(pid, 0); // throws if not running
    return parseInt(fs.readFileSync(PORT_FILE, 'utf8').trim(), 10);
  } catch {}

  // Spawn detached
  const { spawn } = require('child_process');
  const serverPath = path.join(__dirname, 'search-server.js');
  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: 'ignore',
    cwd: path.join(__dirname, '..')
  });
  child.unref();

  // Wait briefly for port file to appear (max 500ms)
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    try {
      const port = parseInt(fs.readFileSync(PORT_FILE, 'utf8').trim(), 10);
      if (port && !isNaN(port)) return port;
    } catch {}
    // Busy wait 10ms
    const end = Date.now() + 10;
    while (Date.now() < end) {}
  }
  return null;
}

const http = require('http');

// Export for programmatic use (by mentor-agent.js)
module.exports = { search, tokenize, expandWithSynonyms, searchViaServer, startServer };

// Only run main when executed directly (not when required as module)
if (require.main === module) {
  main();
}
