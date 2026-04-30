// Shared helpers for the GroupMe test kit. Zero external deps.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BASE_URL = 'https://api.groupme.com/v3';
const STATE_DIR = path.join(__dirname, 'state');

function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    throw new Error(
      `No .env file found at ${envPath}\n` +
      `Copy .env.example to .env and fill in your GROUPME_TOKEN.`
    );
  }
  const text = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function requireToken() {
  const token = process.env.GROUPME_TOKEN;
  if (!token || token === 'paste_your_token_here') {
    throw new Error('GROUPME_TOKEN is not set in .env');
  }
  return token;
}

async function api(method, endpoint, body) {
  const token = requireToken();
  const sep = endpoint.includes('?') ? '&' : '?';
  const url = `${BASE_URL}${endpoint}${sep}token=${encodeURIComponent(token)}`;
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);

  const res = await fetch(url, init);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const err = new Error(`GroupMe API ${method} ${endpoint} failed: ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function newGuid() {
  return crypto.randomUUID();
}

function logJson(label, data) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(data, null, 2));
}

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
}

function saveState(filename, data) {
  ensureStateDir();
  const fp = path.join(STATE_DIR, filename);
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
  return fp;
}

function loadState(filename) {
  const fp = path.join(STATE_DIR, filename);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function todayStamp() {
  // Local date YYYY-MM-DD
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

module.exports = {
  loadEnv, requireToken, api, newGuid, logJson, BASE_URL,
  saveState, loadState, todayStamp, STATE_DIR,
};
