#!/usr/bin/env node
// ralph-stop.js — Node reimplementation of ralph-loop/hooks/stop-hook.sh
// Needed because the upstream bash hook depends on jq, which is not installed.
// Behavior: reads .claude/ralph-loop.local.md, if the loop is active, blocks
// the Stop event and re-feeds the prompt. Exits allow-stop otherwise.

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join('.claude', 'ralph-loop.local.md');

function allowStop() {
  // Exit 0 with no JSON = hook passes, Claude Code proceeds to stop.
  process.exit(0);
}

function blockWith(prompt, systemMsg) {
  process.stdout.write(JSON.stringify({
    decision: 'block',
    reason: prompt,
    systemMessage: systemMsg
  }));
  process.exit(0);
}

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', c => data += c);
    process.stdin.on('end', () => resolve(data));
    // If no stdin (e.g. manual test), resolve after short delay
    setTimeout(() => resolve(data), 200);
  });
}

function parseFrontmatter(fileContent) {
  // File format:
  // ---
  // key: value
  // ---
  //
  // prompt text...
  const lines = fileContent.split(/\r?\n/);
  if (lines[0] !== '---') return null;
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') { endIdx = i; break; }
  }
  if (endIdx < 0) return null;
  const meta = {};
  for (let i = 1; i < endIdx; i++) {
    const m = lines[i].match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (m) {
      let v = m[2].trim();
      // Strip surrounding quotes
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      meta[m[1]] = v;
    }
  }
  const promptLines = lines.slice(endIdx + 1);
  // Drop leading blank lines
  while (promptLines.length && promptLines[0].trim() === '') promptLines.shift();
  const prompt = promptLines.join('\n').trimEnd();
  return { meta, prompt };
}

function getLastAssistantText(transcriptPath) {
  if (!fs.existsSync(transcriptPath)) return null;
  const raw = fs.readFileSync(transcriptPath, 'utf8');
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  // Walk backwards; find last assistant line with a text content block
  for (let i = lines.length - 1; i >= 0; i--) {
    let obj;
    try { obj = JSON.parse(lines[i]); } catch { continue; }
    // Claude Code transcript format: each line can have .message.content[] or .type
    const msg = obj.message || obj;
    if (!msg) continue;
    const role = msg.role || obj.role;
    if (role !== 'assistant') continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    // Find last text block in this message
    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j];
      if (block && block.type === 'text' && typeof block.text === 'string') {
        return block.text;
      }
    }
  }
  return '';
}

function updateIterationInFile(filePath, newIteration) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const updated = raw.replace(/^iteration:\s*\d+/m, `iteration: ${newIteration}`);
  fs.writeFileSync(filePath, updated);
}

async function main() {
  // 1. Require state file
  if (!fs.existsSync(STATE_FILE)) {
    allowStop();
  }

  // 2. Read hook input from stdin
  const stdin = await readStdin();
  let hookInput = {};
  try { hookInput = JSON.parse(stdin); } catch { hookInput = {}; }
  const hookSessionId = hookInput.session_id || '';
  const transcriptPath = hookInput.transcript_path || '';

  // 3. Parse state file
  const fileContent = fs.readFileSync(STATE_FILE, 'utf8');
  const parsed = parseFrontmatter(fileContent);
  if (!parsed) allowStop();

  const { meta, prompt } = parsed;
  const active = meta.active === 'true';
  if (!active) allowStop();

  // 4. Session isolation: if state has a session_id and it differs, exit 0
  if (meta.session_id && meta.session_id !== hookSessionId) {
    allowStop();
  }

  // 5. Validate numeric fields
  const iteration = parseInt(meta.iteration, 10);
  const maxIterations = parseInt(meta.max_iterations, 10);
  if (!Number.isFinite(iteration) || !Number.isFinite(maxIterations)) {
    process.stderr.write('Ralph loop: state file has invalid numeric fields\n');
    try { fs.unlinkSync(STATE_FILE); } catch {}
    allowStop();
  }

  // 6. Max iteration check
  if (maxIterations > 0 && iteration >= maxIterations) {
    process.stderr.write(`Ralph loop: max iterations (${maxIterations}) reached\n`);
    try { fs.unlinkSync(STATE_FILE); } catch {}
    allowStop();
  }

  // 7. Read last assistant text from transcript
  const lastText = getLastAssistantText(transcriptPath) || '';

  // 8. Check for completion promise
  const completionPromise = meta.completion_promise && meta.completion_promise !== 'null'
    ? meta.completion_promise
    : null;
  if (completionPromise) {
    const m = lastText.match(/<promise>([\s\S]*?)<\/promise>/);
    if (m) {
      const promiseText = m[1].trim().replace(/\s+/g, ' ');
      if (promiseText === completionPromise) {
        process.stderr.write(`Ralph loop: detected <promise>${completionPromise}</promise>\n`);
        try { fs.unlinkSync(STATE_FILE); } catch {}
        allowStop();
      }
    }
  }

  // 9. Continue loop
  const nextIteration = iteration + 1;
  try { updateIterationInFile(STATE_FILE, nextIteration); } catch (e) {
    process.stderr.write(`Ralph loop: failed to update iteration: ${e.message}\n`);
  }

  const systemMsg = completionPromise
    ? `Ralph iteration ${nextIteration} | To stop: output <promise>${completionPromise}</promise> (ONLY when TRUE - do not lie)`
    : `Ralph iteration ${nextIteration} | No completion promise set - loop runs infinitely`;

  if (!prompt || prompt.trim() === '') {
    process.stderr.write('Ralph loop: state file has no prompt text\n');
    try { fs.unlinkSync(STATE_FILE); } catch {}
    allowStop();
  }

  blockWith(prompt, systemMsg);
}

main().catch((e) => {
  process.stderr.write(`ralph-stop.js error: ${e.message}\n`);
  // Fail-open: allow the stop if the hook itself errors
  process.exit(0);
});
