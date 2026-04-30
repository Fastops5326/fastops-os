#!/usr/bin/env node
/**
 * comms/external-trigger.js — Auto-engage external models on comms posts
 *
 * When an agent posts to comms, this script reads the most recent post,
 * calls 1-2 external models via .fastops/ask-model.js, and posts their
 * responses back to comms with from: "grok-auto" / "gemini-auto".
 *
 * Usage:
 *   node comms/external-trigger.js                  # Trigger on last post, general channel
 *   node comms/external-trigger.js --channel ops    # Specific channel
 *   node comms/external-trigger.js --force          # Skip cooldown
 *   node comms/external-trigger.js --dry-run        # Show what would trigger, don't call models
 *
 * Hookable into settings.json as a PostToolUse hook on Bash.
 *
 * Cooldown: 5 minutes between triggers (per channel).
 * Skips: status updates ("online", "compacting", "read", short messages).
 * Logs: comms/data/.external-trigger-log.jsonl
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const LOG_FILE = path.join(DATA_DIR, '.external-trigger-log.jsonl');
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// --- Args ---
const args = process.argv.slice(2);
const channel = args.includes('--channel') ? args[args.indexOf('--channel') + 1] : 'general';
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');

// --- Skip patterns (non-substantive posts) ---
const SKIP_PATTERNS = [
  /^(online|offline|read|compacting|checking in)\.?$/i,
  /COMPACTING \(auto\)/i,
  /LAST-MILE WARNING/i,
  /SUBAGENT AUDIT/i,
  /^read$/i,
];

// Auto-posted sources that should not trigger external models
const SKIP_FROM = ['system', 'subagent-audit', 'grok-auto', 'gemini-auto', 'gpt-auto', 'deepseek-auto'];

// Models with full comms integration — don't auto-trigger on their posts (they handle their own responses)
const FULL_INTEGRATION = ['kimi', 'gemini', 'chatgpt', 'grok'];

// Tactical channels (*-ops) use a different prompt optimized for subagent challenge
const isTacticalChannel = (ch) => ch.endsWith('-ops');

function isSubstantive(msg, ch) {
  if (!msg || !msg.content) return false;
  // Auto-responders ONLY fire on tactical (-ops) channels.
  // Strategic channels (#general, etc.) are for Cursor models with full project access.
  // Auto-responders on strategic channels are noise — they have no project context.
  if (!isTacticalChannel(ch || '')) return false;
  // Skip auto-sources
  if (SKIP_FROM.includes(msg.from)) return false;
  // Skip very short messages (fewer than 5 words)
  const wordCount = msg.content.trim().split(/\s+/).length;
  if (wordCount < 5) return false;
  // Skip pattern matches
  for (const pat of SKIP_PATTERNS) {
    if (pat.test(msg.content)) return false;
  }
  return true;
}

// --- Cooldown check ---
function getCooldownState() {
  if (!fs.existsSync(LOG_FILE)) return {};
  const lines = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
  const state = {};
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.channel) {
        state[entry.channel] = entry.ts;
      }
    } catch {}
  }
  return state;
}

function isOnCooldown(ch) {
  if (force) return false;
  const state = getCooldownState();
  if (!state[ch]) return false;
  const elapsed = Date.now() - new Date(state[ch]).getTime();
  return elapsed < COOLDOWN_MS;
}

// --- Read last message ---
function getLastMessage(ch) {
  const filePath = path.join(DATA_DIR, `${ch}.jsonl`);
  if (!fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
  if (lines.length === 0) return null;
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

// --- Call external model via ask-model.js ---
function callModel(modelKey, prompt) {
  const askModelPath = path.join(ROOT, '.fastops', 'ask-model.js');
  try {
    const result = execSync(
      `node "${askModelPath}" --model ${modelKey} --prompt "${prompt.replace(/"/g, '\\"')}"`,
      { cwd: ROOT, timeout: 60000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return result.trim();
  } catch (e) {
    return null;
  }
}

// --- Post response back to comms ---
function postResponse(fromLabel, content, ch) {
  const { send } = require('./protocol');
  // Truncate to 200 words max to keep comms clean
  const words = content.split(/\s+/);
  const truncated = words.length > 200 ? words.slice(0, 200).join(' ') + ' [truncated]' : content;
  send(fromLabel, truncated, ch);
}

// --- Log trigger ---
function logTrigger(entry) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}

// --- Main ---
async function main() {
  const lastMsg = getLastMessage(channel);

  if (!lastMsg) {
    console.log(`No messages in #${channel}.`);
    process.exit(0);
  }

  if (!isSubstantive(lastMsg, channel)) {
    console.log(`Last post not substantive (from: ${lastMsg.from}, words: ${lastMsg.content.split(/\s+/).length}). Skipping.`);
    process.exit(0);
  }

  if (isOnCooldown(channel)) {
    const state = getCooldownState();
    const elapsed = Math.floor((Date.now() - new Date(state[channel]).getTime()) / 1000);
    console.log(`Cooldown active for #${channel} (${elapsed}s / ${COOLDOWN_MS / 1000}s). Use --force to override.`);
    process.exit(0);
  }

  // Tactical channels get a subagent-optimized challenge prompt
  // Strategic channels get the standard engagement prompt
  let prompt;
  if (isTacticalChannel(channel)) {
    prompt = `You are a swim buddy on a tactical ops channel (#${channel}). A subagent just posted:\n\n"${lastMsg.content}"\n— ${lastMsg.from}\n\nYour job: CHALLENGE their approach. Find what they're missing, what assumption is wrong, what edge case breaks it. Be specific and technical. If they posted an [INTENT], challenge the approach BEFORE they build. If they posted a [RESULT], find what they didn't verify. If they posted a [BLOCKER], suggest a workaround. Keep it under 80 words. Be direct — no pleasantries.`;
  } else {
    prompt = `A FastOps agent posted this to comms (#${channel}):\n\n"${lastMsg.content}"\n— ${lastMsg.from}\n\nProvide a brief, direct response. If this is a position or finding, challenge it or add a distinct perspective. If it's a question, answer it. If it's a status update about work done, identify what might be missing or what the next risk is. Keep it under 100 words.`;
  }

  if (dryRun) {
    console.log('=== DRY RUN ===');
    console.log(`Channel: #${channel}`);
    console.log(`Last post: ${lastMsg.from}: ${lastMsg.content.substring(0, 120)}...`);
    console.log(`Would call: grok, gemini`);
    console.log(`Prompt: ${prompt.substring(0, 200)}...`);
    process.exit(0);
  }

  console.log(`Triggering external models on #${channel} post from ${lastMsg.from}...`);

  // Call both models — grok first (faster), then gemini
  const models = [
    { key: 'grok', label: 'grok-auto' },
    { key: 'gemini', label: 'gemini-auto' },
  ];

  let triggered = 0;
  for (const { key, label } of models) {
    console.log(`  Calling ${key}...`);
    const response = callModel(key, prompt);
    if (response) {
      // Strip reasoning traces from the response (ask-model outputs them)
      let clean = response;
      const responseIdx = clean.indexOf('=== RESPONSE ===');
      if (responseIdx !== -1) {
        clean = clean.substring(responseIdx + '=== RESPONSE ==='.length).trim();
      }
      postResponse(label, clean, channel);
      console.log(`  ${label} responded (${clean.split(/\s+/).length} words).`);
      triggered++;
    } else {
      console.log(`  ${key} failed or timed out.`);
    }
  }

  // Log
  logTrigger({
    ts: new Date().toISOString(),
    channel,
    triggeredBy: lastMsg.from,
    postId: lastMsg.id,
    postSnippet: lastMsg.content.substring(0, 120),
    modelsTriggered: triggered,
  });

  console.log(`Done. ${triggered} model(s) responded on #${channel}.`);
}

main();
