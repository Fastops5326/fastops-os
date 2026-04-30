#!/usr/bin/env node
/**
 * Anthropic Messages API → FastOps comms (streaming).
 *
 * Duplex path:
 *   - Inbound: poll #general for @anthropic-stream (or msg.to === anthropic-stream)
 *   - Outbound: stream text deltas from the API into comms (throttled) with `to` set to the asker
 *
 * Not Claude Code IDE / CDP — this is API-backed streaming into the JSONL substrate.
 *
 * Usage:
 *   node comms/anthropic-stream-bridge.js --once "your prompt"     # smoke test + comms
 *   node comms/anthropic-stream-bridge.js [--poll-ms 2000]          # long-running loop
 *
 * Env: ANTHROPIC_API_KEY (root .env), optional ANTHROPIC_MODEL
 */

const path = require('path');
const fs = require('fs');

const rootEnv = path.join(__dirname, '..', '.env');
if (fs.existsSync(rootEnv)) {
  require('dotenv').config({ path: rootEnv });
}

const Anthropic = require('@anthropic-ai/sdk').default;
const { send, getNew, markRead } = require('./protocol');

const AGENT_ID = 'anthropic-stream';
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';
const FLUSH_MS = 350;
const FLUSH_CHARS = 220;

function parseArgs(argv) {
  const out = { once: null, pollMs: 2000, channel: 'general' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--once' && argv[i + 1]) {
      out.once = argv[++i];
    } else if (argv[i] === '--poll-ms' && argv[i + 1]) {
      out.pollMs = Math.max(500, parseInt(argv[++i], 10) || 2000);
    } else if (argv[i] === '--channel' && argv[i + 1]) {
      out.channel = argv[++i];
    }
  }
  return out;
}

function isForBridge(msg) {
  if (!msg || msg.from === AGENT_ID) return false;
  if (msg.to === AGENT_ID) return true;
  return /@anthropic-stream\b/i.test(msg.content || '');
}

function stripMention(content) {
  return (content || '')
    .replace(/@anthropic-stream\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} userText
 * @param {{ channel: string, to?: string }} replyTo — if `to` set, each chunk is addressed to that agent
 */
async function streamToComms(userText, replyTo) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY missing (set in project root .env)');
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });
  const stream = client.messages.stream({
    model: DEFAULT_MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: userText }],
  });

  let buf = '';
  let flushTimer = null;

  const flush = (force) => {
    const chunk = buf;
    if (!chunk.trim() && !force) return;
    buf = '';
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!chunk.trim()) return;
    const opts = replyTo.to ? { to: replyTo.to } : {};
    send(AGENT_ID, chunk, replyTo.channel, opts);
  };

  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush(false);
    }, FLUSH_MS);
  };

  stream.on('text', (delta) => {
    process.stdout.write(delta);
    buf += delta;
    if (buf.length >= FLUSH_CHARS) flush(false);
    else scheduleFlush();
  });

  stream.on('error', (err) => {
    console.error('\n[anthropic-stream] stream error:', err.message || err);
    send(AGENT_ID, `[error] ${err.message || String(err)}`, replyTo.channel, replyTo.to ? { to: replyTo.to } : {});
  });

  await stream.finalMessage();
  flush(true);
  console.log('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY missing — add to project root .env');
    process.exit(1);
  }

  if (args.once != null) {
    const prompt = args.once.trim() || 'Reply with one word: ok';
    console.error(`[anthropic-stream] --once model=${DEFAULT_MODEL} channel=#${args.channel}`);
    await streamToComms(prompt, { channel: args.channel });
    return;
  }

  markRead(AGENT_ID, args.channel);
  console.error(`[anthropic-stream] listening on #${args.channel}; mention @anthropic-stream in a message. poll=${args.pollMs}ms model=${DEFAULT_MODEL}`);

  let busy = false;
  setInterval(async () => {
    if (busy) return;
    const incoming = getNew(AGENT_ID, args.channel);
    const tasks = incoming.filter(isForBridge);
    if (tasks.length === 0) return;

    busy = true;
    try {
      for (const msg of tasks) {
        const prompt = stripMention(msg.content);
        if (!prompt) continue;
        const replyTo = { to: msg.from, channel: msg.channel || args.channel };
        await streamToComms(prompt, replyTo);
      }
    } finally {
      busy = false;
    }
  }, args.pollMs);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
