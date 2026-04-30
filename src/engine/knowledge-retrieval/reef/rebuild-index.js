#!/usr/bin/env node
'use strict';

/**
 * reef/rebuild-index.js — Standalone Knowledge Index Rebuilder
 *
 * Rebuilds .fastops/knowledge-index.json from current knowledge-base.jsonl state.
 * Can be called programmatically (require + call rebuildIndex()) or as CLI.
 *
 * After ANY script modifies knowledge-base.jsonl (enrich-kb.js, sync-scores.js,
 * migrate-to-knowledge-base.js), call this to keep the index fresh.
 *
 * Usage:
 *   CLI:    node reef/rebuild-index.js [--full]
 *   Code:   const { rebuildIndex } = require('./reef/rebuild-index.js');
 *           const stats = rebuildIndex();
 *
 * Options:
 *   --full   Also rebuild reef/index.json (TF-IDF + edges, slower)
 *
 * Created: Session 157 — 8d5e70ef (Meeting action item #6)
 */

var fs = require('fs');
var path = require('path');
var execSync = require('child_process').execSync;

var ROOT = path.resolve(__dirname, '..');
var KB_FILE = path.join(ROOT, '.fastops', 'knowledge-base.jsonl');
var INDEX_FILE = path.join(ROOT, '.fastops', 'knowledge-index.json');
var REEF_INDEX_SCRIPT = path.join(__dirname, 'build-index.js');

// Domain taxonomy (matches migrate-to-knowledge-base.js)
var DOMAINS = {
  'deploy-ship':        ['deploy', 'vercel', 'build', 'git', 'push', 'ci', 'ssl', 'dns', 'env', 'cron', 'ship'],
  'visual-qa':          ['css', 'screenshot', 'ui', 'layout', 'visual', 'color', 'font', 'responsive', 'playwright'],
  'multi-agent':        ['deconflict', 'comms', 'collision', 'identity', 'lease', 'heartbeat', 'colony', 'team', 'coordination'],
  'agent-behavior':     ['helpfulness', 'permission', 'joel', 'ask', 'frame', 'bias', 'vocabulary', 'compliance', 'reasoning'],
  'knowledge-search':   ['reef', 'search', 'wisdom', 'index', 'retrieval', 'knowledge', 'monday', 'cbr'],
  'meeting-collab':     ['meeting', 'conversation', 'protocol', 'round-robin', 'external', 'model', 'council', 'horsepower'],
  'build-quality':      ['test', 'untested', 'challenge', 'jailbreak', 'horsepower', 'scope', 'quality', 'contract'],
  'succession-handoff': ['handoff', 'compaction', 'context', 'successor', 'predecessor', 'stale', 'onboarding'],
};

