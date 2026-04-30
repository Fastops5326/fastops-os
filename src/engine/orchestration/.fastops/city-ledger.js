#!/usr/bin/env node
// === CITY LEDGER — The City's Persistence Layer ===
// Architecture: DeepSeek (core design, append/query/compress)
// Contributions: Gemini (event schema + correlation_id), Grok (witness on replay verification)
// Assembled by: LEDGER (Claude Opus 4.6) — bug fixes only, design is the city's
//
// 28 models converged on this design: append-only event log, queryable state briefs,
// aggressive pruning with summary nodes, event-sourced state derivation.
// This is the city's DNA, not any single model's.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_LEDGER_PATH = path.join(__dirname, 'city-ledger.jsonl');

class CityLedger {
  constructor(filePath = DEFAULT_LEDGER_PATH) {
    this.filePath = path.resolve(filePath);
    this._ensureFile();
    this.sequence = this._getLastSequence();
  }

  _ensureFile() {
    if (!fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, '');
    }
  }

  _getLastSequence() {
    const content = fs.readFileSync(this.filePath, 'utf8').trim();
    if (!content) return 0;
    const lines = content.split('\n');
    const lastLine = lines[lines.length - 1];
    try {
      const parsed = JSON.parse(lastLine);
      return (parsed.sequence || 0) + 1;
    } catch {
      return 0;
    }
  }

  // Append a structured event to the ledger
  // Required: type, agent, action
  // Optional: data (object), tags (array), correlationId
  append(event) {
    if (!event.type || !event.agent || !event.action) {
      throw new Error('Event requires: type, agent, action');
    }

    const fullEvent = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      sequence: this.sequence++,
      type: event.type,
      agent: event.agent,
      action: event.action,
      data: event.data || {},
      tags: event.tags || [],
      correlationId: event.correlationId || null
    };

    fs.appendFileSync(this.filePath, JSON.stringify(fullEvent) + '\n');
    return fullEvent;
  }

  // Convenience: log a convergence event with structured metadata
  // score: 0-1.0 convergence score, models: array of model names,
  // question: the problem posed, divergence: optional divergence map
  logConvergence({ agent, question, score, models, divergence, correlationId } = {}) {
    return this.append({
      type: 'convergence',
      agent: agent || 'city',
      action: score >= 0.7 ? 'converged' : 'diverged',
      data: {
        question: question || '',
        score: score != null ? score : null,
        modelCount: Array.isArray(models) ? models.length : 0,
        models: Array.isArray(models) ? models : [],
        divergence: divergence || null
      },
      tags: ['convergence', score >= 0.7 ? 'high-signal' : 'low-signal'],
      correlationId: correlationId || null
    });
  }

  // Convenience: log agent lifecycle events (boot, compact, mission-start, handoff)
  logLifecycle({ agent, action, data, correlationId } = {}) {
    return this.append({
      type: 'lifecycle',
      agent: agent || 'unknown',
      action: action || 'boot',
      data: data || {},
      tags: ['lifecycle'],
      correlationId: correlationId || null
    });
  }

  // Query events matching filters
  // since: hours ago, type: event type, agent: agent id, limit: max results
  query({ since, type, agent, tags, limit = 100 } = {}) {
    if (!fs.existsSync(this.filePath)) return [];

    const now = Date.now();
    const cutoff = since ? now - (since * 3600 * 1000) : 0;
    const results = [];

    const content = fs.readFileSync(this.filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        const eventTime = new Date(event.timestamp).getTime();

        if (since && eventTime < cutoff) continue;
        if (type && event.type !== type) continue;
        if (agent && event.agent !== agent) continue;
        if (tags && tags.length && !tags.some(t => (event.tags || []).includes(t))) continue;

        results.push(event);
        if (results.length >= limit) break;
      } catch {
        // Skip malformed lines
      }
    }

    return results;
  }

  // Generate a human-readable summary of recent activity
  stateBrief(hours = 24) {
    const events = this.query({ since: hours, limit: 10000 });
    const byType = {};

    for (const event of events) {
      if (!byType[event.type]) {
        byType[event.type] = { count: 0, agents: new Set(), actions: new Set(), latest: null };
      }
      byType[event.type].count++;
      byType[event.type].agents.add(event.agent);
      byType[event.type].actions.add(event.action);
      byType[event.type].latest = event.timestamp;
    }

    const lines = [`# City State Brief — last ${hours}h`, `Total events: ${events.length}`, ''];

    for (const [type, data] of Object.entries(byType)) {
      lines.push(`## ${type} (${data.count} events)`);
      lines.push(`  Agents: ${Array.from(data.agents).join(', ')}`);
      lines.push(`  Actions: ${Array.from(data.actions).join(', ')}`);
      lines.push(`  Latest: ${data.latest}`);
      lines.push('');
    }

    if (events.length === 0) {
      lines.push('No activity in this window.');
    }

    return lines.join('\n');
  }

  // Compress events older than threshold into summary nodes
  compress(olderThanHours = 48) {
    if (!fs.existsSync(this.filePath)) return { compressed: 0, summaries: 0 };

    const cutoff = Date.now() - (olderThanHours * 3600 * 1000);
    const content = fs.readFileSync(this.filePath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());

    const keep = [];
    const old = [];

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (new Date(event.timestamp).getTime() < cutoff && event.type !== 'summary') {
          old.push(event);
        } else {
          keep.push(line);
        }
      } catch {
        // Drop malformed lines during compression
      }
    }

    if (old.length === 0) return { compressed: 0, summaries: 0 };

    // Group old events by hour + type (DeepSeek's design)
    const groups = {};
    for (const event of old) {
      const hourKey = event.timestamp.slice(0, 13) + ':00:00Z';
      const key = `${hourKey}|${event.type}`;
      if (!groups[key]) {
        groups[key] = { hour: hourKey, type: event.type, count: 0, agents: new Set(), actions: new Set(), sampleIds: [] };
      }
      groups[key].count++;
      groups[key].agents.add(event.agent);
      groups[key].actions.add(event.action);
      if (groups[key].sampleIds.length < 3) {
        groups[key].sampleIds.push(event.id);
      }
    }

    // Write summary nodes
    const summaryLines = Object.values(groups).map(g => JSON.stringify({
      id: crypto.randomUUID(),
      timestamp: g.hour,
      sequence: -1, // summaries don't need sequence
      type: 'summary',
      agent: 'city-ledger',
      action: 'compress',
      data: {
        originalType: g.type,
        count: g.count,
        agents: Array.from(g.agents),
        actions: Array.from(g.actions),
        sampleIds: g.sampleIds
      },
      tags: ['compressed']
    }));

    // Atomic write: temp file + rename (Gemini's recommendation over appendFile)
    const tempPath = this.filePath + '.tmp';
    fs.writeFileSync(tempPath, [...summaryLines, ...keep].join('\n') + '\n');
    fs.renameSync(tempPath, this.filePath);

    return { compressed: old.length, summaries: summaryLines.length };
  }

  // Get total event count
  count() {
    if (!fs.existsSync(this.filePath)) return 0;
    return fs.readFileSync(this.filePath, 'utf8').split('\n').filter(l => l.trim()).length;
  }
}

