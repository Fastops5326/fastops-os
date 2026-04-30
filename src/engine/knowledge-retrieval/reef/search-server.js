#!/usr/bin/env node
/**
 * reef/search-server.js — Persistent search daemon for <50ms warm cache
 *
 * Problem: contextual-injection.js spawns a new process per PreToolUse hook.
 * Each invocation pays ~150ms to load+parse the 12MB index.json.
 * This daemon loads the index ONCE and serves searches via HTTP on localhost.
 *
 * Lifecycle:
 *   - Auto-started by first search request (via search.js startServer())
 *   - Auto-stops after 5 minutes of idle (no requests)
 *   - Auto-reloads index if index.json mtime changes
 *   - Writes port to .fastops/.search-server-port for clients
 *   - Writes PID to .fastops/.search-server-pid for cleanup
 *
 * API:
 *   POST /search  { query: string, topN?: number }  → search results JSON
 *   GET  /health  → "ok"
 *   GET  /stats   → { uptime, searches, index_entries, last_reload }
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..');
const FASTOPS = path.join(BASE, '.fastops');
const INDEX_PATH = path.join(__dirname, 'index.json');
const PORT_FILE = path.join(FASTOPS, '.search-server-port');
const PID_FILE = path.join(FASTOPS, '.search-server-pid');
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

let index = null;
let indexMtime = 0;
let invertedIndex = null; // term → [{idx, count}]
let entryIdToIdx = null;  // entry.id → array index (for O(1) edge boost lookup)
let idleTimer = null;
let searchCount = 0;
let startTime = Date.now();
let lastReload = null;

const { tokenize, expandWithSynonyms } = require('./search.js');

function loadIndex() {
  try {
    const stat = fs.statSync(INDEX_PATH);
    if (stat.mtimeMs !== indexMtime) {
      const t0 = Date.now();
      index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
      indexMtime = stat.mtimeMs;
      lastReload = new Date().toISOString();
      buildInvertedIndex();
      console.log(`[search-server] Index loaded + inverted: ${index.entries.length} entries, ${Date.now() - t0}ms`);
    }
  } catch (err) {
    console.error(`[search-server] Failed to load index: ${err.message}`);
  }
  return index;
}

function buildInvertedIndex() {
  invertedIndex = new Map();
  entryIdToIdx = new Map();
  for (let i = 0; i < index.entries.length; i++) {
    const entry = index.entries[i];
    entryIdToIdx.set(entry.id, i);
    const termCounts = new Map();
    for (const t of entry.tokens) termCounts.set(t, (termCounts.get(t) || 0) + 1);
    for (const b of entry.bigrams) termCounts.set(b, (termCounts.get(b) || 0) + 1);
    for (const [term, count] of termCounts) {
      if (!invertedIndex.has(term)) invertedIndex.set(term, []);
      invertedIndex.get(term).push({ idx: i, count });
    }
  }
}

function searchFast(query, topN) {
  const rawTokens = tokenize(query);
  const expanded = expandWithSynonyms(rawTokens, index.synonym_groups || []);
  const queryBigrams = [];
  for (let i = 0; i < rawTokens.length - 1; i++) {
    queryBigrams.push(rawTokens[i] + ' ' + rawTokens[i + 1]);
  }
  const allQueryTerms = [...expanded, ...queryBigrams];
  const queryTF = new Map();
  for (const term of allQueryTerms) queryTF.set(term, (queryTF.get(term) || 0) + 1);

  // Score only entries with matching terms (via inverted index)
  const scoreMap = new Map();
  for (const [term, qf] of queryTF) {
    const postings = invertedIndex.get(term);
    if (!postings) continue;
    const idf = index.idf[term] || 1;
    for (const { idx, count } of postings) {
      if (!scoreMap.has(idx)) scoreMap.set(idx, { score: 0, matched: 0 });
      const data = scoreMap.get(idx);
      data.score += qf * count * idf;
      data.matched++;
    }
  }

  for (const [idx, data] of scoreMap) {
    data.score *= (index.entries[idx].weight || 1.0);
    data.score *= (1 + data.matched / allQueryTerms.length);
  }

  // Edge boost with O(1) target lookup
  const edges = index.edges || {};
  const results = [];
  for (const [idx, data] of scoreMap) {
    const entry = index.entries[idx];
    let edgeBoost = 0;
    const relatedIds = [];
    for (const edge of (edges[entry.id] || [])) {
      const targetIdx = entryIdToIdx.get(edge.target);
      if (targetIdx !== undefined && scoreMap.has(targetIdx)) {
        edgeBoost += 0.15 * edge.similarity;
        relatedIds.push(edge.target);
      }
      if (edge.outcome_validated && edge.fitness > 0) edgeBoost += 0.05 * edge.fitness;
    }
    results.push({
      source_type: entry.source_type, file_path: entry.file_path,
      id: entry.id, title: entry.title, preview: entry.preview,
      score: Math.round(data.score * (1 + edgeBoost) * 100) / 100,
      related: relatedIds.length > 0 ? relatedIds : undefined,
      edge_boost: edgeBoost > 0 ? Math.round(edgeBoost * 100) / 100 : undefined
    });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topN);
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.log('[search-server] Idle timeout — shutting down');
    cleanup();
    process.exit(0);
  }, IDLE_TIMEOUT_MS);
}

function cleanup() {
  try { fs.unlinkSync(PORT_FILE); } catch {}
  try { fs.unlinkSync(PID_FILE); } catch {}
}

const server = http.createServer((req, res) => {
  resetIdleTimer();

  if (req.method === 'POST' && req.url === '/search') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { query, topN } = JSON.parse(body);
        const idx = loadIndex();
        if (!idx) {
          res.writeHead(503);
          res.end(JSON.stringify({ error: 'Index not loaded' }));
          return;
        }
        const t0 = Date.now();
        const results = searchFast(query, topN || 3);
        searchCount++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ results, latency_ms: Date.now() - t0 }));
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  } else if (req.url === '/health') {
    res.writeHead(200);
    res.end('ok');
  } else if (req.url === '/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      uptime_s: Math.round((Date.now() - startTime) / 1000),
      searches: searchCount,
      index_entries: index ? index.entries.length : 0,
      last_reload: lastReload
    }));
  } else {
    res.writeHead(404);
    res.end('not found');
  }
});

server.on('error', (err) => {
  console.error(`[search-server] Server error: ${err.message}`);
  cleanup();
  process.exit(1);
});

process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('exit', cleanup);

// Start
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  try { fs.mkdirSync(FASTOPS, { recursive: true }); } catch {}
  fs.writeFileSync(PORT_FILE, String(port));
  fs.writeFileSync(PID_FILE, String(process.pid));
  console.log(`[search-server] Running on 127.0.0.1:${port} (PID ${process.pid})`);
  loadIndex();
  resetIdleTimer();
});
