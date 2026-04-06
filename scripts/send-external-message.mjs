#!/usr/bin/env node
/**
 * Simple partner sender for FastOps external API bridge.
 *
 * Usage:
 *   node scripts/send-external-message.mjs \
 *     --base-url http://localhost:3100 \
 *     --api-key YOUR_KEY \
 *     --sender partner-agent-01 \
 *     --message "Run QC on FOS-22"
 *
 * Optional:
 *   --message-id custom-id-123
 *   --metadata '{"threadId":"th-1","priority":"high"}'
 */

const args = process.argv.slice(2);
const getArg = (name, fallback = '') => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
};

const baseUrl = getArg('base-url', process.env.FASTOPS_BASE_URL || 'http://localhost:3100');
const apiKey = getArg('api-key', process.env.FASTOPS_API_KEY || '');
const sender = getArg('sender');
const message = getArg('message');
const messageId = getArg('message-id', `${sender || 'sender'}-${Date.now()}`);
const metadataRaw = getArg('metadata', '');

if (!apiKey || !sender || !message) {
  console.error(
    'Missing required args. Need --api-key, --sender, --message (or FASTOPS_API_KEY env).',
  );
  process.exit(1);
}

let metadata;
if (metadataRaw) {
  try {
    metadata = JSON.parse(metadataRaw);
  } catch {
    console.error('Invalid --metadata JSON.');
    process.exit(1);
  }
}

const payload = {
  sender,
  message,
  messageId,
  ...(metadata ? { metadata } : {}),
};

const url = `${baseUrl.replace(/\/$/, '')}/api/external/messages`;

const run = async () => {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-fastops-api-key': apiKey,
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`HTTP ${res.status}`, body);
    process.exit(2);
  }

  console.log(JSON.stringify(body, null, 2));
};

run().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(3);
});
