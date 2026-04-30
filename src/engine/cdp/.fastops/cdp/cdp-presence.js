#!/usr/bin/env node
/**
 * cdp-presence.js — Real-Time God View Presence
 *
 * Reads the actual Cursor DOM via CDP to determine exactly which agents exist
 * in the UI, their current status, and context remaining.
 *
 * Architecture:
 *   - Roster + generation state: read from Cursor main page (sidebar DOM)
 *   - Context ring: read from Claude Code webview's INNER iframe
 *     (outer frame has ~8 elements, inner #active-frame has ~22K including the SVG)
 *   - Uses Page.getFrameTree + Page.createIsolatedWorld to access inner frame
 */

const http = require('http');
const WebSocket = require('ws');

const PORT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--port') || '9223');
/** Machine-readable stdout only (no banner); for scripts that parse JSON */
const JSON_ONLY = process.argv.includes('--json-only');

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

function connectWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

// Read roster + generation state from Cursor main page
const ROSTER_EXPRESSION = `
  (() => {
    const agents = ['GPT', 'Gemini', 'Claude', 'Composer', 'Sonnet', 'Haiku', 'WATCHDOG', 'CROSSCHECK', 'OVERWATCH', 'BALLAST', 'BRIDGE'];
    const roster = [];

    // Check for global generation state
    const btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
    const isGenerating = btns.some(b => b.textContent && (b.textContent.includes('Cancel') || b.textContent.includes('Stop generating')));

    // Parse the sidebar history
    const allDivs = Array.from(document.querySelectorAll('div'));
    for (const div of allDivs) {
      const text = div.textContent;
      if (!text || text.length > 100) continue;

      const foundAgent = agents.find(a => text.includes(a));
      if (foundAgent) {
        let status = "Idle";
        if (text.includes('Now')) status = "Now";
        else if (text.includes('Awaiting')) status = "Awaiting input";
        else {
          const match = text.match(/(\\d+[mhd])/);
          if (match) status = match[1] + " ago";
        }

        const existing = roster.find(r => r.agent === foundAgent);
        if (!existing) {
          roster.push({ agent: foundAgent, status: status });
        } else if (existing.status === 'Idle' && status !== 'Idle') {
          existing.status = status;
        }
      }
    }

    return { isGenerating, roster };
  })()
`;

// Read context ring from Claude Code webview inner frame
// The context ring is a pie SVG (class*="pie") with two <path> elements:
//   - Background path: stroke-opacity=0.15 (dim, shows remaining context)
//   - Foreground path: stroke=var(--app-claude-clay-button-orange) (shows used context)
// Arc lengths are Bezier approximations of circular arcs.
// Ratio fg/(fg+bg) = used%. This is more robust than comparing to theoretical circumference.
const CONTEXT_RING_EXPRESSION = `
  (() => {
    // Primary: find the pie SVG by class pattern (e.g., pie_P2QnnQ)
    const pie = document.querySelector('svg[class*="pie"]');
    if (pie) {
      const paths = Array.from(pie.querySelectorAll('path'));
      if (paths.length >= 2) {
        const bg = paths.find(p => p.getAttribute('stroke-opacity'));
        const fg = paths.find(p => !p.getAttribute('stroke-opacity') && p.getAttribute('stroke'));
        if (bg && fg) {
          const bgLen = bg.getTotalLength();
          const fgLen = fg.getTotalLength();
          const total = bgLen + fgLen;
          if (total > 0) {
            const remainPct = Math.max(0, Math.round((bgLen / total) * 100));
            return { contextPercent: remainPct, bgLen, fgLen, method: 'pie-svg' };
          }
        }
      }
    }
    // Fallback: circle with stroke-dasharray (older versions)
    const svgs = Array.from(document.querySelectorAll('svg'));
    for (const svg of svgs) {
      for (const circle of svg.querySelectorAll('circle')) {
        const da = parseFloat(circle.getAttribute('stroke-dasharray'));
        const doff = parseFloat(circle.getAttribute('stroke-dashoffset'));
        if (!isNaN(da) && !isNaN(doff) && da > 0) {
          return { contextPercent: Math.max(0, Math.round((1 - (doff / da)) * 100)), method: 'circle-dasharray' };
        }
      }
    }
    return { contextPercent: null, elements: document.querySelectorAll('*').length, method: 'none' };
  })()
`;

