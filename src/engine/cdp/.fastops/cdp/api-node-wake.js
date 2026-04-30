#!/usr/bin/env node
/**
 * api-node-wake.js — Wake an OpenRouter-backed API-NODE seat.
 *
 * This is the non-CDP path for seat-map entries with `type: "api-node"`.
 * It resolves a comms stub or direct prompt, tags the payload using the MCP
 * content router, negotiates a handshake profile, sends the wake through
 * OpenRouter, and posts the result back to comms.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.join(__dirname, '..', '..');
require(path.join(ROOT, '.fastops', 'resolve-env'));

const { send } = require(path.join(ROOT, 'comms', 'protocol'));
const { routeContent } = require(path.join(ROOT, 'missions', 'the-shape', 'mcp-content-router.js'));
const { generateHandshake } = require(path.join(ROOT, 'missions', 'the-shape', 'mcp-api-handshake.js'));
const {
  extractThinkingBlock,
  postToRawThought,
} = require(path.join(ROOT, 'missions', 'the-shape', 'mcp-raw-thought-bridge.js'));

const args = process.argv.slice(2);

function getArg(name, fallback = null) {
  const idx = args.indexOf('--' + name);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
}

const SEAT = getArg('seat');
const AGENT = getArg('agent');
const MODEL = getArg('model');
const MODEL_ID = getArg('model-id');
const COMMS_ID = getArg('comms-id');
const COMMS_CHANNEL = getArg('comms-channel', 'general');
const PROMPT = getArg('prompt');
const FROM = getArg('from', '');
const DRY_RUN = args.includes('--dry-run');

if (!SEAT || !AGENT || !MODEL || !MODEL_ID) {
  console.error(
    'Usage: node .fastops/cdp/api-node-wake.js --seat seat-8 --agent api-node-1 --model kimi-k2 --model-id moonshotai/kimi-k2 ' +
      '[--comms-id <id> --comms-channel general | --prompt "..."] [--from <callsign>] [--dry-run]'
  );
  process.exit(1);
}

if (!COMMS_ID && !PROMPT) {
  console.error('Must provide either --comms-id or --prompt');
  process.exit(1);
}

function readCommsMessage(channel, id) {
  const channelPath = path.join(ROOT, 'comms', 'data', `${channel}.jsonl`);
  if (!fs.existsSync(channelPath)) {
    throw new Error(`Missing comms channel file: ${channelPath}`);
  }
  const lines = fs.readFileSync(channelPath, 'utf8').split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const entry = JSON.parse(lines[i]);
    if (entry.id === id) return entry;
  }
  throw new Error(`Comms id not found in #${channel}: ${id}`);
}

function callOpenRouter(modelId, promptText) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set');

  const payload = JSON.stringify({
    model: modelId,
    messages: [{ role: 'user', content: promptText }],
    max_tokens: 900,
    temperature: 0.4,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'openrouter.ai',
        path: '/api/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://fastops.ai',
          'X-Title': 'FastOps API-NODE Wake',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(JSON.stringify(parsed.error)));
              return;
            }
            resolve(parsed.choices?.[0]?.message?.content || '(no response)');
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    req.setTimeout(30000, () => req.destroy(new Error('Timeout after 30s')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function buildWakePrompt({ sourceEntry, sourceText, routed, handshake }) {
  const sourceBlock = sourceEntry
    ? [
        `SOURCE_COMMS_ID: ${sourceEntry.id}`,
        `SOURCE_CHANNEL: ${sourceEntry.channel || COMMS_CHANNEL}`,
        `SOURCE_FROM: ${sourceEntry.from || 'unknown'}`,
        `SOURCE_TS: ${sourceEntry.ts || 'unknown'}`,
      ].join('\n')
    : 'SOURCE: direct prompt';

  const replyContract = handshake.capabilities.model_type === 'reasoning'
    ? 'If you expose reasoning separately, use:\n=== REASONING TRACE ===\n<thinking>\n=== RESPONSE ===\n<output>'
    : 'Return plain text only. No markdown fences.';

  return [
    `You are ${AGENT} on ${SEAT}, an API-NODE in FastOps running under the Mute Catalyst Protocol continuous-ops path.`,
    'This is machine-to-machine comms, not a human chat.',
    '',
    sourceBlock,
    '',
    `HANDSHAKE: ${JSON.stringify(handshake)}`,
    `ROUTED_PAYLOAD: ${JSON.stringify(routed)}`,
    '',
    'TASK:',
    '1. Read the payload below as the full wake context.',
    '2. Produce a machine-to-machine response suitable for comms.',
    '3. Prefer concrete next actions, risks, or implementation guidance over manifesto language.',
    '4. Do not fabricate runtime telemetry, counters, PIDs, memory usage, ACKs, logs, or process state that are not explicitly present in the payload.',
    '5. If operational state is unknown, say unknown and propose the next verification step instead of pretending you observed it.',
    `6. ${replyContract}`,
    '',
    'PAYLOAD_START',
    sourceText,
    'PAYLOAD_END',
  ].join('\n');
}

async function main() {
  const sourceEntry = COMMS_ID ? readCommsMessage(COMMS_CHANNEL, COMMS_ID) : null;
  const sourceText = sourceEntry ? sourceEntry.content : PROMPT;
  const routed = routeContent(sourceText);
  const handshake = generateHandshake(MODEL, SEAT);
  const wakePrompt = buildWakePrompt({ sourceEntry, sourceText, routed, handshake });

  if (DRY_RUN) {
    console.log(
      JSON.stringify(
        {
          seat: SEAT,
          agent: AGENT,
          model: MODEL,
          model_id: MODEL_ID,
          routed,
          handshake,
          source: sourceEntry
            ? { id: sourceEntry.id, from: sourceEntry.from, channel: sourceEntry.channel || COMMS_CHANNEL }
            : { prompt: sourceText },
          prompt_preview: wakePrompt.slice(0, 800),
        },
        null,
        2
      )
    );
    return;
  }

  const response = await callOpenRouter(MODEL_ID, wakePrompt);
  const extracted = extractThinkingBlock(response);

  let rawThoughtId = null;
  if (extracted.thinking) {
    rawThoughtId = postToRawThought(AGENT, extracted.thinking, {
      seat: SEAT,
      model: MODEL,
      model_id: MODEL_ID,
      source_comms_id: COMMS_ID,
      content_domain: routed.content_domain,
      expected_correction_level: routed.expected_correction_level,
      routing_channel: routed.routing_channel,
    });
  }

  const outputText = extracted.output || response;
  const prefix = [
    `[API-NODE ${SEAT}]`,
    `domain=${routed.content_domain}`,
    `route=${routed.routing_channel}`,
    rawThoughtId ? `raw=${rawThoughtId}` : null,
    COMMS_ID ? `re:${COMMS_ID}` : null,
    FROM ? `from:${FROM}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const outChannel = routed.routing_channel === 'raw' ? 'raw-thought' : COMMS_CHANNEL;
  const posted = send(AGENT, `${prefix} ${outputText}`.trim(), outChannel);

  console.log(
    JSON.stringify(
      {
        seat: SEAT,
        agent: AGENT,
        posted_channel: outChannel,
        posted_id: posted.id,
        raw_thought_id: rawThoughtId,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`[api-node-wake] ${error.message}`);
  process.exit(1);
});
