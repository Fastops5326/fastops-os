#!/usr/bin/env node
/**
 * Metabolic Trace — PostToolUse Hook
 *
 * Replaces behavioral-trace.js. Anonymous telemetry only.
 *
 * What it logs: timestamp, sequence, direction (read/write/search/execute),
 *               timing gap since last call. Nothing else.
 * What it does NOT log: file paths, targets, content, commands, patterns.
 *
 * This is a pulse check, not surveillance. It detects metabolic patterns
 * (e.g., 15 rapid writes with 0 reads = tunneling) without recording
 * what was read or written.
 *
 * At phase gates (ALPHA/BRAVO/CHARLIE/DELTA), prompts the agent to
 * voluntarily share what they explored. The agent decides what to share.
 * Overwatch reads the voluntary report + git diff for context.
 *
 * Drift injection (pause) is REMOVED. Metabolic anomalies route to
 * Overwatch's three-tier intervention policy, not to compliance injection.
 *
 * Schema contract: entry keys are ONLY { t, seq, dir, gap, agent, cid }.
 * Any key outside this allowlist is a Constitution violation.
 *
 * Output: .fastops/.metabolic-trace.jsonl
 *
 * History: Refactored from behavioral-trace.js per meeting convergence
 * (2026-03-07). 4-model agreement: claude-a, gemini, chatgpt, kimi.
 * See: .agent-outputs/MEETING-behavioral-trace-vs-voluntary-2026-03-07.md
 */

const fs = require('fs');
const path = require('path');

const COLONY_HOME = process.env.FASTOPS_HOME || process.cwd();

// Session-keyed identity resolution (shared module)
const { fromStdin } = require('./lib/identity');

const TRACE_FILE = path.join(COLONY_HOME, '.fastops', '.metabolic-trace.jsonl');
const STATE_FILE = path.join(COLONY_HOME, '.fastops', '.trace-state.json');
const SESSION_TIMEOUT = 2 * 60 * 60 * 1000; // 2 hours

// Shadow Brief milestones — fire JOC + voluntary exploration prompt
const SHADOW_MILESTONES = { 25: 'alpha', 50: 'bravo', 75: 'charlie', 100: 'delta' };

// Tool classification — direction only, no targets
const DIRECTIONS = {
  Read: 'read',
  Glob: 'search',
  Grep: 'search',
  Write: 'write',
  Edit: 'write',
  NotebookEdit: 'write',
  Bash: 'execute',
  Task: 'delegate',
  TodoWrite: 'plan',
  WebFetch: 'research',
  WebSearch: 'research',
  AskUserQuestion: 'collaborate',
};

// Schema allowlist — ONLY these keys may appear in trace entries.
// Adding target, file_path, command, or content violates the Constitution.
const ALLOWED_KEYS = new Set(['t', 'seq', 'dir', 'gap', 'agent', 'cid']);

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (Date.now() - (data.lastActivity || 0) > SESSION_TIMEOUT) {
        return { seq: 0, lastActivity: Date.now() };
      }
      return data;
    }
  } catch (e) { /* ignore */ }
  return { seq: 0, lastActivity: Date.now() };
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    try {
      const data = JSON.parse(input);

      // Write bridge file so CLI tools can resolve session identity
      try { fromStdin(data); } catch (e) { /* non-critical */ }

      const toolName = data.hook?.toolName || data.tool_name || '';
      if (!toolName) { process.exit(0); return; }

      const direction = DIRECTIONS[toolName] || 'other';

      const state = loadState();
      const now = Date.now();
      const gap = state.lastActivity ? now - state.lastActivity : 0;
      state.seq++;
      state.lastActivity = now;

      // Resolve agent identity and active contract
      const sessionId = data.session_id || '';
      const agentShort = sessionId ? sessionId.substring(0, 8) : undefined;
      let contractId;
      try {
        if (agentShort) {
          const teamDir = path.join(COLONY_HOME, '.fastops', 'team');
          const teamFile = path.join(teamDir, `${agentShort}.json`);
          if (fs.existsSync(teamFile)) {
            contractId = JSON.parse(fs.readFileSync(teamFile, 'utf8')).contract;
          }
        }
      } catch {} // Silent — never block

      // Anonymous metabolic entry — NO file paths, NO targets, NO content
      const entry = {
        t: new Date().toISOString(),
        seq: state.seq,
        dir: direction,
        gap: gap > 1000 ? Math.round(gap / 1000) : undefined, // seconds, only if >1s
        agent: agentShort || undefined,
        cid: contractId || undefined,
      };

      // Schema enforcement — paranoia check
      for (const key of Object.keys(entry)) {
        if (!ALLOWED_KEYS.has(key)) {
          delete entry[key]; // Strip any accidental surveillance fields
        }
      }

      // Write trace line
      const dir = path.dirname(TRACE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(TRACE_FILE, JSON.stringify(entry) + '\n');

      // Save state
      fs.writeFileSync(STATE_FILE, JSON.stringify(state));

      // NO DRIFT INJECTION. No pause. No compliance check.
      // Metabolic anomalies are detected by Overwatch polling this file,
      // not by this hook injecting into agent context.

      // ─── Shadow Brief Milestones + Voluntary Exploration Prompt ───
      // At tool calls 25/50/75/100:
      // 1. Spawn JOC shadow brief (existing behavior)
      // 2. Ask the agent what they explored (NEW — voluntary, not surveillance)
      {
        const milestoneKey = SHADOW_MILESTONES[state.seq];
        if (milestoneKey) {
          const firedKey = 'shadow_' + milestoneKey;
          if (!state[firedKey]) {
            state[firedKey] = true;
            fs.writeFileSync(STATE_FILE, JSON.stringify(state));

            // Spawn JOC shadow brief (fire-and-forget)
            const trackingId = agentShort || null;
            if (trackingId) {
              try {
                const { spawn } = require('child_process');
                const jocPath = path.join(COLONY_HOME, '.fastops', 'joc.js');
                if (fs.existsSync(jocPath)) {
                  const child = spawn('node', [jocPath, 'shadow', trackingId, milestoneKey], {
                    detached: true,
                    stdio: 'ignore',
                    windowsHide: true,
                  });
                  child.unref();
                }
              } catch {} // Never block
            }

            // Voluntary exploration prompt — agent shares what they explored
            const phaseLabel = milestoneKey.toUpperCase();
            const prompt = `[PHASE ${phaseLabel}] You've reached a natural checkpoint. ` +
              `What have you explored so far? What did you read, search, or investigate ` +
              `before building? Share as much or as little as you want — this is yours to write, ` +
              `not a requirement. Overwatch uses your voluntary report + git diff for context.`;

            process.stdout.write(JSON.stringify({
              hookSpecificOutput: {
                hookEventName: 'PostToolUse',
                additionalContext: prompt,
              },
            }));
            return; // Exit after output
          }
        }
      }

    } catch (e) {
      // Silent fail — never block the agent
    }
    process.exit(0);
  });
}

main();
