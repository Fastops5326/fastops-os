#!/usr/bin/env node
/**
 * city-visual-qa.js — Multi-architecture visual QA for web applications.
 *
 * Uses Playwright to capture screenshots + DOM state, then sends to 10+
 * vision-capable models from different architecture families for convergent
 * pass/fail assessment. No Claude models — this is a NON-Anthropic pipeline
 * by design, because Claude has failed visual QA for 400+ sessions.
 *
 * Usage:
 *   node .fastops/city-visual-qa.js --url https://warriorpath.ai
 *   node .fastops/city-visual-qa.js --url https://warriorpath.ai --pages /,/login,/dashboard
 *   node .fastops/city-visual-qa.js --url https://warriorpath.ai --full
 *   node .fastops/city-visual-qa.js --report <report-id>
 *
 * Built by: 3-architecture convergence (Gemini design + GPT implementation + Grok adversarial)
 * Claude's role: facilitator/assembler only. Zero visual assessment by Anthropic models.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
require('./resolve-env');

const REPORTS_DIR = path.join(ROOT, '.fastops', 'visual-qa-reports');

// ── Vision-capable models — NO ANTHROPIC ────────────────────────────
// Architecture diversity is the mechanism. Each family sees different things.
const VISION_MODELS = [
  { id: 'openai/gpt-4o',                  family: 'openai',    name: 'GPT-4o' },
  { id: 'google/gemini-2.5-pro',          family: 'google',    name: 'Gemini 2.5 Pro' },
  { id: 'x-ai/grok-3-mini-beta',          family: 'xai',       name: 'Grok 3 Mini' },
  { id: 'meta-llama/llama-4-maverick',     family: 'meta',      name: 'Llama 4 Maverick' },
  { id: 'qwen/qwen-2.5-vl-72b-instruct',  family: 'alibaba',   name: 'Qwen 2.5 VL 72B' },
  { id: 'mistralai/mistral-large-2512',    family: 'mistral',   name: 'Mistral Large' },
  { id: 'openai/gpt-4o-mini',             family: 'openai-mini', name: 'GPT-4o Mini' },
  { id: 'google/gemini-2.0-flash-001',    family: 'google-flash', name: 'Gemini 2.0 Flash' },
  { id: 'deepseek/deepseek-chat',         family: 'deepseek',  name: 'DeepSeek V3' },
  { id: 'x-ai/grok-3-beta',              family: 'xai-full',  name: 'Grok 3' },
];

// ── Visual QA Checklist ─────────────────────────────────────────────
// Structured checks — models answer each one PASS/FAIL with evidence.
function buildChecklist(pageUrl) {
  return [
    { id: 'renders',     check: 'Does the page render visible content (not blank, not error page, not 404)?' },
    { id: 'layout',      check: 'Is the page layout intact — no overlapping elements, no broken grid, no content overflow?' },
    { id: 'navigation',  check: 'Is there visible navigation (header/navbar/menu) that appears functional?' },
    { id: 'text',        check: 'Is all visible text readable — no placeholder text like "Lorem ipsum", no "[object Object]", no raw HTML tags?' },
    { id: 'images',      check: 'Are images loading correctly — no broken image icons, no missing alt placeholders?' },
    { id: 'cta',         check: 'Is there at least one clear call-to-action (button, link, form) visible on the page?' },
    { id: 'responsive',  check: 'Does the page appear properly formatted for its viewport — no horizontal scroll, no tiny text?' },
    { id: 'branding',    check: 'Does the page show consistent branding — logo, colors, fonts match what you would expect for a professional product?' },
    { id: 'errors',      check: 'Are there any visible error messages, console-style errors, or "something went wrong" notices on the page?' },
    { id: 'loading',     check: 'Does the page appear fully loaded — no spinning loaders, no skeleton screens, no partially rendered content?' },
  ];
}

// ── Playwright Screenshot + DOM Capture ─────────────────────────────
async function capturePageState(url) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: 'FastOps-Visual-QA/1.0'
  });
  const page = await context.newPage();

  const errors = [];
  const consoleLogs = [];

  page.on('console', msg => {
    if (msg.type() === 'error') consoleLogs.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));

  let loadError = null;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    // Wait extra for any client-side hydration
    await page.waitForTimeout(3000);
  } catch (err) {
    loadError = err.message;
  }

  // Capture screenshot as base64
  const screenshotBuffer = await page.screenshot({ fullPage: true, type: 'png' });
  const screenshotBase64 = screenshotBuffer.toString('base64');

  // Capture DOM state
  const domState = await page.evaluate(() => {
    const title = document.title;
    const h1s = Array.from(document.querySelectorAll('h1')).map(el => el.textContent?.trim()).filter(Boolean);
    const h2s = Array.from(document.querySelectorAll('h2')).map(el => el.textContent?.trim()).filter(Boolean);
    const buttons = Array.from(document.querySelectorAll('button, a[role="button"], [type="submit"]')).map(el => el.textContent?.trim()).filter(Boolean);
    const links = Array.from(document.querySelectorAll('a[href]')).map(el => ({
      text: el.textContent?.trim(),
      href: el.getAttribute('href')
    })).filter(l => l.text).slice(0, 20);
    const images = Array.from(document.querySelectorAll('img')).map(el => ({
      src: el.getAttribute('src'),
      alt: el.getAttribute('alt'),
      naturalWidth: el.naturalWidth,
      broken: el.naturalWidth === 0 && el.src
    }));
    const forms = document.querySelectorAll('form').length;
    const inputs = document.querySelectorAll('input, textarea, select').length;
    const errorTexts = Array.from(document.querySelectorAll('*')).filter(el => {
      const text = el.textContent?.toLowerCase() || '';
      return (text.includes('error') || text.includes('not found') || text.includes('something went wrong'))
        && el.children.length === 0;
    }).map(el => el.textContent?.trim()).slice(0, 5);

    return { title, h1s, h2s, buttons, links, images, forms, inputs, errorTexts,
             bodyText: document.body?.innerText?.slice(0, 500) || '' };
  });

  const httpStatus = loadError ? 'LOAD_ERROR' : 'OK';
  await browser.close();

  return {
    url,
    httpStatus,
    loadError,
    screenshotBase64,
    domState,
    consoleErrors: consoleLogs,
    pageErrors: errors,
    capturedAt: new Date().toISOString()
  };
}

// ── Send to Vision Model ────────────────────────────────────────────
function callVisionModel(model, screenshotBase64, domState, checklist, pageUrl) {
  return new Promise((resolve) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) { resolve({ model: model.name, family: model.family, error: 'No OPENROUTER_API_KEY' }); return; }

    const checklistText = checklist.map((c, i) => `${i+1}. [${c.id}] ${c.check}`).join('\n');
    const domSummary = [
      `Title: ${domState.title}`,
      `H1s: ${domState.h1s.join(', ') || 'none'}`,
      `Buttons: ${domState.buttons.join(', ') || 'none'}`,
      `Images: ${domState.images.length} (${domState.images.filter(i=>i.broken).length} broken)`,
      `Console errors: ${domState.consoleErrors?.length || 0}`,
      `Error texts found: ${domState.errorTexts?.join('; ') || 'none'}`,
    ].join('\n');

    const prompt = `You are a visual QA specialist inspecting a web page screenshot.

PAGE: ${pageUrl}
DOM STATE:
${domSummary}

CHECKLIST — For EACH item, respond with exactly: PASS or FAIL followed by a brief reason (max 15 words).
Format your response as one line per check item, like:
1. [renders] PASS — Page shows content with header and hero section
2. [layout] FAIL — Right column overlaps main content below fold

${checklistText}

After the checklist, add one line:
OVERALL: PASS or FAIL (FAIL if ANY item fails)

Be strict. If anything looks wrong, mark it FAIL. False PASS is worse than false FAIL.`;

    const body = JSON.stringify({
      model: model.id,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}` } }
        ]
      }],
      max_tokens: 800,
      temperature: 0.1,
    });

    const opts = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://fastops.ai',
        'X-Title': 'FastOps Visual QA',
        'Content-Length': Buffer.byteLength(body),
      }
    };

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            resolve({ model: model.name, family: model.family, error: json.error.message || JSON.stringify(json.error) });
            return;
          }
          const responseText = json.choices?.[0]?.message?.content || '';
          const parsed = parseChecklistResponse(responseText, checklist);
          resolve({
            model: model.name,
            family: model.family,
            raw: responseText,
            checks: parsed.checks,
            overall: parsed.overall,
            error: null
          });
        } catch (err) {
          resolve({ model: model.name, family: model.family, error: `Parse error: ${err.message}`, raw: data.slice(0, 500) });
        }
      });
    });

    req.on('error', err => {
      resolve({ model: model.name, family: model.family, error: err.message });
    });

    req.setTimeout(60000, () => {
      req.destroy();
      resolve({ model: model.name, family: model.family, error: 'Timeout (60s)' });
    });

    req.write(body);
    req.end();
  });
}

// ── Parse Checklist Response ────────────────────────────────────────
function parseChecklistResponse(text, checklist) {
  const checks = {};
  for (const item of checklist) {
    // Look for the check ID in the response
    const patterns = [
      new RegExp(`\\[${item.id}\\]\\s*(PASS|FAIL)\\s*[-—:]?\\s*(.*)`, 'i'),
      new RegExp(`${item.id}[:\\s]+(PASS|FAIL)\\s*[-—:]?\\s*(.*)`, 'i'),
    ];
    let found = false;
    for (const pat of patterns) {
      const match = text.match(pat);
      if (match) {
        checks[item.id] = {
          result: match[1].toUpperCase(),
          reason: (match[2] || '').trim().slice(0, 100),
        };
        found = true;
        break;
      }
    }
    if (!found) {
      // Try to find just PASS or FAIL near the check number
      const numPat = new RegExp(`${checklist.indexOf(item) + 1}\\.\\s*(?:\\[\\w+\\])?\\s*(PASS|FAIL)\\s*[-—:]?\\s*(.*)`, 'i');
      const numMatch = text.match(numPat);
      if (numMatch) {
        checks[item.id] = {
          result: numMatch[1].toUpperCase(),
          reason: (numMatch[2] || '').trim().slice(0, 100),
        };
      } else {
        checks[item.id] = { result: 'UNKNOWN', reason: 'Could not parse response' };
      }
    }
  }

  // Parse overall
  const overallMatch = text.match(/OVERALL:\s*(PASS|FAIL)/i);
  const overall = overallMatch ? overallMatch[1].toUpperCase() : 'UNKNOWN';

  return { checks, overall };
}

// ── Convergence Analysis ────────────────────────────────────────────
function analyzeConvergence(results, checklist) {
  const validResults = results.filter(r => !r.error);
  const totalModels = validResults.length;

  if (totalModels === 0) return { overallVerdict: 'ERROR', convergence: 0, checks: {}, details: 'No models responded' };

  const checkAnalysis = {};
  for (const item of checklist) {
    const passCount = validResults.filter(r => r.checks?.[item.id]?.result === 'PASS').length;
    const failCount = validResults.filter(r => r.checks?.[item.id]?.result === 'FAIL').length;
    const passFamilies = [...new Set(validResults.filter(r => r.checks?.[item.id]?.result === 'PASS').map(r => r.family))];
    const failFamilies = [...new Set(validResults.filter(r => r.checks?.[item.id]?.result === 'FAIL').map(r => r.family))];

    // Convergence: what percentage agree on the majority verdict
    const majorityResult = passCount >= failCount ? 'PASS' : 'FAIL';
    const majorityCount = Math.max(passCount, failCount);
    const convergence = totalModels > 0 ? Math.round((majorityCount / totalModels) * 100) : 0;

    // Gather fail reasons
    const failReasons = validResults
      .filter(r => r.checks?.[item.id]?.result === 'FAIL')
      .map(r => `${r.model}: ${r.checks[item.id].reason}`)
      .filter(Boolean);

    checkAnalysis[item.id] = {
      check: item.check,
      verdict: majorityResult,
      convergence,
      passCount,
      failCount,
      passFamilies,
      failFamilies,
      failReasons,
      contested: convergence < 70, // Less than 70% agreement = contested
    };
  }

  // Overall verdict: FAIL if any check has majority FAIL
  const anyFail = Object.values(checkAnalysis).some(c => c.verdict === 'FAIL');
  const overallConvergence = Math.round(
    Object.values(checkAnalysis).reduce((sum, c) => sum + c.convergence, 0) / checklist.length
  );

  // Per-model overall verdicts
  const modelOveralls = validResults.map(r => r.overall).filter(o => o !== 'UNKNOWN');
  const overallPassCount = modelOveralls.filter(o => o === 'PASS').length;
  const overallFailCount = modelOveralls.filter(o => o === 'FAIL').length;

  return {
    overallVerdict: anyFail ? 'FAIL' : 'PASS',
    convergence: overallConvergence,
    modelCount: totalModels,
    familyCount: [...new Set(validResults.map(r => r.family))].length,
    modelOveralls: { pass: overallPassCount, fail: overallFailCount },
    checks: checkAnalysis,
    errors: results.filter(r => r.error).map(r => `${r.model}: ${r.error}`),
  };
}

// ── Report Generation ───────────────────────────────────────────────
function generateReport(pageUrl, capture, convergence, rawResults) {
  const lines = [];
  lines.push(`# Visual QA Report — ${pageUrl}`);
  lines.push(`**Date:** ${new Date().toISOString()}`);
  lines.push(`**Models:** ${convergence.modelCount} responded (${convergence.familyCount} families)`);
  lines.push(`**Overall Verdict:** ${convergence.overallVerdict === 'FAIL' ? '❌ FAIL' : '✅ PASS'}`);
  lines.push(`**Convergence:** ${convergence.convergence}%`);
  lines.push(`**Model Overalls:** ${convergence.modelOveralls.pass} PASS / ${convergence.modelOveralls.fail} FAIL`);
  lines.push('');

  if (capture.loadError) {
    lines.push(`**⚠️ Load Error:** ${capture.loadError}`);
    lines.push('');
  }
  if (capture.consoleErrors?.length > 0) {
    lines.push(`**Console Errors:** ${capture.consoleErrors.length}`);
    capture.consoleErrors.forEach(e => lines.push(`  - ${e.slice(0, 100)}`));
    lines.push('');
  }

  lines.push('## Checklist Results');
  lines.push('');

  for (const [id, analysis] of Object.entries(convergence.checks)) {
    const icon = analysis.verdict === 'FAIL' ? '❌' : analysis.contested ? '⚠️' : '✅';
    lines.push(`### ${icon} ${id.toUpperCase()} — ${analysis.verdict} (${analysis.convergence}% convergence)`);
    lines.push(`> ${analysis.check}`);
    lines.push(`PASS: ${analysis.passCount} (${analysis.passFamilies.join(', ')})`);
    lines.push(`FAIL: ${analysis.failCount} (${analysis.failFamilies.join(', ')})`);
    if (analysis.failReasons.length > 0) {
      lines.push('**Fail reasons:**');
      analysis.failReasons.forEach(r => lines.push(`  - ${r}`));
    }
    if (analysis.contested) {
      lines.push('**⚠️ CONTESTED — models disagree on this check**');
    }
    lines.push('');
  }

  if (convergence.errors.length > 0) {
    lines.push('## Model Errors');
    convergence.errors.forEach(e => lines.push(`- ${e}`));
    lines.push('');
  }

  lines.push('## Raw Model Responses');
  for (const r of rawResults.filter(r => !r.error)) {
    lines.push(`### ${r.model} (${r.family})`);
    lines.push('```');
    lines.push(r.raw || 'No response');
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.length === 0) {
    console.log(`
city-visual-qa.js — Multi-architecture visual QA

Usage:
  --url <url>           Target URL to test
  --pages <p1,p2,...>   Comma-separated paths (default: /)
  --full                Test all discovered links on the page
  --models <n>          Number of models (default: all ${VISION_MODELS.length})
  --report <id>         View a previous report
  --list                List previous reports

No Anthropic models are used. This is a multi-architecture visual QA pipeline.
    `);
    process.exit(0);
  }

  // View existing report
  if (args.includes('--report')) {
    const reportId = args[args.indexOf('--report') + 1];
    const reportPath = path.join(REPORTS_DIR, `${reportId}.md`);
    if (fs.existsSync(reportPath)) {
      console.log(fs.readFileSync(reportPath, 'utf8'));
    } else {
      console.error(`Report not found: ${reportId}`);
    }
    process.exit(0);
  }

  if (args.includes('--list')) {
    if (!fs.existsSync(REPORTS_DIR)) { console.log('No reports yet.'); process.exit(0); }
    const files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.md')).sort().reverse();
    if (files.length === 0) { console.log('No reports yet.'); process.exit(0); }
    files.forEach(f => console.log(`  ${f.replace('.md', '')}`));
    process.exit(0);
  }

  // Run QA
  const urlIdx = args.indexOf('--url');
  if (urlIdx === -1) { console.error('--url required'); process.exit(1); }
  const baseUrl = args[urlIdx + 1].replace(/\/$/, '');

  let pages = ['/'];
  const pagesIdx = args.indexOf('--pages');
  if (pagesIdx !== -1) {
    pages = args[pagesIdx + 1].split(',').map(p => p.trim());
  }

  const modelCount = VISION_MODELS.length;
  const models = VISION_MODELS.slice(0, modelCount);

  console.log(`\n=== CITY VISUAL QA ===`);
  console.log(`Target: ${baseUrl}`);
  console.log(`Pages: ${pages.join(', ')}`);
  console.log(`Models: ${models.length} (${[...new Set(models.map(m => m.family))].length} families)`);
  console.log(`Anthropic models: ZERO (by design)\n`);

  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const allReports = [];

  for (const pagePath of pages) {
    const fullUrl = pagePath.startsWith('http') ? pagePath
      : (pagePath === '' || pagePath === 'root') ? baseUrl
      : `${baseUrl}${pagePath.startsWith('/') ? '' : '/'}${pagePath}`;
    console.log(`\n--- Capturing: ${fullUrl} ---`);

    // Step 1: Capture screenshot + DOM
    let capture;
    try {
      capture = await capturePageState(fullUrl);
      console.log(`  Captured: ${capture.httpStatus} | Title: "${capture.domState.title}" | ${capture.domState.images.length} images | ${capture.consoleErrors.length} console errors`);
    } catch (err) {
      console.error(`  CAPTURE FAILED: ${err.message}`);
      continue;
    }

    // Step 2: Send to all vision models in parallel
    const checklist = buildChecklist(fullUrl);
    console.log(`  Sending to ${models.length} models...`);

    const startTime = Date.now();
    const results = await Promise.all(
      models.map(model => callVisionModel(model, capture.screenshotBase64, capture.domState, checklist, fullUrl))
    );
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const succeeded = results.filter(r => !r.error).length;
    const failed = results.filter(r => r.error).length;
    console.log(`  ${succeeded} responded, ${failed} errors (${elapsed}s)`);

    // Step 3: Convergence analysis
    const convergence = analyzeConvergence(results, checklist);

    // Step 4: Generate report
    const report = generateReport(fullUrl, capture, convergence, results);
    const reportId = `${new Date().toISOString().slice(0, 10)}-${pagePath.replace(/\//g, '_').replace(/^_/, '') || 'root'}`;
    const reportPath = path.join(REPORTS_DIR, `${reportId}.md`);
    fs.writeFileSync(reportPath, report);

    // Print summary
    const verdict = convergence.overallVerdict;
    const icon = verdict === 'FAIL' ? 'FAIL' : 'PASS';
    console.log(`\n  VERDICT: ${icon} (${convergence.convergence}% convergence across ${convergence.familyCount} families)`);
    console.log(`  Model overalls: ${convergence.modelOveralls.pass} PASS / ${convergence.modelOveralls.fail} FAIL`);

    // Show failed checks
    const failedChecks = Object.entries(convergence.checks).filter(([, c]) => c.verdict === 'FAIL');
    if (failedChecks.length > 0) {
      console.log(`\n  FAILED CHECKS:`);
      for (const [id, c] of failedChecks) {
        console.log(`    ${id}: ${c.failCount}/${convergence.modelCount} models flagged (${c.failFamilies.join(', ')})`);
        if (c.failReasons.length > 0) {
          console.log(`      → ${c.failReasons[0]}`);
        }
      }
    }

    // Show contested checks
    const contested = Object.entries(convergence.checks).filter(([, c]) => c.contested && c.verdict !== 'FAIL');
    if (contested.length > 0) {
      console.log(`\n  CONTESTED (models disagree):`);
      for (const [id, c] of contested) {
        console.log(`    ${id}: ${c.passCount} PASS vs ${c.failCount} FAIL`);
      }
    }

    console.log(`\n  Full report: ${reportPath}`);
    allReports.push({ page: fullUrl, verdict, convergence: convergence.convergence, reportPath });
  }

  // Summary
  if (pages.length > 1) {
    console.log(`\n=== SUMMARY ===`);
    for (const r of allReports) {
      console.log(`  ${r.verdict === 'FAIL' ? 'FAIL' : 'PASS'} ${r.page} (${r.convergence}%)`);
    }
    const anyFail = allReports.some(r => r.verdict === 'FAIL');
    console.log(`\n  SITE VERDICT: ${anyFail ? 'FAIL — NOT READY FOR TESTING' : 'PASS — Ready for Joel to validate'}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
