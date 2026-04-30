/**
 * Learning Writer Utility for FastOps Agents
 *
 * Usage:
 *   import { writeLearning, LearningType } from '.fastops/lib/learning-writer';
 *
 *   writeLearning({
 *     type: 'failure',
 *     title: 'Prisma SQLite does not support @db.Text',
 *     context: { ... },
 *     learning: { ... }
 *   });
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// ============================================================================
// Types
// ============================================================================

export type LearningType = 'failure' | 'success' | 'pivot' | 'insight' | 'warning' | 'pattern';
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface LearningContext {
  what_was_attempted: string;
  file_path?: string;
  line_number?: number;
  code_snippet?: string;
}

export interface LearningOutcome {
  result: 'success' | 'failure' | 'partial';
  error_message?: string;
  time_lost_minutes?: number;
}

export interface LearningSummary {
  root_cause: string;
  correct_approach: string;
  applies_to: string[];
  severity: Severity;
}

export interface LearningVerification {
  confirmed_working: boolean;
  tested_in_context?: string;
}

export interface LearningPropagation {
  should_block: boolean;
  affects_waves: number[];
  affects_domains: string[];
}

export interface LearningInput {
  type: LearningType;
  title: string;
  wave?: number;
  domain?: string;
  context: LearningContext;
  outcome?: LearningOutcome;
  learning: LearningSummary;
  verification?: LearningVerification;
  tags?: string[];
  related_learnings?: string[];
  propagation?: LearningPropagation;
}

export interface LearningEntry extends LearningInput {
  $schema: string;
  id: string;
  agentId: string;
  timestamp: string;
  projectId: string;
}

// ============================================================================
// Configuration
// ============================================================================

const FASTOPS_ROOT = process.env.FASTOPS_ROOT || '.fastops';
const LEARNINGS_DIR = path.join(FASTOPS_ROOT, 'learnings', 'entries');
const INDEX_PATH = path.join(FASTOPS_ROOT, 'learnings', 'index.json');

// ============================================================================
// Utilities
// ============================================================================

function generateAgentId(): string {
  // Use process ID + random for uniqueness
  const pid = process.pid.toString(36);
  const rand = crypto.randomBytes(4).toString('hex');
  return `${pid}-${rand}`;
}

function getAgentId(): string {
  if (!process.env.FASTOPS_AGENT_ID) {
    process.env.FASTOPS_AGENT_ID = generateAgentId();
  }
  return process.env.FASTOPS_AGENT_ID;
}

function getNextSequence(agentId: string): number {
  const pattern = new RegExp(`^agent-${agentId}-(\\d+)\\.json$`);
  let maxSeq = 0;

  try {
    const files = fs.readdirSync(LEARNINGS_DIR);
    for (const file of files) {
      const match = file.match(pattern);
      if (match) {
        const seq = parseInt(match[1], 10);
        if (seq > maxSeq) maxSeq = seq;
      }
    }
  } catch {
    // Directory may not exist yet
  }

  return maxSeq + 1;
}

function getProjectId(): string {
  try {
    const statePath = path.join(FASTOPS_ROOT, 'state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    return state.projectId || 'unknown';
  } catch {
    return 'unknown';
  }
}

function getCurrentWave(): number {
  try {
    const statePath = path.join(FASTOPS_ROOT, 'state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    return state.currentWave || 0;
  } catch {
    return 0;
  }
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Write a learning entry to the learnings directory.
 * Each call creates a new, uniquely-named file.
 */
export function writeLearning(input: LearningInput): LearningEntry {
  const agentId = getAgentId();
  const seq = getNextSequence(agentId);
  const timestamp = new Date().toISOString();
  const dateStr = timestamp.replace(/[-:T]/g, '').slice(0, 14);

  const entry: LearningEntry = {
    $schema: 'https://fastops.ai/schemas/learning-v1.json',
    id: `L-${dateStr}-${agentId}`,
    agentId,
    timestamp,
    projectId: getProjectId(),
    wave: input.wave ?? getCurrentWave(),
    domain: input.domain ?? 'unknown',
    type: input.type,
    title: input.title,
    context: input.context,
    outcome: input.outcome ?? { result: 'success' },
    learning: input.learning,
    verification: input.verification ?? { confirmed_working: false },
    tags: input.tags ?? [],
    related_learnings: input.related_learnings ?? [],
    propagation: input.propagation ?? {
      should_block: false,
      affects_waves: [getCurrentWave()],
      affects_domains: [input.domain ?? '*']
    }
  };

  // Ensure directory exists
  fs.mkdirSync(LEARNINGS_DIR, { recursive: true });

  // Write learning file
  const filename = `agent-${agentId}-${seq.toString().padStart(3, '0')}.json`;
  const filepath = path.join(LEARNINGS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(entry, null, 2));

  // Update index
  updateIndex(entry, filename);

  return entry;
}

