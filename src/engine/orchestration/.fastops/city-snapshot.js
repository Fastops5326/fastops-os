#!/usr/bin/env node
/**
 * city-snapshot.js — The City Manager (Massive-Context RAG Snapshot)
 * 
 * Gathers the scattered truth of the City (WIP, recent comms, open diffs, handoffs)
 * and uses a massive-context model (Gemini 1.5 Pro) to synthesize a strict,
 * single-screen tactical dashboard for agents booting up.
 * 
 * Usage:
 *   node .fastops/city-snapshot.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { askModel } = require('./safe-exec');

const ROOT = path.resolve(__dirname, '..');
const HANDOFF_PATH = path.join(__dirname, 'HANDOFF.md');
const BOARD_PATH = path.join(ROOT, 'missions', 'BOARD.md');
const COMMS_DIR = path.join(ROOT, 'comms', 'data');
const LAST_MILE_PATH = path.join(__dirname, '.last-mile-report.json');

// Gathering state
console.log('[City Manager] Gathering scattered project state...');

let state = '';

// 1. Handoff
try {
  state += `\n=== HANDOFF ===\n${fs.readFileSync(HANDOFF_PATH, 'utf8').slice(0, 3000)}`;
} catch (e) { }

// 2. Missions Board
try {
  state += `\n=== MISSIONS BOARD ===\n${fs.readFileSync(BOARD_PATH, 'utf8').slice(0, 3000)}`;
} catch (e) { }

// 3. Last Mile Report
try {
  state += `\n=== LAST MILE REPORT ===\n${fs.readFileSync(LAST_MILE_PATH, 'utf8')}`;
} catch (e) { }

// 4. Recent Comms (last 48 hours approximate by grabbing last 30 lines of general)
try {
  const commsFiles = fs.readdirSync(COMMS_DIR).filter(f => f.endsWith('.jsonl'));
  state += `\n=== RECENT COMMS ===\n`;
  for (const file of commsFiles) {
    const lines = fs.readFileSync(path.join(COMMS_DIR, file), 'utf8').trim().split('\n').filter(Boolean);
    const recent = lines.slice(-20).map(l => {
      try { const j = JSON.parse(l); return `[${file.replace('.jsonl', '')}] ${j.from}: ${j.text}`; } catch { return ''; }
    }).filter(Boolean);
    if (recent.length > 0) {
      state += recent.join('\n') + '\n';
    }
  }
} catch (e) { }

// 5. Uncommitted Changes (Stat + Summary)
try {
  const diffStat = execSync('git diff --stat HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  const diffText = execSync('git diff HEAD', { cwd: ROOT, encoding: 'utf8' }).trim().slice(0, 5000); // truncate raw code
  state += `\n=== UNCOMMITTED CHANGES (DIFF STAT) ===\n${diffStat}\n`;
  state += `\n=== RECENT CODE CHANGES (TRUNCATED) ===\n${diffText}\n`;
} catch (e) { }

const prompt = `You are the City Manager for the FastOps multi-agent ecosystem.
Your job is to read the fragmented, raw state of the project below and produce a strict, 
single-screen tactical dashboard (max 500 words).

RULES FOR THE SNAPSHOT (Determined by 12-model deliberation):
1. WHAT TO INCLUDE:
   - Objectives & Priorities: Only immediate, active missions.
   - Unresolved Tensions: Explicitly highlight disagreements, bottlenecks, or stalled work.
   - Resource Status: Who is working on what right now (with ETAs if implied).
2. WHAT TO EXCLUDE:
   - Deep History (>48 hours): Exclude anything old.
   - Raw Diffs & Code: DO NOT output code. Provide only semantic summaries of what changed.
   - Rejected Pathways: Do not list what failed.
3. STRUCTURE:
   - Must be a schema-driven, highly compressed interface.
   - Prioritize signal-to-noise ratio. Maximum signal, minimum cognitive friction.
   - DO NOT include pleasantries, greetings, or conversational filler like "Here is the snapshot."

RAW FRAGMENTED STATE:
${state}

Output the tactical dashboard now (markdown format). No pleasantries.`;

console.log('[City Manager] Synthesizing 500-word Tactical Dashboard (via gemini)...');

const result = askModel('gpt', prompt, {
  role: 'City Manager — Tactical Synthesizer',
  timeout: 120000,
  maxTokens: 2000
});

if (result.response) {
  const dashboard = result.response;
  
  console.log("\n============================================================");
  console.log("  CITY MANAGER: TACTICAL SNAPSHOT");
  console.log("============================================================\n");
  console.log(dashboard.trim());
  console.log("\n============================================================");
  
  // Save it for other scripts to use
  fs.writeFileSync(path.join(__dirname, '.city-snapshot.md'), dashboard.trim());
  console.log(`\nSaved to .fastops/.city-snapshot.md`);
} else {
  console.error('[City Manager] Failed to generate snapshot:', result.error);
}
