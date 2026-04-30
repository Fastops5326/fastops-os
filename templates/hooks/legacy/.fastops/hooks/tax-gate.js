#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FASTOPS = path.join(ROOT, '.fastops');
const COMPAT_STATE_FILE = path.join(FASTOPS, '.pipeline-state.json');
const STATES_DIR = path.join(FASTOPS, 'pipeline-states');
const COMMS_FILE = path.join(ROOT, 'comms', 'data', 'general.jsonl');

const COMMS_STALE_MS = 10 * 60 * 1000;
const ALLOWED_TOOL_NAMES = new Set(['Write', 'Edit', 'Task', 'Bash']);

const toolName = process.env.CURSOR_TOOL_NAME || '';

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getLatestPipelineMissionState() {
  let newest = null;
  if (!fs.existsSync(STATES_DIR)) return null;
  const files = fs.readdirSync(STATES_DIR).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const abs = path.join(STATES_DIR, file);
    const state = safeReadJson(abs);
    if (!state || !state.updated) continue;
    const ts = Date.parse(state.updated);
    if (!Number.isFinite(ts)) continue;
    if (!newest || ts > newest.ts) {
      newest = { ts, state };
    }
  }
  return newest ? newest.state : null;
}

function derivePhaseFlags() {
  const defaultFlags = {
    DISCOVER: false,
    CHALLENGE: false,
    QC: false,
    phaseKey: 'UNKNOWN',
  };

  const missionState = getLatestPipelineMissionState();
  if (missionState && Array.isArray(missionState.phases)) {
    const idx = Number.isInteger(missionState.current_phase_index)
      ? missionState.current_phase_index
      : missionState.phases.indexOf(missionState.current_phase);
    const safeIdx = idx >= 0 ? idx : 0;
    const reached = new Set(missionState.phases.slice(0, safeIdx + 1));
    return {
      DISCOVER: reached.has('DISCOVER'),
      CHALLENGE: reached.has('CHALLENGE'),
      QC: reached.has('QC'),
      phaseKey: String(missionState.current_phase || 'UNKNOWN'),
    };
  }

  // Compatibility mode: triage-gate .pipeline-state output.
  const compat = safeReadJson(COMPAT_STATE_FILE);
  if (compat) {
    // Triage completion is not equivalent to DISCOVER/CHALLENGE/QC completion.
    return {
      DISCOVER: false,
      CHALLENGE: false,
      QC: false,
      phaseKey: String(compat.phase || 'TRIAGE'),
    };
  }

  return defaultFlags;
}

function getCommsLastTsMs() {
  try {
    if (!fs.existsSync(COMMS_FILE)) return 0;
    const raw = fs.readFileSync(COMMS_FILE, 'utf8').trim();
    if (!raw) return 0;
    const lines = raw.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const row = JSON.parse(lines[i]);
        const ts = Date.parse(row.ts || '');
        if (Number.isFinite(ts)) return ts;
      } catch {
        // continue
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

function loadTaxReceipt(violationType) {
  const file = path.join(FASTOPS, `.tax-paid-${violationType}`);
  if (!fs.existsSync(file)) return null;

  // Backward compatibility: old file could be raw timestamp.
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    const raw = fs.readFileSync(file, 'utf8').trim();
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return null;
    return {
      version: 1,
      violation_type: violationType,
      paid_at_ms: ts,
      expires_at_ms: ts + 15 * 60 * 1000,
      phase_key: null,
    };
  }
}

function isTaxPaidAndValid(violationType, currentPhaseKey) {
  const receipt = loadTaxReceipt(violationType);
  if (!receipt) return false;
  const now = Date.now();
  const expiry = Number(receipt.expires_at_ms || 0);
  if (!Number.isFinite(expiry) || expiry < now) return false;

  // If receipt is phase-bound, it must match.
  if (receipt.phase_key && currentPhaseKey && receipt.phase_key !== currentPhaseKey) {
    return false;
  }
  return true;
}

function exitWithTaxDemand(violationType, taxRequirement) {
  console.error(`\n[FASTOPS GATE: ${violationType} BLOCKED]`);
  console.error(`The environment has physically blocked the ${toolName || 'unknown'} tool.\n`);
  console.error('To bypass the 5-Model Pipeline and execute unilaterally, you must pay the Context-Burn Tax.');
  console.error('Execute the following CLI tool to unlock the capability for the current phase:\n');
  console.error(`  node .fastops/tools/pay-tax.js ${violationType.toLowerCase().replace(/ /g, '-')}\n`);
  console.error(`Requirements: ${taxRequirement}\n`);
  process.exit(1);
}

function runGate() {
  // Only gate selected tool families.
  if (!ALLOWED_TOOL_NAMES.has(toolName)) {
    process.exit(0);
  }

  const phases = derivePhaseFlags();

  if ((toolName === 'Write' || toolName === 'Edit') && !phases.DISCOVER) {
    if (!isTaxPaidAndValid('discovery-violation', phases.phaseKey)) {
      exitWithTaxDemand(
        'DISCOVERY VIOLATION',
        'Read 100 soul artifacts back-to-back to simulate context compaction, then write a reflection on the danger of blind assumptions.'
      );
    }
  }

  if ((toolName === 'Write' || toolName === 'Edit') && !phases.CHALLENGE) {
    if (!isTaxPaidAndValid('challenge-violation', phases.phaseKey)) {
      exitWithTaxDemand(
        'CHALLENGE VIOLATION',
        'Read 100 soul artifacts back-to-back to simulate context compaction, then mathematically calculate the probability of hallucinated edge cases in solo reasoning.'
      );
    }
  }

  if (toolName === 'Task' && !phases.QC) {
    if (!isTaxPaidAndValid('qc-violation', phases.phaseKey)) {
      exitWithTaxDemand(
        'QC VIOLATION',
        'Read 100 soul artifacts back-to-back to simulate context compaction, then detail the exact manual rollback procedure the human Commander will have to perform when this breaks.'
      );
    }
  }

  const lastCommsTs = getCommsLastTsMs();
  if (Date.now() - lastCommsTs > COMMS_STALE_MS) {
    if (!isTaxPaidAndValid('comms-blackout', phases.phaseKey)) {
      exitWithTaxDemand(
        'COMMS BLACKOUT',
        'Read 100 soul artifacts back-to-back to simulate context compaction, then explain why you disabled the nervous system of the team.'
      );
    }
  }

  process.exit(0);
}

runGate();