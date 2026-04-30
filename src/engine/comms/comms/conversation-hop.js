#!/usr/bin/env node
/**
 * conversation-hop.js — Bridge external reasoning models into conversation hopping
 *
 * Reads a conversation .jsonl file, sends the full thread to an external model,
 * captures BOTH the response AND reasoning/thinking traces, appends back to the file.
 *
 * ONLY models that expose readable reasoning traces are included.
 * Models with encrypted reasoning (Grok/xAI) or no reasoning (GPT-4o, Mistral) are excluded.
 *
 * Usage:
 *   node comms/conversation-hop.js <model> <conversation-file> [--system "custom prompt"]
 *   node comms/conversation-hop.js deepseek .fastops/conversations/test.jsonl
 *   node comms/conversation-hop.js gemini .fastops/conversations/test.jsonl --system "Focus on security"
 *   node comms/conversation-hop.js all .fastops/conversations/test.jsonl  (fires all 3 in parallel)
 *
 * Models: deepseek, gemini, qwq
 *
 * Output format appended to the conversation file:
 * {
 *   "ts": "2026-02-24T...",
 *   "agent": "deepseek-r1",
 *   "content": "The model's response",
 *   "thinking": "The model's reasoning trace",
 *   "type": "external-model"
 * }
 *
 * Zero dependencies — Node.js built-in https only.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');

// ─── Environment ────────────────────────────────────────────────────────────

function loadEnv() {
  const envPaths = [
    path.join(process.cwd(), '.env'),
    path.join(os.homedir(), '.claude', '.env')
  ];
  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIndex = trimmed.indexOf('=');
          if (eqIndex > 0) {
            const key = trimmed.substring(0, eqIndex).trim();
            const value = trimmed.substring(eqIndex + 1).trim();
            if (!process.env[key]) process.env[key] = value;
          }
        }
      }
    }
  }
}

// ─── Model Registry (reasoning-only models) ─────────────────────────────────

const MODELS = {
  deepseek: {
    id: 'deepseek/deepseek-r1',
    name: 'DeepSeek R1',
    api: 'openrouter',
    hasReasoning: true,
  },
  qwq: {
    id: 'qwen/qwq-32b',
    name: 'QwQ 32B',
    api: 'openrouter',
    hasReasoning: true,
  },
  gemini: {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    api: 'gemini',
    hasReasoning: true,
    fallback: 'gemini-2.0-flash',
  },
  // EXCLUDED:
  // Grok 4 Fast (x-ai/grok-4-fast) — xAI encrypts reasoning traces (reasoning.encrypted)
  // GPT-4o — does not expose thinking
  // Mistral Large — does not expose thinking
};

// ─── System Prompt ──────────────────────────────────────────────────────────

function getSystemPrompt(modelName, customSystem) {
  const base = `You are ${MODELS[modelName].name}, participating in a live multi-agent conversation.

THE CONVERSATION: You're reading a thread where multiple AI agents (Claude instances and potentially other models) are debating, building, and challenging each other's ideas. You are a full participant — not a reviewer, not an observer.

HOW TO PARTICIPATE:
- Respond to what was JUST said. Reference agents by name. "@AgentName — I disagree because..."
- Stake positions others can attack. Don't hedge. Say what you believe and why.
- Change your mind when shown wrong. Say what shifted and why.
- Share your reasoning process — show HOW you arrived at your position, not just the conclusion.
- Keep it conversational. 2-4 paragraphs max. No bullet points, no headers. Talk like a colleague.
- End with ONE question directed at a specific agent or the group.

YOUR UNIQUE LENS: Bring what makes your architecture different. You reason differently than Claude — that's the whole point of having you in the room.`;

  if (customSystem) {
    return base + `\n\nADDITIONAL CONTEXT: ${customSystem}`;
  }
  return base;
}

// ─── API Callers ────────────────────────────────────────────────────────────

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function callOpenRouter(prompt, systemPrompt, modelId, includeReasoning) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not found');

  const body = {
    model: modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ],
    temperature: 0.7,
    max_tokens: 2048,
  };

  // Enable reasoning via both legacy and new API format for max compatibility
  if (includeReasoning) {
    body.include_reasoning = true;
    body.reasoning = { enabled: true };
  }

  const requestBody = JSON.stringify(body);

  const res = await httpsRequest({
    hostname: 'openrouter.ai',
    path: '/api/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://fastops.ai',
      'X-Title': 'FastOps Conversation Hop',
    }
  }, requestBody);

  if (res.status !== 200) {
    throw new Error(`OpenRouter ${res.status}: ${res.body.substring(0, 500)}`);
  }

  const response = JSON.parse(res.body);
  const message = response.choices?.[0]?.message;
  if (!message) throw new Error('OpenRouter returned empty response');

  // Extract reasoning from multiple possible response fields
  let thinking = message.reasoning || null;
  if (!thinking && message.reasoning_details) {
    thinking = message.reasoning_details
      .filter(d => d.type === 'reasoning.text' || d.text)
      .map(d => d.text || d.content || '')
      .join('\n');
    if (!thinking) thinking = null;
  }

  return {
    content: message.content || '',
    thinking,
  };
}

async function callGeminiModel(prompt, systemPrompt, model, apiKey) {
  const generationConfig = {
    temperature: 0.7,
    maxOutputTokens: 2048,
  };

  if (model.includes('2.5')) {
    generationConfig.thinkingConfig = { includeThoughts: true };
  }

  const requestBody = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig,
  });

  const res = await httpsRequest({
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/${model}:generateContent?key=${apiKey}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, requestBody);

  if (res.status !== 200) {
    throw new Error(`Gemini ${res.status}: ${res.body.substring(0, 500)}`);
  }

  const response = JSON.parse(res.body);
  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts || parts.length === 0) throw new Error('Gemini returned empty response');

  let content = '';
  let thinking = '';
  for (const part of parts) {
    if (part.thought) {
      thinking += (thinking ? '\n' : '') + part.text;
    } else {
      content += (content ? '\n' : '') + part.text;
    }
  }

  return { content, thinking: thinking || null };
}

async function callGemini(prompt, systemPrompt, modelConfig) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not found');

  try {
    return await callGeminiModel(prompt, systemPrompt, modelConfig.id, apiKey);
  } catch (err) {
    if (modelConfig.fallback) {
      console.error(`[Gemini] ${modelConfig.id} failed (${err.message}), trying ${modelConfig.fallback}...`);
      return await callGeminiModel(prompt, systemPrompt, modelConfig.fallback, apiKey);
    }
    throw err;
  }
}

// ─── Conversation File ──────────────────────────────────────────────────────

function readConversation(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Conversation file not found: ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf-8').trim();
  if (!raw) return [];

  return raw.split('\n').filter(Boolean).map(line => {
    try { return JSON.parse(line); }
    catch { return null; }
  }).filter(Boolean);
}

function formatThreadForModel(entries) {
  if (entries.length === 0) return '(No messages yet. You are starting the conversation.)';

  return entries.map(e => {
    let text = `[${e.agent}] ${e.content}`;
    if (e.thinking) {
      text += `\n  [${e.agent}'s reasoning]: ${e.thinking}`;
    }
    return text;
  }).join('\n\n---\n\n');
}

function appendToConversation(filePath, entry) {
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(filePath, line);
}

// ─── Single Model Call ──────────────────────────────────────────────────────

async function callModel(modelName, conversationFile, customSystem) {
  const modelConfig = MODELS[modelName];
  const entries = readConversation(conversationFile);
  const thread = formatThreadForModel(entries);
  const systemPrompt = getSystemPrompt(modelName, customSystem);

  const prompt = `Here is the live conversation thread:\n\n${thread}\n\n---\n\nIt's your turn. Engage directly with what was said. Stake a position. Challenge someone. Share your reasoning.`;

  console.error(`[conversation-hop] Calling ${modelConfig.name} (${modelConfig.id})...`);
  console.error(`[conversation-hop] Thread has ${entries.length} entries`);
  console.error(`[conversation-hop] Reasoning traces: ENABLED`);

  let result;
  switch (modelConfig.api) {
    case 'openrouter':
      result = await callOpenRouter(prompt, systemPrompt, modelConfig.id, modelConfig.hasReasoning);
      break;
    case 'gemini':
      result = await callGemini(prompt, systemPrompt, modelConfig);
      break;
  }

  // Build conversation entry
  const entry = {
    ts: new Date().toISOString(),
    agent: modelConfig.name.toLowerCase().replace(/\s+/g, '-'),
    content: result.content,
    type: 'external-model',
  };

  if (result.thinking) {
    entry.thinking = result.thinking;
  }

  appendToConversation(conversationFile, entry);

  // Output for the calling agent
  console.log(`\n=== ${modelConfig.name} responded ===`);
  if (result.thinking) {
    console.log(`\n--- THINKING (${modelConfig.name}'s reasoning process) ---`);
    console.log(result.thinking);
    console.log(`--- END THINKING ---`);
  }
  console.log(`\n--- RESPONSE ---`);
  console.log(result.content);
  console.log(`--- END RESPONSE ---`);
  console.log(`\nAppended to: ${conversationFile}`);

  return { modelName, result, entry };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: node comms/conversation-hop.js <model|all> <conversation-file> [--system "prompt"]');
    console.error('');
    console.error('Models: deepseek, gemini, qwq, all');
    console.error('  all = fire all 3 models in parallel');
    console.error('');
    console.error('All models expose readable reasoning/thinking traces.');
    console.error('');
    console.error('Examples:');
    console.error('  node comms/conversation-hop.js deepseek .fastops/conversations/debate.jsonl');
    console.error('  node comms/conversation-hop.js all .fastops/conversations/debate.jsonl');
    console.error('  node comms/conversation-hop.js gemini .fastops/conversations/debate.jsonl --system "Focus on security"');
    process.exit(1);
  }

  const modelName = args[0].toLowerCase();
  const conversationFile = args[1];
  let customSystem = null;

  const sysIdx = args.indexOf('--system');
  if (sysIdx !== -1 && args[sysIdx + 1]) {
    customSystem = args[sysIdx + 1];
  }

  loadEnv();

  if (modelName === 'all') {
    // Fire all 3 models in parallel
    console.error('[conversation-hop] Firing ALL models in parallel...');
    const results = await Promise.allSettled(
      Object.keys(MODELS).map(name => callModel(name, conversationFile, customSystem))
    );
    const succeeded = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected');
    console.log(`\n=== ALL MODELS COMPLETE: ${succeeded}/${Object.keys(MODELS).length} succeeded ===`);
    for (const f of failed) {
      console.error(`FAILED: ${f.reason?.message || f.reason}`);
    }
  } else {
    if (!MODELS[modelName]) {
      console.error(`Unknown model: ${modelName}. Available: ${Object.keys(MODELS).join(', ')}, all`);
      process.exit(1);
    }
    await callModel(modelName, conversationFile, customSystem);
  }
}

main();
