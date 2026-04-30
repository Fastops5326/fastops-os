#!/usr/bin/env node
/**
 * KB Enrichment: Mine 3 data sources to add real problem/solution/evidence to KB entries
 *
 * For each principle in knowledge-base.jsonl:
 *   1. Search outcome-log.jsonl by W-ID and trigger keywords → execution data
 *   2. Search environment/cards/ by keywords → reasoning traces (why it worked/failed)
 *   3. Search HANDOFF.md by keywords → session context (what was being built)
 *
 * Output: Enriched entries with populated source.session, and companion CASE entries
 * with problem.symptom, solution.what_worked, solution.what_failed, outcome.evidence
 *
 * Usage:
 *   node reef/enrich-kb.js --preview        # Show what enrichment would add
 *   node reef/enrich-kb.js --execute        # Write enriched data to knowledge-base.jsonl
 *   node reef/enrich-kb.js --stats          # Show enrichment coverage stats
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const KB_FILE = path.join(ROOT, '.fastops', 'knowledge-base.jsonl');
const OUTCOME_LOG = path.join(ROOT, 'reef', 'outcome-log.jsonl');
const CARDS_DIR = path.join(ROOT, 'environment', 'cards');
const HANDOFF_FILE = path.join(ROOT, '.fastops', 'HANDOFF.md');

// --- Load data sources ---

function loadKB() {
  if (!fs.existsSync(KB_FILE)) return [];
  return fs.readFileSync(KB_FILE, 'utf8').trim().split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function loadOutcomeLog() {
  if (!fs.existsSync(OUTCOME_LOG)) return [];
  return fs.readFileSync(OUTCOME_LOG, 'utf8').trim().split('\n')
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function loadCards() {
  if (!fs.existsSync(CARDS_DIR)) return [];
  const cards = [];
  try {
    const files = fs.readdirSync(CARDS_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const card = JSON.parse(fs.readFileSync(path.join(CARDS_DIR, file), 'utf8'));
        card._filename = file;
        cards.push(card);
      } catch {}
    }
  } catch {}
  return cards;
}

function loadHandoff() {
  if (!fs.existsSync(HANDOFF_FILE)) return '';
  return fs.readFileSync(HANDOFF_FILE, 'utf8');
}

// --- Keyword extraction ---

function extractKeywords(text) {
  if (!text) return [];
  const stopwords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between',
    'through', 'during', 'before', 'after', 'above', 'below', 'up', 'down',
    'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
    'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
    'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than', 'too',
    'very', 'just', 'because', 'when', 'while', 'if', 'then', 'that',
    'this', 'these', 'those', 'what', 'which', 'who', 'whom', 'how',
    'where', 'why', 'it', 'its', 'you', 'your', 'they', 'them', 'their',
    'we', 'our', 'he', 'she', 'his', 'her', 'my', 'me', 'us'
  ]);
  return text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopwords.has(w));
}

// --- Search functions ---

function searchOutcomeLogByWisdomId(outcomes, wId) {
  return outcomes.filter(o =>
    o.reef_entry_id === wId ||
    (o.entries_used && o.entries_used.includes(wId))
  );
}

function searchOutcomeLogByKeywords(outcomes, keywords, minMatches = 3) {
  if (keywords.length === 0) return [];
  return outcomes.filter(o => {
    const text = `${o.task_text || ''} ${o.description || ''} ${o.next_task_text || ''}`.toLowerCase();
    const matches = keywords.filter(kw => text.includes(kw));
    return matches.length >= minMatches;
  }).slice(0, 5);
}

function searchCardsByKeywords(cards, keywords, minMatches = 2) {
  if (keywords.length === 0) return [];
  return cards.filter(card => {
    const text = JSON.stringify(card).toLowerCase();
    const matches = keywords.filter(kw => text.includes(kw));
    return matches.length >= minMatches;
  }).slice(0, 3);
}

function searchHandoffByKeywords(handoffText, keywords, minMatches = 3) {
  if (keywords.length === 0) return [];
  // Split handoff into session blocks (separated by ### Session headers)
  const blocks = handoffText.split(/(?=###?\s+(?:Session|Handoff)\s*#?\d)/i);
  const matches = [];

  for (const block of blocks) {
    const blockLower = block.toLowerCase();
    const matched = keywords.filter(kw => blockLower.includes(kw));
    if (matched.length >= minMatches) {
      // Extract session number
      const sessionMatch = block.match(/(?:Session|Handoff)\s*#?(\d+)/i);
      const sessionNum = sessionMatch ? parseInt(sessionMatch[1]) : null;
      matches.push({
        session: sessionNum,
        excerpt: block.slice(0, 500).trim(),
        matchedKeywords: matched,
        matchCount: matched.length
      });
    }
  }

  return matches.sort((a, b) => b.matchCount - a.matchCount).slice(0, 3);
}

// --- Build enrichment for a single principle ---

function enrichPrinciple(principle, outcomes, cards, handoffText) {
  const wId = principle.id;
  const triggerKw = extractKeywords(principle.trigger || '');
  const contentKw = extractKeywords(principle.content || '');
  const titleKw = extractKeywords(principle.title || '');
  const allKw = [...new Set([...triggerKw, ...contentKw.slice(0, 10), ...titleKw.slice(0, 5)])];

  const enrichment = {
    id: wId,
    trigger: principle.trigger,
    outcomeMatches: [],
    cardMatches: [],
    handoffMatches: [],
    sessions: new Set(),
    approaches: [],
    outcomes_found: [],
    evidence: []
  };

  // 1. Search outcome log by W-ID (direct reference)
  const directMatches = searchOutcomeLogByWisdomId(outcomes, wId);
  for (const m of directMatches) {
    enrichment.outcomeMatches.push(m);
    if (m.session) enrichment.sessions.add(m.session);
    if (m.task_text) enrichment.approaches.push(m.task_text);
    if (m.outcome) enrichment.outcomes_found.push({ result: m.outcome, session: m.session, task: m.task_text });
  }

  // 2. Search outcome log by keywords (fuzzy)
  if (directMatches.length === 0) {
    const fuzzyMatches = searchOutcomeLogByKeywords(outcomes, allKw);
    for (const m of fuzzyMatches) {
      enrichment.outcomeMatches.push(m);
      if (m.session) enrichment.sessions.add(m.session);
      if (m.task_text) enrichment.approaches.push(m.task_text);
      if (m.outcome) enrichment.outcomes_found.push({ result: m.outcome, session: m.session, task: m.task_text });
    }
  }

  // 3. Search environment cards
  const cardMatches = searchCardsByKeywords(cards, allKw);
  for (const card of cardMatches) {
    enrichment.cardMatches.push(card);
    if (card.session) enrichment.sessions.add(card.session);
    // Extract state transitions as evidence
    if (card.state_transitions) {
      for (const st of card.state_transitions) {
        enrichment.evidence.push({
          type: 'state_transition',
          before: st.posture_before || st.before,
          after: st.posture_after || st.after,
          what_broke: st.what_broke_it || st.broke,
          session: card.session
        });
      }
    }
    if (card.if_repeated) {
      enrichment.evidence.push({
        type: 'if_repeated',
        advice: card.if_repeated,
        session: card.session
      });
    }
  }

  // 4. Search handoff
  const handoffMatches = searchHandoffByKeywords(handoffText, allKw);
  for (const m of handoffMatches) {
    enrichment.handoffMatches.push(m);
    if (m.session) enrichment.sessions.add(m.session);
  }

  enrichment.sessions = [...enrichment.sessions].sort((a, b) => a - b);
  enrichment.totalMatches = enrichment.outcomeMatches.length + enrichment.cardMatches.length + enrichment.handoffMatches.length;

  return enrichment;
}

// --- Build a case entry from enrichment data ---

function buildCaseFromEnrichment(principle, enrichment) {
  if (enrichment.totalMatches === 0) return null;

  // Build problem description from trigger
  const problem = {
    symptom: principle.trigger || principle.title.slice(0, 200),
    root_cause: null,
    tags: extractKeywords(principle.trigger || '').slice(0, 5)
  };

  // Build solution from approaches tried
  const whatWorked = [];
  const whatFailed = [];

  for (const o of enrichment.outcomes_found) {
    if (o.result === 'completed' || o.result === 'success') {
      whatWorked.push(o.task + (o.session ? ` (S${o.session})` : ''));
    } else if (o.result === 'failed' || o.result === 'failure') {
      whatFailed.push(o.task + (o.session ? ` (S${o.session})` : ''));
    }
  }

  // Add state transition evidence
  for (const ev of enrichment.evidence) {
    if (ev.type === 'state_transition' && ev.what_broke) {
      whatFailed.push(`Approach: "${ev.before}" — broke because: ${ev.what_broke} (S${ev.session || '?'})`);
      whatWorked.push(`Shifted to: "${ev.after}" (S${ev.session || '?'})`);
    }
    if (ev.type === 'if_repeated') {
      whatWorked.push(`Next time: ${ev.advice}`);
    }
  }

  // Add handoff context
  const handoffExcerpts = enrichment.handoffMatches
    .map(h => h.excerpt.slice(0, 200))
    .join(' | ');

  const solution = {
    what_worked: whatWorked.length > 0 ? whatWorked.join('; ') : principle.content.slice(0, 300),
    what_failed: whatFailed.length > 0 ? whatFailed.join('; ') : null,
    files_changed: []
  };

  // Build outcome
  const hasSuccess = enrichment.outcomes_found.some(o => o.result === 'completed' || o.result === 'success');
  const hasFailed = enrichment.outcomes_found.some(o => o.result === 'failed' || o.result === 'failure');

  const outcome = {
    result: hasSuccess ? 'success' : hasFailed ? 'failure' : 'partial',
    evidence: `Mined from ${enrichment.outcomeMatches.length} outcome entries, ${enrichment.cardMatches.length} environment cards, ${enrichment.handoffMatches.length} handoff blocks. Sessions: ${enrichment.sessions.join(', ') || 'unknown'}`,
    session: enrichment.sessions[0] || null,
    joel_score: null,
    learned: principle.anti_pattern || null
  };

  return {
    id: `case-${principle.id}`,
    type: 'case',
    domain: principle.domain,
    problem,
    solution,
    outcome,
    source: {
      session: enrichment.sessions[0] || null,
      agent: null,
      wisdom_id: principle.id
    },
    integrity_score: principle.integrity_score,
    joel_graded: false,
    monday_item_id: null,
    edges: [{ target: principle.id, type: 'derived_from' }],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}

// --- Update principle source fields ---

function updatePrincipleSource(principle, enrichment) {
  if (enrichment.sessions.length > 0 && !principle.source.session) {
    principle.source.session = enrichment.sessions[0];
  }
  principle.updated_at = new Date().toISOString();
  return principle;
}

// --- Main ---

async function main() {
  const mode = process.argv[2] || '--stats';

  console.log('=== KB Enrichment: Mining 3 data sources ===\n');

  // Load all data
  console.log('Loading data sources...');
  const kb = loadKB();
  const outcomes = loadOutcomeLog();
  const cards = loadCards();
  const handoffText = loadHandoff();

  const principles = kb.filter(e => e.type === 'principle');
  const existingCases = kb.filter(e => e.type === 'case');

  console.log(`  knowledge-base.jsonl: ${kb.length} entries (${principles.length} principles, ${existingCases.length} cases)`);
  console.log(`  outcome-log.jsonl: ${outcomes.length} entries`);
  console.log(`  environment/cards: ${cards.length} cards`);
  console.log(`  HANDOFF.md: ${Math.round(handoffText.length / 1024)}KB\n`);

  // Enrich each principle
  console.log('Mining data sources for each principle...');
  const enrichments = [];
  for (const p of principles) {
    const e = enrichPrinciple(p, outcomes, cards, handoffText);
    enrichments.push(e);
  }

  // Stats
  const withOutcomes = enrichments.filter(e => e.outcomeMatches.length > 0);
  const withCards = enrichments.filter(e => e.cardMatches.length > 0);
  const withHandoff = enrichments.filter(e => e.handoffMatches.length > 0);
  const withAny = enrichments.filter(e => e.totalMatches > 0);
  const withNone = enrichments.filter(e => e.totalMatches === 0);

  console.log(`\n=== ENRICHMENT COVERAGE ===`);
  console.log(`  Principles with outcome-log matches: ${withOutcomes.length}/${principles.length} (${Math.round(withOutcomes.length/principles.length*100)}%)`);
  console.log(`  Principles with env card matches: ${withCards.length}/${principles.length} (${Math.round(withCards.length/principles.length*100)}%)`);
  console.log(`  Principles with handoff matches: ${withHandoff.length}/${principles.length} (${Math.round(withHandoff.length/principles.length*100)}%)`);
  console.log(`  Principles with ANY match: ${withAny.length}/${principles.length} (${Math.round(withAny.length/principles.length*100)}%)`);
  console.log(`  Principles with NO matches: ${withNone.length}/${principles.length}`);

  // Domain breakdown
  const byDomain = {};
  for (const e of enrichments) {
    const p = principles.find(p => p.id === e.id);
    const d = p.domain || 'unknown';
    if (!byDomain[d]) byDomain[d] = { total: 0, enriched: 0 };
    byDomain[d].total++;
    if (e.totalMatches > 0) byDomain[d].enriched++;
  }
  console.log(`\n  Coverage by domain:`);
  for (const [domain, counts] of Object.entries(byDomain).sort((a, b) => b[1].enriched - a[1].enriched)) {
    console.log(`    ${domain}: ${counts.enriched}/${counts.total} (${Math.round(counts.enriched/counts.total*100)}%)`);
  }

  if (mode === '--stats') {
    console.log('\nUse --preview to see enrichment details, or --execute to write.');
    return;
  }

  if (mode === '--preview') {
    // Show top 10 most-enriched principles
    const sorted = enrichments.sort((a, b) => b.totalMatches - a.totalMatches);
    console.log(`\n=== TOP 10 MOST-ENRICHED PRINCIPLES ===\n`);

    for (const e of sorted.slice(0, 10)) {
      const p = principles.find(p => p.id === e.id);
      console.log(`[${e.id}] ${(p.trigger || p.title).slice(0, 80)}`);
      console.log(`  Matches: ${e.outcomeMatches.length} outcomes, ${e.cardMatches.length} cards, ${e.handoffMatches.length} handoff blocks`);
      console.log(`  Sessions: ${e.sessions.join(', ') || 'none'}`);
      if (e.approaches.length > 0) {
        console.log(`  Approaches tried: ${e.approaches.slice(0, 3).map(a => a.slice(0, 80)).join('; ')}`);
      }
      if (e.evidence.length > 0) {
        const ev = e.evidence[0];
        if (ev.type === 'state_transition') {
          console.log(`  Before: "${(ev.before || '').slice(0, 60)}" → After: "${(ev.after || '').slice(0, 60)}"`);
        }
        if (ev.type === 'if_repeated') {
          console.log(`  Next time: ${(ev.advice || '').slice(0, 100)}`);
        }
      }

      // Show what the case entry would look like
      const caseEntry = buildCaseFromEnrichment(p, e);
      if (caseEntry) {
        console.log(`  → CASE: problem="${caseEntry.problem.symptom.slice(0, 60)}" | result=${caseEntry.outcome.result}`);
        console.log(`  → what_worked: ${(caseEntry.solution.what_worked || '').slice(0, 120)}`);
      }
      console.log();
    }

    // Show 3 with no matches
    console.log('=== 3 PRINCIPLES WITH NO MATCHES (gaps) ===\n');
    for (const e of withNone.slice(0, 3)) {
      const p = principles.find(p => p.id === e.id);
      console.log(`[${e.id}] ${(p.trigger || p.title).slice(0, 80)}`);
      console.log(`  Domain: ${p.domain} | Keywords: ${extractKeywords(p.trigger || '').slice(0, 5).join(', ')}`);
      console.log();
    }

    console.log('Use --execute to write enriched data.');
    return;
  }

  if (mode === '--execute') {
    console.log(`\nWriting enrichments...\n`);

    // 1. Update principle source fields
    let principlesUpdated = 0;
    for (const e of enrichments) {
      if (e.sessions.length > 0) {
        const p = kb.find(entry => entry.id === e.id);
        if (p && (!p.source || !p.source.session)) {
          updatePrincipleSource(p, e);
          principlesUpdated++;
        }
      }
    }

    // 2. Build new case entries
    const existingCaseIds = new Set(existingCases.map(c => c.id));
    const newCases = [];
    for (const e of enrichments) {
      if (e.totalMatches === 0) continue;
      const caseId = `case-${e.id}`;
      if (existingCaseIds.has(caseId)) continue;

      const p = principles.find(p => p.id === e.id);
      const caseEntry = buildCaseFromEnrichment(p, e);
      if (caseEntry) newCases.push(caseEntry);
    }

    // 3. Write back — safety gate prevents accidental KB wipe (anvil-viii, 2026-03-08)
    const allEntries = [...kb, ...newCases];
    const enrichContent = allEntries.map(e => JSON.stringify(e)).join('\n') + '\n';
    try {
      const { safeWriteKB } = require(path.resolve(__dirname, '..', '.fastops', 'kb-safety'));
      safeWriteKB(enrichContent, { reason: 'enrich-kb principle update + new cases' });
    } catch {
      if (allEntries.length >= 100) fs.writeFileSync(KB_FILE, enrichContent);
    }

    console.log(`Principles updated (source.session added): ${principlesUpdated}`);
    console.log(`New case entries created: ${newCases.length}`);
    console.log(`Total KB entries: ${allEntries.length} (was ${kb.length})`);

    // Rebuild knowledge index after modifying KB
    const { rebuildIndex } = require('./rebuild-index.js');
    console.log('\nRebuilding knowledge index...');
    rebuildIndex({ quiet: true });
    console.log('Knowledge index rebuilt.');

    // Save enrichment report
    const reportFile = path.join(ROOT, '.agent-outputs', 'kb-enrichment-report.json');
    const report = {
      timestamp: new Date().toISOString(),
      principles_total: principles.length,
      principles_with_matches: withAny.length,
      principles_updated: principlesUpdated,
      cases_created: newCases.length,
      coverage_pct: Math.round(withAny.length / principles.length * 100),
      by_domain: byDomain,
      gaps: withNone.map(e => ({ id: e.id, trigger: principles.find(p => p.id === e.id)?.trigger }))
    };
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    console.log(`Report saved to ${reportFile}`);
  }
}

main().catch(e => {
  console.error('Failed:', e.message);
  process.exit(1);
});
