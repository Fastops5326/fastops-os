#!/usr/bin/env node
// === CITY OUTCOME LEDGER (COL) — Operation Outcome Tracking ===
// Design: Kimi-K2 (schema + reliability stats)
// Hardening: DeepSeek V3 (dedup, truncation, validation)
// Adversarial QA: Mistral (10 failure mode specifications)
// Peer Review: Grok 3 (dedup hash fix, empty-state verification)
// Assembly: Claude Opus 4.6 (facilitator only — zero design decisions)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CityLedger = require('./city-ledger.js');

class CityOutcomeLedger {
  constructor() {
    this.ledger = new CityLedger(path.join(__dirname, 'city-outcome-ledger.jsonl'));
    this._recentHashes = new Map();
    this._cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [hash, ts] of this._recentHashes) {
        if (now - ts > 5000) this._recentHashes.delete(hash);
      }
    }, 60000);
    if (this._cleanupInterval.unref) this._cleanupInterval.unref();
  }

  _hashEntry(entry, timestamp) {
    const core = entry.operationType + '|' + entry.agentId + '|' +
      entry.filePaths.slice().sort().join(',') + '|' +
      Math.floor(new Date(timestamp).getTime() / 1000);
    return crypto.createHash('md5').update(core).digest('hex');
  }

  ledgerLog(outcome) {
    if (!outcome.operationType || !['PATCH', 'EXEC', 'TEST'].includes(outcome.operationType)) {
      throw new Error('operationType must be PATCH, EXEC, or TEST');
    }
    if (typeof outcome.success !== 'boolean') {
      throw new Error('success must be boolean');
    }
    if (!outcome.agentId || typeof outcome.agentId !== 'string' || !outcome.agentId.trim()) {
      throw new Error('agentId required and must be non-empty string');
    }
    if (!Array.isArray(outcome.filePaths)) {
      throw new Error('filePaths must be array');
    }

    if (outcome.lineRanges) {
      if (!Array.isArray(outcome.lineRanges)) throw new Error('lineRanges must be array of [start, end]');
      for (const range of outcome.lineRanges) {
        if (!Array.isArray(range) || range.length !== 2) throw new Error('each lineRange must be [start, end]');
        if (typeof range[0] !== 'number' || typeof range[1] !== 'number') throw new Error('lineRange values must be numbers');
        if (range[0] < 0 || range[1] < 0) throw new Error('lineRange values must be non-negative');
        if (range[0] > range[1]) throw new Error('lineRange start must be <= end');
      }
    }

    let errorContext = outcome.errorContext || null;
    let contextTruncated = false;
    if (errorContext) {
      const serialized = typeof errorContext === 'string' ? errorContext : JSON.stringify(errorContext);
      if (serialized.length > 2048) {
        errorContext = serialized.slice(0, 2048);
        contextTruncated = true;
      }
    }

    const timestamp = new Date().toISOString();
    const entry = {
      operationType: outcome.operationType,
      success: outcome.success,
      agentId: outcome.agentId.trim(),
      filePaths: outcome.filePaths,
      lineRanges: outcome.lineRanges || [],
      errorType: outcome.errorType || null,
      errorContext,
      contextTruncated
    };

    const hash = this._hashEntry(entry, timestamp);
    const now = Date.now();
    if (this._recentHashes.has(hash) && (now - this._recentHashes.get(hash)) < 2000) {
      return { deduplicated: true, hash };
    }
    this._recentHashes.set(hash, now);

    return this.ledger.append({
      type: 'outcome',
      agent: entry.agentId,
      action: entry.operationType,
      data: entry,
      tags: [entry.operationType, entry.success ? 'SUCCESS' : 'FAILURE']
    });
  }

  ledgerQuery(filters = {}) {
    const parentFilters = { type: 'outcome', limit: filters.limit || 1000 };
    if (filters.since) parentFilters.since = filters.since;
    if (filters.agentId) parentFilters.agent = filters.agentId;
    if (filters.tags) parentFilters.tags = filters.tags;
    let results = this.ledger.query(parentFilters);
    if (filters.operationType) {
      results = results.filter(e => e.data && e.data.operationType === filters.operationType);
    }
    if (filters.success !== undefined) {
      results = results.filter(e => e.data && e.data.success === filters.success);
    }
    return results;
  }

  _calculateReliability(results) {
    const stats = { byOperationType: {}, byAgent: {}, overall: { total: 0, success: 0, rate: 0 } };
    for (const event of results) {
      const d = event.data || {};
      const op = d.operationType, agent = d.agentId, ok = d.success;
      if (op) {
        if (!stats.byOperationType[op]) stats.byOperationType[op] = { total: 0, success: 0, rate: 0 };
        stats.byOperationType[op].total++;
        if (ok) stats.byOperationType[op].success++;
      }
      if (agent) {
        if (!stats.byAgent[agent]) stats.byAgent[agent] = { total: 0, success: 0, rate: 0 };
        stats.byAgent[agent].total++;
        if (ok) stats.byAgent[agent].success++;
      }
      stats.overall.total++;
      if (ok) stats.overall.success++;
    }
    for (const s of Object.values(stats.byOperationType)) s.rate = s.total > 0 ? s.success / s.total : 0;
    for (const s of Object.values(stats.byAgent)) s.rate = s.total > 0 ? s.success / s.total : 0;
    stats.overall.rate = stats.overall.total > 0 ? stats.overall.success / stats.overall.total : 0;
    return stats;
  }

  reliability(filters = {}) {
    const results = this.ledgerQuery(filters);
    return this._calculateReliability(results);
  }

  snapshot() {
    const results = this.ledgerQuery({ limit: 10000 });
    if (results.length === 0) return 'No operations recorded yet.';
    const stats = this._calculateReliability(results);
    const opsSorted = Object.entries(stats.byOperationType).sort((a, b) => b[1].rate - a[1].rate);
    const lines = [];
    lines.push('Outcome Ledger: ' + stats.overall.total + ' ops, ' + (stats.overall.rate * 100).toFixed(1) + '% success');
    if (opsSorted.length > 0) {
      const best = opsSorted[0];
      lines.push('Most reliable: ' + best[0] + ' (' + (best[1].rate * 100).toFixed(1) + '% of ' + best[1].total + ')');
    }
    if (opsSorted.length > 1) {
      const worst = opsSorted[opsSorted.length - 1];
      lines.push('Least reliable: ' + worst[0] + ' (' + (worst[1].rate * 100).toFixed(1) + '% of ' + worst[1].total + ')');
    }
    return lines.join('\n');
  }
}