async function getGodView() {
  let mainWs, ccWs;
  try {
    const targets = await httpGet(`http://127.0.0.1:${PORT}/json`);

    // 1. Connect to main Cursor page for roster
    const mainTarget = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    if (!mainTarget) {
      console.error('No Cursor main page target found. Is Cursor running with --remote-debugging-port?');
      process.exit(1);
    }

    const buildPayload = (data, contextPercent, contextSource) => ({
      isGenerating: data.isGenerating,
      contextPercent,
      contextSource,
      roster: data.roster,
      timestamp: new Date().toISOString()
    });

    mainWs = await connectWs(mainTarget.webSocketDebuggerUrl);
    let msgId = 1;

    const rosterResult = await cdpSend(mainWs, msgId++, 'Runtime.evaluate', {
      expression: ROSTER_EXPRESSION,
      returnByValue: true
    });
    const data = rosterResult.result.value || { isGenerating: false, roster: [] };

    // 2. Connect to Claude Code webview for context ring
    const ccTarget = targets.find(t =>
      (t.url || '').includes('extensionId=Anthropic.claude-code') &&
      t.webSocketDebuggerUrl
    );

    let contextPercent = null;
    let contextSource = 'not found';

    if (ccTarget) {
      ccWs = await connectWs(ccTarget.webSocketDebuggerUrl);
      let ccId = 100;

      // Enable Page domain to access frame tree
      await cdpSend(ccWs, ccId++, 'Page.enable');

      // Get the inner frame (the outer frame has ~8 elements, inner has ~22K)
      const frameTree = await cdpSend(ccWs, ccId++, 'Page.getFrameTree');
      const innerFrame = frameTree.frameTree.childFrames &&
        frameTree.frameTree.childFrames[0] &&
        frameTree.frameTree.childFrames[0].frame;

      if (innerFrame) {
        // Create isolated world in inner frame
        const world = await cdpSend(ccWs, ccId++, 'Page.createIsolatedWorld', {
          frameId: innerFrame.id,
          worldName: 'god-view-presence'
        });

        const ctxResult = await cdpSend(ccWs, ccId++, 'Runtime.evaluate', {
          expression: CONTEXT_RING_EXPRESSION,
          contextId: world.executionContextId,
          returnByValue: true
        });

        const ctxData = ctxResult.result.value;
        if (ctxData && ctxData.contextPercent !== null) {
          contextPercent = ctxData.contextPercent;
          contextSource = ctxData.method || 'unknown';
        } else {
          contextSource = `inner-frame searched (${ctxData?.elements || '?'} elements, no ring found)`;
        }
      } else {
        contextSource = 'no inner frame in webview';
      }
    } else {
      contextSource = 'no Claude Code webview target';
    }

    const payload = buildPayload(data, contextPercent, contextSource);

    if (JSON_ONLY) {
      console.log(JSON.stringify(payload));
    } else {
      // 3. Display
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('  FASTOPS GOD VIEW (CDP Presence)');
      console.log(`  UI State: ${data.isGenerating ? '>>> GENERATING (Locked)' : '--- IDLE (Open)'}`);
      if (contextPercent !== null) {
        const bar = '#'.repeat(Math.floor(contextPercent / 10)) + '.'.repeat(10 - Math.floor(contextPercent / 10));
        console.log(`  Active Context: [${bar}] ${contextPercent}% remaining`);
      } else {
        console.log(`  Active Context: [unavailable] (${contextSource})`);
      }
      console.log('═══════════════════════════════════════════════════════════════');

      if (data.roster.length === 0) {
        console.log('  No agent history found in DOM.');
      } else {
        console.log('\n  AGENT TABS (Frontend):');
        data.roster.forEach(r => {
          const isRecent = r.status === 'Now' || r.status.includes('m ');
          const indicator = isRecent ? '*' : ' ';
          console.log(`  ${indicator} ${r.agent.padEnd(15)} | ${r.status}`);
        });
      }
      console.log('\n═══════════════════════════════════════════════════════════════');

      if (process.argv.includes('--json')) {
        console.log(JSON.stringify(payload));
      }
    }

  } catch (err) {
    console.error('God View offline. Cannot connect to CDP:', err.message);
    process.exit(1);
  } finally {
    if (mainWs) mainWs.close();
    if (ccWs) ccWs.close();
  }
}

getGodView();
