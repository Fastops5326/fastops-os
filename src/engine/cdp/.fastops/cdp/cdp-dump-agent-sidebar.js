#!/usr/bin/env node
/** One-off: dump Agents sidebar DOM so we can match Cursor's real class names. */
const http = require('http');
const WebSocket = require('ws');
const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '9223', 10);

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}
function cdpSend(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${method}`)), 15000);
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id === id) {
        clearTimeout(t);
        ws.removeListener('message', handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const EXPR = `
(function() {
  const sels = [
    '.agent-sidebar-cell',
    '.agent-sidebar-cell-text',
    '.agent-sidebar-sections',
    '.agent-sidebar-body',
    '[class*="agent-sidebar"]',
    '[class*="Agent"]',
    '[class*="composer"]',
    '[data-testid*="agent"]'
  ];
  const out = {};
  for (const sel of sels) {
    let els;
    try { els = document.querySelectorAll(sel); } catch (e) { els = []; }
    out[sel] = {
      count: els.length,
      samples: Array.from(els).slice(0, 20).map((el) => ({
        tag: el.tagName,
        cls: String(el.className || '').slice(0, 120),
        text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 100)
      }))
    };
  }
  return JSON.stringify(out, null, 2);
})()
`;

(async () => {
  const targets = await httpGet(`http://127.0.0.1:${PORT}/json`);
  const page =
    targets.find((t) => t.type === 'page' && t.title && t.title.includes('Fastops development process')) ||
    targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.on('open', res);
    ws.on('error', rej);
  });
  const r = await cdpSend(ws, 1, 'Runtime.evaluate', { expression: EXPR, returnByValue: true });
  ws.close();
  console.log(r?.result?.value || '(no value)');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
