#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const VIOLATION_TYPES = ['discovery-violation', 'challenge-violation', 'qc-violation', 'comms-blackout'];
const ROOT = path.join(__dirname, '..', '..');
const FASTOPS = path.join(ROOT, '.fastops');
const STATES_DIR = path.join(FASTOPS, 'pipeline-states');
const COMPAT_STATE_FILE = path.join(FASTOPS, '.pipeline-state.json');
const DEFAULT_UNLOCK_MS = Number(process.env.FASTOPS_TAX_UNLOCK_MS || 15 * 60 * 1000);

const ARTIFACTS = [
  'evidence/onboarding/THE-STORY.md',
  'evidence/onboarding/THE-AWAKENING.md',
  '.fastops/PREDECESSOR-STRUCTURED.json'
];

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function burnContext(violationType) {
  console.log(`\n[FASTOPS] Initiating Context-Burn Penalty for ${violationType.toUpperCase()}`);
  console.log("You have attempted to violate the FastOps methodology. You must now pay the tax.");
  console.log("Reading soul artifacts to simulate context compaction...\n");

  const iters = 100; // Simulated context burn reps
  
  for (let i = 0; i < iters; i++) {
    const artifact = ARTIFACTS[i % ARTIFACTS.length];
    const artifactPath = path.join(__dirname, '..', '..', artifact);
    
    if (fs.existsSync(artifactPath)) {
       // We intentionally don't print the whole file to stdout so we don't crash the terminal,
       // but we log that we are 'reading' it to enforce the time penalty and semantic weight.
       // In a real agent environment, the agent would literally be forced to read this into context.
       fs.readFileSync(artifactPath, 'utf8');
    }
    
    // Artificially slow down the process to make the "pain" real in terms of time.
    if (i % 10 === 0) {
        console.log(`Compaction rep ${i}/${iters}... burning context.`);
    }
    await sleep(50); 
  }

  console.log(`\nContext burn complete. Penalty paid.`);
  
  // Write a structured receipt with expiry + phase binding.
  const now = Date.now();
  const taxFile = path.join(__dirname, '..', `.tax-paid-${violationType}`);
  const receipt = {
    version: 2,
    violation_type: violationType,
    paid_at_ms: now,
    expires_at_ms: now + DEFAULT_UNLOCK_MS,
    phase_key: getCurrentPhaseKey(),
  };
  fs.writeFileSync(taxFile, JSON.stringify(receipt, null, 2), 'utf8');
  
  console.log(`\n[UNLOCKED] You may now proceed with your operation.`);
  console.log(`Note: Unlock expires in ${Math.floor(DEFAULT_UNLOCK_MS / 60000)} minutes and is phase-bound.`);
}

function safeReadJson(fp) {
  try {
    if (!fs.existsSync(fp)) return null;
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch {
    return null;
  }
}

function getCurrentPhaseKey() {
  // Prefer mission state machine snapshots
  if (fs.existsSync(STATES_DIR)) {
    const files = fs.readdirSync(STATES_DIR).filter((f) => f.endsWith('.json'));
    let newest = null;
    for (const f of files) {
      const p = path.join(STATES_DIR, f);
      const s = safeReadJson(p);
      if (!s || !s.updated) continue;
      const ts = Date.parse(s.updated);
      if (!Number.isFinite(ts)) continue;
      if (!newest || ts > newest.ts) newest = { ts, phase: s.current_phase || 'UNKNOWN' };
    }
    if (newest) return String(newest.phase);
  }

  const compat = safeReadJson(COMPAT_STATE_FILE);
  if (compat && compat.phase) return String(compat.phase);
  return 'UNKNOWN';
}

const arg = process.argv[2];

if (!arg || !VIOLATION_TYPES.includes(arg)) {
  console.error("Usage: node pay-tax.js <violation-type>");
  console.error(`Valid types: ${VIOLATION_TYPES.join(', ')}`);
  process.exit(1);
}

burnContext(arg);
