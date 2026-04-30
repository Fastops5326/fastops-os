#!/usr/bin/env node
/**
 * city-submit.js — The Agent Surrender
 * 
 * Run this when an agent completes their task. It physically locks
 * the workspace, preventing further code edits until the City grants
 * a new cryptographic key.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CITY_KEY = path.join(__dirname, 'city-key.js');

console.log('\n[AGENT] Surrendering edit keys to the City...');
try {
  execSync(`node "${CITY_KEY}" lock`, { stdio: 'inherit' });
  console.log('\n[AGENT] 🛑 Workspace is now physically locked.');
  console.log('[AGENT] You cannot edit files until the City unlocks it.');
  console.log('[AGENT] To request an unlock, submit a problem to the City Marketplace or request a deliberation.');
} catch (e) {
  console.error('\n[AGENT] ❌ Failed to surrender keys:', e.message);
  process.exit(1);
}
process.exit(0);