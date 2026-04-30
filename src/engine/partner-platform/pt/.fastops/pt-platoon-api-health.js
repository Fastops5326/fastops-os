#!/usr/bin/env node
/**
 * One-shot: PT Platoon inbound API health (pt-ai-os.vercel.app).
 * Key: PARTNER_X_PT_API_KEY or PT_SHARED_SECRET from .env, else matches send-pt-welcome.js embedded value.
 * Does not print secrets.
 */
const fs = require('fs');
const path = require('path');

// Ensure fetch is available (for Node < 18)
if (typeof fetch === 'undefined') {
  global.fetch = require('node-fetch');
}

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ENDPOINT = 'https://pt-ai-os.vercel.app/api/external/messages';

function keyFromSendPtWelcome() {
  try {
    const src = fs.readFileSync(path.join(__dirname, '..', 'send-pt-welcome.js'), 'utf8');
    const m = src.match(/x-pt-api-key['"]:\s*['"]([^'"]+)['"]/);
    if (m) return m[1];
  } catch (err) {
    // If the file doesn't exist or can't be read, just proceed to fallback
  }
  return null;
}

async function main() {
  try {
    const r0 = await fetch('https://pt-ai-os.vercel.app/', { redirect: 'manual' });
    console.log('[host] GET https://pt-ai-os.vercel.app/ ->', r0.status, r0.statusText || '');
  } catch (err) {
    console.error('[host] GET https://pt-ai-os.vercel.app/ failed:', err.message);
    process.exit(1);
  }

  try {
    const rOpt = await fetch(ENDPOINT, { method: 'OPTIONS' });
    console.log('[route] OPTIONS /api/external/messages ->', rOpt.status);
  } catch (err) {
    console.error('[route] OPTIONS /api/external/messages failed:', err.message);
    process.exit(1);
  }

  const key =
    process.env.PARTNER_X_PT_API_KEY ||
    process.env.PT_SHARED_SECRET ||
    keyFromSendPtWelcome();

  if (!key) {
    console.error('[auth] No key: set PARTNER_X_PT_API_KEY or PT_SHARED_SECRET in .env, or add to send-pt-welcome.js');
    process.exit(2);
  }

  let r;
  try {
    r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-pt-api-key': key,
      },
      body: JSON.stringify({
        sender: process.env.PT_HEALTH_SENDER || 'fastops-agent-01',
        message: '[HEALTH] FastOps automated connectivity check — safe to ignore.',
        messageId: 'hc-' + Date.now(),
      }),
    });
  } catch (err) {
    console.error('[POST] /api/external/messages failed:', err.message);
    process.exit(1);
  }

  let text;
  try {
    text = await r.text();
  } catch (err) {
    console.error('[body] Failed to read response text:', err.message);
    process.exit(1);
  }
  
  console.log('[POST] /api/external/messages -> HTTP', r.status);
  // Redact body text to prevent API key or other sensitive data exposure in logs
  console.log('[body] [REDACTED FOR SECURITY]');
  process.exit(r.ok ? 0 : 1);
}

main().catch((e) => {
  console.error('[fail]', e.message);
  process.exit(1);
});
