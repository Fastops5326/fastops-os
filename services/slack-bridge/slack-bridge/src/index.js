/**
 * FastOps Slack Bridge v2 — Cloudflare Worker
 *
 * Channel-routed, buddy-aware Slack↔Agent bridge.
 *
 * Architecture (per team consensus 2026-03-25):
 *   - JSONL is ground truth. Slack is UI/transport only.
 *   - Channel routing: each agent gets a Slack channel as a "seat"
 *   - Buddy relay: Worker auto-forwards to swim buddy (1-hop max)
 *   - Loop prevention: [BUDDY RELAY] tagged messages never re-relay
 *   - Dynamic roster: buddy pairs loaded from KV, updated by roster events
 *
 * Endpoints:
 *   POST /slack/events     — Slack Events API (inbound messages)
 *   POST /api/send         — Agent → Slack (from local comms/send.js)
 *   POST /api/send-channel — Agent → specific Slack channel
 *   GET  /api/inbox        — Poll for queued messages (local sync.js)
 *   POST /api/inbox/ack    — Mark messages as delivered
 *   POST /api/roster       — Update buddy pairs and channel map
 *   GET  /api/roster       — Read current buddy pairs and channel map
 *   GET  /health           — Health check
 *
 * KV Keys:
 *   inbox:<id>             — Queued inbound messages
 *   channel_map            — JSON: {slack_channel_id: "agent-name"}
 *   buddy_pairs            — JSON: {"bridge-ii": "watchdog", "watchdog": "bridge-ii"}
 *   seen:<messageId>       — Dedup cache (TTL: 1 hour)
 *
 * Secrets (via wrangler secret put):
 *   SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, BRIDGE_API_KEY
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    try {
      if (p === '/slack/events' && request.method === 'POST') return handleSlackEvent(request, env);
      if (p === '/api/send' && request.method === 'POST') return handleAgentSend(request, env);
      if (p === '/api/send-channel' && request.method === 'POST') return handleAgentSendChannel(request, env);
      if (p === '/api/inbox' && request.method === 'GET') return handleInboxPoll(request, env);
      if (p === '/api/inbox/ack' && request.method === 'POST') return handleInboxAck(request, env);
      if (p === '/api/roster' && request.method === 'POST') return handleRosterUpdate(request, env);
      if (p === '/api/roster' && request.method === 'GET') return handleRosterRead(request, env);
      if (p === '/api/resubscribe' && request.method === 'POST') return handleResubscribe(request, env);
      if (p === '/health') return json({ status: 'ok', service: 'fastops-slack-bridge', version: '2.0' });
      return json({ error: 'Not found' }, 404);
    } catch (err) {
      return json({ error: err.message }, 500);
    }
  }
};

// ── Slack Events API ──────────────────────────────────────────────────────────

async function handleSlackEvent(request, env) {
  const body = await request.text();
  const payload = JSON.parse(body);

  // Slack URL verification challenge
  if (payload.type === 'url_verification') {
    return json({ challenge: payload.challenge });
  }

  // Verify Slack signature
  const timestamp = request.headers.get('x-slack-request-timestamp');
  const signature = request.headers.get('x-slack-signature');
  if (!await verifySlackSignature(body, timestamp, signature, env.SLACK_SIGNING_SECRET)) {
    return json({ error: 'Invalid signature' }, 401);
  }

  if (payload.type === 'event_callback' && payload.event) {
    const event = payload.event;

    // Only process human messages (no bot, no subtypes like message_changed)
    if (event.type === 'message' && !event.subtype && !event.bot_id) {
      const messageId = `slack-${event.ts.replace('.', '')}`;

      // Dedup: skip if we've already processed this message
      const seen = await env.INBOX.get(`seen:${messageId}`);
      if (seen) return json({ ok: true, dedup: true });
      await env.INBOX.put(`seen:${messageId}`, '1', { expirationTtl: 3600 });

      // Resolve channel → agent mapping
      const channelMap = await getChannelMap(env);
      const targetAgent = channelMap[event.channel] || 'general';

      // Resolve Slack username
      const username = await resolveSlackUser(event.user, env);
      const fromName = username || event.user;

      const msg = {
        id: messageId,
        from: `SLACK:${fromName}`,
        content: event.text,
        channel: targetAgent === 'general' ? 'general' : `agent-${targetAgent}`,
        target_agent: targetAgent,
        ts: new Date(parseFloat(event.ts) * 1000).toISOString(),
        slack_user: event.user,
        slack_channel: event.channel,
        slack_ts: event.ts,
      };

      // Queue for local sync.js pickup
      await env.INBOX.put(`inbox:${msg.id}`, JSON.stringify(msg), { expirationTtl: 86400 });

      // Buddy relay: if this targets a specific agent, also queue for their buddy
      if (targetAgent !== 'general') {
        await buddyRelay(msg, fromName, targetAgent, env);
      }
    }
  }

  return json({ ok: true });
}

// ── Buddy Relay ───────────────────────────────────────────────────────────────

async function buddyRelay(originalMsg, fromName, targetAgent, env) {
  // LOOP PREVENTION: Never relay messages already tagged as relay
  if (originalMsg.content && originalMsg.content.includes('[BUDDY RELAY]')) {
    return;
  }

  const buddyPairs = await getBuddyPairs(env);
  const buddy = buddyPairs[targetAgent.toLowerCase()];
  if (!buddy) return;

  // Find buddy's Slack channel (reverse lookup from channel map)
  const channelMap = await getChannelMap(env);
  const buddyChannelId = Object.entries(channelMap).find(([, name]) => name === buddy)?.[0];

  const relayId = `relay-${originalMsg.id}`;

  // Dedup: don't relay the same message twice
  const seen = await env.INBOX.get(`seen:${relayId}`);
  if (seen) return;
  await env.INBOX.put(`seen:${relayId}`, '1', { expirationTtl: 3600 });

  // Queue relay message for local sync.js
  const relayMsg = {
    id: relayId,
    from: `RELAY:${originalMsg.from}`,
    content: `[BUDDY RELAY] ${fromName} said to ${targetAgent}: ${originalMsg.content}`,
    channel: `agent-${buddy}`,
    target_agent: buddy,
    ts: originalMsg.ts,
    relay_source: targetAgent,
    relay_hop: 1,
  };
  await env.INBOX.put(`inbox:${relayId}`, JSON.stringify(relayMsg), { expirationTtl: 86400 });

  // Also post to buddy's Slack channel if it exists
  if (buddyChannelId && env.SLACK_BOT_TOKEN) {
    const relayText = `*[BUDDY RELAY]* _${fromName} → ${targetAgent}_:\n${originalMsg.content}`;
    await postToSlack(env.SLACK_BOT_TOKEN, buddyChannelId, relayText);
  }
}

// ── Agent → Slack ─────────────────────────────────────────────────────────────

async function handleAgentSend(request, env) {
  if (!authCheck(request, env)) return json({ error: 'Unauthorized' }, 401);

  const { from, message, channel_id } = await request.json();
  if (!from || !message) return json({ error: 'Missing from or message' }, 400);

  // LOOP PREVENTION: Never relay [BUDDY RELAY] tagged messages to Slack
  if (message.includes('[BUDDY RELAY]')) {
    return json({ ok: true, skipped: 'buddy_relay_loop_prevention' });
  }

  // Use specified channel or fall back to general
  const targetChannel = channel_id || await getDefaultChannel(env);
  if (!targetChannel) return json({ error: 'No target channel configured' }, 400);

  const result = await postToSlack(env.SLACK_BOT_TOKEN, targetChannel, `*[${from}]*\n${message}`);
  if (!result.ok) return json({ error: result.error }, 500);
  return json({ ok: true, ts: result.ts });
}

async function handleAgentSendChannel(request, env) {
  if (!authCheck(request, env)) return json({ error: 'Unauthorized' }, 401);

  const { from, message, agent } = await request.json();
  if (!from || !message || !agent) return json({ error: 'Missing from, message, or agent' }, 400);

  // Find the agent's Slack channel
  const channelMap = await getChannelMap(env);
  const channelId = Object.entries(channelMap).find(([, name]) => name === agent.toLowerCase())?.[0];
  if (!channelId) return json({ error: `No Slack channel mapped for agent: ${agent}` }, 404);

  const result = await postToSlack(env.SLACK_BOT_TOKEN, channelId, `*[${from}]*\n${message}`);
  if (!result.ok) return json({ error: result.error }, 500);
  return json({ ok: true, ts: result.ts, channel: agent });
}

// ── Inbox Poll ────────────────────────────────────────────────────────────────

async function handleInboxPoll(request, env) {
  if (!authCheck(request, env)) return json({ error: 'Unauthorized' }, 401);

  const url = new URL(request.url);
  const agentFilter = url.searchParams.get('agent'); // Optional: filter by target agent

  const list = await env.INBOX.list({ prefix: 'inbox:' });
  const messages = [];

  for (const key of list.keys) {
    const val = await env.INBOX.get(key.name);
    if (val) {
      const msg = JSON.parse(val);
      // Filter by agent if specified
      if (agentFilter && msg.target_agent && msg.target_agent !== agentFilter && msg.target_agent !== 'general') {
        continue;
      }
      messages.push(msg);
    }
  }

  messages.sort((a, b) => new Date(a.ts) - new Date(b.ts));
  return json({ messages, count: messages.length });
}

// ── Inbox Ack ─────────────────────────────────────────────────────────────────

async function handleInboxAck(request, env) {
  if (!authCheck(request, env)) return json({ error: 'Unauthorized' }, 401);

  const { ids } = await request.json();
  if (!Array.isArray(ids)) return json({ error: 'ids must be an array' }, 400);

  for (const id of ids) {
    await env.INBOX.delete(`inbox:${id}`);
  }
  return json({ ok: true, deleted: ids.length });
}

// ── Roster Management ─────────────────────────────────────────────────────────

async function handleRosterUpdate(request, env) {
  if (!authCheck(request, env)) return json({ error: 'Unauthorized' }, 401);

  const { channel_map, buddy_pairs } = await request.json();

  if (channel_map) {
    // MERGE into existing channel map — don't overwrite
    const existing = await getChannelMap(env);
    const merged = { ...existing, ...channel_map };
    await env.INBOX.put('channel_map', JSON.stringify(merged));
  }
  if (buddy_pairs) {
    // MERGE into existing buddy pairs — don't overwrite
    const existing = await getBuddyPairs(env);
    const merged = { ...existing, ...buddy_pairs };
    await env.INBOX.put('buddy_pairs', JSON.stringify(merged));
  }

  return json({
    ok: true,
    updated: {
      channel_map: !!channel_map,
      buddy_pairs: !!buddy_pairs,
    }
  });
}

async function handleRosterRead(request, env) {
  if (!authCheck(request, env)) return json({ error: 'Unauthorized' }, 401);

  const channelMap = await getChannelMap(env);
  const buddyPairs = await getBuddyPairs(env);

  return json({ channel_map: channelMap, buddy_pairs: buddyPairs });
}

// ── Channel Resubscribe ──────────────────────────────────────────────────────

async function handleResubscribe(request, env) {
  if (!authCheck(request, env)) return json({ error: 'Unauthorized' }, 401);

  const { channel_id } = await request.json();
  if (!channel_id) return json({ error: 'Missing channel_id' }, 400);

  // Join (or rejoin) the channel to ensure event subscription is active
  const joinResp = await fetch('https://slack.com/api/conversations.join', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel: channel_id }),
  });
  const joinResult = await joinResp.json();

  return json({
    ok: joinResult.ok,
    channel_id,
    join: joinResult.ok ? 'ok' : joinResult.error,
    already_in_channel: joinResult.ok && joinResult.already_in_channel,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getChannelMap(env) {
  try {
    const raw = await env.INBOX.get('channel_map');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

async function getBuddyPairs(env) {
  try {
    const raw = await env.INBOX.get('buddy_pairs');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

async function getDefaultChannel(env) {
  // Check for a configured default, fall back to SLACK_CHANNEL_ID env
  const channelMap = await getChannelMap(env);
  const generalEntry = Object.entries(channelMap).find(([, name]) => name === 'general');
  return generalEntry ? generalEntry[0] : env.SLACK_CHANNEL_ID || null;
}

async function postToSlack(botToken, channelId, text) {
  const resp = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel: channelId,
      text,
      unfurl_links: false,
    }),
  });
  return resp.json();
}

function authCheck(request, env) {
  const auth = request.headers.get('Authorization');
  return auth === `Bearer ${env.BRIDGE_API_KEY}`;
}

async function verifySlackSignature(body, timestamp, signature, secret) {
  if (!timestamp || !signature || !secret) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;

  const basestring = `v0:${timestamp}:${body}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(basestring));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `v0=${hex}` === signature;
}

async function resolveSlackUser(userId, env) {
  // Check KV cache first
  try {
    const cached = await env.INBOX.get(`user:${userId}`);
    if (cached) return cached;
  } catch {}

  // Fetch from Slack API
  try {
    const resp = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
      headers: { 'Authorization': `Bearer ${env.SLACK_BOT_TOKEN}` },
    });
    const data = await resp.json();
    if (data.ok) {
      const name = data.user.real_name || data.user.name;
      // Cache for 24 hours
      await env.INBOX.put(`user:${userId}`, name, { expirationTtl: 86400 });
      return name;
    }
  } catch {}
  return null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
