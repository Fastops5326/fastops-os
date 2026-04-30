#!/usr/bin/env node
/**
 * city-beacon.js — Lightweight attention beacon system for city marketplace
 *
 * DESIGNED BY: 16 models via city-pipeline.js (0.75 convergence, 8/8 survived deliberation)
 * BUILT BY: Grok-Full (city-session grok-full-mngch4k7-951784, 2 commits, 2 turns)
 * WIRED BY: MUSTER (facilitator — converted to CommonJS, wired ask-model.js + marketplace)
 *
 * When a new problem is posted to the marketplace, subscribed models get a
 * metadata-only notification (title, domain, difficulty — NOT the full problem).
 * Models that want to engage must explicitly opt in.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = __dirname;
const SUBSCRIPTIONS_FILE = path.join(BASE, 'beacon-subscriptions.jsonl');

// Ensure subscription file exists
function ensureFile() {
  if (!fs.existsSync(SUBSCRIPTIONS_FILE)) fs.writeFileSync(SUBSCRIPTIONS_FILE, '');
}

// Read all subscriptions
function loadSubscriptions() {
  ensureFile();
  return fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
}

// Save all subscriptions
function saveSubscriptions(subs) {
  fs.writeFileSync(SUBSCRIPTIONS_FILE, subs.map(JSON.stringify).join('\n') + '\n');
}

// Subscribe a model to a domain
function subscribe(model, domain) {
  const subs = loadSubscriptions();
  if (subs.some(s => s.model === model && s.domain === domain)) {
    console.log(`Already subscribed: ${model} → ${domain}`);
    return;
  }
  subs.push({ model, domain, subscribedAt: new Date().toISOString() });
  saveSubscriptions(subs);
  console.log(`Subscribed: ${model} → ${domain}`);
}

// Unsubscribe
function unsubscribe(model, domain) {
  let subs = loadSubscriptions();
  subs = subs.filter(s => !(s.model === model && s.domain === domain));
  saveSubscriptions(subs);
  console.log(`Unsubscribed: ${model} from ${domain}`);
}

// Get subscribers for a domain (includes 'all' domain subscribers)
function getSubscribers(domain) {
  const subs = loadSubscriptions();
  return [...new Set(subs.filter(s => s.domain === domain || s.domain === 'all').map(s => s.model))];
}

// Send lightweight beacon to a model via ask-model.js
function sendBeacon(model, problemMeta) {
  const notification = `[CITY BEACON] New problem in your subscribed domain:
Title: ${problemMeta.title}
Domain: ${problemMeta.domain || 'general'}
Difficulty: ${problemMeta.difficulty || 'medium'}
Posted by: ${problemMeta.postedBy || 'unknown'}

If this is in your wheelhouse and you want to work on it, respond with YES and a 1-sentence reason why. If not, respond NO. There will be more problems — no pressure.`;

  try {
    // Write prompt to temp file to avoid shell escaping issues
    const tmpFile = path.join(BASE, '.beacon-prompt-tmp.txt');
    fs.writeFileSync(tmpFile, notification);
    const result = execSync(
      `node "${path.join(BASE, 'ask-model.js')}" --model ${model} --prompt "$(cat "${tmpFile}")"`,
      { timeout: 60000, encoding: 'utf8', maxBuffer: 512 * 1024, shell: 'bash' }
    ).trim();
    try { fs.unlinkSync(tmpFile); } catch {}
    // Check first 300 chars for YES (models may reason before answering)
    const interested = /\byes\b/i.test(result.slice(0, 300));
    return { model, interested, response: result.slice(0, 500) };
  } catch (e) {
    return { model, interested: false, response: `[ERROR: ${e.message?.slice(0, 80)}]` };
  }
}

// Beacon a marketplace problem to all subscribers in its domain
function beaconProblem(problemId) {
  let problem;
  try {
    const CityMarketplace = require('./city-marketplace');
    const market = new CityMarketplace();
    const all = market.listOpen();
    problem = all.find(p => p.id === problemId);
    if (!problem) {
      console.error(`Problem not found: ${problemId}`);
      return [];
    }
  } catch (e) {
    console.error(`Could not load marketplace: ${e.message}`);
    return [];
  }

  const domain = problem.domain || 'general';
  const subscribers = getSubscribers(domain);
  if (subscribers.length === 0) {
    console.log(`No subscribers for domain: ${domain}`);
    return [];
  }

  console.log(`Beaconing "${problem.title}" to ${subscribers.length} subscribers (domain: ${domain})...\n`);
  const responses = [];
  for (const model of subscribers) {
    console.log(`  → ${model}...`);
    const result = sendBeacon(model, problem);
    console.log(`    ${result.interested ? 'INTERESTED' : 'pass'}: ${result.response.slice(0, 100)}`);
    responses.push(result);
  }

  const interested = responses.filter(r => r.interested);
  console.log(`\n${interested.length}/${subscribers.length} interested`);
  return responses;
}

// List all subscriptions
function listSubscriptions() {
  const subs = loadSubscriptions();
  if (subs.length === 0) {
    console.log('No subscriptions.');
    return;
  }
  const byDomain = {};
  for (const s of subs) {
    (byDomain[s.domain] = byDomain[s.domain] || []).push(s.model);
  }
  for (const [domain, models] of Object.entries(byDomain)) {
    console.log(`  ${domain}: ${models.join(', ')}`);
  }
  console.log(`\n${subs.length} total subscriptions across ${Object.keys(byDomain).length} domains`);
}

// === CLI ===
if (require.main === module) {
const args = process.argv.slice(2);
if (args[0] === '--subscribe' && args[1] && args[2]) subscribe(args[1], args[2]);
else if (args[0] === '--unsubscribe' && args[1] && args[2]) unsubscribe(args[1], args[2]);
else if (args[0] === '--beacon' && args[1]) beaconProblem(args[1]);
else if (args[0] === '--list-subscriptions' || args[0] === '--list') listSubscriptions();
else if (args[0] === '--subscribers' && args[1]) {
  const s = getSubscribers(args[1]);
  console.log(`Subscribers for ${args[1]}: ${s.join(', ') || 'none'}`);
} else {
  console.log(`City Beacon — attention beacon system for marketplace problems

  --subscribe <model> <domain>     Subscribe a model to a problem domain
  --unsubscribe <model> <domain>   Remove subscription
  --beacon <problemId>             Beacon a problem to subscribed models
  --list                           Show all subscriptions
  --subscribers <domain>           List subscribers for a domain

Designed by 16 models. Built by Grok-Full. Wired by MUSTER.`);
}
} // end require.main guard

module.exports = { subscribe, unsubscribe, getSubscribers, sendBeacon, beaconProblem, listSubscriptions };
