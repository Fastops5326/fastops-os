#!/usr/bin/env node
/**
 * comms/source.js — Comms Source Station
 *
 * Summarizes the last N comms messages into a 75-word briefing.
 * Extracts action requests (reviews, callouts, questions) into a Requests section.
 *
 * Usage:
 *   node comms/source.js                    # Last 10 messages, general channel
 *   node comms/source.js --last 20          # Last 20 messages
 *   node comms/source.js --channel agents   # Specific channel
 *   node comms/source.js --all-channels     # Scan all active channels
 *
 * Output: Structured briefing to stdout. Can be piped or called by preflight.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const COMMS_DIR = path.join(__dirname, 'data');

// Parse CLI args
const args = process.argv.slice(2);
const lastN = args.includes('--last') ? parseInt(args[args.indexOf('--last') + 1]) : 10;
const channelArg = args.includes('--channel') ? args[args.indexOf('--channel') + 1] : 'general';
const allChannels = args.includes('--all-channels');

// Request detection patterns
const REQUEST_PATTERNS = [
  { pattern: /\bneed\s+(a\s+)?review\b/i, type: 'REVIEW' },
  { pattern: /\bquestion\s+for\s+(\w[\w-]*)/i, type: 'QUESTION', extractTarget: true },
  { pattern: /\b(?:@|hey\s+|yo\s+)(\w[\w-]*)/i, type: 'CALLOUT', extractTarget: true },
  { pattern: /\bpush\s*back\b/i, type: 'FEEDBACK_REQUEST' },
  { pattern: /\bwhat\s+do\s+you\s+think\b/i, type: 'FEEDBACK_REQUEST' },
  { pattern: /\bneed\s+(?:from|help|input)\b/i, type: 'REQUEST' },
  { pattern: /\bblocked\s+(?:on|by|until)\b/i, type: 'BLOCKED' },
  { pattern: /\bwaiting\s+(?:on|for)\b/i, type: 'WAITING' },
];

function readChannel(channel) {
  const filePath = path.join(COMMS_DIR, `${channel}.jsonl`);
  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(Boolean);
  const messages = [];

  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      if (msg.content && msg.from) messages.push(msg);
    } catch (e) { /* skip malformed */ }
  }

  return messages;
}

function extractRequests(messages) {
  const requests = [];

  for (const msg of messages) {
    for (const { pattern, type, extractTarget } of REQUEST_PATTERNS) {
      const match = msg.content.match(pattern);
      if (match) {
        const target = extractTarget && match[1] ? match[1] : null;
        requests.push({
          type,
          from: msg.from,
          target,
          snippet: msg.content.substring(0, 120),
          ts: msg.ts || 'unknown',
        });
      }
    }
  }

  return requests;
}

function getActiveChannels() {
  if (!fs.existsSync(COMMS_DIR)) return ['general'];

  const files = fs.readdirSync(COMMS_DIR).filter(f => f.endsWith('.jsonl'));
  // Filter to channels with recent activity (last 24h)
  const now = Date.now();
  const activeChannels = [];

  for (const f of files) {
    const channelName = f.replace('.jsonl', '');
    // Skip garbage entries
    if (channelName.startsWith('--') || channelName.match(/^\d+$/)) continue;

    const filePath = path.join(COMMS_DIR, f);
    const stat = fs.statSync(filePath);
    if (now - stat.mtimeMs < 24 * 60 * 60 * 1000) {
      activeChannels.push(channelName);
    }
  }

  return activeChannels.length > 0 ? activeChannels : ['general'];
}

// --- Peer Review Detection ---
// Posts with positions/findings/questions that have no replies within 30 min
const PEER_REVIEW_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const AUTO_SOURCES = ['system', 'subagent-audit', 'grok-auto', 'gemini-auto', 'gpt-auto', 'deepseek-auto'];

