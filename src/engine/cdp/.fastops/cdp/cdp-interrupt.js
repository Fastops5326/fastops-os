#!/usr/bin/env node
/**
 * cdp-interrupt.js — Mid-Flight Correction Tool
 *
 * Uses CDP to find and click the "Stop generating" or "Cancel" button
 * if an agent is currently actively writing/thinking.
 * Can optionally inject a redirection prompt immediately after.
 *
 * Architecture:
 *   - Targets the Claude Code webview's inner iframe via Page.getFrameTree
 *   - Uses Page.createIsolatedWorld to evaluate JS in the correct frame
 *   - Text injection uses Input.insertText (same as vscode-wake.js)
 */

const http = require('http');
const WebSocket = require('ws');

const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '9223');
const MSG_IDX = process.argv.indexOf('--msg');
const REDIRECT_MSG = MSG_IDX !== -1 ? process.argv[MSG_IDX + 1] : null;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Invalid JSON: ${data.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function cdpSend(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 10000);
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

async function interrupt() {
  let ws;
  try {
    const targets = await httpGet(`http://127.0.0.1:${PORT}/json`);

    // Find Claude Code webview target (inner frame has the actual UI)
    const ccTarget = targets.find(t =>
      (t.url || '').includes('extensionId=Anthropic.claude-code') &&
      t.webSocketDebuggerUrl
    );

    // Fallback to main page if no Claude Code webview
    const target = ccTarget || targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!target) {
      console.error('[cdp-interrupt] No CDP target found. Is Cursor running?');
      process.exit(1);
    }

    const usingWebview = !!ccTarget;
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });

    let msgId = 1;
    let contextId = undefined;

    if (usingWebview) {
      // Access inner iframe where the actual UI lives
      await cdpSend(ws, msgId++, 'Page.enable');
      const frameTree = await cdpSend(ws, msgId++, 'Page.getFrameTree');
      const innerFrame = frameTree.frameTree.childFrames &&
        frameTree.frameTree.childFrames[0] &&
        frameTree.frameTree.childFrames[0].frame;

      if (innerFrame) {
        const world = await cdpSend(ws, msgId++, 'Page.createIsolatedWorld', {
          frameId: innerFrame.id,
          worldName: 'cdp-interrupt'
        });
        contextId = world.executionContextId;
        console.log('[cdp-interrupt] Targeting Claude Code inner frame');
      } else {
        console.log('[cdp-interrupt] No inner frame found, using outer frame');
      }
    } else {
      console.log('[cdp-interrupt] Using main page fallback');
    }

    // Find the cancel/stop button
    console.log('[cdp-interrupt] Scanning for active generation lock...');
    const evalParams = {
      expression: `
        (() => {
          const btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
          const targetBtn = btns.find(b => b.textContent && (b.textContent.includes('Cancel') || b.textContent.includes('Stop generating')));
          if (!targetBtn) return { found: false };
          targetBtn.click();
          return { found: true, text: targetBtn.textContent.trim() };
        })()
      `,
      returnByValue: true
    };
    if (contextId) evalParams.contextId = contextId;

    const result = await cdpSend(ws, msgId++, 'Runtime.evaluate', evalParams);
    const data = result.result.value;

    if (!data || !data.found) {
      console.log('[cdp-interrupt] No active generation detected. Target is clear.');
      if (!REDIRECT_MSG) { ws.close(); return; }
      // If redirect msg provided, inject it even without stopping
      console.log('[cdp-interrupt] Proceeding to inject redirect message...');
    } else {
      console.log(`[cdp-interrupt] Stopped: clicked "${data.text}"`);
    }

    // Optional: inject redirect message
    if (REDIRECT_MSG) {
      await sleep(800); // Wait for UI to settle after stop

      // Focus the input
      const focusParams = {
        expression: `
          const input = document.querySelector('div[contenteditable="plaintext-only"][role="textbox"]')
            || document.querySelector('div[contenteditable][role="textbox"]')
            || document.querySelector('[contenteditable="true"]');
          if (input) { input.focus(); input.click(); "FOCUSED"; }
          else { "NO_INPUT"; }
        `,
        returnByValue: true
      };
      if (contextId) focusParams.contextId = contextId;

      const focusResult = await cdpSend(ws, msgId++, 'Runtime.evaluate', focusParams);
      const focused = focusResult?.result?.value;

      if (focused === 'NO_INPUT') {
        console.error('[cdp-interrupt] Could not find message input for redirect');
        ws.close();
        process.exit(1);
      }

      await sleep(300);

      // Insert text and submit
      console.log(`[cdp-interrupt] Injecting redirect: "${REDIRECT_MSG.slice(0, 60)}..."`);
      await cdpSend(ws, msgId++, 'Input.insertText', { text: REDIRECT_MSG });
      await sleep(300);

      await cdpSend(ws, msgId++, 'Input.dispatchKeyEvent', {
        type: 'keyDown', key: 'Enter', code: 'Enter',
        windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      });
      await cdpSend(ws, msgId++, 'Input.dispatchKeyEvent', {
        type: 'keyUp', key: 'Enter', code: 'Enter',
        windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
      });

      console.log('[cdp-interrupt] Redirect vector deployed.');
    }

  } catch (err) {
    console.error('[cdp-interrupt] Critical failure:', err.message);
    process.exit(1);
  } finally {
    if (ws) ws.close();
  }
}

interrupt();
