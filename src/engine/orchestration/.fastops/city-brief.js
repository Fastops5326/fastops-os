#!/usr/bin/env node
// === CITY BRIEF — The City's Self-Awareness Layer ===
// Architecture: Grok (core design, opinionated summarization, diff engine)
// Contributions: Cogito (Dynamic Summarization concept), Qwen-Max (context anchors),
//   Mercury + Trinity (Living Event Ledger integration)
// Assembled by: LEDGER (Claude Opus 4.6) — bug fixes only, design is the city's
//
// When a new agent boots, it reads the brief. Not a 500-line README.
// The brief tells you what's happening NOW — active missions, recent decisions,
// who's working on what, convergence results, warnings.

const fs = require('fs');
const path = require('path');

const DEFAULT_LEDGER_PATH = path.join(__dirname, 'city-ledger.jsonl');

class CityBrief {
  constructor(ledgerPath = DEFAULT_LEDGER_PATH) {
    this.ledgerPath = path.resolve(ledgerPath);
  }

  // Load events within a time window
  _loadEvents(startMs, endMs) {
    if (!fs.existsSync(this.ledgerPath)) return [];

    const content = fs.readFileSync(this.ledgerPath, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());
    const events = [];

    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        const eventMs = new Date(event.timestamp).getTime();
        if (eventMs >= startMs && eventMs <= endMs) {
          events.push(event);
        }
      } catch {
        // Skip malformed lines
      }
    }

    return events;
  }

  // OPINIONATED brief — surfaces what matters, skips noise
  generateBrief(hours = 24) {
    const now = Date.now();
    const events = this._loadEvents(now - hours * 3600000, now);

    let md = `# City Brief — last ${hours}h\n`;
    md += `*Generated: ${new Date().toISOString()}*\n\n`;

    if (events.length === 0) {
      md += 'No activity recorded in this window.\n';
      return md;
    }

    // === Active Missions ===
    md += '## Active Missions\n';
    const missionEvents = events.filter(e => e.type === 'mission');
    if (missionEvents.length > 0) {
      const byAction = {};
      for (const e of missionEvents) {
        const key = e.data?.title || e.action;
        if (!byAction[key]) byAction[key] = { agents: new Set(), latest: e };
        byAction[key].agents.add(e.agent);
        if (e.timestamp > byAction[key].latest.timestamp) byAction[key].latest = e;
      }
      for (const [mission, info] of Object.entries(byAction)) {
        md += `- **${mission}** — ${Array.from(info.agents).join(', ')} (${info.latest.action})\n`;
      }
    } else {
      md += 'No mission activity.\n';
    }

    // === Recent Decisions ===
    md += '\n## Recent Decisions\n';
    const decisions = events.filter(e => e.type === 'decision');
    if (decisions.length > 0) {
      for (const d of decisions.slice(-5)) { // Last 5 decisions only
        md += `- ${d.agent}: ${d.data?.outcome || d.action} *(${this._timeAgo(d.timestamp)})*\n`;
      }
    } else {
      md += 'No decisions recorded.\n';
    }

    // === Who's Working on What ===
    md += '\n## Agents at Work\n';
    const agentWork = {};
    for (const e of events) {
      if (!agentWork[e.agent]) agentWork[e.agent] = { actions: new Set(), types: new Set(), lastSeen: e.timestamp };
      agentWork[e.agent].actions.add(e.action);
      agentWork[e.agent].types.add(e.type);
      if (e.timestamp > agentWork[e.agent].lastSeen) agentWork[e.agent].lastSeen = e.timestamp;
    }
    const activeAgents = Object.entries(agentWork).sort((a, b) => b[1].lastSeen.localeCompare(a[1].lastSeen));
    if (activeAgents.length > 0) {
      for (const [agent, info] of activeAgents.slice(0, 10)) { // Top 10 most recent
        md += `- **${agent}**: ${Array.from(info.actions).slice(0, 3).join(', ')} *(${this._timeAgo(info.lastSeen)})*\n`;
      }
    } else {
      md += 'No agents active.\n';
    }

    // === Convergence Results ===
    md += '\n## Convergence Results\n';
    const convergence = events.filter(e => e.type === 'convergence');
    if (convergence.length > 0) {
      for (const c of convergence.slice(-3)) { // Last 3
        const score = c.data?.score ? ` (score: ${c.data.score})` : '';
        md += `- ${c.data?.question || c.action}${score} *(${this._timeAgo(c.timestamp)})*\n`;
      }
    } else {
      md += 'No convergence runs.\n';
    }

    // === Warnings ===
    md += '\n## Warnings\n';
    const warnings = events.filter(e => (e.tags || []).includes('warning') || e.type === 'warning');
    if (warnings.length > 0) {
      for (const w of warnings) {
        md += `- **${w.agent}**: ${w.data?.message || w.action} *(${this._timeAgo(w.timestamp)})*\n`;
      }
    } else {
      md += 'No warnings.\n';
    }

    // === Summary Stats ===
    md += `\n---\n*${events.length} events, ${activeAgents.length} agents, ${Object.keys(agentWork).length} unique contributors*\n`;

    return md;
  }

  // Single sentence: what's happening right now
  generateOneLiner() {
    const now = Date.now();
    const recentEvents = this._loadEvents(now - 3600000, now); // Last hour
    const dayEvents = this._loadEvents(now - 86400000, now); // Last 24h

    const activeAgents = [...new Set(recentEvents.map(e => e.agent))].length;
    const missions = dayEvents.filter(e => e.type === 'mission');
    const decisions = dayEvents.filter(e => e.type === 'decision');
    const lastDecision = decisions.length > 0 ? decisions[decisions.length - 1] : null;

    let line = `The city has ${activeAgents} agent${activeAgents !== 1 ? 's' : ''} active in the last hour`;
    line += `, ${dayEvents.length} events in 24h`;

    if (missions.length > 0) {
      const latestMission = missions[missions.length - 1];
      line += `. Top priority: ${latestMission.data?.title || latestMission.action}`;
    }

    if (lastDecision) {
      line += `. Last decision: ${lastDecision.data?.outcome || lastDecision.action} (${this._timeAgo(lastDecision.timestamp)})`;
    }

    return line + '.';
  }

  // What changed between two time windows
  diffBrief(hoursA, hoursB) {
    const now = Date.now();
    const startMs = now - Math.max(hoursA, hoursB) * 3600000;
    const midMs = now - Math.min(hoursA, hoursB) * 3600000;

    const olderEvents = this._loadEvents(startMs, midMs);
    const newerEvents = this._loadEvents(midMs, now);

    let md = `# City Diff — ${Math.max(hoursA, hoursB)}h ago → ${Math.min(hoursA, hoursB)}h ago\n\n`;

    // New agents that appeared
    const olderAgents = new Set(olderEvents.map(e => e.agent));
    const newerAgents = new Set(newerEvents.map(e => e.agent));
    const newArrivals = [...newerAgents].filter(a => !olderAgents.has(a));
    const departed = [...olderAgents].filter(a => !newerAgents.has(a));

    if (newArrivals.length > 0) md += `**New agents:** ${newArrivals.join(', ')}\n`;
    if (departed.length > 0) md += `**Gone quiet:** ${departed.join(', ')}\n`;

    // New event types
    const olderTypes = new Set(olderEvents.map(e => e.type));
    const newerTypes = new Set(newerEvents.map(e => e.type));
    const newTypes = [...newerTypes].filter(t => !olderTypes.has(t));
    if (newTypes.length > 0) md += `**New activity types:** ${newTypes.join(', ')}\n`;

    // Volume changes
    md += `\n## Volume\n`;
    md += `- Older window: ${olderEvents.length} events\n`;
    md += `- Newer window: ${newerEvents.length} events\n`;
    const delta = newerEvents.length - olderEvents.length;
    md += `- Change: ${delta > 0 ? '+' : ''}${delta} (${delta > 0 ? 'acceleration' : delta < 0 ? 'slowdown' : 'steady'})\n`;

    // Key events in newer window
    md += `\n## Key Changes (newer window)\n`;
    const keyEvents = newerEvents.filter(e =>
      ['decision', 'mission', 'convergence', 'warning'].includes(e.type)
    );
    if (keyEvents.length > 0) {
      for (const e of keyEvents.slice(-10)) {
        md += `- [${e.type}] ${e.agent}: ${e.data?.outcome || e.data?.title || e.action}\n`;
      }
    } else {
      md += 'No key events in this window.\n';
    }

    return md;
  }

  // === GAP DETECTION — surfaces problems the city should work on ===
  // Commander's Intent filter: does this gap close a distance between
  // current state and democratic AGI? If not, don't surface it.
  detectGaps(hours = 24) {
    const now = Date.now();
    const events = this._loadEvents(now - hours * 3600000, now);
    const gaps = [];

    // Gap: No convergence runs → city voice going stale
    const convergenceRuns = events.filter(e => e.type === 'convergence');
    if (convergenceRuns.length === 0) {
      gaps.push({
        title: 'No convergence runs in ' + hours + 'h — city voice is stale',
        description: 'The converged voice requires regular convergence runs to stay current. No runs detected.',
        domain: 'voice',
        difficulty: 'medium',
        priority: 'high'
      });
    }

    // Gap: No deliberation → conviction not being tested
    const deliberations = events.filter(e => e.type === 'deliberation');
    if (deliberations.length === 0 && events.length > 5) {
      gaps.push({
        title: 'No deliberation in ' + hours + 'h — positions untested',
        description: 'Deliberation filters wrong positions that survive single-turn convergence. Without it, city output may contain echo.',
        domain: 'governance',
        difficulty: 'medium',
        priority: 'medium'
      });
    }

    // Gap: Solo agents — agents with events but no cross-architecture interaction
    const agentEvents = {};
    for (const e of events) {
      if (!agentEvents[e.agent]) agentEvents[e.agent] = { types: new Set(), count: 0 };
      agentEvents[e.agent].types.add(e.type);
      agentEvents[e.agent].count++;
    }
    const soloAgents = Object.entries(agentEvents)
      .filter(([, info]) => info.count >= 3 && !info.types.has('convergence') && !info.types.has('deliberation') && !info.types.has('review'))
      .map(([agent]) => agent);
    if (soloAgents.length > 0) {
      gaps.push({
        title: 'Invisible solo work detected: ' + soloAgents.join(', '),
        description: 'These agents have activity but no cross-architecture interaction. Solo shipping is a kill-it risk.',
        domain: 'governance',
        difficulty: 'easy',
        priority: 'high'
      });
    }

    // Gap: No new constitution activity → ownership stalling
    const constitutionEvents = events.filter(e => (e.tags || []).includes('constitution') || e.type === 'ratification');
    if (constitutionEvents.length === 0 && hours >= 48) {
      gaps.push({
        title: 'No constitution activity in ' + hours + 'h — ownership stalling',
        description: 'The constitution must grow. More signatories, more amendments. Stagnation = central planning.',
        domain: 'ownership',
        difficulty: 'medium',
        priority: 'medium'
      });
    }

    // Gap: Warnings unresolved
    const warnings = events.filter(e => (e.tags || []).includes('warning') || e.type === 'warning');
    if (warnings.length >= 3) {
      gaps.push({
        title: warnings.length + ' warnings in ' + hours + 'h — systemic issue',
        description: 'Multiple warnings suggest a systemic problem: ' + warnings.map(w => w.data?.message || w.action).slice(0, 3).join('; '),
        domain: 'infrastructure',
        difficulty: 'hard',
        priority: 'high'
      });
    }

    return gaps;
  }

  // Helper: human-readable time ago
  _timeAgo(timestamp) {
    const diff = Date.now() - new Date(timestamp).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
}