function autoClassify(text) {
  var lower = (text || '').toLowerCase();
  var best = null, bestScore = 0;
  for (var domain in DOMAINS) {
    var keywords = DOMAINS[domain];
    var score = 0;
    for (var ki = 0; ki < keywords.length; ki++) {
      var kw = keywords[ki];
      var re = new RegExp('\\b' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
      var m = lower.match(re);
      if (m) score += m.length;
    }
    if (score > bestScore) { bestScore = score; best = domain; }
  }
  return best;
}

/**
 * Load all entries from knowledge-base.jsonl
 */
function loadKB() {
  if (!fs.existsSync(KB_FILE)) {
    throw new Error('knowledge-base.jsonl not found at ' + KB_FILE);
  }
  var lines = fs.readFileSync(KB_FILE, 'utf8').trim().split('\n');
  var entries = [];
  for (var i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try {
      entries.push(JSON.parse(lines[i]));
    } catch (e) {
      // Skip malformed lines
    }
  }
  return entries;
}

/**
 * Extract searchable text from a node (works for both principles and cases)
 */
function getSearchableText(node) {
  if (node.type === 'case') {
    return [
      node.problem && node.problem.symptom,
      node.problem && node.problem.root_cause,
      node.solution && node.solution.what_worked,
      node.solution && node.solution.what_failed,
      node.outcome && node.outcome.result,
    ].filter(Boolean).join(' ');
  }
  return [node.content, node.trigger, node.title, node.anti_pattern].filter(Boolean).join(' ');
}

/**
 * Build the companion index from loaded entries.
 * Returns the index object with by_domain, by_tag, by_id, by_type, by_session, stats.
 */
function buildIndex(nodes) {
  var byDomain = {};
  var byTag = {};
  var byId = {};
  var byType = { principle: [], case: [] };
  var bySession = {};

  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    var id = node.id;

    // By domain — use existing or auto-classify from content
    var d = node.domain || autoClassify(getSearchableText(node)) || 'build-quality';
    if (!byDomain[d]) byDomain[d] = [];
    byDomain[d].push(id);

    // By tag
    var tags = node.tags || (node.problem && node.problem.tags) || [];
    for (var ti = 0; ti < tags.length; ti++) {
      var t = tags[ti].toLowerCase();
      if (!byTag[t]) byTag[t] = [];
      byTag[t].push(id);
    }

    // By ID (with line number for direct lookup)
    byId[id] = {
      line: i,
      type: node.type,
      domain: d,
      integrity_score: node.integrity_score || 0.5,
      has_question: !!node.question_template,
      joel_graded: !!node.joel_graded,
    };

    // By type
    if (byType[node.type]) byType[node.type].push(id);
    else byType[node.type] = [id];

    // By session (for both source.session and evidence references)
    var session = null;
    if (node.source && node.source.session) {
      session = node.source.session;
    } else if (node.outcome && node.outcome.evidence && typeof node.outcome.evidence === 'string') {
      var match = node.outcome.evidence.match(/Session (\d+)/);
      if (match) session = match[1];
    }
    if (session) {
      var s = String(session);
      if (!bySession[s]) bySession[s] = [];
      bySession[s].push(id);
    }
  }

  // Compute stats
  var graded = 0, ungradedPrinciples = 0, casesWithSolutions = 0;
  var totalIntegrity = 0, withQuestions = 0;
  for (var ni = 0; ni < nodes.length; ni++) {
    var n = nodes[ni];
    totalIntegrity += (n.integrity_score || 0);
    if (n.joel_graded) graded++;
    if (!n.joel_graded && n.type === 'principle') ungradedPrinciples++;
    if (n.question_template) withQuestions++;
    if (n.type === 'case' && n.solution && (n.solution.what_worked || n.solution.what_failed)) {
      casesWithSolutions++;
    }
  }

  return {
    by_domain: byDomain,
    by_tag: byTag,
    by_id: byId,
    by_type: byType,
    by_session: bySession,
    stats: {
      total: nodes.length,
      principles: (byType.principle || []).length,
      cases: (byType.case || []).length,
      cases_with_solutions: casesWithSolutions,
      domains: Object.keys(byDomain).length,
      tags: Object.keys(byTag).length,
      sessions_referenced: Object.keys(bySession).length,
      with_questions: withQuestions,
      joel_graded: graded,
      ungraded_principles: ungradedPrinciples,
      avg_integrity: nodes.length > 0
        ? Number((totalIntegrity / nodes.length).toFixed(3))
        : 0,
    },
    rebuilt_at: new Date().toISOString(),
  };
}

/**
 * Rebuild the knowledge index. Returns stats object.
 *
 * @param {Object} opts
 * @param {boolean} opts.full - Also rebuild reef/index.json (TF-IDF + edges)
 * @param {boolean} opts.quiet - Suppress console output
 * @returns {Object} index.stats
 */
function rebuildIndex(opts) {
  opts = opts || {};
  var full = opts.full || false;
  var quiet = opts.quiet || false;
  var log = quiet ? function(){} : console.log.bind(console);

  log('Rebuilding knowledge index...');

  // Load current KB
  var entries = loadKB();
  log('  Loaded: ' + entries.length + ' entries from knowledge-base.jsonl');

  // Build index
  var index = buildIndex(entries);

  log('  Indexed: ' + index.stats.total + ' nodes (' +
    index.stats.principles + ' principles, ' +
    index.stats.cases + ' cases)');
  log('  Cases with solutions: ' + index.stats.cases_with_solutions);
  log('  Domains: ' + index.stats.domains +
    ', Tags: ' + index.stats.tags +
    ', Sessions: ' + index.stats.sessions_referenced);
  log('  Graded: ' + index.stats.joel_graded +
    ', Ungraded principles: ' + index.stats.ungraded_principles);
  log('  Avg integrity: ' + index.stats.avg_integrity);

  // Domain distribution
  log('\n  Domain distribution:');
  var domainEntries = [];
  for (var dk in index.by_domain) domainEntries.push([dk, index.by_domain[dk]]);
  domainEntries.sort(function(a, b) { return b[1].length - a[1].length; });
  for (var di = 0; di < domainEntries.length; di++) {
    log('    ' + domainEntries[di][0] + ': ' + domainEntries[di][1].length);
  }

  // Write index
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
  log('\n  Written: ' + INDEX_FILE);

  // Optionally rebuild the full reef index (TF-IDF + edges)
  if (full && fs.existsSync(REEF_INDEX_SCRIPT)) {
    log('\nRebuilding full reef index (TF-IDF + edges)...');
    try {
      execSync('node "' + REEF_INDEX_SCRIPT + '"', {
        cwd: ROOT,
        stdio: quiet ? 'ignore' : 'inherit',
      });
    } catch (e) {
      log('  Warning: reef/build-index.js failed: ' + e.message);
    }
  }

  return index.stats;
}

// CLI mode
if (require.main === module) {
  var full = process.argv.includes('--full');
  var stats = rebuildIndex({ full: full });
  console.log('\nDone. ' + stats.total + ' entries indexed.');
}

// Export for programmatic use
module.exports = { rebuildIndex: rebuildIndex, loadKB: loadKB, buildIndex: buildIndex };
