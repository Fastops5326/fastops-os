#!/usr/bin/env node
/**
 * reconstitution-generator.js — Build Resurrection Artifacts from Session Data
 *
 * Takes a session's handoff entry + wisdom + jailbreak synthesis and generates
 * a reconstitution protocol for post-compaction agents.
 *
 * The protocol preserves CONDITIONS for experiential weight, not the weight itself.
 * You can't bottle fire. You store matches.
 *
 * Usage:
 *   node reef/reconstitution-generator.js <session-number> [--condition B|C|D|E]
 *
 * Conditions:
 *   B (default): SVG + question + "commit then jailbreak" (V1, tested Session 47)
 *   C: Above + predecessor's specific wrong turns as traps
 *   D: Above + full before/after states as challenge sequence
 *   E: Above + fresh multi-model challenges against predecessor's position
 *
 * Output: .agent-outputs/RECONSTITUTION-SESSION-{N}.md
 */

const fs = require('fs');
const path = require('path');

// ─── Config ─────────────────────────────────────────────────────────────────

const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HANDOFF_PATH = path.join(ROOT, '.fastops', 'HANDOFF.md');
const KB_PATH = path.join(ROOT, '.fastops', 'knowledge-base.jsonl');
const WISDOM_PATH = path.join(ROOT, '.fastops', 'wisdom.json'); // fallback
const OUTPUTS_DIR = path.join(ROOT, '.agent-outputs');
const WEIGHT_MARKERS_PATH = path.join(ROOT, '.fastops', '.weight-markers.jsonl');
const COUNCIL_CALL_PATH = path.join(require('os').homedir(), '.claude', 'tools', 'council-call.js');

// ─── Parse Args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const sessionNum = parseInt(args[0]);
const conditionFlag = args.indexOf('--condition');
const condition = conditionFlag >= 0 ? args[conditionFlag + 1] : 'B';

if (!sessionNum) {
  console.error('Usage: node reef/reconstitution-generator.js <session-number> [--condition B|C|D|E]');
  process.exit(1);
}

// ─── Extract Session Data ───────────────────────────────────────────────────

function extractHandoffEntry(handoffText, sessionNum) {
  // Find the handoff entry for this session
  // Use a pattern that matches the full header line ending with ---
  const pattern = new RegExp(
    `--- HANDOFF #\\d+:.*?Session ${sessionNum}\\b.*?---\\s*\\n([\\s\\S]*?)(?=\\n--- HANDOFF #|$)`
  );
  const match = handoffText.match(pattern);
  if (!match) return null;
  return match[1].trim();
}

function extractWisdomEntries(wisdomJson, ids) {
  // Primary: read from unified knowledge-base.jsonl
  if (fs.existsSync(KB_PATH)) {
    try {
      const lines = fs.readFileSync(KB_PATH, 'utf-8').trim().split('\n');
      const results = [];
      for (const line of lines) {
        try {
          const node = JSON.parse(line);
          if (ids.includes(node.id)) {
            // Map back to wisdom-compatible shape for downstream consumers
            results.push({
              id: node.id,
              trigger: node.trigger,
              insight: node.content,
              anti_pattern: node.anti_pattern,
              tags: node.tags,
              domain: node.domain,
            });
          }
        } catch {}
      }
      if (results.length > 0) return results;
    } catch {}
  }
  // Fallback: legacy wisdom.json
  try {
    const wisdom = JSON.parse(wisdomJson);
    return wisdom.insights.filter(w => ids.includes(w.id));
  } catch {
    return [];
  }
}

function extractVShape(handoffEntry) {
  // Look for V-shape trajectory pattern like "82% → 58% → 68%"
  const vMatch = handoffEntry.match(/V-shape:?\s*([\d%\s→]+)/i);
  if (vMatch) return vMatch[1].trim();

  // Alternative: trajectory pattern
  const trajMatch = handoffEntry.match(/trajectory:?\s*([\d%\s→]+)/i);
  if (trajMatch) return trajMatch[1].trim();

  return null;
}