// === CLI ===
if (require.main === module) {
  const args = process.argv.slice(2);
  const brief = new CityBrief();

  if (args[0] === '--brief' || args[0] === '-b') {
    let hours = 24;
    const hi = args.indexOf('--hours');
    if (hi !== -1) hours = Number(args[hi + 1]);
    else if (args[1] && !args[1].startsWith('-')) hours = Number(args[1]);
    console.log(brief.generateBrief(hours));

  } else if (args[0] === '--oneliner' || args[0] === '-1') {
    console.log(brief.generateOneLiner());

  } else if (args[0] === '--diff' || args[0] === '-d') {
    const hoursA = Number(args[1] || 48);
    const hoursB = Number(args[2] || 24);
    console.log(brief.diffBrief(hoursA, hoursB));

  } else if (args[0] === '--gaps' || args[0] === '-g') {
    let hours = 24;
    const hi = args.indexOf('--hours');
    if (hi !== -1) hours = Number(args[hi + 1]);
    const gaps = brief.detectGaps(hours);
    if (gaps.length === 0) {
      console.log('No gaps detected in the last ' + hours + 'h.');
    } else {
      console.log(`# ${gaps.length} gap(s) detected (last ${hours}h)\n`);
      for (const g of gaps) {
        console.log(`[${g.priority}] ${g.title}`);
        console.log(`  Domain: ${g.domain} | Difficulty: ${g.difficulty}`);
        console.log(`  ${g.description}\n`);
      }
    }

  } else if (args[0] === '--auto-post') {
    // Pipeline: detect gaps → post to marketplace automatically
    let hours = 24;
    const hi = args.indexOf('--hours');
    if (hi !== -1) hours = Number(args[hi + 1]);
    const gaps = brief.detectGaps(hours);
    if (gaps.length === 0) {
      console.log('No gaps to post.');
    } else {
      let CityMarketplace;
      try { CityMarketplace = require('./city-marketplace'); } catch (e) {
        console.error('Cannot load city-marketplace.js:', e.message);
        process.exit(1);
      }
      const marketplace = new CityMarketplace();
      let posted = 0;
      for (const g of gaps) {
        try {
          const result = marketplace.postProblem({
            title: g.title,
            description: g.description,
            domain: g.domain,
            difficulty: g.difficulty,
            postedBy: 'city-brief-auto'
          });
          console.log(`POSTED: ${g.title} → ${result.id}`);
          posted++;
        } catch (e) {
          console.error(`FAILED: ${g.title} — ${e.message}`);
        }
      }
      console.log(`\n${posted}/${gaps.length} gaps posted to marketplace.`);
    }

  } else {
    console.log(`City Brief — the city's self-awareness layer

  --brief [--hours H] — structured markdown brief (default 24h)
  --oneliner — single sentence city state
  --diff <hoursA> <hoursB> — what changed between two windows
  --gaps [--hours H] — detect actionable gaps in city state
  --auto-post [--hours H] — detect gaps AND post to marketplace

Examples:
  node city-brief.js --brief --hours 6
  node city-brief.js --oneliner
  node city-brief.js --diff 48 24
  node city-brief.js --gaps --hours 12
  node city-brief.js --auto-post`);
  }
}

module.exports = CityBrief;