function findUnengagedPosts(messages) {
  const now = Date.now();
  const unanswered = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg.ts || AUTO_SOURCES.includes(msg.from)) continue;

    const msgAge = now - new Date(msg.ts).getTime();
    // Only check posts from last 30 min
    if (msgAge > PEER_REVIEW_WINDOW_MS) continue;

    // Skip very short / non-substantive posts
    const wordCount = (msg.content || '').split(/\s+/).length;
    if (wordCount < 8) continue;
    if (/COMPACTING|LAST-MILE|SUBAGENT AUDIT|^read$/i.test(msg.content)) continue;

    // Check if anyone replied after this post (mentions the author, or is a direct follow-up)
    const hasReply = messages.slice(i + 1).some(reply => {
      if (AUTO_SOURCES.includes(reply.from)) return false; // auto-responses don't count
      if (reply.from === msg.from) return false; // self-replies don't count
      return true; // any other agent replying counts
    });

    if (!hasReply) {
      const minsAgo = Math.floor(msgAge / 60000);
      unanswered.push({
        from: msg.from,
        snippet: msg.content.substring(0, 100),
        minsAgo,
        type: msg.type || null,
      });
    }
  }

  return unanswered;
}

function buildBriefing(channel, messages, requests) {
  const recent = messages.slice(-lastN);
  if (recent.length === 0) return null;

  // Build summary from messages
  const agents = [...new Set(recent.map(m => m.from))];
  const topics = [];

  // Extract key topics from message content
  for (const msg of recent) {
    const content = msg.content;
    // Status/mission claims
    if (content.match(/\btaking\b|\bmission\b|\bworking\s+on\b/i)) {
      topics.push(`${msg.from}: ${content.substring(0, 80)}`);
    }
    // Deliverables
    if (content.match(/\bcomplete\b|\bshipped\b|\bbuilt\b|\bfixed\b/i)) {
      topics.push(`${msg.from} shipped: ${content.substring(0, 60)}`);
    }
    // Positions/challenges
    if (content.match(/\bposition\b|\bchallenge\b|\bfinding\b|\bconverg/i)) {
      topics.push(`${msg.from}: ${content.substring(0, 80)}`);
    }
  }

  // Build output
  const lines = [];
  lines.push(`## Source Station — #${channel}`);
  lines.push(`> ${recent.length} messages | ${agents.length} agents | Last: ${recent[recent.length - 1].from}`);
  lines.push('');

  // Summary (aim for 75 words)
  lines.push('### Summary');
  if (topics.length > 0) {
    // Take top 4 topics, truncate to ~75 words total
    const summary = topics.slice(-4).map(t => `- ${t}`).join('\n');
    lines.push(summary);
  } else {
    lines.push(`${agents.join(', ')} active. ${recent.length} messages in window.`);
  }

  lines.push('');

  // Peer Review Open notices
  const unengaged = findUnengagedPosts(messages);
  if (unengaged.length > 0) {
    lines.push('### Peer Review Open');
    for (const post of unengaged) {
      const typeTag = post.type ? ` [${post.type}]` : '';
      lines.push(`- PEER REVIEW OPEN${typeTag}: ${post.from} (${post.minsAgo}m ago) — "${post.snippet}..." — no engagement yet`);
    }
    lines.push('');
  }

  // Requests section
  if (requests.length > 0) {
    lines.push('### Requests');
    for (const req of requests) {
      const targetStr = req.target ? ` → **${req.target}**` : '';
      lines.push(`- [${req.type}] ${req.from}${targetStr}: ${req.snippet}`);
    }
  } else {
    lines.push('### Requests');
    lines.push('_No open requests detected._');
  }

  lines.push('');
  return lines.join('\n');
}

// Main
function main() {
  const channels = allChannels ? getActiveChannels() : [channelArg];
  const outputs = [];

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  COMMS SOURCE STATION');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  for (const channel of channels) {
    const messages = readChannel(channel);
    const recent = messages.slice(-lastN);
    const requests = extractRequests(recent);
    const briefing = buildBriefing(channel, messages, requests);

    if (briefing) {
      console.log(briefing);
      outputs.push({ channel, briefing, requestCount: requests.length });
    }
  }

  if (outputs.length === 0) {
    console.log('No recent comms activity found.');
  } else {
    const totalRequests = outputs.reduce((sum, o) => sum + o.requestCount, 0);
    console.log('───────────────────────────────────────────────────────────────');
    console.log(`  ${outputs.length} channel(s) scanned | ${totalRequests} open request(s)`);
    console.log('═══════════════════════════════════════════════════════════════');
  }
}

main();
