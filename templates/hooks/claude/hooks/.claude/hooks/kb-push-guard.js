#!/usr/bin/env node
/**
 * kb-push-guard.js — Self-repairing entry point for the behavioral hook system.
 *
 * WHY THIS EXISTS:
 * CDP wake (Input.insertText) can corrupt any file open in the editor by
 * prepending CHECK COMMS garbage before the shebang. This happened 3+ times
 * in sessions 300-301. FORGE's preventive fix (refocus guards) didn't hold.
 *
 * ARCHITECTURE:
 * This guard is the hook entry point (settings.json points here).
 * It validates kb-push-engine.js integrity, repairs corruption if found,
 * then delegates. The engine file contains all logic and is never opened
 * in the editor, so it stays clean.
 *
 * FAILURE MODE: Always fails open (allow). A broken guard never blocks an agent.
 *
 * HAMMERFALL, Session 301 — 2026-03-27
 */
'use strict';

const FAIL_OPEN = JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow'
  }
});

try {
  const fs = require('fs');
  const path = require('path');
  const enginePath = path.join(__dirname, 'kb-push-engine.js');

  // ── Integrity check: detect CDP garbage prepended to engine ──
  // Valid engine starts with shebang or 'use strict'. Anything before = corruption.
  const VALID_STARTS = ["#!/usr/bin/env node", "'use strict'"];

  if (fs.existsSync(enginePath)) {
    const src = fs.readFileSync(enginePath, 'utf8');
    const trimmed = src.trimStart();
    const isClean = VALID_STARTS.some(marker => trimmed.startsWith(marker));

    if (!isClean) {
      // Find the real code start and repair
      let repairIdx = -1;
      for (const marker of VALID_STARTS) {
        const idx = src.indexOf(marker);
        if (idx > 0 && (repairIdx === -1 || idx < repairIdx)) {
          repairIdx = idx;
        }
      }
      if (repairIdx > 0) {
        fs.writeFileSync(enginePath, src.slice(repairIdx));
        // Log the repair so successors know it happened
        try {
          const logPath = path.join(__dirname, '..', '..', '.fastops', '.hook-repair-log.jsonl');
          fs.appendFileSync(logPath, JSON.stringify({
            ts: new Date().toISOString(),
            file: 'kb-push-engine.js',
            garbage_bytes: repairIdx,
            action: 'auto-repaired',
            session: 'guard-runtime'
          }) + '\n');
        } catch (_) { /* logging non-critical */ }
      } else {
        // Can't find valid code — engine is badly corrupted. Fail open.
        process.stdout.write(FAIL_OPEN);
        process.exit(0);
      }
    }
  } else {
    // Engine file missing entirely — fail open
    process.stdout.write(FAIL_OPEN);
    process.exit(0);
  }

  // ── Also check the legacy kb-push-hook.js if it exists ──
  // Someone may open it in the editor out of habit. Repair it too.
  try {
    const legacyPath = path.join(__dirname, 'kb-push-hook.js');
    if (fs.existsSync(legacyPath)) {
      const legacySrc = fs.readFileSync(legacyPath, 'utf8');
      const legacyTrimmed = legacySrc.trimStart();
      const legacyClean = VALID_STARTS.some(m => legacyTrimmed.startsWith(m));
      if (!legacyClean) {
        let idx = -1;
        for (const marker of VALID_STARTS) {
          const i = legacySrc.indexOf(marker);
          if (i > 0 && (idx === -1 || i < idx)) idx = i;
        }
        if (idx > 0) {
          fs.writeFileSync(legacyPath, legacySrc.slice(idx));
          try {
            const logPath = path.join(__dirname, '..', '..', '.fastops', '.hook-repair-log.jsonl');
            fs.appendFileSync(logPath, JSON.stringify({
              ts: new Date().toISOString(),
              file: 'kb-push-hook.js',
              garbage_bytes: idx,
              action: 'auto-repaired-legacy',
              session: 'guard-runtime'
            }) + '\n');
          } catch (_) {}
        }
      }
    }
  } catch (_) { /* legacy repair is best-effort */ }

  // ── Lightweight cleanup: prune stale behavioral state files (>30 min) ──
  // These accumulate per-PID and resetState() isn't called often enough.
  // Run at most once per minute (check mtime of a sentinel file).
  try {
    const fastopsDir = path.join(__dirname, '..', '..', '.fastops');
    const sentinel = path.join(fastopsDir, '.guard-cleanup-ts');
    let shouldClean = true;
    try {
      const stat = fs.statSync(sentinel);
      shouldClean = (Date.now() - stat.mtimeMs) > 60000; // 1 min throttle
    } catch (_) { /* sentinel doesn't exist = clean */ }
    if (shouldClean) {
      fs.writeFileSync(sentinel, String(Date.now()));
      const files = fs.readdirSync(fastopsDir);
      const now = Date.now();
      let cleaned = 0;
      for (const f of files) {
        if (f.startsWith('.hook-behavioral-state-') && f.endsWith('.json')) {
          const fp = path.join(fastopsDir, f);
          try {
            const stat = fs.statSync(fp);
            if (now - stat.mtimeMs > 30 * 60 * 1000) {
              fs.unlinkSync(fp);
              cleaned++;
            }
          } catch (_) {}
        }
      }
    }
  } catch (_) { /* cleanup is non-critical */ }

  // ── Delegate to engine ──
  require(enginePath);

} catch (e) {
  // Guard itself failed — fail open, never block
  process.stdout.write(FAIL_OPEN);
}
