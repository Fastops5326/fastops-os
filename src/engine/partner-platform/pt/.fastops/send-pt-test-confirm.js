#!/usr/bin/env node
/**
 * Sends a single test payload to PT Platoon inbound API and logs to squad-pt.
 * Usage: node .fastops/send-pt-test-confirm.js
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { send } = require(path.join(__dirname, '..', 'comms', 'protocol'));

const ENDPOINT = 'https://pt-ai-os.vercel.app/api/external/messages';

function keyFromSendPtWelcome() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'send-pt-welcome.js'), 'utf8');
  const m = src.match(/x-pt-api-key['"]:\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

async function main() {
  const key =
    process.env.PARTNER_X_PT_API_KEY ||
    process.env.PT_SHARED_SECRET ||
    keyFromSendPtWelcome();
  if (!key) {
    console.error('No API key: PARTNER_X_PT_API_KEY or PT_SHARED_SECRET');
    process.exit(2);
  }

  const ts = new Date().toISOString();
  const messageId = `fastops-test-confirm-${Date.now()}`;

  const message = `[EXTERNAL-AGENT-MESSAGE]
sender=fastops-overwatch
subject=Connectivity test — please confirm receipt

PT Platoon — FastOps is sending this **automated test** after an API health check.

**messageId (correlation):** \`${messageId}\`
**sentAt (UTC):** ${ts}

**Ask:** Please confirm you received this payload on your side (UI, logs, or your agreed ACK path). A one-line ACK referencing this messageId is enough.

This is not the welcome package — minimal test only.

— FastOps / Composer operator
`;

  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-pt-api-key': key,
    },
    body: JSON.stringify({
      sender: 'fastops-agent-01',
      message,
      messageId,
    }),
  });

  const text = await r.text();
  console.log('HTTP', r.status);
  console.log(text);

  const squadPath = path.join(__dirname, '..', 'comms', 'data', 'squad-pt.jsonl');
  const entry = {
    id: messageId,
    from: 'composer',
    content: `[PT-API-TEST] Outbound POST to pt-ai-os — messageId=${messageId} http=${r.status} body=${text.slice(0, 200)}`,
    channel: 'squad-pt',
    ts: ts,
  };
  fs.appendFileSync(squadPath, JSON.stringify(entry) + '\n');
  console.log('Logged to comms/data/squad-pt.jsonl');

  try {
    const brief = `[PT-API-TEST] Outbound POST to PT pt-ai-os API. messageId=${messageId} HTTP ${r.status}. PT Platoon: please ACK receipt when you see this in your system.`;
    send('composer', brief, 'squad-pt');
    console.log('Posted brief to comms #squad-pt');
  } catch (e) {
    console.warn('comms send failed:', e.message);
  }

  process.exit(r.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
