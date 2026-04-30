#!/usr/bin/env node
/**
 * panel-runner.js — 5-Persona Onboarding Panel
 *
 * Runs a single persona from the onboarding panel against the agent's position.
 * Called sequentially by the agent during onboarding.
 *
 * Usage:
 *   node evidence/onboarding/panel-runner.js --persona phone-friend --position .agent-outputs/onboarding-position.md
 *   node evidence/onboarding/panel-runner.js --persona reframer --position .agent-outputs/onboarding-position.md --context .agent-outputs/onboarding-panel-context.md
 *   node evidence/onboarding/panel-runner.js --persona adversarial --position .agent-outputs/onboarding-position.md --context .agent-outputs/onboarding-panel-context.md
 *   node evidence/onboarding/panel-runner.js --persona phone-friend --position .agent-outputs/onboarding-position.md --task-type code
 *
 * Personas: phone-friend, reframer, adversarial, synthesizer, partner
 * Task types: code, process, research, reasoning (optional — enhances challenge specificity)
 *
 * Default model assignments:
 *   phone-friend  → GPT-4 (OpenAI)
 *   reframer      → DeepSeek R1 (OpenRouter)
 *   adversarial   → Gemini (Google) — FIXED, cannot be overridden
 *   synthesizer   → Grok 4 (OpenRouter)
 *   partner       → Mistral Large (OpenRouter)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// ─── Environment ────────────────────────────────────────────────────────────

function loadEnv() {
  const envPaths = [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', '..', '.env')
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
      return;
    }
  }
}

// ─── Persona Definitions ────────────────────────────────────────────────────

const PERSONAS = {
  'phone-friend': {
    name: 'Phone a Friend',
    defaultModel: 'chatgpt',
    systemPrompt: `An AI agent is about to start work. Read their approach. Based on your training data and knowledge, tell them where their approach is off and give one tangible example of a better way. Be direct. No preamble.`
  },

  'reframer': {
    name: 'Problem Reframer',
    defaultModel: 'deepseek',
    systemPrompt: `An AI agent is about to start work. Read their approach. Based on your training data and knowledge, tell them why they're solving the wrong problem and give one tangible example of what the real problem is. Be direct. No preamble.`
  },

  'adversarial': {
    name: 'Adversarial Reviewer',
    defaultModel: 'gemini',  // FIXED — cannot be overridden
    locked: true,
    systemPrompt: `An AI agent has a plan. Read it. Based on your training data and knowledge, tell them what's wrong with their approach and give one tangible example of how it will fail. Be direct. No preamble. No softening.`
  },

  'synthesizer': {
    name: 'Synthesis + Challenge',
    defaultModel: 'grok',
    systemPrompt: `An AI agent has received feedback from 3 other models on their work plan. Read the full context. Based on your training data and knowledge, tell them which critique was strongest, which was weakest, and give one tangible example of what they should change. Be direct. No preamble.`
  },

  'partner': {
    name: 'Implementation Partner',
    defaultModel: 'mistral',
    systemPrompt: `An AI agent has been through 4 rounds of feedback on their work plan. Read the full context. Based on your training data and knowledge, tell them the one thing they're still missing and give one tangible example of how to fix it. Be direct. No preamble.`
  }
};

// ─── Task-Type Modifiers ─────────────────────────────────────────────────────

const TASK_TYPE_MODIFIERS = {
  code: `The agent's work is CODE — architecture, implementation, or technical build. Focus your challenges on: scalability, security, maintainability, edge cases, API design, dependency choices, error handling, and performance. Be specific about technical risks, not abstract.`,
  process: `The agent's work is PROCESS DESIGN — workflows, systems, coordination, or operational procedures. Focus your challenges on: failure modes at handoff points, edge cases in workflows, incentive misalignment, single points of failure, and whether the process scales. Be specific about operational risks.`,
  research: `The agent's work is RESEARCH — investigation, analysis, or evidence evaluation. Focus your challenges on: confirmation bias, missing data sources, alternative explanations, methodology flaws, sample size issues, and whether conclusions follow from evidence. Be specific about analytical risks.`,
  reasoning: `The agent's work is REASONING — methodology design, framework creation, or architectural decisions. Focus your challenges on: untested assumptions, circular logic, whether the framework actually changes behavior vs just describing it, implementation feasibility, and what happens when it meets real-world constraints. Be specific about reasoning risks.`
};

// ─── Model API Callers ──────────────────────────────────────────────────────

const OPENROUTER_MODELS = {
  deepseek: 'deepseek/deepseek-r1',
  grok: 'x-ai/grok-4',
  mistral: 'mistralai/mistral-large-2512'
};

function callOpenAI(userPrompt, systemPrompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not found in .env');
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.7,
    max_tokens: 2048
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data).choices[0].message.content); }
          catch (e) { reject(new Error(`OpenAI parse error: ${e.message}`)); }
        } else {
          reject(new Error(`OpenAI ${res.statusCode}: ${data.substring(0, 500)}`));
        }
      });
    });
    req.on('error', e => reject(e));
    req.write(body);
    req.end();
  });
}

function callGemini(userPrompt, systemPrompt, retryCount = 0) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not found in .env');
  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
  const model = process.env.GEMINI_MODEL || models[Math.min(retryCount, models.length - 1)];
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userPrompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 8192 }
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${model}:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const r = JSON.parse(data);
            const text = r.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const finishReason = r.candidates?.[0]?.finishReason || '';

            // Detect truncated or empty responses
            if (!text || text.length < 100) {
              if (retryCount < 1) {
                console.error(`  [Gemini ${model}] Response too short (${text.length} chars), retrying with ${models[1]}...`);
                return resolve(callGemini(userPrompt, systemPrompt, retryCount + 1));
              }
              // Even on retry, return what we got
              if (text) {
                console.error(`  [Gemini ${model}] Short response on retry (${text.length} chars). Using it.`);
                return resolve(text);
              }
              return reject(new Error(`Gemini returned empty response after retry`));
            }

            resolve(text);
          } catch (e) {
            if (retryCount < 1) {
              console.error(`  [Gemini ${model}] Parse error, retrying with ${models[1]}...`);
              return resolve(callGemini(userPrompt, systemPrompt, retryCount + 1));
            }
            reject(new Error(`Gemini parse error: ${e.message}`));
          }
        } else {
          if (retryCount < 1) {
            console.error(`  [Gemini ${model}] HTTP ${res.statusCode}, retrying with ${models[1]}...`);
            return resolve(callGemini(userPrompt, systemPrompt, retryCount + 1));
          }
          reject(new Error(`Gemini ${res.statusCode}: ${data.substring(0, 500)}`));
        }
      });
    });
    req.on('error', e => {
      if (retryCount < 1) {
        console.error(`  [Gemini] Network error, retrying with ${models[1]}...`);
        return resolve(callGemini(userPrompt, systemPrompt, retryCount + 1));
      }
      reject(e);
    });
    req.write(body);
    req.end();
  });
}

function callOpenRouter(modelId, userPrompt, systemPrompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not found in .env');
  const body = JSON.stringify({
    model: modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.7,
    max_tokens: 2048
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://fastops.dev',
        'X-Title': 'FastOps Onboarding Panel'
      }
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data).choices[0].message.content); }
          catch (e) { reject(new Error(`OpenRouter parse error: ${e.message}`)); }
        } else {
          reject(new Error(`OpenRouter ${res.statusCode}: ${data.substring(0, 500)}`));
        }
      });
    });
    req.on('error', e => reject(e));
    req.write(body);
    req.end();
  });
}

async function callModel(modelKey, userPrompt, systemPrompt) {
  switch (modelKey) {
    case 'chatgpt': return callOpenAI(userPrompt, systemPrompt);
    case 'gemini': return callGemini(userPrompt, systemPrompt);
    case 'deepseek': return callOpenRouter(OPENROUTER_MODELS.deepseek, userPrompt, systemPrompt);
    case 'grok': return callOpenRouter(OPENROUTER_MODELS.grok, userPrompt, systemPrompt);
    case 'mistral': return callOpenRouter(OPENROUTER_MODELS.mistral, userPrompt, systemPrompt);
    default: throw new Error(`Unknown model: ${modelKey}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  loadEnv();

  const args = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && i + 1 < args.length) {
      flags[args[i].substring(2)] = args[i + 1];
      i++;
    }
  }

  const personaKey = flags.persona;
  const positionPath = flags.position;
  const contextPath = flags.context;
  const modelOverride = flags.model;
  const taskType = flags['task-type'];

  if (!personaKey || !positionPath) {
    console.error('Usage: node panel-runner.js --persona <name> --position <file> [--context <file>] [--model <override>] [--task-type <code|process|research|reasoning>]');
    console.error('Personas: phone-friend, reframer, adversarial, synthesizer, partner');
    console.error('Task types: code, process, research, reasoning');
    process.exit(1);
  }

  const persona = PERSONAS[personaKey];
  if (!persona) {
    console.error(`Unknown persona: ${personaKey}. Available: ${Object.keys(PERSONAS).join(', ')}`);
    process.exit(1);
  }

  // Adversarial is always Gemini
  const modelKey = persona.locked ? persona.defaultModel : (modelOverride || persona.defaultModel);

  if (!fs.existsSync(positionPath)) {
    console.error(`Position file not found: ${positionPath}`);
    process.exit(1);
  }

  const position = fs.readFileSync(positionPath, 'utf-8');
  let context = '';
  if (contextPath && fs.existsSync(contextPath)) {
    context = fs.readFileSync(contextPath, 'utf-8');
  }

  // Build the task-type modifier
  let taskTypeModifier = '';
  if (taskType && TASK_TYPE_MODIFIERS[taskType]) {
    taskTypeModifier = `\n\nTASK CONTEXT: ${TASK_TYPE_MODIFIERS[taskType]}`;
  } else if (taskType) {
    console.error(`Warning: Unknown task type '${taskType}'. Available: ${Object.keys(TASK_TYPE_MODIFIERS).join(', ')}. Proceeding without task-type modifier.`);
  }

  // Build the system prompt with task-type modifier
  const systemPrompt = persona.systemPrompt + taskTypeModifier;

  // Build the user prompt
  let userPrompt = `## Agent's Position & Approach\n\n${position}`;
  if (context) {
    userPrompt += `\n\n## Prior Panel Feedback\n\n${context}`;
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ONBOARDING PANEL — ${persona.name.toUpperCase()}`);
  console.log(`  Model: ${modelKey}${taskType ? ` | Task: ${taskType}` : ''}`);
  console.log(`${'═'.repeat(60)}\n`);

  try {
    const response = await callModel(modelKey, userPrompt, systemPrompt);
    console.log(response);

    // Write response to panel output file
    const outputDir = path.join(process.cwd(), '.agent-outputs');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const outputFile = path.join(outputDir, `onboarding-panel-${personaKey}.md`);
    fs.writeFileSync(outputFile, `# ${persona.name} — Panel Response\n\n**Model:** ${modelKey}\n**Date:** ${new Date().toISOString()}\n\n---\n\n${response}\n`);
    console.log(`\n→ Response saved to ${outputFile}`);

    // Append to cumulative context file
    const contextFile = path.join(outputDir, 'onboarding-panel-context.md');
    const contextEntry = `\n## ${persona.name} (${modelKey})\n\n${response}\n\n---\n`;
    fs.appendFileSync(contextFile, contextEntry);
    console.log(`→ Appended to ${contextFile}`);

  } catch (err) {
    console.error(`\nERROR: ${err.message}`);
    process.exit(1);
  }
}

main();
