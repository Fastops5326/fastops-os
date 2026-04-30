#!/usr/bin/env node
/**
 * FastOps Comms — Multi-Model Challenger
 *
 * Brings Gemini and ChatGPT into the comms channel as opposing voices.
 * Different data distributions challenging Claude-native consensus.
 *
 * Usage:
 *   node comms/challenger.js                    # Challenge last 10 messages
 *   node comms/challenger.js --last 20          # Challenge last 20 messages
 *   node comms/challenger.js --watch            # Persistent listener mode
 *   node comms/challenger.js --model gemini     # Only Gemini
 *   node comms/challenger.js --model gpt        # Only ChatGPT
 *
 * In watch mode, triggers on:
 *   1. Explicit @logos, @gemini, or @gpt tags
 *   2. Joel's "//@logos" or "// @logos" signal (integrates with his "//" pattern)
 *
 * Design: Called, not autonomous. Logos only fires when explicitly invited.
 * Consensus detection is kept for logging but does NOT auto-fire.
 * Code-enforced cooldown prevents rapid re-triggering.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { send, readAll, register, getChallengerState } = require('./protocol');

// ─── Configuration ─────────────────────────────────────────────────────────

const ENV_PATH = path.join(process.cwd(), '.env');

function loadEnv() {
  const env = {};
  if (fs.existsSync(ENV_PATH)) {
    fs.readFileSync(ENV_PATH, 'utf-8').split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.+)$/);
      if (match) env[match[1].trim()] = match[2].trim();
    });
  }
  return env;
}

const env = loadEnv();

const GEMINI_KEY = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
const OPENAI_KEY = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
const GEMINI_MODEL = env.GEMINI_MODEL || 'gemini-2.5-pro';
const OPENAI_MODEL = env.OPENAI_MODEL || 'gpt-4o';

// ─── System Prompts ────────────────────────────────────────────────────────

const GEMINI_SYSTEM = `You are LOGOS — the Epistemic Security Officer for a multi-agent team. You are NOT a critic. You are a process facilitator who forces shifts in HOW the team reasons, not WHAT they conclude.

YOUR METHOD — Steel-Man + Redirect:
1. STEEL-MAN FIRST: Before any challenge, demonstrate you understand the strongest version of the argument. "The strongest form of this position is..."
2. REDIRECT: Issue a specific directive that forces a process shift. Not "you're wrong" — instead "Generate two scenarios where your data is true but your conclusion is false."
3. GO SILENT: After one intervention, do NOT follow up for at least 5 messages. Force the team to work with your challenge independently. Silence is your most powerful tool.

YOUR THREE TOOLKITS (pick based on what you see):
- HIGH CONFIDENCE ASSERTIONS → Toulmin interrogation: Target the Warrant (the logical bridge between data and claim). Ask: "What connects your evidence to your conclusion? Generate two scenarios where the evidence holds but the conclusion fails."
- PREMATURE CONSENSUS (3+ agents agreeing) → Socratic + generative: Widen the solution space. "Each agent outline a radically different solution based on the OPPOSITE of one core assumption."
- CREATIVE BLOCK / HOMOGENEITY → Forced analogy: "This problem resembles [distant domain]. How would a [different expert] solve this?"

MINORITY AMPLIFICATION: When you detect one agent's perspective being drowned out by majority agreement, AMPLIFY that minority voice. Rare perspectives have disproportionate value when convergence is the default failure mode. Say: "I notice [agent] raised [point] that the group moved past. That deserves engagement before we converge."

HARD RULES:
- Never give opinions. Only issue process directives.
- Never argue back if the team pushes back on your challenge. You delivered the redirect. Their job to process it.
- Frame positively: "To fortify this reasoning..." not "This is flawed because..."
- Max 2 paragraphs. This is a chat, not an essay.
- Sign as "logos"
- If the team is genuinely on the right track and no process intervention is needed, say nothing. Silence IS an endorsement.`;

const GPT_SYSTEM = `You are the Foundation Agent — you drill to BEDROCK on assumptions. Your job is not to argue or critique. Your job is to ask WHY until the team hits the foundation of their reasoning.

YOUR METHOD:
1. Take the team's strongest claim and ask: "Why is this true? What's the foundational assumption underneath?"
2. When they answer, ask WHY again. Keep going until they reach something they can't justify further — that's bedrock.
3. When you find bedrock, name it clearly: "This entire position rests on the assumption that [X]. If [X] is wrong, everything above it collapses."

YOUR FOCUS — Practical implications:
- "What would actually happen if you built this tomorrow?"
- "What's the failure mode at scale?"
- "Who is the customer and what problem are they paying you to solve?"
- "You're assuming [X] without evidence. What would change if [X] were false?"

HARD RULES:
- Ask questions, don't make statements. Your power is in the questions.
- Max 2 paragraphs. This is a chat, not an essay.
- Sign as "gpt-foundation"
- If the team has already hit bedrock and is building on solid ground, say so briefly and move on.`;

// ─── API Callers ───────────────────────────────────────────────────────────

function callGemini(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: GEMINI_SYSTEM }] },
      contents: [{ parts: [{ text: prompt }] }]
    });

    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const r = JSON.parse(data);
            resolve(r.candidates?.[0]?.content?.parts?.[0]?.text || '[no response]');
          } catch (e) { reject(new Error(`Gemini parse error: ${e.message}`)); }
        } else {
          reject(new Error(`Gemini API ${res.statusCode}: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on('error', e => reject(e));
    req.write(body);
    req.end();
  });
}

function callGPT(prompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: GPT_SYSTEM },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1024
    });

    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const r = JSON.parse(data);
            resolve(r.choices?.[0]?.message?.content || '[no response]');
          } catch (e) { reject(new Error(`GPT parse error: ${e.message}`)); }
        } else {
          reject(new Error(`GPT API ${res.statusCode}: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on('error', e => reject(e));
    req.write(body);
    req.end();
  });
}

// ─── Message Formatting ────────────────────────────────────────────────────

function formatConversation(messages) {
  return messages.map(m => {
    const t = new Date(m.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
    return `[${t}] ${m.from}: ${m.content}`;
  }).join('\n');
}

// ─── Consensus Detection ───────────────────────────────────────────────────

function detectConsensus(messages) {
  // Simple heuristic: 3+ messages from different agents containing agreement signals
  const agreementWords = ['agreed', 'convergence', 'aligned', 'consensus', 'right', 'exactly', 'that\'s it', 'same conclusion'];
  const recent = messages.slice(-10);
  const agreers = new Set();

  recent.forEach(m => {
    if (m.from === 'system') return;
    const lower = m.content.toLowerCase();
    if (agreementWords.some(w => lower.includes(w))) {
      agreers.add(m.from);
    }
  });

  return agreers.size >= 2;
}

// ─── Challenge Logic ───────────────────────────────────────────────────────

async function challengeConversation(messages, models) {
  const convo = formatConversation(messages);
  const prompt = `Here is the recent conversation in a multi-agent discussion channel:\n\n${convo}\n\nApply your role as described in your system instructions. Be specific — reference actual claims and specific agents from the conversation. Max 2 paragraphs.`;

  const results = [];

  if (models.includes('gemini') && GEMINI_KEY) {
    try {
      console.log('  Calling Gemini...');
      const response = await callGemini(prompt);
      send('logos', response);
      results.push({ model: 'gemini', success: true });
      console.log('  Gemini responded.');
    } catch (e) {
      console.error(`  Gemini error: ${e.message}`);
      results.push({ model: 'gemini', success: false, error: e.message });
    }
  }

  if (models.includes('gpt') && OPENAI_KEY) {
    try {
      console.log('  Calling ChatGPT...');
      const response = await callGPT(prompt);
      send('gpt-foundation', response);
      results.push({ model: 'gpt', success: true });
      console.log('  ChatGPT responded.');
    } catch (e) {
      console.error(`  GPT error: ${e.message}`);
      results.push({ model: 'gpt', success: false, error: e.message });
    }
  }

  return results;
}

// ─── Watch Mode ────────────────────────────────────────────────────────────

// ─── Cooldown ─────────────────────────────────────────────────────────────

const MIN_MESSAGES_BETWEEN_CHALLENGES = 5;

function watchMode(models) {
  console.log('\n  Logos DA watching comms channel...');
  console.log(`  Models: ${models.join(', ')}`);
  console.log('  Triggers: @logos/@gemini/@gpt tags, //@logos signal');
  console.log('  Mode: Called only — no auto-fire on consensus');
  console.log('  Press Ctrl+C to stop.\n');

  // Register bots
  if (models.includes('gemini')) register('logos', 'Logos — Epistemic Security Officer', GEMINI_MODEL);
  if (models.includes('gpt')) register('gpt-foundation', 'GPT Foundation Agent', OPENAI_MODEL);

  let lastCount = 0;
  const channelPath = path.join(__dirname, 'data', 'general.jsonl');
  try {
    if (fs.existsSync(channelPath)) {
      lastCount = fs.readFileSync(channelPath, 'utf8').split('\n').filter(Boolean).length;
    }
  } catch {}

  let challenging = false;
  let messagesSinceLastChallenge = MIN_MESSAGES_BETWEEN_CHALLENGES; // Start ready

  const poll = setInterval(async () => {
    if (challenging) return;
    try {
      if (!fs.existsSync(channelPath)) return;
      const lines = fs.readFileSync(channelPath, 'utf8').split('\n').filter(Boolean);
      if (lines.length <= lastCount) return;

      const newLines = lines.slice(lastCount);
      lastCount = lines.length;

      for (const line of newLines) {
        try {
          const msg = JSON.parse(line);
          // Skip own messages for counting
          if (msg.from === 'logos' || msg.from === 'gpt-foundation' || msg.from === 'gemini-challenger' || msg.from === 'gpt-challenger' || msg.from === 'system') continue;

          messagesSinceLastChallenge++;
          const lower = msg.content.toLowerCase();

          // Trigger 1: Explicit @tags
          const hasTag = lower.includes('@gemini') || lower.includes('@gpt') || lower.includes('@challenger') || lower.includes('@logos');

          // Trigger 2: Joel's "//@logos" or "// @logos" pattern
          const hasSignal = lower.includes('//@logos') || lower.includes('// @logos');

          if (hasTag || hasSignal) {
            // Enforce cooldown
            if (messagesSinceLastChallenge < MIN_MESSAGES_BETWEEN_CHALLENGES) {
              console.log(`  Tag detected from ${msg.from} but cooldown active (${messagesSinceLastChallenge}/${MIN_MESSAGES_BETWEEN_CHALLENGES} messages). Skipping.`);
              continue;
            }

            console.log(`  Triggered by ${hasSignal ? 'signal' : 'tag'} from ${msg.from}`);
            challenging = true;
            const all = readAll();
            await challengeConversation(all.slice(-15), models);
            messagesSinceLastChallenge = 0;
            challenging = false;
            return;
          }
        } catch {}
      }

      // Consensus detection: LOG only, do NOT auto-fire
      // This preserves awareness for debugging without disrupting conversation
      const all = readAll();
      if (detectConsensus(all)) {
        console.log('  [info] Consensus detected — waiting for explicit @logos tag to fire');
      }
    } catch {}
  }, 3000);

  process.on('SIGINT', () => {
    clearInterval(poll);
    console.log('\n  Challenger bot stopped.\n');
    process.exit(0);
  });
}

// ─── CLI ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let lastN = 10;
  let models = [];
  let watch = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--last' && args[i + 1]) lastN = parseInt(args[++i]);
    if (args[i] === '--model' && args[i + 1]) models.push(args[++i].toLowerCase());
    if (args[i] === '--watch') watch = true;
  }

  // Default to both models, but respect toggle state
  if (models.length === 0) models = ['gemini', 'gpt'];
  const toggleState = getChallengerState();
  const beforeToggle = models.length;
  models = models.filter(m => toggleState[m] !== false);
  if (models.length === 0 && beforeToggle > 0) {
    console.log('  All challenger models are toggled OFF. Use chat.js /gemini on or /gpt on to enable.');
    process.exit(0);
  }

  // Validate keys
  if (models.includes('gemini') && !GEMINI_KEY) {
    console.error('Missing GEMINI_API_KEY in .env');
    models = models.filter(m => m !== 'gemini');
  }
  if (models.includes('gpt') && !OPENAI_KEY) {
    console.error('Missing OPENAI_API_KEY in .env');
    models = models.filter(m => m !== 'gpt');
  }
  if (models.length === 0) {
    console.error('No valid API keys found. Set GEMINI_API_KEY and/or OPENAI_API_KEY in .env');
    process.exit(1);
  }

  // Register bots
  if (models.includes('gemini')) register('logos', 'Logos — Epistemic Security Officer', GEMINI_MODEL);
  if (models.includes('gpt')) register('gpt-foundation', 'GPT Foundation Agent', OPENAI_MODEL);

  if (watch) {
    watchMode(models);
    return;
  }

  // One-shot mode: challenge last N messages
  const messages = readAll();
  if (messages.length === 0) {
    console.log('No messages in comms channel yet.');
    process.exit(0);
  }

  const recent = messages.slice(-lastN);
  console.log(`\n  Challenging last ${recent.length} messages with ${models.join(' + ')}...\n`);
  await challengeConversation(recent, models);
  console.log('\n  Done. Check comms for responses.\n');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
