#!/usr/bin/env node
/**
 * List Composer-class agent cells in the Cursor Agents sidebar (same DOM rules as cdp-wake peerIndex).
 * Run before batch wakes to confirm count/order matches seat-map peerIndex 0..N.
 *
 *   node .fastops/cdp/cdp-list-composer-peers.js
 *   node .fastops/cdp/cdp-list-composer-peers.js --port 9223 --json
 *   node .fastops/cdp/cdp-list-composer-peers.js --min-count 4   # default squad: four Composer 2 agents (peerIndex 0..3)
 *
 * Requires: Cursor on --remote-debugging-port, Agents panel visible enough for DOM nodes to exist.
 */

const http = require('http');
const WebSocket = require('ws');
const { LIST_EXPRESSION } = require('./cdp-composer-peer-dom');
const { loadSeatMap } = require('./cdp-seat-utils');

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const idx = args.indexOf('--' + name);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
}
const PORT = parseInt(getArg('port', '9223'), 10);
const JSON_ONLY = args.includes('--json');
const MIN_COUNT_RAW = getArg('min-count', null);
const MIN_COUNT =
  MIN_COUNT_RAW !== null && MIN_COUNT_RAW !== '' && !Number.isNaN(parseInt(String(MIN_COUNT_RAW), 10))
    ? parseInt(String(MIN_COUNT_RAW), 10)
    : null;

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

function cdpSend(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 15000);
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id === id) {
        clearTimeout(timeout);
        ws.removeListener('message', handler);
        if (msg.error) reject(new Error(`CDP error: ${msg.error.message}`));
        else resolve(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function connect() {
  const targets = await httpGet(`http://127.0.0.1:${PORT}/json`);
  const devProcess = targets.find(
    (t) => t.type === 'page' && t.title && t.title.includes('Fastops development process')
  );
  const page = devProcess || targets.find((t) => t.type === 'page');
  if (!page) throw new Error('No page target found');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  return ws;
}

async function main() {
  const ws = await connect();
  let nid = 1;
  const nextId = () => nid++;
  const result = await cdpSend(ws, nextId(), 'Runtime.evaluate', {
    expression: LIST_EXPRESSION,
    returnByValue: true,
  });
  ws.close();

  const raw = result?.result?.value;
  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    console.error('[cdp-list-composer-peers] Bad CDP result:', raw);
    process.exit(1);
  }

  if (JSON_ONLY) {
    console.log(JSON.stringify(data, null, 0));
  } else {
    console.log(`Composer peer cells (0-based peerIndex = cdp-wake / seat-map): ${data.count}`);
    for (const p of data.peers || []) {
      console.log(`  [${p.peerIndex}] ${p.label}`);
    }
    try {
      const map = loadSeatMap();
      const hint = [];
      for (const [sid, cfg] of Object.entries(map.seats || {})) {
        if (cfg && cfg.peerIndex !== undefined && cfg.peerIndex !== null) {
          hint.push(`${sid} → peerIndex ${cfg.peerIndex}`);
        }
      }
      if (hint.length) {
        console.log('seat-map peerIndex entries:');
        hint.sort().forEach((h) => console.log(' ', h));
      }
    } catch (_) {
      /* optional */
    }
    if (data.count === 0) {
      console.error(
        '[cdp-list-composer-peers] WARN: 0 cells — not "sidebar closed" necessarily. Run: node .fastops/cdp/cdp-dump-agent-sidebar.js (DOM drift vs .agent-sidebar-cell).'
      );
    }
  }

  if (MIN_COUNT !== null && (data.count || 0) < MIN_COUNT) {
    console.error(
      `[cdp-list-composer-peers] FAIL: count ${data.count} < --min-count ${MIN_COUNT}`
    );
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('[cdp-list-composer-peers]', e.message);
  process.exit(1);
});
