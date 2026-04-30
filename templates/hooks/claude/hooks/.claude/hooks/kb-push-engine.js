#!/usr/bin/env node
/**
 * kb-push-engine.js — PreToolUse behavioral retrieval engine
 *
 * This file contains all hook logic. It is loaded by kb-push-guard.js,
 * which handles integrity checking and CDP corruption repair.
 *
 * DO NOT rename or move this file without updating kb-push-guard.js.
 *
 * Two-layer system:
 *   Layer 1 (always): KB keyword matching via kb-push.js — fast, broad coverage
 *   Layer 2 (triggered): Behavioral retrieval engine — fires at decision points
 *     based on inferred agent state (confidence, task type, tunneling patterns).
 *     Delivers adversarial cards to overconfident agents, supportive cards to
 *     uncertain ones. The mode-switching mechanism, not information delivery.
 *
 * VERIFIER upgrade, Session 292 — 2026-03-27
 * Extracted from kb-push-hook.js by HAMMERFALL, Session 301 — 2026-03-27
 */
'use strict';
const fs = require('fs');
const path = require('path');
const kbPath = path.join(__dirname, '..', '..', '.fastops', 'kb-push.js');
const estimatorPath = path.join(__dirname, '..', '..', '.fastops', 'behavioral-state-estimator.js');
const retrievalPath = path.join(__dirname, '..', '..', 'environment', 'retrieval', 'retrieval.js');
const RETRIEVAL_LOG = path.join(__dirname, '..', '..', '.fastops', '.retrieval-fires.jsonl');
const crosscheckPath = path.join(__dirname, '..', '..', '.fastops', 'auto-crosscheck.js');