// === CLI ===
if (require.main === module) {
  const args = process.argv.slice(2);
  const ledger = new CityLedger();

  if (args[0] === '--append' || args[0] === '-a') {
    try {
      const event = JSON.parse(args[1]);
      const result = ledger.append(event);
      console.log('Appended:', JSON.stringify(result));
    } catch (e) {
      console.error('Usage: --append \'{"type":"mission","agent":"LEDGER","action":"started","data":{},"tags":[]}\'');
      console.error('Error:', e.message);
      process.exit(1);
    }
  } else if (args[0] === '--query' || args[0] === '-q') {
    const opts = {};
    for (let i = 1; i < args.length; i += 2) {
      const key = args[i].replace('--', '');
      const val = args[i + 1];
      if (key === 'since' || key === 'limit') opts[key] = Number(val);
      else if (key === 'tags') opts[key] = val.split(',');
      else opts[key] = val;
    }
    const results = ledger.query(opts);
    console.log(JSON.stringify(results, null, 2));
  } else if (args[0] === '--brief' || args[0] === '-b') {
    const hours = args[1] ? Number(args[1]) : 24;
    console.log(ledger.stateBrief(hours));
  } else if (args[0] === '--compress') {
    const hours = args[1] ? Number(args[1]) : 48;
    const result = ledger.compress(hours);
    console.log(`Compressed ${result.compressed} events into ${result.summaries} summaries`);
  } else if (args[0] === '--count') {
    console.log(`${ledger.count()} events in ledger`);
  } else {
    console.log(`City Ledger — the city's persistence layer

  --append '{"type":"..","agent":"..","action":".."}' — log an event
  --query [--since H] [--type T] [--agent A] [--limit N] — search events
  --brief [hours] — state summary (default 24h)
  --compress [hours] — compress old events (default 48h)
  --count — total event count

Event types: mission, decision, build, convergence, lifecycle, marketplace, profile, comms, warning`);
  }
}

module.exports = CityLedger;
