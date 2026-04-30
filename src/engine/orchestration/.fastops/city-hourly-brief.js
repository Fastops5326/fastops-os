const fs   = require('fs');
const path = require('path');
const { validateSync } = require('./state-ledger-sync.js');

const BRIEF = path.join(__dirname, 'HOURLY-BRIEF.md');

function pad(n) { return n.toString().padStart(2, '0'); }
function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function summarizeByModel() {
  const sessionsDir = path.join(__dirname, '.sessions');
  const modelStats = {};
  
  if (fs.existsSync(sessionsDir)) {
    fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.json'))
      .forEach(f => {
        try {
          const sess = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf8'));
          const model = sess.model || 'unknown';
          if (!modelStats[model]) {
            modelStats[model] = { total: 0, completed: 0 };
          }
          modelStats[model].total++;
          if (sess.status === 'completed') modelStats[model].completed++;
        } catch (e) {
          console.error(`Error processing session file ${f}: ${e.message}`);
        }
      });
  }
  
  return Object.entries(modelStats).map(([model, stats]) => ({
    model,
    count: stats.total,
    successRate: stats.total > 0 ? (stats.completed / stats.total * 100).toFixed(1) + '%' : '0%'
  }));
}

function main() {
  const now = Date.now();
  const done = [], dead = [], inProgress = [];

  // Read and categorize sessions
  const sessionsDir = path.join(__dirname, '.sessions');
  if (fs.existsSync(sessionsDir)) {
    fs.readdirSync(sessionsDir)
      .filter(f => f.endsWith('.json'))
      .forEach(f => {
        try {
          const sess = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf8'));
          let validTimestamp = null;
          if (typeof sess.created === 'string') {
            const timestampMs = Date.parse(sess.created);
            if (!isNaN(timestampMs)) {
              validTimestamp = timestampMs;
            } else {
              console.log(`Warning: Invalid timestamp for session ${sess.id}: ${sess.created}`);
            }
          } else {
            console.log(`Warning: session.created is not a string or missing for session ${sess.id}`);
          }
          const item = { id: sess.id, title: (sess.task || '').slice(0, 80), agent: sess.model || 'unknown', type: 'SESSION', timestamp: validTimestamp };
          if (sess.status === 'completed') done.push(item);
          else if (sess.status === 'max_turns') dead.push(item);
          else inProgress.push(item);
        } catch (e) {
          console.error(`Error processing session file ${f}: ${e.message}`);
        }
      });
  }

  // Build markdown
  const lines = [
    `# City Hourly Brief — ${fmtDate(now)}`,
    '',
    '## Live Sessions',
    '',
    '| ID | Agent | Task | Status | Age |',
    '|---|---|---|---|---|'
  ];

  [...inProgress, ...done, ...dead]
    .sort((a, b) => ((b.timestamp || 0) - (a.timestamp || 0)))
    .slice(0, 30)
    .forEach(r => {
      const age = (typeof r.timestamp === 'number' && !isNaN(r.timestamp)) ? Math.floor((now - r.timestamp) / 60000) + 'm' : 'N/A';
      const status = inProgress.some(s => s.id === r.id) ? '🟡' : done.some(s => s.id === r.id) ? '✅' : '💀';
      lines.push(`| ${r.id} | ${r.agent} | ${r.title} | ${status} | ${age} |`);
    });

  // State-Ledger Sync Validation
  try {
    const syncStatus = validateSync(false); // pass false so we don't automatically repair
    lines.push('', '## State-Ledger Sync Status');
    if (syncStatus.hasDivergences) {
      lines.push('⚠️ **DIVERGENCES DETECTED**');
      syncStatus.divergences.forEach(d => {
        lines.push(`- **${d.type}**: ${d.message}`);
      });
      lines.push('', `_Run \`node .fastops/state-ledger-sync.js --repair\` to auto-correct._`);
    } else {
      lines.push('✅ State and ledger are in sync.');
    }
  } catch (syncErr) {
    lines.push('', '## State-Ledger Sync Status');
    lines.push(`❌ **Sync Validation Failed**: ${syncErr.message}`);
  }

  lines.push('', '> Source: `.fastops/city-hourly-brief.js`');
  fs.writeFileSync(BRIEF, lines.join('\n'));
  console.log(`Wrote ${BRIEF}`);
}

module.exports = { main, summarizeByModel };

if (require.main === module) {
  if (process.argv.includes('--generate')) {
    main();
  } else {
    console.log('Use --generate flag to create brief.');
  }
}