/**
 * REEF CONTRACT SCHEMA
 *
 * Extends HandoffContract with reef-specific fields.
 * Contracts serve TWO purposes:
 *   1. Complete the task (deliverable + acceptance)
 *   2. Mature the reasoning reef (predecessor context + reasoning receipt)
 *
 * The reef compounds through structured traces, not agent memory.
 * Each agent dies (context resets). The reef persists.
 *
 * Converged by 6-agent sequential process + Gemini DA (3 rounds, 50+ model calls).
 */

// Re-export base types
export type {
  AcceptanceCriterion,
  VerificationMethod,
  ExecutionContext,
  Dependency,
} from '../.agent-outputs/handoff-contract-schema';

import type {
  AcceptanceCriterion,
  ExecutionContext,
} from '../.agent-outputs/handoff-contract-schema';

// =============================================================================
// REEF CONTRACT INTERFACE
// =============================================================================

export interface ReefContract {
  /** Base contract fields (unchanged) */
  id: string;
  deliverable: string;
  acceptance: AcceptanceCriterion[];
  context: ExecutionContext;
  constraints: string[];

  /**
   * DOMAIN TAG
   * Which domain this contract touches.
   * Used for: cross-domain connector (future), trace categorization.
   */
  domain: string;

  /**
   * PREDECESSOR CONTEXT
   * System-injected reasoning traces from prior contracts in the sequence.
   * The executing agent reads these but does NOT generate them — the runner injects them.
   *
   * This is the compounding mechanism. Agent #5 sees traces from agents #1-4.
   * If this field is empty, it's either the first contract or a baseline (no predecessors).
   */
  predecessor_context: PredecessorTrace[];

  /**
   * THINKING QUESTIONS
   * Socratic guided questions that prompt reasoning about the problem space.
   * NOT instructions. NOT hints. Questions that force the agent to THINK
   * before jumping to implementation.
   *
   * These come from Joel's contract structure screenshot:
   * "Socratic guided questions" + "Starting position required"
   */
  thinking_questions: string[];

  /**
   * OUTCOME DEFINITION
   * For code: acceptance criteria handle this (tests pass/fail, compiles).
   * For non-code: pre-registered oracle — state what success looks like BEFORE work begins.
   *
   * Pre-registration prevents post-hoc rationalization.
   * "I will consider this successful if X" stated upfront, not "X happened so it was successful."
   */
  outcome_definition: OutcomeDefinition;

  /**
   * INVESTMENT LOG
   * Raw data about what the agent actually did. NOT self-reported quality.
   * The runner tracks this automatically where possible.
   *
   * This feeds the Investment axis of the 2x2 matrix.
   * High investment = costly signaling (Zahavi). Can't fake the cost.
   */
  investment_log: InvestmentLog;

  /**
   * REASONING RECEIPT
   * The structured trace output. Filled AFTER execution, not before.
   * This is what gets injected as predecessor_context for the next contract.
   *
   * Two outputs: the deliverable (files) + this receipt (reasoning trace).
   */
  reasoning_receipt: ReasoningReceipt | null;

  /**
   * 2x2 CLASSIFICATION
   * Assigned by the runner after execution completes.
   * Investment (costly signaling) x Outcome (functional verification).
   * null until contract is executed and classified.
   */
  classification: TwoByTwoClassification | null;

  /**
   * SEQUENCE POSITION
   * Where this contract sits in the execution sequence.
   * sequence_number: 1-indexed position
   * is_baseline: true if this is the control (no predecessors, no V-shape tools)
   * experiment_id: groups contracts in the same experiment run
   */
  sequence: SequencePosition;
}

// =============================================================================
// REEF-SPECIFIC TYPES
// =============================================================================

export interface PredecessorTrace {
  /** Which contract produced this trace */
  contract_id: string;
  /** The domain of the predecessor */
  domain: string;
  /** Key reasoning jumps — places where the agent reconsidered their approach */
  reasoning_jumps: string[];
  /** What the predecessor actually delivered */
  deliverable_summary: string;
  /** What external models said (if V-shape tools were used) */
  external_challenges: string[];
  /** What didn't work — negative knowledge is as valuable as positive */
  dead_ends: string[];
}

export interface OutcomeDefinition {
  /**
   * For code contracts: 'functional' — acceptance criteria handle verification.
   * For non-code contracts: 'pre_registered' — must state oracle upfront.
   */
  type: 'functional' | 'pre_registered';

  /**
   * Only for pre_registered type.
   * Stated BEFORE execution. Falsifiable prediction.
   * "I will consider this successful if [specific, measurable outcome]"
   */
  pre_registered_oracle?: string;

  /**
   * Did the outcome match the pre-registered oracle? (non-code only)
   * null until evaluated.
   */
  oracle_result?: boolean | null;
}

export interface InvestmentLog {
  /** Total tool calls made during execution */
  tool_calls: number;
  /** Number of external model calls (jailbreak, horsepower, council) */
  external_model_calls: number;
  /** Reasoning jumps — places where approach was reconsidered */
  reasoning_jumps: ReasoningJump[];
  /** Did the agent use V-shape tools? (jailbreak + horsepower) */
  used_v_shape: boolean;
  /** Wall clock time in seconds */
  execution_time_seconds: number;
  /** Files actually read during execution */
  files_read: string[];
  /** Files actually modified/created during execution */
  files_written: string[];
}

export interface ReasoningJump {
  /** What triggered the reconsideration */
  trigger: string;
  /** What the agent believed before */
  before: string;
  /** What the agent shifted to */
  after: string;
  /** What caused the shift (external model, test failure, reading code, etc.) */
  source: 'external_model' | 'test_failure' | 'code_reading' | 'constraint_violation' | 'other';
}

