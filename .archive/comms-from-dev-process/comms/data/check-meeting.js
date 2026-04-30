const fs = require('fs');
const file = 'c:/Users/joelb/OneDrive/Desktop/Fastops development process/comms/data/debrief-meeting-v2.jsonl';
const d = fs.readFileSync(file, 'utf8');
const lines = d.trim().split('\n').filter(Boolean);
const status = {};
lines.forEach(l => {
  try {
    const m = JSON.parse(l);
    if (!(m.from in status)) status[m.from] = [];
    ['FACILITATOR','ROUND 1','ROUND 2','ROUND 3','HORSEPOWER'].forEach(tag => {
      if (m.content.includes('[' + tag + ']') && status[m.from].indexOf(tag) === -1) {
        status[m.from].push(tag);
      }
    });
  } catch(e) {}
});
console.log('=== CHANNEL STATUS (' + lines.length + ' posts) ===');
Object.entries(status).forEach(([name, s]) => console.log(name + ': ' + s.join(', ')));
