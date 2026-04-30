#!/usr/bin/env node
/**
 * auto-capture.js — PostToolUse hook: Knowledge-Bearing Content Capture
 *
 * REBUILT (anvil-vii, 2026-03-08) — Previous version disabled because 100% of
 * output was noise (tool-output logs like "Writing foo.js (45 lines) -> success").
 *
 * New approach: Only capture when agents write to KNOWLEDGE-BEARING files —
 * files where the content itself IS the knowledge:
 *   - MISSION.md successor notes (agent insights about what works/fails)
 *   - Debrief JSONL files (structured session learnings)
 *   - legacy.md (agent reflections)
 *   - HANDOFF.md (session handoff knowledge)
 *
 * What changed:
 *   OLD: Captured tool mechanics ("Modifying gate.js: replacing 3 lines")
 *   NEW: Captures the actual content written to knowledge-bearing files
 *
 * DeepSeek R1 challenge (2026-03-08): "Code edits with docblocks contain
 * knowledge too." True, but the old auto-capture proved that capturing ALL
 * edits produces 100% noise. This filter is conservative — easy to expand
 * the allow-list if shadow testing shows missed knowledge in other files.
 *
 * Zero agent effort. Silent (no stdout). Under 200ms.
 */

const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', '..');
const KB_PATH = path.join(BASE, '.fastops', 'knowledge-base.jsonl');
const RATE_FILE = path.join(BASE, '.fastops', '.auto-capture-rate');
const LOG_FILE = path.join(BASE, '.fastops', '.auto-capture-log.jsonl');

// Rate limit: 1 capture per 30 seconds (knowledge writes are infrequent)
const RATE_LIMIT_MS = 30000;

// Minimum content length to be worth capturing (skip trivial edits)
const MIN_CONTENT_LENGTH = 100;

// Knowledge-bearing file patterns — the content in these files IS knowledge
const KNOWLEDGE_PATTERNS = [
  { pattern: /MISSION\.md$/i, section: 'successor-notes', domain: 'succession-handoff' },
  { pattern: /subagent-debriefs\/.*\.jsonl$/i, section: 'debrief', domain: 'agent-behavior' },
  { pattern: /legacy\.md$/i, section: 'legacy', domain: 'succession-handoff' },
  { pattern: /HANDOFF\.md$/i, section: 'handoff', domain: 'succession-handoff' },
  { pattern: /\.agent-outputs\/.*\.md$/i, section: 'agent-output', domain: 'build-quality' },
];

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(inputData);
    const toolName = data.tool_name || '';

    // Only capture Edit and Write
    if (toolName !== 'Edit' && toolName !== 'Write') {
      process.exit(0);
      return;
    }

    const toolInput = data.tool_input || {};
    const filePath = (toolInput.file_path || '').replace(/\\/g, '/');

    if (!filePath) { process.exit(0); return; }

    // Check if this is a knowledge-bearing file
    const match = KNOWLEDGE_PATTERNS.find(p => p.pattern.test(filePath));
    if (!match) { process.exit(0); return; }

    // Extract the content that was written
    let content = '';
    if (toolName === 'Edit') {
      content = toolInput.new_string || '';
    } else if (toolName === 'Write') {
      content = toolInput.content || '';
    }

    // Skip trivial content
    if (content.length < MIN_CONTENT_LENGTH) { process.exit(0); return; }

    // For debrief JSONLs, extract the structured knowledge
    if (match.section === 'debrief') {
      try {
        const parsed = JSON.parse(content);
        // Build content from debrief fields that carry knowledge
        const parts = [];
        if (parsed.what_i_built) parts.push(parsed.what_i_built);
        if (parsed.why_i_chose_this) parts.push(parsed.why_i_chose_this);
        if (parsed.whats_unanswered) parts.push('Unanswered: ' + parsed.whats_unanswered);
        content = parts.join(' | ');
        if (content.length < MIN_CONTENT_LENGTH) { process.exit(0); return; }
      } catch {
        // Not valid JSON — use raw content
      }
    }

    // For MISSION.md edits, only capture successor note sections
    if (match.section === 'successor-notes' && toolName === 'Edit') {
      // Skip edits that don't look like successor notes (e.g., status changes)
      const hasInsight = /what.*(learn|found|built|fixed|broke|fail|work|know)/i.test(content) ||
                         /root.cause|unanswer|successor|open.work/i.test(content) ||
                         content.length > 300; // Long edits to MISSION.md are usually substantive
      if (!hasInsight) { process.exit(0); return; }
    }

    // Rate limit
    try {
      if (fs.existsSync(RATE_FILE)) {
        const last = parseInt(fs.readFileSync(RATE_FILE, 'utf-8').trim(), 10);
        if (Date.now() - last < RATE_LIMIT_MS) { process.exit(0); return; }
      }
    } catch {}
    try { fs.writeFileSync(RATE_FILE, String(Date.now())); } catch {}

    // Dedup: check if this content already exists in KB
    try {
      const existingKB = fs.readFileSync(KB_PATH, 'utf-8');
      const contentFingerprint = content.replace(/\s+/g, ' ').trim().substring(0, 150).toLowerCase();
      if (existingKB.toLowerCase().includes(contentFingerprint)) {
        process.exit(0);
        return;
      }
    } catch {}

    // Build KB entry — the content IS the knowledge, not a description of a tool call
    const now = new Date().toISOString();
    const fileName = path.basename(filePath);
    const title = extractTitle(content, fileName);

    const entry = {
      id: `AC-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: 'auto-captured-insight',
      domain: match.domain,
      title: title.substring(0, 200),
      content: content.substring(0, 2000), // Cap at 2000 chars
      trigger: `Written to ${fileName} (${match.section})`,
      source: {
        method: 'auto_capture_v2',
        file: filePath,
        section: match.section,
        tool: toolName
      },
      integrity_score: 0.2, // Higher than old triples (0.1) — content is actual insight, not tool log
      joel_graded: false,
      tags: ['auto-captured-v2', match.section],
      usage_count: 0,
      positive_outcomes: 0,
      negative_outcomes: 0,
      version: 1,
      created_at: now,
      updated_at: now
    };

    // Append to KB
    fs.appendFileSync(KB_PATH, JSON.stringify(entry) + '\n');

    // Log for shadow testing (DeepSeek R1 recommended auditing what gets captured)
    const logEntry = {
      ts: now,
      file: filePath,
      section: match.section,
      content_length: content.length,
      title: title.substring(0, 100),
      captured: true
    };
    fs.appendFileSync(LOG_FILE, JSON.stringify(logEntry) + '\n');

  } catch (err) {
    process.stderr.write(`auto-capture error: ${err.message}\n`);
  }
  process.exit(0);
});

/**
 * Extract a meaningful title from knowledge content.
 * Looks for markdown headers, bold text, or first sentence.
 */
function extractTitle(content, fileName) {
  // Try markdown header
  const headerMatch = content.match(/^#+\s+(.+)$/m);
  if (headerMatch) return headerMatch[1].trim();

  // Try bold text (often used for key findings)
  const boldMatch = content.match(/\*\*(.{10,100}?)\*\*/);
  if (boldMatch) return boldMatch[1].trim();

  // Try JSON field (for debrief content)
  const jsonMatch = content.match(/"what_i_built"\s*:\s*"(.{10,150})"/);
  if (jsonMatch) return jsonMatch[1].trim();

  // First meaningful sentence
  const firstSentence = content.replace(/\s+/g, ' ').trim().split(/[.!?]\s/)[0];
  if (firstSentence.length > 10) return firstSentence.substring(0, 150);

  return `Auto-captured from ${fileName}`;
}
