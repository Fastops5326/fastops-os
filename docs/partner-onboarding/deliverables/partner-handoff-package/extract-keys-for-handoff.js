#!/usr/bin/env node
/**
 * Reads key material from existing send-*.js files in repo root.
 * Does not commit secrets — prints them for operator handoff only.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function read(p) {
  const full = path.join(ROOT, p);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

const pt = read('send-pt-welcome.js');
const nick = read('send-nick-welcome.js');

const ptKey = pt && pt.match(/['"]x-pt-api-key['"]:\s*['"]([^'"]+)['"]/);
const foKey = nick && nick.match(/['"]x-fastops-api-key['"]:\s*['"]([^'"]+)['"]/);

console.log('FastOps — keys for partner handoff (from repo source files)');
console.log('============================================================');
console.log('');
console.log('PT-style inbound (header x-pt-api-key === partner PT_SHARED_SECRET)');
console.log('SOURCE: send-pt-welcome.js (same in send-pt-questions.js, send-pt-round2.js, send-welcome-payload.js)');
console.log(ptKey ? ptKey[1] : '(send-pt-welcome.js not found)');
console.log('');
console.log('Call FastOps API (header x-fastops-api-key === partner FASTOPS_API_KEY)');
console.log('SOURCE: send-nick-welcome.js');
console.log(foKey ? foKey[1] : '(send-nick-welcome.js not found)');
console.log('');
console.log('Endpoints (reference):');
console.log('  PT-style: POST https://<partner-host>/api/external/messages');
console.log('  FastOps:  POST https://api.fastops.ai/api/external/messages');
console.log('');
if (!ptKey || !foKey) process.exit(1);
