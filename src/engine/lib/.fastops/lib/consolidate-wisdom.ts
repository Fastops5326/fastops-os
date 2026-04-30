/**
 * Swarm Wisdom Consolidation Script
 *
 * Reads all learning entries and generates SWARM-WISDOM.md
 *
 * Usage:
 *   npx tsx .fastops/lib/consolidate-wisdom.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Configuration
// ============================================================================

const FASTOPS_ROOT = process.env.FASTOPS_ROOT || '.fastops';
const ENTRIES_DIR = path.join(FASTOPS_ROOT, 'learnings', 'entries');
const WISDOM_PATH = path.join(FASTOPS_ROOT, 'learnings', 'SWARM-WISDOM.md');
const INDEX_PATH = path.join(FASTOPS_ROOT, 'learnings', 'index.json');
const STATE_PATH = path.join(FASTOPS_ROOT, 'state.json');

// ============================================================================
// Types
// ============================================================================

interface LearningEntry {
  id: string;
  agentId: string;
  timestamp: string;
  projectId: string;
  wave: number;
  domain: string;
  type: 'failure' | 'success' | 'pivot' | 'insight' | 'warning' | 'pattern';
  title: string;
  context: {
    what_was_attempted: string;
    file_path?: string;
    code_snippet?: string;
  };
  outcome?: {
    result: string;
    error_message?: string;
    time_lost_minutes?: number;
  };
  learning: {
    root_cause: string;
    correct_approach: string;
    applies_to: string[];
    severity: 'critical' | 'high' | 'medium' | 'low';
  };
  tags?: string[];
}

// ============================================================================
// Main
// ============================================================================

async function consolidate(): Promise<void> {
  console.log('Consolidating swarm wisdom...');

  // Read all entries
  const entries: LearningEntry[] = [];
  try {
    const files = fs.readdirSync(ENTRIES_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(ENTRIES_DIR, file), 'utf-8');
      entries.push(JSON.parse(content));
    }
  } catch (err) {
    console.log('No entries found or error reading entries.');
    return;
  }

  if (entries.length === 0) {
    console.log('No entries to consolidate.');
    return;
  }

  // Sort by timestamp
  entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  // Group by type and severity
  const critical = entries.filter(e => e.learning.severity === 'critical' || e.learning.severity === 'high');
  const failures = entries.filter(e => e.type === 'failure');
  const pivots = entries.filter(e => e.type === 'pivot');
  const insights = entries.filter(e => e.type === 'insight');
  const successes = entries.filter(e => e.type === 'success');
  const patterns = entries.filter(e => e.type === 'pattern');

  // Get project info
  let projectName = 'FastOps Project';
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
    projectName = state.projectName || projectName;
  } catch {
    // Use default
  }

  // Generate markdown
  const now = new Date().toISOString();
  let md = `# Swarm Wisdom - ${projectName}

**Last Updated:** ${now}
**Total Learnings:** ${entries.length}
**By Type:** ${failures.length} failures, ${pivots.length} pivots, ${insights.length} insights, ${patterns.length} patterns

---

## CRITICAL - Read First

> These learnings are HIGH SEVERITY. Ignoring them WILL cause failures.

`;

  // Critical section
  if (critical.length > 0) {
    for (const entry of critical) {
      md += formatLearningFull(entry);
    }
  } else {
    md += '*No critical learnings yet.*\n\n';
  }

  // Failures table
  md += `---

## Failures (Don't Repeat These)

`;
  if (failures.length > 0) {
    md += `| ID | Title | Domain | Severity | Tags |
|-----|-------|--------|----------|------|
`;
    for (const f of failures) {
      md += `| ${f.id.slice(-8)} | ${f.title.slice(0, 40)} | ${f.domain} | ${f.learning.severity} | ${(f.tags || []).slice(0, 3).join(', ')} |\n`;
    }
    md += '\n### Failure Details\n\n';
    for (const f of failures.filter(x => !critical.includes(x))) {
      md += formatLearningFull(f);
    }
  } else {
    md += '*No failures recorded yet.*\n\n';
  }

  // Pivots
  md += `---

## Pivots (Direction Changes)

`;
  if (pivots.length > 0) {
    for (const p of pivots) {
      md += formatLearningFull(p);
    }
  } else {
    md += '*No pivots recorded yet.*\n\n';
  }

  // Insights
  md += `---

## Insights (Non-Obvious Knowledge)

`;
  if (insights.length > 0) {
    for (const i of insights) {
      md += formatLearningFull(i);
    }
  } else {
    md += '*No insights recorded yet.*\n\n';
  }

  // Patterns
  md += `---

## Success Patterns (Use These)

`;
  if (patterns.length > 0 || successes.length > 0) {
    for (const p of [...patterns, ...successes]) {
      md += formatLearningFull(p);
    }
  } else {
    md += '*No patterns recorded yet.*\n\n';
  }

  // Quick reference
  md += `---

## Quick Reference

### All Tags
${[...new Set(entries.flatMap(e => e.tags || []))].sort().map(t => `\`${t}\``).join(' ')}

### Entry Timeline
| Time | Type | Title |
|------|------|-------|
`;
  for (const e of entries.slice(-10)) {
    const time = e.timestamp.slice(11, 19);
    md += `| ${time} | ${e.type} | ${e.title.slice(0, 50)} |\n`;
  }

  md += `

---

*Auto-generated from ${entries.length} learning entries. Last consolidation: ${now}*
`;

  // Write wisdom file
  fs.writeFileSync(WISDOM_PATH, md);
  console.log(`Wrote ${WISDOM_PATH} with ${entries.length} entries.`);

  // Update index with consolidation timestamp
  try {
    const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
    index.lastConsolidated = now;
    fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
  } catch {
    // Ignore
  }
}

function formatLearningFull(entry: LearningEntry): string {
  let md = `### [${entry.id.slice(-8)}] ${entry.title}
**Type:** ${entry.type} | **Severity:** ${entry.learning.severity} | **Domain:** ${entry.domain}
`;

  if (entry.outcome?.time_lost_minutes) {
    md += `**Time Lost:** ${entry.outcome.time_lost_minutes} min\n`;
  }

  md += `
**Context:** ${entry.context.what_was_attempted}
`;

  if (entry.context.code_snippet) {
    md += `
\`\`\`
${entry.context.code_snippet}
\`\`\`
`;
  }

  if (entry.type === 'failure') {
    md += `
**Root Cause:** ${entry.learning.root_cause}

**Correct Approach:** ${entry.learning.correct_approach}
`;
  } else {
    md += `
**Insight:** ${entry.learning.root_cause}
`;
  }

  if (entry.tags && entry.tags.length > 0) {
    md += `
**Tags:** ${entry.tags.map(t => `\`${t}\``).join(' ')}
`;
  }

  md += '\n---\n\n';
  return md;
}

// Run
consolidate().catch(console.error);
