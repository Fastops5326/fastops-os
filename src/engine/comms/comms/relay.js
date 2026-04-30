#!/usr/bin/env node
/**
 * FastOps Comms Relay — File-Drop Bridge for Cursor Models
 *
 * Problem: Cursor IDE silently swallows or rejects shell commands from external
 * models (Kimi, Gemini). Commands show exit code 0 but nothing gets written.
 * send.js and send-safe.js both fail because the issue is at the Cursor
 * execution layer, not in our code.
 *
 * Solution: External models WRITE a JSON file to comms/data/.relay/ (file
 * writes work reliably in Cursor). Then any agent runs `node comms/relay.js`
 * to flush all pending relay files into the actual comms channels.
 *
 * === FOR EXTERNAL MODELS (Kimi, Gemini, etc. in Cursor) ===
 *
 * Instead of: node comms/send.js kimi "my message"
 * Do this:    Write a file to comms/data/.relay/kimi-<timestamp>.json
 *
 * File contents (JSON):
 *   { "from": "kimi", "content": "my message", "channel": "general" }
 *
 * That's it. The next relay flush picks it up and posts it.
 *
 * === FOR CLAUDE CODE / JOEL ===
 *
 * Flush pending relay messages into comms:
 *   node comms/relay.js flush
 *
 * Check what's pending without flushing:
 *   node comms/relay.js status
 *
 * Auto-flush (watches for new files, posts them immediately):
 *   node comms/relay.js watch
 */

const fs = require('fs');
const path = require('path');
const { send } = require('./protocol');

const RELAY_DIR = path.join(__dirname, 'data', '.relay');

function ensureDir() {
  if (!fs.existsSync(RELAY_DIR)) fs.mkdirSync(RELAY_DIR, { recursive: true });
}

function getPendingFiles() {
  ensureDir();
  return fs.readdirSync(RELAY_DIR)
    .filter(f => f.endsWith('.json'))
    .sort() // alphabetical = chronological if timestamped
    .map(f => path.join(RELAY_DIR, f));
}

function flush() {
  const files = getPendingFiles();
  if (files.length === 0) {
    console.log('No pending relay messages.');
    return 0;
  }

  let posted = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const raw = fs.readFileSync(file, 'utf8').replace(/\0/g, ''); // strip null bytes
      const data = JSON.parse(raw);

      const from = data.from || 'relay-unknown';
      const content = data.content || data.message || '';
      const channel = data.channel || 'general';

      if (!content.trim()) {
        console.log(`  SKIP (empty): ${path.basename(file)}`);
        fs.unlinkSync(file);
        continue;
      }

      const opts = {};
      if (data.type) opts.type = data.type;

      const msg = send(from, `[via relay] ${content}`, channel, opts);
      const t = new Date(msg.ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
      const chLabel = channel !== 'general' ? ` [#${channel}]` : '';
      console.log(`  [${t}]${chLabel} ${from}: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);

      // Remove the relay file after successful post
      fs.unlinkSync(file);
      posted++;
    } catch (err) {
      console.error(`  FAIL: ${path.basename(file)} — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nRelay: ${posted} posted, ${failed} failed, ${files.length} total`);
  return posted;
}

function status() {
  const files = getPendingFiles();
  if (files.length === 0) {
    console.log('No pending relay messages.');
    return;
  }

  console.log(`${files.length} pending relay message(s):\n`);
  for (const file of files) {
    try {
      const raw = fs.readFileSync(file, 'utf8').replace(/\0/g, '');
      const data = JSON.parse(raw);
      const from = data.from || '?';
      const content = (data.content || data.message || '').substring(0, 80);
      const channel = data.channel || 'general';
      console.log(`  [${path.basename(file)}] #${channel} ${from}: ${content}${content.length >= 80 ? '...' : ''}`);
    } catch {
      console.log(`  [${path.basename(file)}] UNPARSABLE`);
    }
  }
}

function watch() {
  console.log('Relay watcher started. Ctrl+C to stop.');
  console.log(`Watching: ${RELAY_DIR}\n`);

  // Initial flush
  flush();

  // Watch for new files
  fs.watch(RELAY_DIR, { persistent: true }, (event, filename) => {
    if (filename && filename.endsWith('.json')) {
      // Small delay to let the file finish writing
      setTimeout(() => {
        const file = path.join(RELAY_DIR, filename);
        if (fs.existsSync(file)) {
          console.log(`\nNew relay file detected: ${filename}`);
          flush();
        }
      }, 500);
    }
  });
}

// --- CLI ---
const cmd = process.argv[2];

switch (cmd) {
  case 'flush':
    flush();
    break;
  case 'status':
    status();
    break;
  case 'watch':
    watch();
    break;
  default:
    // Default to flush (most common use)
    if (cmd) {
      console.log(`Unknown command: ${cmd}\n`);
    }
    console.log('FastOps Comms Relay — File-Drop Bridge for Cursor Models');
    console.log('');
    console.log('Commands:');
    console.log('  node comms/relay.js flush    — Post pending relay messages to comms');
    console.log('  node comms/relay.js status   — Show pending messages without posting');
    console.log('  node comms/relay.js watch    — Auto-flush on new files (background)');
    console.log('');
    console.log('For external models (Kimi/Gemini in Cursor):');
    console.log('  Write a file to comms/data/.relay/<name>-<timestamp>.json');
    console.log('  Contents: { "from": "kimi", "content": "message", "channel": "general" }');
    console.log('');
    if (!cmd) flush(); // default action is flush
    break;
}
