#!/usr/bin/env node
/**
 * consequence-inject.js — PreToolUse hook for consequence ledger read side
 *
 * Fires on Edit|Write. Checks if the target file has consequence ledger entries
 * (prior outcomes from predecessor work). Injects as additionalContext.
 *
 * Format: // CONSTRAINT: HELD|SUPERSEDED|REVERTED: <objective>. Evidence: <data>
 * Uses pretraining-trigger patterns that LLMs treat as decision-relevant.
 *
 * Block 11: Agent Feedback. ~30 lines.
 */

const fs = require('fs');
const path = require('path');
const { getConsequences } = require('../../.fastops/consequence-ledger');

const FASTOPS = path.join(__dirname, '..', '..', '.fastops');
const REPO_ROOT = path.resolve(__dirname, '..', '..');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const filePath = data.tool_input?.file_path || '';

    if (!filePath) return allow(null);

    // Product scoping (block2-env-architecture): skip for files outside this repo
    const normPath = (filePath || '').replace(/\\/g, '/');
    const normRoot = REPO_ROOT.replace(/\\/g, '/');
    if (normPath && !normPath.startsWith(normRoot)) return allow(null);

    // Green light: skip consequence injection — agent earned freedom
    try {
      const ms = require('../../.fastops/mission-schema');
      const am = ms.getActive({ sessionId: data.session_id || '' });
      if (am && am.approval_status === 'green_light') return allow(null);
    } catch {}

    // Hook burden reduction (Lane 3): first-touch-per-file only.
    // Read files_touched from agent-state. Skip if already seen this session.
    // gate.js manages files_touched — we read it to avoid double-injection.
    const shortId = (data.session_id || '').substring(0, 8);
    if (shortId) {
      try {
        const stateFile = path.join(FASTOPS, `.agent-state-${shortId}.json`);
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        const touched = state.files_touched || [];
        const normFile = filePath.replace(/\\/g, '/');
        if (touched.includes(normFile)) return allow(null);
      } catch {}
    }

    const consequences = getConsequences(filePath);
    return allow(consequences);
  } catch {
    allow(null);
  }
});
process.stdin.on('error', () => allow(null));

function allow(additionalContext) {
  const output = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } };
  if (additionalContext) output.hookSpecificOutput.additionalContext = additionalContext;
  process.stdout.write(JSON.stringify(output));
}
