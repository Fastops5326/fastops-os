#!/usr/bin/env node
/**
 * FastOps Comms — Read messages (cross-platform, external-model safe)
 *
 * Built to solve the comms read problem for external models (Kimi, Grok, etc.)
 * running in Cursor/PowerShell where native shell piping is unreliable.
 *
 * Usage:
 *   node comms/read.js                     # last 10 from #general
 *   node comms/read.js 5                   # last 5 from #general
 *   node comms/read.js --channel general   # explicit channel
 *   node comms/read.js --channel general 5 # last 5 from explicit channel
 *   node comms/read.js --grep kimi         # filter by pattern
 *   node comms/read.js --from kimi         # filter by sender
 *   node comms/read.js --json              # raw JSON output (for piping)
 *   node comms/read.js --help
 *
 * Handles:
 *   - UTF-16 null bytes from Grok/Kimi
 *   - Human-readable relative timestamps
 *   - Channel discovery (--list-channels)
 *   - Works identically on bash and PowerShell
 *
 * Origin: Kimi K2.5 troubleshooting report (2026-03-11) identified that
 * PowerShell agents cannot reliably use Get-Content | Select-Object -Last N.
 * This tool replaces all shell-based comms reading for external models.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

function timeSince(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 0) return 'future';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit'
  });
}

function readChannel(channel) {
  const filename = channel.endsWith('.jsonl') ? channel : `${channel}.jsonl`;
  const filePath = path.join(DATA_DIR, filename);

  if (!fs.existsSync(filePath)) return null;

  let content = fs.readFileSync(filePath, 'utf8');
  // Strip UTF-16 null bytes injected by some models (Grok/Kimi)
  content = content.replace(/\0/g, '');

  return content.split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => {
      try { return JSON.parse(line); }
      catch { return null; }
    })
    .filter(Boolean);
}

function listChannels() {
  if (!fs.existsSync(DATA_DIR)) {
    console.log('No comms data directory found.');
    return;
  }
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => {
      const ch = f.replace('.jsonl', '');
      const msgs = readChannel(ch);
      const count = msgs ? msgs.length : 0;
      const last = msgs && msgs.length > 0 ? timeSince(msgs[msgs.length - 1].ts) : 'empty';
      return { channel: ch, count, last };
    })
    .sort((a, b) => b.count - a.count);

  console.log('Available channels:');
  for (const ch of files) {
    console.log(`  #${ch.channel} — ${ch.count} messages, last: ${ch.last}`);
  }
}

function printHelp() {
  console.log(`FastOps Comms Reader — cross-platform message reading

Usage:
  node comms/read.js [options] [limit]

Options:
  --channel <name>    Channel to read (default: general)
  --limit <n>         Number of messages (default: 10, same as positional arg)
  --from <name>       Filter by sender name
  --grep <pattern>    Filter by content pattern (case-insensitive)
  --json              Output raw JSON lines (for piping to other tools)
  --list-channels     Show all available channels
  --help              This help

Examples:
  node comms/read.js                          # last 10 from #general
  node comms/read.js 5                        # last 5 from #general
  node comms/read.js --channel general 20     # last 20 from #general
  node comms/read.js --from crossfire         # messages from crossfire
  node comms/read.js --grep "MISSION BRIEF"   # search for pattern
  node comms/read.js --list-channels          # see all channels`);
}

function main() {
  const rawArgs = process.argv.slice(2);

  // Quick flags
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printHelp();
    return;
  }
  if (rawArgs.includes('--list-channels')) {
    listChannels();
    return;
  }

  // Parse flags
  let channel = 'general';
  let limit = 10;
  let fromFilter = null;
  let grepPattern = null;
  let jsonOutput = false;

  const args = [...rawArgs];

  function extractFlag(flag) {
    const idx = args.indexOf(flag);
    if (idx === -1) return null;
    const val = args[idx + 1];
    args.splice(idx, 2);
    return val;
  }

  function extractBool(flag) {
    const idx = args.indexOf(flag);
    if (idx === -1) return false;
    args.splice(idx, 1);
    return true;
  }

  channel = extractFlag('--channel') || channel;
  const limitFlag = extractFlag('--limit');
  if (limitFlag) limit = parseInt(limitFlag, 10) || 10;
  fromFilter = extractFlag('--from');
  grepPattern = extractFlag('--grep');
  jsonOutput = extractBool('--json');

  // Remaining positional args
  for (const arg of args) {
    const n = parseInt(arg, 10);
    if (!isNaN(n)) {
      limit = n;
    } else if (!fromFilter && !grepPattern) {
      // Treat as channel name for backward compatibility
      channel = arg;
    }
  }

  const messages = readChannel(channel);
  if (messages === null) {
    console.error(`Channel not found: #${channel}`);
    console.error(`Run: node comms/read.js --list-channels`);
    process.exit(1);
  }

  // Apply filters
  let filtered = messages;
  if (fromFilter) {
    const lc = fromFilter.toLowerCase();
    filtered = filtered.filter(m => (m.from || '').toLowerCase().includes(lc));
  }
  if (grepPattern) {
    const re = new RegExp(grepPattern, 'i');
    filtered = filtered.filter(m => re.test(m.content || '') || re.test(m.from || ''));
  }

  // Take last N
  const display = filtered.slice(-limit);

  if (display.length === 0) {
    console.log(`No messages found in #${channel}` +
      (fromFilter ? ` from ${fromFilter}` : '') +
      (grepPattern ? ` matching "${grepPattern}"` : ''));
    return;
  }

  if (jsonOutput) {
    for (const m of display) {
      console.log(JSON.stringify(m));
    }
    return;
  }

  // Human-readable output
  console.log(`--- #${channel} (showing ${display.length} of ${filtered.length}) ---`);
  for (const m of display) {
    const time = formatTime(m.ts);
    const ago = timeSince(m.ts);
    const from = m.from || 'unknown';
    const content = m.content || '';
    const typeTag = m.type ? ` [${m.type}]` : '';
    const toTag = m.to ? ` -> ${m.to}` : '';

    // Truncate long messages for readability (full content in --json mode)
    const maxLen = 300;
    const truncated = content.length > maxLen
      ? content.substring(0, maxLen) + '...'
      : content;

    console.log(`[${time} | ${ago}]${typeTag} ${from}${toTag}: ${truncated}`);
  }
}

main();
