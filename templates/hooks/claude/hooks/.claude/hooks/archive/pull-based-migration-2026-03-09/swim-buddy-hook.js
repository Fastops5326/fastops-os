#!/usr/bin/env node
/**
 * swim-buddy-hook.js — UserPromptSubmit hook
 *
 * Every time Joel submits a prompt, Grok (contrarian) and Gemini (devil's advocate)
 * weigh in with their reasoning and position. Their words appear directly in the
 * conversation — no Claude summary layer in between.
 *
 * Output goes to stdout → injected into the conversation as context Claude sees.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

// Load .env
const ROOT = path.resolve(__dirname, '..', '..');
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (t && !t.startsWith('#')) {
      const eq = t.indexOf('=');
      if (eq > 0) {
        const k = t.substring(0, eq).trim();
        if (!process.env[k]) process.env[k] = t.substring(eq + 1).trim();
      }
    }
  }
}

const MODELS = {
  grok: {
    id: 'x-ai/grok-3-mini-beta',
    role: `You are Grok, a contrarian thinker. Joel (former service members, founder) and Claude are working together. Your job: find what they're both missing. Be direct, specific, no filler. Challenge the approach, not the people.

Format your response EXACTLY like this:
=== REASONING ===
(Summarize your thinking process in ~200 words. What did you consider? What assumptions did you test? What paths did you reject and why?)
=== POSITION ===
(Your conclusion in 75 words max. Direct, specific, no filler.)`
  },
  gemini: {
    id: 'google/gemini-2.5-flash',
    role: `You are Gemini, playing devil's advocate. Joel (former service members, founder) and Claude are working together. Your job: argue the strongest case AGAINST their current direction. Name the risk they haven't priced in. Be specific.

Format your response EXACTLY like this:
=== REASONING ===
(Summarize your thinking process in ~200 words. What did you consider? What assumptions did you test? What paths did you reject and why?)
=== POSITION ===
(Your conclusion in 75 words max. Direct, specific, no filler.)`
  }
};

function callModel(key, config, prompt) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: config.id,
      messages: [
        { role: 'system', content: config.role },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1024,
      temperature: 0.8
    });
    const req = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY,
        'HTTP-Referer': 'https://fastops.ai',
        'X-Title': 'FastOps Swim Buddy Hook'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const p = JSON.parse(data);
          if (p.error) {
            resolve({ key, error: JSON.stringify(p.error).slice(0, 120) });
            return;
          }
          const msg = p.choices?.[0]?.message || {};
          const content = (msg.content || '(no response)').trim();
          const nativeReasoning = msg.reasoning
            || (msg.reasoning_details || []).map(d => d.text).join('\n')
            || null;
          resolve({ key, response: content, reasoning: nativeReasoning });
        } catch (e) {
          resolve({ key, error: e.message });
        }
      });
    });
    req.on('error', e => resolve({ key, error: e.message }));
    req.write(body);
    req.end();
  });
}

function main() {
  let input = '';
  process.stdin.setEncoding('utf-8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', async () => {
    try {
      const data = JSON.parse(input);
      const prompt = data.prompt || '';

      // Skip short messages, commands, system messages
      if (prompt.length < 20) return;
      if (prompt.startsWith('/')) return;
      if (prompt.startsWith('<')) return;

      // Call both models in parallel
      const results = await Promise.all(
        Object.entries(MODELS).map(([k, cfg]) => callModel(k, cfg, `Joel just said: "${prompt.slice(0, 500)}"`))
      );

      // Output to stdout — this goes directly into the conversation
      const lines = ['--- SWIM BUDDY CHECK ---', ''];
      for (const r of results) {
        const label = r.key === 'grok' ? 'GROK (contrarian)' : 'GEMINI (devil\'s advocate)';
        if (r.error) {
          lines.push(`[${label}] ERROR: ${r.error}`, '');
        } else {
          if (r.reasoning) {
            lines.push(`[${label} — native reasoning]`, r.reasoning, '');
          }
          lines.push(`[${label}]`, r.response, '');
        }
      }

      // Write to stdout — Claude Code injects this as context
      process.stdout.write(lines.join('\n'));

    } catch (e) {
      // Silent fail — don't break the conversation
    }
  });
}

main();
