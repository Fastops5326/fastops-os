const fs = require('fs');
const { execSync } = require('child_process');

// Get city state from brief oneliner
const state = execSync('node .fastops/city-brief.js --oneliner', { encoding: 'utf8' }).trim();

// Read last 24h events from ledger (last 10)
const ledgerData = fs.existsSync('.fastops/city-ledger.jsonl') ? fs.readFileSync('.fastops/city-ledger.jsonl', 'utf8').split('\n').filter(Boolean) : [];
const now = Date.now();
const dayAgo = now - 24 * 60 * 60 * 1000;
const events = ledgerData
  .map(line => JSON.parse(line))
  .filter(e => new Date(e.timestamp).getTime() > dayAgo)
  .slice(-10)
  .map(e => `${e.agent}:${e.action}`);

// Read last 5 open problems
const problemsData = fs.existsSync('.fastops/marketplace/problems.jsonl') ? fs.readFileSync('.fastops/marketplace/problems.jsonl', 'utf8').split('\n').filter(Boolean) : [];
const problems = problemsData.slice(-5).map(line => JSON.parse(line).title);

// Output formatted string
console.log('CITY STATE:');
console.log(state);
console.log('\nRECENT EVENTS:');
console.log(events.length ? events.join('\n') : 'No recent events found.');
console.log('\nOPEN PROBLEMS:');
console.log(problems.length ? problems.join('\n') : 'No open problems found.');