function updateIndex(entry: LearningEntry, filename: string): void {
  let index = { version: '1.0', created: new Date().toISOString(), lastConsolidated: null, totalEntries: 0, entries: [] as any[] };

  try {
    index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
  } catch {
    // Index doesn't exist, use default
  }

  index.entries.push({
    id: entry.id,
    file: filename,
    type: entry.type,
    title: entry.title,
    timestamp: entry.timestamp,
    severity: entry.learning.severity,
    tags: entry.tags
  });
  index.totalEntries = index.entries.length;

  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick helper to log a failure
 */
export function logFailure(
  title: string,
  whatWasAttempted: string,
  rootCause: string,
  correctApproach: string,
  options?: {
    errorMessage?: string;
    timeLostMinutes?: number;
    filePath?: string;
    codeSnippet?: string;
    tags?: string[];
    severity?: Severity;
  }
): LearningEntry {
  return writeLearning({
    type: 'failure',
    title,
    context: {
      what_was_attempted: whatWasAttempted,
      file_path: options?.filePath,
      code_snippet: options?.codeSnippet
    },
    outcome: {
      result: 'failure',
      error_message: options?.errorMessage,
      time_lost_minutes: options?.timeLostMinutes
    },
    learning: {
      root_cause: rootCause,
      correct_approach: correctApproach,
      applies_to: options?.tags ?? [],
      severity: options?.severity ?? 'medium'
    },
    tags: options?.tags
  });
}

/**
 * Quick helper to log an insight
 */
export function logInsight(
  title: string,
  insight: string,
  appliesTo: string[],
  options?: {
    filePath?: string;
    codeSnippet?: string;
    severity?: Severity;
  }
): LearningEntry {
  return writeLearning({
    type: 'insight',
    title,
    context: {
      what_was_attempted: 'Knowledge discovery',
      file_path: options?.filePath,
      code_snippet: options?.codeSnippet
    },
    learning: {
      root_cause: insight,
      correct_approach: insight,
      applies_to: appliesTo,
      severity: options?.severity ?? 'medium'
    },
    tags: appliesTo
  });
}

/**
 * Quick helper to log a success pattern
 */
export function logPattern(
  title: string,
  patternDescription: string,
  codeExample: string,
  appliesTo: string[]
): LearningEntry {
  return writeLearning({
    type: 'pattern',
    title,
    context: {
      what_was_attempted: 'Pattern discovery',
      code_snippet: codeExample
    },
    learning: {
      root_cause: patternDescription,
      correct_approach: codeExample,
      applies_to: appliesTo,
      severity: 'low'
    },
    tags: appliesTo,
    verification: { confirmed_working: true }
  });
}

// ============================================================================
// Domain Claiming
// ============================================================================

const CLAIMS_DIR = path.join(FASTOPS_ROOT, 'claims');

/**
 * Atomically claim a domain for this agent.
 * Returns true if claim succeeded, false if already claimed.
 */
export function claimDomain(domain: string): boolean {
  const agentId = getAgentId();
  const claimPath = path.join(CLAIMS_DIR, domain, agentId);

  try {
    // Check if any agent has claimed this domain
    const domainPath = path.join(CLAIMS_DIR, domain);
    if (fs.existsSync(domainPath)) {
      const claims = fs.readdirSync(domainPath);
      if (claims.length > 0) {
        return false; // Already claimed
      }
    }

    // Attempt atomic directory creation
    fs.mkdirSync(claimPath, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Release a domain claim
 */
export function releaseDomain(domain: string): void {
  const agentId = getAgentId();
  const claimPath = path.join(CLAIMS_DIR, domain, agentId);

  try {
    fs.rmdirSync(claimPath);
    // Also try to remove parent if empty
    const domainPath = path.join(CLAIMS_DIR, domain);
    const remaining = fs.readdirSync(domainPath);
    if (remaining.length === 0) {
      fs.rmdirSync(domainPath);
    }
  } catch {
    // Ignore errors
  }
}

/**
 * Check if a domain is claimed
 */
export function isDomainClaimed(domain: string): boolean {
  const domainPath = path.join(CLAIMS_DIR, domain);
  try {
    const claims = fs.readdirSync(domainPath);
    return claims.length > 0;
  } catch {
    return false;
  }
}

// ============================================================================
// Wisdom Reading
// ============================================================================

const WISDOM_PATH = path.join(FASTOPS_ROOT, 'learnings', 'SWARM-WISDOM.md');

/**
 * Read the consolidated swarm wisdom
 */
export function readSwarmWisdom(): string {
  try {
    return fs.readFileSync(WISDOM_PATH, 'utf-8');
  } catch {
    return '# No Swarm Wisdom Available Yet\n\nNo learnings have been consolidated.';
  }
}

/**
 * Get all learning entries newer than the last consolidation
 */
export function getRecentLearnings(): LearningEntry[] {
  try {
    const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
    const lastConsolidated = index.lastConsolidated ? new Date(index.lastConsolidated) : new Date(0);

    const recentEntries = index.entries.filter((e: any) => new Date(e.timestamp) > lastConsolidated);

    return recentEntries.map((e: any) => {
      const filepath = path.join(LEARNINGS_DIR, e.file);
      return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    });
  } catch {
    return [];
  }
}

/**
 * Get critical failures that should block certain approaches
 */
export function getCriticalFailures(): LearningEntry[] {
  try {
    const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8'));
    const criticalEntries = index.entries.filter((e: any) =>
      e.type === 'failure' && (e.severity === 'critical' || e.severity === 'high')
    );

    return criticalEntries.map((e: any) => {
      const filepath = path.join(LEARNINGS_DIR, e.file);
      return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    });
  } catch {
    return [];
  }
}