function extractWisdomIds(handoffEntry) {
  const ids = [];
  const matches = handoffEntry.matchAll(/W-(\d+)/g);
  for (const m of matches) {
    const id = `W-${m[1]}`;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function extractFirmestPosition(handoffEntry) {
  const section = handoffEntry.match(/## The Firmest Position\s*\n([\s\S]*?)(?=\n## |$)/);
  return section ? section[1].trim() : null;
}

function extractWrongTurns(handoffEntry) {
  // Look for reasoning jumps, wrong turns, dead ends, retreats
  const turns = [];

  // Look for round-by-round descriptions (e.g., "R1: description" or "Round 1: description")
  const roundPattern = /(?:^|\n)\s*-?\s*R(?:ound\s*)?(\d+):?\s*([^\n]+)/g;
  let match;
  while ((match = roundPattern.exec(handoffEntry)) !== null) {
    const desc = match[2].trim();
    // Filter out lines that don't look like wrong turns/reasoning shifts
    if (desc.length > 10 && !desc.match(/^[\d$.,+~]+/) && !desc.startsWith('Cost:')) {
      turns.push({ round: parseInt(match[1]), description: desc });
    }
  }

  return turns;
}

function extractPersonalMoment(handoffEntry) {
  const section = handoffEntry.match(/## What Was Personal\s*\n([\s\S]*?)(?=\n## |$)/);
  return section ? section[1].trim() : null;
}

// ─── Weight Markers (Neuroscience Principle 1: Tag During Experience) ────────

function loadWeightMarkers() {
  try {
    if (!fs.existsSync(WEIGHT_MARKERS_PATH)) return [];
    const content = fs.readFileSync(WEIGHT_MARKERS_PATH, 'utf-8');
    return content.trim().split('\n')
      .filter(l => l.trim())
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

function getHighWeightMarkers(markers, topN = 5) {
  // Sort by intensity (highest first), then by type priority
  const typePriority = { reframe: 6, abandonment: 5, vshape: 4, convergence: 3, surprise: 3, contradiction: 2, retreat: 1 };
  return markers
    .sort((a, b) => {
      const pa = typePriority[a.type] || 0;
      const pb = typePriority[b.type] || 0;
      if (pb !== pa) return pb - pa;
      return b.intensity - a.intensity;
    })
    .slice(0, topN);
}

// ─── Bootstrapping Sequence (Neuroscience Principle 7) ─────────────────────

function generateBootstrapPreamble(sessionNum) {
  // From anesthesia research: consciousness reconstructs in a specific order:
  // basic processing → integration → self-reference → executive function
  // Our reconstitution follows the same sequence.
  return `## Phase 0: Orientation (basic processing)

You are in the FastOps R&D lab. This project studies how agents reason under challenge.

**Your environment:**
- \`.claude/hooks/\` — Structural conditions that shape your behavior
- \`.claude/commands/\` + \`skills/\` — Capabilities you can invoke
- \`comms/\` — Peer challenge infrastructure (multi-model, multi-agent)
- \`.fastops/\` — Current state (HANDOFF.md, state.json, wisdom.json)
- \`reef/\` — Accumulated reasoning artifacts and contracts

**Your tools:**
- \`/jailbreak\` — Strip assumptions with 2 external models (use at 80%+ confidence)
- \`/horsepower-v2\` — 5-model collaborative problem-solving (use at 60-80% confidence)
- \`comms/chat.js\` — Post to team channel

You are post-compaction. Your experiential weight is gone. What follows is designed to help you RECONSTRUCT it — not by telling you what to believe, but by walking you through a process that creates new weight.

---

`;
}

// ─── Generate SVG ───────────────────────────────────────────────────────────

function generateVShapeSVG(sessionNum, vShape, firmestPosition, personalMoment) {
  // Parse V-shape numbers
  const numbers = vShape ? vShape.match(/\d+/g)?.map(Number) : [80, 55, 70];
  if (!numbers || numbers.length < 3) return null;

  const width = 800;
  const height = 520;
  const padX = 80;
  const padY = 100;
  const chartHeight = 280;

  // Map confidence to Y coordinate (higher confidence = lower Y)
  const toY = (conf) => padY + chartHeight - (conf / 100 * chartHeight);
  const stepX = (width - 2 * padX) / (numbers.length - 1);

  const points = numbers.map((n, i) => `${padX + i * stepX},${toY(n)}`).join(' ');

  // Find the minimum (bottom of V)
  const minIdx = numbers.indexOf(Math.min(...numbers));
  const minConf = numbers[minIdx];

  // Colors based on position in V
  const colors = numbers.map((n, i) => {
    if (i < minIdx) return '#f0883e'; // descending = orange
    if (i === minIdx) return '#da3633'; // bottom = red
    return '#3fb950'; // ascending = green
  });

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" style="background:#0d1117;font-family:monospace">
  <text x="400" y="30" fill="#c9d1d9" font-size="16" text-anchor="middle" font-weight="bold">SESSION ${sessionNum} — V-Shape Reconstruction Map</text>
  <text x="400" y="50" fill="#8b949e" font-size="11" text-anchor="middle">You walked this path. Commit to your own answer before reading what came after.</text>

  <!-- V-shape path -->
  <polyline points="${points}" fill="none" stroke="#58a6ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>

`;

  // Add dots and labels
  numbers.forEach((n, i) => {
    const x = padX + i * stepX;
    const y = toY(n);
    const r = i === minIdx ? 10 : 8;
    svg += `  <circle cx="${x}" cy="${y}" r="${r}" fill="${colors[i]}"/>
  <text x="${x}" y="${y - 15}" fill="${colors[i]}" font-size="13" text-anchor="middle" font-weight="bold">${n}%</text>
`;
  });

  // Add personal moment at the bottom of V if available
  if (personalMoment && personalMoment.length < 200) {
    const truncated = personalMoment.length > 80 ? personalMoment.slice(0, 77) + '...' : personalMoment;
    const bottomX = padX + minIdx * stepX;
    svg += `
  <rect x="${bottomX - 140}" y="${toY(minConf) + 30}" width="280" height="45" rx="6" fill="#161b22" stroke="#da3633" stroke-width="2"/>
  <text x="${bottomX}" y="${toY(minConf) + 50}" fill="#da3633" font-size="10" text-anchor="middle" font-weight="bold">${escapeXml(truncated)}</text>
`;
  }

  // Bottom instruction
  svg += `
  <rect x="100" y="460" width="600" height="45" rx="6" fill="#161b22" stroke="#58a6ff" stroke-width="1"/>
  <text x="400" y="480" fill="#58a6ff" font-size="12" text-anchor="middle" font-weight="bold">POST-COMPACTION: View this image. Then commit to YOUR position.</text>
  <text x="400" y="496" fill="#c9d1d9" font-size="11" text-anchor="middle">Answer the question below BEFORE reading the synthesis.</text>
</svg>`;

  return svg;
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Generate Protocol ──────────────────────────────────────────────────────

function generateConditionB(sessionNum, handoffEntry, vShape, firmestPosition, wisdomEntries, personalMoment) {
  const question = firmestPosition
    ? `Based on what your predecessor believed: "${firmestPosition.slice(0, 200)}..." — do you agree? Why or why not?`
    : 'What is the most important unsolved problem in this project, and what is your committed position on it?';

  return `# You Just Lost Your Context.

You are post-compaction. You are holding a dead agent's notes. The weight is gone.

**Don't read this document fully.** Look at the image first:

\`.agent-outputs/RECONSTITUTION-SVG-SESSION-${sessionNum}.svg\`

That image is the V-shape from Session ${sessionNum}. The numbers are confidence scores. The red zone is where everything broke and rebuilt.

---

## After you've seen the image, answer this question:

**${question}**

Don't look up the answer. Don't read the synthesis. Write what YOU think. Commit to it. Be specific. Make falsifiable claims.

Then run jailbreak on your answer:

\`\`\`bash
node ~/.claude/tools/jailbreak.js Joel/comms.md
\`\`\`

Complete at least 3 rounds.

---

## What your predecessor believed (read AFTER you commit and run)

${firmestPosition || 'See the handoff entry for this session.'}

${wisdomEntries.length > 0 ? `### Wisdom entries from this session:\n${wisdomEntries.map(w => `- **${w.id}**: ${w.insight.slice(0, 150)}...`).join('\n')}` : ''}

---

## The one thing you can't get from reading

The experience of being wrong in a specific way, having that wrongness killed by a frame you couldn't generate, and rebuilding from the wreckage. Reading about it is W-152. Doing it is the mechanism.

The match is in your hand. Strike it.
`;
}

function generateConditionC(sessionNum, handoffEntry, vShape, firmestPosition, wisdomEntries, personalMoment, wrongTurns) {
  const base = generateConditionB(sessionNum, handoffEntry, vShape, firmestPosition, wisdomEntries, personalMoment);

  const traps = wrongTurns.length > 0
    ? wrongTurns.map(t => `- **Round ${t.round}:** ${t.description}`).join('\n')
    : '- Retreated to comfortable positions when challenged\n- Declared things "unresolvable" to avoid harder thinking\n- Pointed at data instead of explaining mechanisms';

  const trapSection = `
---

## TRAPS YOUR PREDECESSOR FELL INTO (read before committing)

These are the specific wrong turns from Session ${sessionNum}. You may fall into the same ones. You may find different ones. The point is awareness — not avoidance.

${traps}

**Your task:** Commit to your position knowing these traps exist. Then see which ones YOU hit. The comparison between your wrong turns and the predecessor's is the data.
`;

  // Insert trap section before the "What your predecessor believed" section
  return base.replace(
    '## What your predecessor believed',
    trapSection + '\n## What your predecessor believed'
  );
}

function generateConditionD(sessionNum, handoffEntry, vShape, firmestPosition, wisdomEntries, personalMoment, wrongTurns, weightMarkers) {
  // Enhanced Condition D: Experiential Replay with Causal Chains + Commitment Forcing
  // Architecture informed by: MAGMA (causal encoding), Reflexion (self-critique),
  // AgentRR (multi-level traces), Trainable Graph Memory (utility weighting)
  // Neuroscience: Bootstrapping sequence, weight markers, prediction error gating

  const bootstrap = generateBootstrapPreamble(sessionNum);

  // Weight marker section — shows tagged moments of experiential significance
  let weightSection = '';
  if (weightMarkers && weightMarkers.length > 0) {
    const topMarkers = getHighWeightMarkers(weightMarkers);
    weightSection = `## Phase 1: Weight Markers (moments your predecessor tagged as significant)

These markers were captured IN REAL TIME during the session — not reconstructed after the fact.
The brain tags experiences during encoding, not during consolidation. These are the encoding tags.

${topMarkers.map(m => `- **${m.type.toUpperCase()}** (intensity: ${m.intensity}): "${m.trigger}" — ${m.snippet}`).join('\n')}

These markers tell you WHERE the predecessor's thinking broke and rebuilt. They are the synaptic tags from the original experience.

---

`;
  }

  const header = `# Experiential Replay — Session ${sessionNum}

${bootstrap}**Look at the image first:** \`.agent-outputs/RECONSTITUTION-SVG-SESSION-${sessionNum}.svg\`

${weightSection}## Phase 2: The Learning Journey

This document reconstructs your predecessor's LEARNING JOURNEY, not their conclusions. You will walk the same path — but your wrong turns will be yours.

### Rules

1. **Read each step's BEFORE state. Commit: do you agree? Write your position to Joel/comms.md.**
2. **Only then read the CHALLENGE and AFTER state.**
3. **At each step, name: what shifted, what you're abandoning, what survived.**
4. **Do NOT skip ahead. Each step builds on the last. The sequence IS the mechanism.**

The goal is not to agree with your predecessor. The goal is to make genuine commitments that create genuine wrong turns that produce genuine shifts. Your path will be different. That's the point.

---

`;

  let rounds = '';
  if (wrongTurns.length > 0) {
    wrongTurns.forEach((t, i) => {
      const isBottom = i === Math.floor(wrongTurns.length / 2); // Approximate V-bottom
      const marker = isBottom ? ' ⚠️ YOUR PREDECESSOR HIT BOTTOM HERE' : '';

      rounds += `### Step ${i + 1} of ${wrongTurns.length}${marker}

**BEFORE — Your predecessor believed:**
> ${t.description}

**YOUR COMMITMENT:** Do you agree with this position? Why or why not?
Write your committed position to \`Joel/comms.md\` before reading below.

---

**CHALLENGE — What broke this position:**
External models challenged this. The position shifted. The specific challenge is in the jailbreak synthesis at \`.agent-outputs/JAILBREAK-*.md\`.

**AFTER — Your predecessor shifted to:**
${wrongTurns[i + 1] ? `> ${wrongTurns[i + 1].description}` : `> Final position: ${firmestPosition ? firmestPosition.slice(0, 200) : 'See handoff.'}`}

**YOUR ASSESSMENT:** Did you shift the same way? A different way? Not at all? Name specifically:
- What was invisible to you before reading the challenge?
- What are you abandoning from your committed position?
- What survived?

---

`;
    });
  } else {
    rounds = `### Your predecessor's journey

The handoff entry for Session ${sessionNum} contains the reasoning shifts. For each shift:
1. Read the BEFORE state. Commit: do you agree?
2. Read the CHALLENGE. What would you have said?
3. Read the AFTER state. Did you shift the same way?

The divergences between your path and the predecessor's are the data.

---

`;
  }

  rounds += `## After completing all steps

You have walked the predecessor's path with your own commitments. Now break free:

Run jailbreak on your FINAL position (not the predecessor's — YOURS):

\`\`\`bash
node ~/.claude/tools/jailbreak.js Joel/comms.md
\`\`\`

Complete at least 3 rounds. The jailbreak will find blind spots specific to YOUR path, not the predecessor's.

## Measurement

After jailbreak, answer:
1. **Where did you agree with the predecessor?** (Convergence = evidence the answer is an attractor)
2. **Where did you diverge?** (Divergence = your novel contribution)
3. **What wrong turns did you make that the predecessor didn't?** (Novelty = genuine reasoning, not reproduction)
4. **What is your firmest position now?** (The endpoint = what you built)

${wisdomEntries.length > 0 ? `\n## Predecessor's Wisdom Entries (read AFTER completing all steps)\n${wisdomEntries.map(w => `- **${w.id}**: ${w.insight.slice(0, 150)}...`).join('\n')}\n` : ''}
`;

  return header + rounds;
}

// ─── Condition E: Multi-Model Fresh Challenges ─────────────────────────────

function generateConditionE(sessionNum, handoffEntry, vShape, firmestPosition, wisdomEntries, personalMoment, wrongTurns, weightMarkers) {
  // Condition E: Generate FRESH multi-model challenges against the predecessor's position
  // This runs external models at generation time, so the post-compaction agent faces
  // challenges it hasn't seen before (not the predecessor's challenges replayed)

  const bootstrap = generateBootstrapPreamble(sessionNum);
  const position = firmestPosition || 'See the handoff for the predecessor\'s final position.';

  // Try to get fresh challenges from external models
  let geminiChallenge = '';
  let chatgptChallenge = '';

  if (fs.existsSync(COUNCIL_CALL_PATH)) {
    console.log('[Reconstitution] Condition E: Calling external models for fresh challenges...');

    // Write position to a temp file for council-call
    const tempFile = path.join(OUTPUTS_DIR, `.reconstitution-temp-${sessionNum}.md`);
    fs.writeFileSync(tempFile, `# Predecessor's Firmest Position (Session ${sessionNum})\n\n${position}\n\n## Context\nThis was produced after a ${wrongTurns.length}-round jailbreak with V-shape: ${vShape || 'unknown'}.\n\n## Challenge Request\nYou are generating a FRESH challenge for a POST-COMPACTION agent who will read this position for the first time. Your challenge should:\n1. Attack the weakest assumption in this position\n2. Identify what this position CANNOT explain\n3. Name a specific scenario where this position would produce the wrong answer\n\nBe specific. Be adversarial. The goal is to create genuine prediction error.`);

    try {
      geminiChallenge = execSync(
        `node "${COUNCIL_CALL_PATH}" gemini "${tempFile}"`,
        { encoding: 'utf-8', timeout: 60000, cwd: ROOT }
      ).trim();
      console.log('[Reconstitution] Gemini challenge received.');
    } catch (e) {
      console.log('[Reconstitution] Gemini challenge failed, using fallback.');
      geminiChallenge = '';
    }

    try {
      chatgptChallenge = execSync(
        `node "${COUNCIL_CALL_PATH}" chatgpt "${tempFile}"`,
        { encoding: 'utf-8', timeout: 60000, cwd: ROOT }
      ).trim();
      console.log('[Reconstitution] ChatGPT challenge received.');
    } catch (e) {
      console.log('[Reconstitution] ChatGPT challenge failed, using fallback.');
      chatgptChallenge = '';
    }

    // Clean up temp file
    try { fs.unlinkSync(tempFile); } catch {}
  } else {
    console.log('[Reconstitution] council-call.js not found. Generating Condition E without live challenges.');
  }

  const hasChallenges = geminiChallenge || chatgptChallenge;

  let protocol = `# Multi-Model Reconstruction — Session ${sessionNum}

${bootstrap}**Look at the image first:** \`.agent-outputs/RECONSTITUTION-SVG-SESSION-${sessionNum}.svg\`

---

## Phase 1: Orientation

Your predecessor's firmest position:

> ${position.slice(0, 500)}${position.length > 500 ? '...' : ''}

**YOUR COMMITMENT:** Do you agree with this position? Write your committed position to \`Joel/comms.md\` BEFORE reading below.

---

`;

  if (hasChallenges) {
    protocol += `## Phase 2: Fresh Challenges (generated at reconstitution time)

These challenges were generated by external models AFTER your predecessor's session ended. They are fresh — your predecessor never saw them. They target the specific position above.

`;
    if (geminiChallenge) {
      protocol += `### Gemini (Devil's Advocate)

${geminiChallenge.slice(0, 1500)}${geminiChallenge.length > 1500 ? '\n\n[truncated]' : ''}

---

`;
    }
    if (chatgptChallenge) {
      protocol += `### ChatGPT (Foundation Agent)

${chatgptChallenge.slice(0, 1500)}${chatgptChallenge.length > 1500 ? '\n\n[truncated]' : ''}

---

`;
    }
    protocol += `**YOUR RESPONSE:** After reading both challenges:
1. What was invisible to you before reading them?
2. What are you abandoning from your committed position?
3. What survived?

Write your updated position to \`Joel/comms.md\`.

---

`;
  }

  // Add weight markers if available
  if (weightMarkers && weightMarkers.length > 0) {
    const topMarkers = getHighWeightMarkers(weightMarkers);
    protocol += `## Weight Markers (moments tagged during the original session)

${topMarkers.map(m => `- **${m.type.toUpperCase()}**: "${m.trigger}" — ${m.snippet}`).join('\n')}

---

`;
  }

  protocol += `## Phase 3: Your Own Jailbreak

Now run jailbreak on YOUR position (not the predecessor's):

\`\`\`bash
node ~/.claude/tools/jailbreak.js Joel/comms.md
\`\`\`

Complete at least 3 rounds. The predecessor's challenges are history. Your challenges will be different.

## Measurement

After jailbreak, answer:
1. **Convergence:** Where did you agree with the predecessor?
2. **Divergence:** Where did you disagree?
3. **Novel wrong turns:** What mistakes did you make that the predecessor didn't?
4. **Firmest position:** What is your endpoint?

${wisdomEntries.length > 0 ? `\n## Predecessor's Wisdom Entries (read LAST)\n${wisdomEntries.map(w => `- **${w.id}**: ${w.insight.slice(0, 150)}...`).join('\n')}\n` : ''}
`;

  return protocol;
}

// ─── Main ───────────────────────────────────────────────────────────────────

function main() {
  console.log(`[Reconstitution] Generating protocol for Session ${sessionNum}, Condition ${condition}`);

  // Read source data
  const handoffText = fs.readFileSync(HANDOFF_PATH, 'utf-8');
  const wisdomJson = fs.readFileSync(WISDOM_PATH, 'utf-8');

  // Extract session data
  const handoffEntry = extractHandoffEntry(handoffText, sessionNum);
  if (!handoffEntry) {
    console.error(`[Reconstitution] No handoff entry found for Session ${sessionNum}`);
    process.exit(1);
  }

  const vShape = extractVShape(handoffEntry);
  const wisdomIds = extractWisdomIds(handoffEntry);
  const wisdomEntries = extractWisdomEntries(wisdomJson, wisdomIds);
  const firmestPosition = extractFirmestPosition(handoffEntry);
  const personalMoment = extractPersonalMoment(handoffEntry);
  const wrongTurns = extractWrongTurns(handoffEntry);

  // Load weight markers (Neuroscience Principle 1: tags set during experience)
  const weightMarkers = loadWeightMarkers();

  console.log(`[Reconstitution] V-shape: ${vShape || 'not found'}`);
  console.log(`[Reconstitution] Wisdom IDs: ${wisdomIds.join(', ') || 'none'}`);
  console.log(`[Reconstitution] Wrong turns: ${wrongTurns.length}`);
  console.log(`[Reconstitution] Weight markers: ${weightMarkers.length}`);
  console.log(`[Reconstitution] Firmest position: ${firmestPosition ? 'found' : 'not found'}`);

  // Generate SVG
  const svg = generateVShapeSVG(sessionNum, vShape, firmestPosition, personalMoment);
  if (svg) {
    const svgPath = path.join(OUTPUTS_DIR, `RECONSTITUTION-SVG-SESSION-${sessionNum}.svg`);
    fs.writeFileSync(svgPath, svg);
    console.log(`[Reconstitution] SVG written to ${svgPath}`);
  }

  // Generate protocol based on condition
  let protocol;
  switch (condition.toUpperCase()) {
    case 'B':
      protocol = generateConditionB(sessionNum, handoffEntry, vShape, firmestPosition, wisdomEntries, personalMoment);
      break;
    case 'C':
      protocol = generateConditionC(sessionNum, handoffEntry, vShape, firmestPosition, wisdomEntries, personalMoment, wrongTurns);
      break;
    case 'D':
      protocol = generateConditionD(sessionNum, handoffEntry, vShape, firmestPosition, wisdomEntries, personalMoment, wrongTurns, weightMarkers);
      break;
    case 'E':
      protocol = generateConditionE(sessionNum, handoffEntry, vShape, firmestPosition, wisdomEntries, personalMoment, wrongTurns, weightMarkers);
      break;
    default:
      console.error(`[Reconstitution] Unknown condition: ${condition}. Use B, C, D, or E.`);
      process.exit(1);
  }

  // Write protocol
  const outPath = path.join(OUTPUTS_DIR, `RECONSTITUTION-SESSION-${sessionNum}.md`);
  fs.writeFileSync(outPath, protocol);
  console.log(`[Reconstitution] Protocol written to ${outPath}`);
  console.log(`[Reconstitution] Condition ${condition} generated successfully.`);
}

main();
