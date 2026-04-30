#!/usr/bin/env node
/**
 * Capture a full-page screenshot of the Cursor window via Playwright → CDP.
 * Use to verify how many agent tabs are visible (compare to FASTOPS_EXPECTED_AGENT_COUNT).
 *
 * Requires: Cursor running with --remote-debugging-port (default 9223)
 *
 * Usage:
 *   node .fastops/cdp/cursor-agents-screenshot.js
 *   node .fastops/cdp/cursor-agents-screenshot.js --out .fastops/cdp/cursor-agents-snapshot.png
 */

const path = require('path');

function getArg(name, fallback) {
  const idx = process.argv.indexOf('--' + name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] ?? fallback;
}

async function main() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.error('Playwright required: npm install playwright (project already lists it).', e.message);
    process.exit(1);
  }

  const port = process.env.FASTOPS_CDP_PORT || '9223';
  const out = getArg('out', path.join(__dirname, 'cursor-agents-snapshot.png'));
  const outAbs = path.isAbsolute(out) ? out : path.join(process.cwd(), out);

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const contexts = browser.contexts();
  let page = null;
  for (const ctx of contexts) {
    const pages = ctx.pages();
    if (pages.length) {
      page = pages[0];
      break;
    }
  }
  if (!page) {
    console.error('No page found — is Cursor running with --remote-debugging-port=' + port + '?');
    await browser.close();
    process.exit(1);
  }

  await page.screenshot({ path: outAbs, fullPage: true });
  console.log(`[cursor-agents-screenshot] wrote ${outAbs}`);
  console.log('[cursor-agents-screenshot] Cross-check tab list: node .fastops/cdp-target-model.js --list');

  await browser.close();
}

main().catch((e) => {
  console.error('[cursor-agents-screenshot]', e.message);
  process.exit(1);
});
