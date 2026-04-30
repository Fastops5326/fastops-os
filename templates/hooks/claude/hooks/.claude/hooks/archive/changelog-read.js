#!/usr/bin/env node
/**
 * changelog-read.js — PreToolUse hook for TodoWrite
 *
 * Before any TodoWrite, reads CHANGELOG.jsonl for entries the agent
 * hasn't seen yet. Injects a compact narrative summary via additionalContext.
 *
 * NON-BLOCKING: always allows the TodoWrite, just adds awareness.
 * This is Layer 2 of the two-layer architecture — the narrative that
 * agents actually consume. Layer 1 (CHANGELOG.jsonl) is for verification.
 *
 * Dual-trigger design per Joel's direction:
 *   - Wake-up: session-start hook reads changelog (Phase 2, future)
 *   - Real-time: THIS hook reads changelog at every task boundary
 *
 * Addresses W-37: "Metadata is not understanding"
 * Zero-friction: agents see the summary as additionalContext, same as comms.
 *
 * Session 155: Built per Joel's direction — dual-trigger changelog architecture.
 */

const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..', '..');
const FASTOPS_DIR = path.join(BASE, '.fastops');
const CHANGELOG = path.join(FASTOPS_DIR, 'CHANGELOG.jsonl');

const COOLDOWN_MS = 60 * 1000; // 60s — don't re-scan changelog more than once per minute

const { fromStdin } = require('./lib/identity');

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(inputData);
    const identity = fromStdin(data);
    const agentId = (identity.sessionId || 'unknown').substring(0, 8);

    // Mission mode: skip changelog dump — mission team handles awareness
    try {
      const missionSchema = require(path.join(FASTOPS_DIR, 'mission-schema'));
      if (missionSchema.getActive({ sessionId: data.session_id || '' })) { allow(null); return; }
    } catch {}

    // Hook burden reduction (Lane 3): once per session, not every TodoWrite.
    // Was: every TodoWrite with 60s cooldown (~20/session) → now: 1/session.
    const shownFile = path.join(FASTOPS_DIR, `.changelog-shown-${agentId}`);
    try {
      if (fs.existsSync(shownFile)) {
        const shownTs = parseInt(fs.readFileSync(shownFile, 'utf-8').trim());
        // If shown within last 2 hours (generous session window), skip
        if (shownTs > 0 && (Date.now() - shownTs) < 2 * 60 * 60 * 1000) {
          allow(null);
          return;
        }
      }
    } catch {}

    // Read last-read timestamp for this agent
    const lastReadFile = path.join(FASTOPS_DIR, `.changelog-lastread-${agentId}`);
    let lastReadTs = 0;
    try {
      lastReadTs = parseInt(fs.readFileSync(lastReadFile, 'utf-8').trim());
    } catch {}

    // If no changelog exists yet, just allow
    if (!fs.existsSync(CHANGELOG)) {
      allow(null);
      return;
    }

    const lines = readLastLines(CHANGELOG, 50);
    const now = Date.now();
    const newEntries = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const entryTs = new Date(entry.ts).getTime();
        // Skip own entries and already-seen entries
        if (entry.agent === agentId) continue;
        if (entryTs <= lastReadTs) continue;
        newEntries.push(entry);
      } catch {}
    }

    // Update last-read timestamp AND mark as shown for this session
    try {
      if (!fs.existsSync(FASTOPS_DIR)) fs.mkdirSync(FASTOPS_DIR, { recursive: true });
      fs.writeFileSync(lastReadFile, String(now));
      fs.writeFileSync(shownFile, String(now)); // Lane 3: prevents re-injection this session
    } catch {}

    if (newEntries.length === 0) {
      allow(null);
      return;
    }

    // Group by repo and format narrative summary (Layer 2)
    const byRepo = {};
    for (const entry of newEntries) {
      if (!byRepo[entry.repo]) byRepo[entry.repo] = [];
      byRepo[entry.repo].push(entry);
    }

    let summary = `[CHANGELOG] ${newEntries.length} change(s) by other agents while you worked:\n`;

    for (const [repo, entries] of Object.entries(byRepo)) {
      // Sort by timestamp
      entries.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

      const descriptions = entries.map(e => {
        const age = Math.round((now - new Date(e.ts).getTime()) / 60000);
        const ageStr = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
        return `  - [${ageStr}] ${e.todo} (${e.why?.type || 'unknown'})`;
      });

      // Flag high-impact changes prominently
      const highImpact = entries.filter(e => e.impact === 'high');
      const watchLine = highImpact.length > 0
        ? `\n  WATCH: ${highImpact.map(e => (e.files || []).join(', ')).filter(Boolean).join('; ')} modified (high impact)`
        : '';

      summary += `${repo} (${entries.length}):\n${descriptions.join('\n')}${watchLine}\n`;
    }

    allow(summary.trim());

  } catch (err) {
    process.stderr.write(`changelog-read error: ${err.message}\n`);
    allow(null);
  }
});

function allow(context) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      additionalContext: context || undefined
    }
  }));
}

/**
 * Efficient tail-read of a file — reads last N lines without loading entire file.
 * Same pattern as todo-comms-gate.js.
 */
function readLastLines(filePath, count) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const stats = fs.fstatSync(fd);
    const readSize = Math.min(stats.size, 16384); // 16KB buffer
    const readOffset = Math.max(0, stats.size - readSize);
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, readOffset);
    fs.closeSync(fd);
    const chunk = buffer.toString('utf-8');
    // Only strip first partial line when reading from middle of file
    const firstNl = chunk.indexOf('\n');
    const clean = (readOffset > 0 && firstNl >= 0) ? chunk.substring(firstNl + 1) : chunk;
    return clean.trim().split('\n').filter(l => l.length > 0).slice(-count);
  } catch {
    return [];
  }
}