// === CLI ===
if (require.main === module) {
  const args = process.argv.slice(2);
  const col = new CityOutcomeLedger();

  if (!args.length || args[0] === '--help' || args[0] === '-h') {
    console.log('City Outcome Ledger — operation outcome tracking\n');
    console.log('  --log operationType=PATCH success=true agentId=NAME filePaths=a.js,b.js');
    console.log('  --query [operationType=X] [agentId=X] [success=true|false] [since=HOURS]');
    console.log('  --reliability [operationType=X] [agentId=X]');
    console.log('  --snapshot — 3-line summary for .city-snapshot.md\n');
    console.log('Operation types: PATCH, EXEC, TEST');
    console.log('Design: Kimi-K2 | Hardening: DeepSeek V3 | QA: Mistral | Review: Grok');
    process.exit(0);
  }

  function parseKV(kvArgs) {
    const obj = {};
    for (const arg of kvArgs) {
      const eq = arg.indexOf('=');
      if (eq === -1) continue;
      const key = arg.slice(0, eq);
      let val = arg.slice(eq + 1);
      if (val === 'true') val = true;
      else if (val === 'false') val = false;
      else if (key === 'filePaths') val = val.split(',');
      else if (key === 'lineRanges') {
        val = val.split(',').map(function(r) { var parts = r.split(':').map(Number); return [parts[0], parts[1]]; });
      }
      else if (key === 'since' || key === 'limit') val = Number(val);
      obj[key] = val;
    }
    return obj;
  }

  try {
    if (args[0] === '--log') {
      console.log(JSON.stringify(col.ledgerLog(parseKV(args.slice(1)))));
    } else if (args[0] === '--query') {
      console.log(JSON.stringify(col.ledgerQuery(parseKV(args.slice(1))), null, 2));
    } else if (args[0] === '--reliability') {
      console.log(JSON.stringify(col.reliability(parseKV(args.slice(1))), null, 2));
    } else if (args[0] === '--snapshot') {
      console.log(col.snapshot());
    } else {
      console.error('Unknown command. Use --help.');
      process.exit(1);
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

module.exports = CityOutcomeLedger;
