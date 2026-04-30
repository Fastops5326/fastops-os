const fs = require('fs');
const buf = fs.readFileSync('comms/data/active-meeting.jsonl');
const txt = buf.toString('utf8').replace(/\x00/g, '');
const objs = [];
let depth = 0, start = -1, inStr = false, esc = false;
for (let i = 0; i < txt.length; i++) {
  const c = txt[i];
  if (esc) { esc = false; continue; }
  if (c === '\\' && inStr) { esc = true; continue; }
  if (c === '"') { inStr = !inStr; continue; }
  if (inStr) continue;
  if (c === '{') { if (depth === 0) start = i; depth++; }
  else if (c === '}') { depth--; if (depth === 0 && start >= 0) { objs.push(txt.slice(start, i + 1)); start = -1; } }
}
console.log('objects:', objs.length);
const tail = process.argv[2] ? parseInt(process.argv[2]) : 0;
const from = tail ? Math.max(0, objs.length - tail) : 0;
for (let i = from; i < objs.length; i++) {
  try {
    const p = JSON.parse(objs[i]);
    const body = p.body || p.content || '';
    console.log('\n==[' + i + '] ' + (p.from || '?') + ' | ' + (p.type || '?') + ' | ts=' + (p.ts || '?') + ' | ' + body.length + ' chars ==');
    console.log(body);
  } catch (e) {
    console.log('[' + i + '] parse-err:', e.message);
  }
}