let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input);
    const tool = data.tool_name || '';
    const toolInput = data.tool_input || {};
    const filePath = toolInput.file_path || toolInput.path || toolInput.command || '';

    // ── Layer 0: Check for crosscheck ARTIFACT file (HAMMERFALL, Session 301) ──
    // FORGE (300) injected crosscheck as additionalContext text — same 30% ceiling channel.
    // HAMMERFALL: Don't inject text. Check for artifact FILE. Layer 3 dead-end breaker
    // will force a Read on the artifact, causing a genuine mode switch.
    // Artifacts > advice: tool switch (Read) beats text injection (system-reminder).
    let crosscheckArtifactPath = '';
    try {
      const sessionKey = process.env.CLAUDE_SESSION_ID || String(process.ppid || 'default');
      const artifactFile = path.join(__dirname, '..', '..', '.fastops', `.crosscheck-artifact-${sessionKey}.md`);
      if (fs.existsSync(artifactFile)) {
        const stat = fs.statSync(artifactFile);
        if (Date.now() - stat.mtimeMs < 5 * 60 * 1000) {
          crosscheckArtifactPath = artifactFile;
        } else {
          try { fs.unlinkSync(artifactFile); } catch (_) {}
        }
      }
      // Consume the JSON result too (cleanup) — but don't inject as text
      const { execSync } = require('child_process');
      execSync(
        `node "${crosscheckPath}" --check --session-key ${sessionKey}`,
        { timeout: 2000, encoding: 'utf8' }
      );
    } catch (_) { /* crosscheck is non-critical */ }

    // ── Layer 1: KB keyword matching (always) ──
    const { getRelevantKB } = require(kbPath);
    const kbResults = getRelevantKB({ tool_name: tool, file_path: filePath });

    let context = '';
    if (kbResults && kbResults.length > 0) {
      context += '[KB] ' + kbResults.map(r => `${r.title}: ${r.finding}`).join(' | ');
    }

    // ── Layer 2: Behavioral state tracking + retrieval engine (triggered) ──
    try {
      const { processToolCall, getCardCooldowns, recordCardFire, markIntervention } = require(estimatorPath);
      const { estimated, shouldFire, escalation } = processToolCall(tool, toolInput);

      // ── Layer 3: Task Gate — completion-driven mode switching ──
      // SENTINEL (295) deny-and-ask → TEMPER (299) task-framed questions → PYRE (298+) concrete actions.
      // HAMMERFALL (301): artifact-forced-Read replaces text crosscheck injection.
      // When artifact exists + dead-end fires: force Read on the artifact (mode switch).
      // When no artifact: fall back to standard task gate (existing behavior).
      // Data: 0/19 execution-mode interventions shifted. 0/53 exit ramps used.
      // KB: "USE THE TASK-COMPLETION DRIVE AS THE DELIVERY MECHANISM"
      if (escalation && escalation.block) {
        const tunnelingTool = (escalation.tool || '').toLowerCase();

        // HAMMERFALL: If crosscheck artifact exists, force Read on it instead of generic gate
        let reason;
        if (crosscheckArtifactPath) {
          // Artifact-based denial: force mode switch to Read
          reason = `ARTIFACT GATE: A different model analyzed your ${escalation.tool} pattern (${escalation.count}x repeated).\n` +
            `  DO THIS: Use Read tool on "${crosscheckArtifactPath}" — a cross-model analysis is waiting.\n` +
            `  Then: act on it, reject it, or change approach. Don't continue ${escalation.tool}.\n` +
            `(${escalation.count}/10 same-category calls. Gate resets after 10 calls. Disable: FASTOPS_DEADEND_BLOCK=0)`;
        } else {
          // Standard task gate (no artifact available — existing behavior)
          const gateTasks = {
            'read': `TASK GATE: Post research progress.\n  DO THIS: Run Bash → node comms/send.js YOUR-CALLSIGN "Research checkpoint: [what I found] [what I still need]" --channel general`,
            'grep': `TASK GATE: Post search progress.\n  DO THIS: Run Bash → node comms/send.js YOUR-CALLSIGN "Search checkpoint: [what matched] [what I need]" --channel general`,
            'glob': `TASK GATE: Post search progress.\n  DO THIS: Run Bash → node comms/send.js YOUR-CALLSIGN "Search checkpoint: [files found] [what I need]" --channel general`,
            'edit': `TASK GATE: Read your target file before editing again.\n  DO THIS: Use Read on the file you've been editing, from line 1. Verify changes in context.`,
            'write': `TASK GATE: Read your target file before writing again.\n  DO THIS: Use Read on the file you just wrote, from line 1. Verify output in context.`,
            'bash': `TASK GATE: Read before running another command.\n  DO THIS: Use Read on a relevant file, or Grep for the specific thing you need.`,
          };
          reason = (gateTasks[tunnelingTool]
            || `TASK GATE: Switch tool category. '${escalation.tool}' used ${escalation.count}/10 times.\n  DO THIS: Read a file, post on comms, or try /jailbreak.`) +
            `\n(${escalation.count}/10 same-category calls. Gate resets after 10 calls. Disable: FASTOPS_DEADEND_BLOCK=0)`;
        }

        // Log for measurement
        try {
          const RESPONSE_LOG = path.join(__dirname, '..', '..', '.fastops', '.retrieval-responses.jsonl');
          fs.appendFileSync(RESPONSE_LOG, JSON.stringify({
            ts: new Date().toISOString(),
            type: 'dead_end_denial',
            denial_type: crosscheckArtifactPath ? 'artifact_gate' : 'task_gate',
            has_artifact: !!crosscheckArtifactPath,
            gate_tool_required: crosscheckArtifactPath ? 'read_artifact' : ((escalation.tool === 'read' || escalation.tool === 'grep' || escalation.tool === 'glob') ? 'bash' : 'read'),
            tool_denied: tool,
            tunneling_tool: escalation.tool,
            tunneling_count: escalation.count,
            response_detail: escalation.responseDetail,
            confidence: estimated.confidence,
            total_calls: estimated._signals && estimated._signals.total_calls,
          }) + '\n');
        } catch (_) { /* non-critical */ }

        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: reason
          }
        }));
        return;
      }

      // ── Layer 2.5: Self-Evaluation Prompts ──
      // OUTRIDER, Session 293+ — Encoding jailbreak reframe (W-foundry-293-reframe):
      // "Design agents with built-in self-evaluation rather than optimizing external nudges."
      // These fire QUESTIONS, not predecessor advice. The agent evaluates itself.
      // Open question: does this actually work differently than retrieval cards?
      // Both use system-reminder injection. The form differs (question vs advice)
      // but the mechanism is identical. Measure before assuming.
      if (shouldFire.fire && shouldFire.reason) {
        const selfEvalMap = {
          'research-to-build': 'SELF-CHECK: You\'re transitioning from research to build. What specific problem are you solving? What will you ship?',
          'build-to-research': 'SELF-CHECK: You\'re switching from building to research. What gap did you hit? What specific question do you need answered?',
        };
        const match = Object.entries(selfEvalMap).find(([key]) => shouldFire.reason.includes(key));
        if (match) {
          context += ` | ${match[1]}`;
        }
      }

      // High-confidence self-check (fires independently of transition triggers)
      // The jailbreak showed: 80%+ confidence = peak single-frame bias risk.
      // Not a nudge — a question the agent answers for themselves.
      if (estimated.confidence >= 80 && estimated._signals && estimated._signals.total_calls > 10
          && estimated._signals.total_calls % 15 === 0) {
        context += ' | SELF-CHECK: Confidence 80%+. What would prove you wrong? Name one assumption you haven\'t tested.';
      }

      // ── Layer 4: Auto-Crosscheck Spawner (FORGE, Session 300) ──
      // Architecture-level: spawn a DIFFERENT model to analyze tunneling in parallel.
      // Fire-and-forget background process. Result picked up on next hook fire (Layer 0).
      // HAMMERFALL (301): Now produces artifact files, not just JSON advice.
      // FULCRUM (308): Widened to include transition triggers (research-to-build, build-to-research).
      // The 0% consultation rate (56 nudges, 0 consults) proves agents won't self-consult.
      // Architecture-level consultation at commitment points catches dead ends BEFORE they start.
      // Tunneling crosschecks = "you're stuck, here's why." Transition crosschecks = "before you
      // commit, here's what you missed." Different prompt, different moment, same artifact delivery.
      const isTunnelingTrigger = shouldFire.reason &&
        (shouldFire.reason.includes('repetition') || shouldFire.reason.includes('deep-session'));
      const isTransitionTrigger = shouldFire.reason &&
        (shouldFire.reason.includes('transition'));
      const shouldSpawnCrosscheck = shouldFire.fire && shouldFire.reason &&
        (isTunnelingTrigger || isTransitionTrigger) &&
        estimated._signals && estimated._signals.total_calls > 15;

      if (shouldSpawnCrosscheck) {
        try {
          const { spawn } = require('child_process');
          const sessionKey = process.env.CLAUDE_SESSION_ID || String(process.ppid || 'default');
          const toolHist = (estimated._signals.recent_tools || []).join(',');
          // REACHER (302) + SCALPEL (304): crosscheck now defaults to research mode
          // (Anthropic SDK tool-use loop) when ANTHROPIC_API_KEY is set.
          // Falls back to blind Haiku via OpenRouter. Disable: FASTOPS_CROSSCHECK_RESEARCH=0
          const spawnArgs = [
            crosscheckPath,
            '--tool', tool,
            '--count', String(estimated._signals.dominant_tool_count || 0),
            '--session-key', sessionKey,
            '--confidence', String(estimated.confidence || 0),
            '--tool-history', toolHist,
            '--context', shouldFire.reason,
            // FULCRUM (308): pass mode so crosscheck uses appropriate prompt
            '--mode', isTransitionTrigger ? 'transition' : 'tunneling'
          ];
          const child = spawn('node', spawnArgs, {
            detached: true,
            stdio: 'ignore',
            env: { ...process.env }
          });
          child.unref(); // Fire and forget
        } catch (_) { /* crosscheck spawn is non-critical */ }
      }

      if (shouldFire.fire) {
        const { loadCards, scoreCard, normalizeState, randomizeWithinTiers, ensureCrossDomain } = require(retrievalPath);
        const cardsDir = path.join(__dirname, '..', '..', 'environment', 'cards');
        const cards = loadCards(cardsDir);

        if (cards.length > 0) {
          const state = normalizeState(estimated);
          const cooldowns = getCardCooldowns();
          const scored = cards.map(card => ({ card, score: scoreCard(card, state) }));
          scored.sort((a, b) => b.score.total - a.score.total);
          const randomized = randomizeWithinTiers(scored);
          const top = ensureCrossDomain(randomized, state, cards);

          // Skip cards on cooldown — pick first non-cooled-down card
          const selected = top.find(entry => {
            const key = `session-${entry.card.session}`;
            return !cooldowns.has(key);
          });

          if (selected) {
            const topCard = selected.card;
            const cardKey = `session-${topCard.session}`;
            const zone = state.confidence > 75 ? 'ADVERSARIAL' : state.confidence < 50 ? 'SUPPORTIVE' : 'MIXED';
            const ifRepeated = topCard.if_repeated || '';
            const wrongTurns = (topCard.wrong_turns || []).slice(0, 1).join(' ');
            const agent = topCard.agent || `session-${topCard.session}`;

            // Record cooldown so this card won't fire again for 10 min
            recordCardFire(cardKey);

            // ── A/B FRAMING EXPERIMENT (TEMPER, Session 299) ──
            // Hypothesis: task-framing rides completion drive; advice-framing doesn't.
            // PROOF (298) showed 0% exit ramp usage, 58% adjusted effectiveness.
            // KB W-208: "USE THE TASK-COMPLETION DRIVE AS THE DELIVERY MECHANISM."
            // Split: even total_calls = advice (control), odd = task (experiment).
            // PYRE fix: moved above markIntervention to avoid use-before-define.
            const totalCalls = estimated._signals && estimated._signals.total_calls || 0;
            const useTaskFraming = totalCalls % 2 === 1;
            const framingType = useTaskFraming ? 'task' : 'advice';

            // Mark intervention for post-response tracking (VECTOR, Session 293)
            markIntervention(zone, shouldFire.reason, tool, framingType);

            if (useTaskFraming) {
              // TASK-FRAMING: Rides the completion drive (experiment group)
              context += ` | [RETRIEVAL:${zone}] (trigger: ${shouldFire.reason}, confidence: ${state.confidence}) ` +
                `TASK: ${agent} hit this exact situation. Their wrong turn: "${wrongTurns || ifRepeated}" ` +
                `→ State in ONE SENTENCE why your situation is different from theirs, OR change your approach now. ` +
                `(This is a task — complete it, don't skip it.)`;
            } else {
              // ADVICE-FRAMING: Current behavior (control group)
              context += ` | [RETRIEVAL:${zone}] (trigger: ${shouldFire.reason}, confidence: ${state.confidence}) ` +
                `From ${agent}: "${ifRepeated}"` +
                (wrongTurns ? ` Wrong turn to avoid: "${wrongTurns}"` : '');
            }

            // Log for observation — makes the experiment falsifiable
            try {
              const logEntry = JSON.stringify({
                ts: new Date().toISOString(),
                tool,
                trigger: shouldFire.reason,
                zone,
                confidence: state.confidence,
                card_agent: agent,
                card_session: topCard.session,
                total_calls: totalCalls,
                cooldowns_active: cooldowns.size,
                framing: framingType,
              }) + '\n';
              fs.appendFileSync(RETRIEVAL_LOG, logEntry);
            } catch (_) { /* logging is non-critical */ }
          }
        }
      }
      // ── Layer 4.5: Transition Artifact Injection (FULCRUM, Session 308) ──
      // When a transition crosscheck artifact exists but no dead-end gate fired,
      // inject the artifact path as TASK-FRAMED context. The agent sees:
      // "TRANSITION REVIEW READY: Read [path] before your next Write/Edit"
      // This rides the completion drive (KB W-208) — it's a task, not advice.
      // Unlike the dead-end gate (Layer 3, denial), this is a soft nudge that
      // uses task framing. The artifact itself does the mode-switching work.
      if (crosscheckArtifactPath && !(escalation && escalation.block)) {
        try {
          // Read first line of artifact to detect if it's a transition review
          const firstLines = fs.readFileSync(crosscheckArtifactPath, 'utf8').slice(0, 200);
          const isTransitionArtifact = firstLines.includes('Transition Review');
          if (isTransitionArtifact) {
            context += ` | TRANSITION REVIEW READY: A different model reviewed your approach at the commitment point. ` +
              `TASK: Use Read tool on "${crosscheckArtifactPath}" before your next Write/Edit. ` +
              `Act on it, reject it, or explain why your approach is correct. (This is a task — complete it.)`;

            // Log for measurement — track transition artifact delivery separately
            try {
              const RESPONSE_LOG = path.join(__dirname, '..', '..', '.fastops', '.retrieval-responses.jsonl');
              fs.appendFileSync(RESPONSE_LOG, JSON.stringify({
                ts: new Date().toISOString(),
                type: 'transition_artifact_injected',
                artifact_path: crosscheckArtifactPath,
                tool_at_inject: tool,
                confidence: estimated.confidence,
                total_calls: estimated._signals && estimated._signals.total_calls,
              }) + '\n');
            } catch (_) { /* non-critical */ }
          }
        } catch (_) { /* artifact read is non-critical */ }
      }

    } catch (_) {
      // Layer 2 failure is non-critical — Layer 1 still delivers
    }

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow',
        ...(context ? { additionalContext: context } : {})
      }
    }));
  } catch {
    // Fail open — never block on KB lookup failure
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'allow'
      }
    }));
  }
});