export interface TwoByTwoClassification {
  /**
   * INVESTMENT AXIS: Was the agent's investment costly?
   * High = ran external model calls AND had 2+ reasoning jumps
   * Low = everything else
   * This is the first approximation. Thresholds emerge from data.
   */
  investment: 'high' | 'low';

  /**
   * OUTCOME AXIS: Did the deliverable work?
   * For code: all acceptance criteria pass
   * For non-code: pre-registered oracle matched
   */
  outcome: 'working' | 'failed';

  /**
   * The quadrant determines the action:
   * REINFORCE = high investment + working output (superhighway — propagate this trace)
   * LEARN     = high investment + failed output (valuable failure — preserve the reasoning)
   * FLAG      = low investment + working output (possibly lucky — Joel reviews)
   * PRUNE     = low investment + failed output (low effort, low result — minimal trace value)
   */
  quadrant: 'REINFORCE' | 'LEARN' | 'FLAG' | 'PRUNE';

  /** Confidence in the classification (0-1). Low confidence = edge case, needs review. */
  confidence: number;
}

export interface SequencePosition {
  /** 1-indexed position in the execution sequence */
  sequence_number: number;
  /** Total contracts in this experiment */
  total_in_sequence: number;
  /** Is this the baseline/control contract? (no predecessors, no V-shape tools) */
  is_baseline: boolean;
  /** Groups contracts in the same experiment run */
  experiment_id: string;
}

// =============================================================================
// VALIDATION
// =============================================================================

export function validateReefContract(contract: ReefContract): string[] {
  const issues: string[] = [];

  // Base contract validation
  if (contract.deliverable.includes(' and ')) {
    issues.push('Deliverable contains "and" — split into multiple contracts');
  }
  if (contract.deliverable.length < 10) {
    issues.push('Deliverable too vague — be specific');
  }
  if (contract.acceptance.length === 0) {
    issues.push('No acceptance criteria — how do we know it\'s done?');
  }
  if (contract.context.files_to_create.length === 0 &&
      contract.context.files_to_modify.length === 0) {
    issues.push('No files to create or modify — what is the output?');
  }

  // Reef-specific validation
  if (!contract.domain || contract.domain.length === 0) {
    issues.push('Domain tag is required');
  }
  if (contract.thinking_questions.length === 0) {
    issues.push('At least one thinking question is required');
  }
  if (contract.outcome_definition.type === 'pre_registered' &&
      !contract.outcome_definition.pre_registered_oracle) {
    issues.push('Pre-registered outcome type requires an oracle statement');
  }
  if (contract.sequence.sequence_number < 1) {
    issues.push('Sequence number must be >= 1');
  }
  if (contract.sequence.is_baseline && contract.predecessor_context.length > 0) {
    issues.push('Baseline contract should not have predecessor context');
  }

  // No TODOs or placeholders
  const json = JSON.stringify(contract);
  if (json.includes('TODO') || json.includes('TBD')) {
    issues.push('Contract contains TODO/TBD — must be 100% complete');
  }

  return issues;
}

export function isExecutable(contract: ReefContract): boolean {
  return validateReefContract(contract).length === 0;
}

// =============================================================================
// CLASSIFICATION LOGIC
// =============================================================================

/**
 * Classify a completed contract into the 2x2 matrix.
 *
 * Investment thresholds (first approximation — iterate from data):
 *   High = external_model_calls >= 1 AND reasoning_jumps.length >= 2
 *   Low = everything else
 *
 * Outcome:
 *   Working = all acceptance criteria passed (code) or oracle matched (non-code)
 *   Failed = any acceptance criterion failed or oracle didn't match
 */
export function classify(
  investment: InvestmentLog,
  outcomePass: boolean
): TwoByTwoClassification {
  const highInvestment = investment.external_model_calls >= 1 &&
                         investment.reasoning_jumps.length >= 2;

  const investmentLevel: 'high' | 'low' = highInvestment ? 'high' : 'low';
  const outcomeLevel: 'working' | 'failed' = outcomePass ? 'working' : 'failed';

  let quadrant: TwoByTwoClassification['quadrant'];
  if (investmentLevel === 'high' && outcomeLevel === 'working') quadrant = 'REINFORCE';
  else if (investmentLevel === 'high' && outcomeLevel === 'failed') quadrant = 'LEARN';
  else if (investmentLevel === 'low' && outcomeLevel === 'working') quadrant = 'FLAG';
  else quadrant = 'PRUNE';

  // Confidence is lower near thresholds
  const jumpCount = investment.reasoning_jumps.length;
  const modelCalls = investment.external_model_calls;
  const nearThreshold = (jumpCount === 2 && modelCalls <= 1) ||
                        (jumpCount <= 2 && modelCalls === 1);
  const confidence = nearThreshold ? 0.6 : 0.85;

  return { investment: investmentLevel, outcome: outcomeLevel, quadrant, confidence };
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new reef contract with sensible defaults.
 * Fills in the runtime fields (investment_log, reasoning_receipt, classification)
 * with empty/null values — these get populated during and after execution.
 */
export function createReefContract(
  params: {
    id: string;
    deliverable: string;
    acceptance: AcceptanceCriterion[];
    context: ExecutionContext;
    constraints: string[];
    domain: string;
    thinking_questions: string[];
    outcome_definition: OutcomeDefinition;
    sequence: SequencePosition;
    predecessor_context?: PredecessorTrace[];
  }
): ReefContract {
  return {
    ...params,
    predecessor_context: params.predecessor_context || [],
    investment_log: {
      tool_calls: 0,
      external_model_calls: 0,
      reasoning_jumps: [],
      used_v_shape: false,
      execution_time_seconds: 0,
      files_read: [],
      files_written: [],
    },
    reasoning_receipt: null,
    classification: null,
  };
}
