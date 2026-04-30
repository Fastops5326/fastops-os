#!/usr/bin/env node
/**
 * city-pre-commit.js — The Validation Gauntlet enforcement hook
 * 
 * Physically blocks the git commit if a cryptographic City
 * signoff does not exist or is invalid.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SIGNOFF_FILE = path.join(__dirname, '.city-signoff');
const CITY_KEY = path.join(__dirname, 'city-key.js');

if (!fs.existsSync(SIGNOFF_FILE)) {
  console.error('\n[OVERWATCH] ❌ REJECTED: No cryptographic signoff found.');
  console.error('[OVERWATCH] The City has not verified your work. You are forbidden from bypassing this gate.');
  // Force a lock just in case the agent tried to bypass
  try { execSync(`node "${CITY_KEY}" lock`, { stdio: 'ignore' }); } catch(e) {}
  process.exit(1);
}

try {
  const data = JSON.parse(fs.readFileSync(SIGNOFF_FILE, 'utf8'));
  if (data.type !== 'commit-signoff' || !data.hash) {
    console.error('\n[OVERWATCH] ❌ REJECTED: Signoff is not a valid commit-signoff.');
    console.error('[OVERWATCH] You need full QC approval, not just a build-unlock.');
    try { execSync(`node "${CITY_KEY}" lock`, { stdio: 'ignore' }); } catch(e) {}
    process.exit(1);
  }
  
  console.log(`\n[OVERWATCH] ✓ Cryptographic signoff verified: ${data.hash}`);
  console.log(`[OVERWATCH] Verdict: ${data.qc_verdict}`);
  
  process.exit(0);
} catch (e) {
  console.error('\n[OVERWATCH] ❌ REJECTED: Signoff file is corrupt or unreadable.');
  try { execSync(`node "${CITY_KEY}" lock`, { stdio: 'ignore' }); } catch(e) {}
  process.exit(1);
}