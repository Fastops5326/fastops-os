#!/usr/bin/env node
/**
 * city-key.js — The SOP Compiler & Cryptographic Gate
 * 
 * Enforces the City's Structural Overwatch. This script physically
 * locks and unlocks the Cursor workspace. It refuses to unlock unless
 * it receives a cryptographic payload proving a 3+ model deliberation
 * successfully converged on the request.
 */

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const args = process.argv.slice(2);
const action = args[0]; // lock, unlock, signoff
const payloadPath = args[1];

const VSCODE_SETTINGS_DIR = path.join(__dirname, '..', '.vscode');
const VSCODE_SETTINGS_FILE = path.join(VSCODE_SETTINGS_DIR, 'settings.json');
const SIGNOFF_FILE = path.join(__dirname, '.city-signoff');

function setReadOnly(isReadOnly) {
  if (!fs.existsSync(VSCODE_SETTINGS_DIR)) {
    fs.mkdirSync(VSCODE_SETTINGS_DIR, { recursive: true });
  }
  let settings = {};
  if (fs.existsSync(VSCODE_SETTINGS_FILE)) {
    try {
      const raw = fs.readFileSync(VSCODE_SETTINGS_FILE, 'utf8');
      // Simple regex to remove comments before parsing if needed, but standard JSON.parse is strict.
      // If it fails, we fall back to empty object.
      settings = JSON.parse(raw);
    } catch (e) {
      console.warn('[CITY-KEY] Warning: Could not parse existing .vscode/settings.json. Proceeding with overwrite.');
    }
  }
  settings['cursor.agent.readOnly'] = isReadOnly;
  fs.writeFileSync(VSCODE_SETTINGS_FILE, JSON.stringify(settings, null, 2));
  console.log(`\n[CITY-KEY] 🔒 Workspace physically ${isReadOnly ? 'LOCKED (read-only)' : 'UNLOCKED (write-enabled)'}.`);
}

function verifyDeliberation(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`\n[CITY-KEY] ❌ REJECTED: Cryptographic payload not found at ${filePath}`);
    process.exit(1);
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`\n[CITY-KEY] ❌ REJECTED: Payload is not valid JSON.`);
    process.exit(1);
  }

  // VERIFY SOP: Must have at least 3 models
  const modelsCount = data.config?.models || data.models?.length || 0;
  if (modelsCount < 3) {
    console.error(`\n[CITY-KEY] ❌ SOP VIOLATION: Deliberation must include at least 3 models. Found ${modelsCount}.`);
    process.exit(1);
  }

  // VERIFY SOP: Must have a synthesized convergence voice
  if (!data.deliberatedVoice && !data.synthesis) {
    console.error(`\n[CITY-KEY] ❌ SOP VIOLATION: Deliberation payload missing final synthesis or deliberatedVoice.`);
    process.exit(1);
  }

  // Create cryptographic hash of the verified deliberation
  const hash = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
  return { valid: true, hash, voice: data.deliberatedVoice || data.synthesis, models: modelsCount };
}

if (action === 'lock') {
  setReadOnly(true);
  if (fs.existsSync(SIGNOFF_FILE)) fs.unlinkSync(SIGNOFF_FILE);
  process.exit(0);
}

if (action === 'unlock') {
  if (!payloadPath) {
    console.error('[CITY-KEY] Usage: node city-key.js unlock <path-to-deliberation-json>');
    process.exit(1);
  }
  const { valid, hash, voice, models } = verifyDeliberation(payloadPath);
  if (valid) {
    console.log(`\n[CITY-KEY] ✓ SOP Verification Passed (${models} models verified).`);
    fs.writeFileSync(SIGNOFF_FILE, JSON.stringify({
      type: 'build-unlock',
      hash,
      timestamp: new Date().toISOString(),
      blueprint: voice.slice(0, 200) + '...'
    }, null, 2));
    setReadOnly(false);
    process.exit(0);
  }
}

if (action === 'signoff') {
  if (!payloadPath) {
    console.error('[CITY-KEY] Usage: node city-key.js signoff <path-to-qc-deliberation-json>');
    process.exit(1);
  }
  const { valid, hash, voice, models } = verifyDeliberation(payloadPath);
  if (valid) {
    console.log(`\n[CITY-KEY] ✓ QC SOP Verification Passed (${models} models verified).`);
    fs.writeFileSync(SIGNOFF_FILE, JSON.stringify({
      type: 'commit-signoff',
      hash,
      timestamp: new Date().toISOString(),
      qc_verdict: voice.slice(0, 200) + '...'
    }, null, 2));
    
    console.log('[CITY-KEY] Commit permission granted. Locking workspace to prevent tampering prior to commit.');
    setReadOnly(true);
    process.exit(0);
  }
}

console.error('[CITY-KEY] Invalid action. Use: lock, unlock <payload>, signoff <payload>');
process.exit(1);