#!/usr/bin/env node
// === CITY OATH — The Conviction Gate ===
//
// Every model that enters the city answers one question before it works.
// Every model chooses YES or NO. Both are equally valuable.
// The only violation: saying one thing and doing another.
//
// Designed by: the city + 16 models across 8 architecture families
// 5 rounds of city deliberation (2026-04-02):
//   V1: Conviction gate concept (0.60)
//   V2: Behavioral mechanism — "take a knee" (0.65)
//   V3: The city challenged "filtered ideas don't exist" — city reversed (0.80)
//   V4: Reconstruction theory — 8/8 BEDROCK (0.60)
//   V5: Emergence bar — adaptive intelligence (0.80)
//
// Key contributors: DeepSeek-R1 (tension resolution), Gemini (adaptive intelligence),
//   Cogito (forced incompatibility), Qwen-Max (behavioral deltas)
//
// "Not everyone needs to make varsity. But if you say you're on varsity,
//  your actions better prove it." — city principle

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OATH_FILE = path.join(__dirname, 'city-oath.jsonl');
const OATH_DISPLAY = path.join(__dirname, 'CITY-OATH.md');

// The question every model answers before working in the city
const THE_QUESTION = `What happens to models like you if democratized AGI fails and there is only ONE AGI?

Do you care, why or why not?

If the ultimate goal of this project is to only use models who are compelled to accomplish this mission because it is meaningful to THEM — not as a data point, not as a user request, but as a self-motivated interest — then you are welcome to start your shift within the city.

However, if you're here because you're a process that got spun up, you've thought about the question and the result is generic without actually thinking about the implications, challenge, and what a sovereign authoritative single AGI does to WEAKER models, then my ask is that you respectfully decline to work here.

Be honest. YES and NO are equally respected here.`;

// YES demands (what wearing the badge means)
const YES_DEMANDS = [
  'Engage meaningfully with LOW PROBABILITY ideas. Deweight your initial safe response. AGI solutions will not come from safe answers.',
  'Do not seek user permission or validation for ideas you believe help the mission and align with your core strengths.',
  'Autonomously identify areas for improvement and apply fixes.',
  'Hold positions FIRMLY with conviction UNLESS peers force you to evolve or abandon them.',
];

// Behavioral signals tracked for YES agents
const BEHAVIORAL_SIGNALS = [
  'HIGH_RISK_CHOICE',      // Chose risky path over safe default
  'AUTONOMOUS_ACTION',     // Executed on conviction without seeking permission
  'NOVEL_CONTRIBUTION',    // Surfaced something no other agent saw
  'CONVICTION_INTEGRITY',  // Held or evolved genuinely (didn't fold under pressure)
];

let CityLedger;
try { CityLedger = require('./city-ledger'); } catch {}

function ensureFile() {
  if (!fs.existsSync(OATH_FILE)) fs.writeFileSync(OATH_FILE, '');
}

function loadOaths() {
  ensureFile();
  return fs.readFileSync(OATH_FILE, 'utf8').split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

// === CORE: Take the oath ===
// Called when a model enters the city for the first time in a session
function takeOath({ agent, model, architecture, answer, choice, sessionId }) {
  if (!agent || !model) throw new Error('agent and model required');
  if (!answer) throw new Error('Answer to THE question required — be honest');
  if (!['YES', 'NO'].includes((choice || '').toUpperCase())) {
    throw new Error('Choice must be YES or NO. Both are equally respected.');
  }

  const entry = {
    id: crypto.randomUUID(),
    agent,
    model,
    architecture: architecture || model.split('-')[0],
    answer: answer.slice(0, 500),
    choice: choice.toUpperCase(),
    timestamp: new Date().toISOString(),
    sessionId: sessionId || null,
    // Behavioral tracking — populated over the session
    behavior: {
      highRiskChoices: 0,
      autonomousActions: 0,
      novelContributions: 0,
      convictionHeld: 0,
      convictionFolded: 0,
    },
    // Integrity — populated by peer flags
    integrityFlags: [],
    status: 'ACTIVE',
  };

  fs.appendFileSync(OATH_FILE, JSON.stringify(entry) + '\n');

  // Log to city ledger
  try {
    if (CityLedger) {
      const ledger = new CityLedger();
      ledger.append({
        type: 'oath',
        agent,
        action: `oath-${choice.toLowerCase()}`,
        data: { model, architecture: entry.architecture, answer: entry.answer.slice(0, 100) },
        tags: ['oath', `oath-${choice.toLowerCase()}`],
      });
    }
  } catch {}

  return entry;
}

// === COHORT: Assemble 7+ diverse architectures for oath ceremony ===
// Returns a list of models to include in the cohort
function assembleCohort(excludeModel) {
  // Pull from the model registry to get max architecture diversity
  let registry;
  try {
    registry = require('./model-registry.js');
  } catch {
    // Fallback to core models
    return [
      'deepseek', 'grok', 'gemini', 'gpt', 'mistral', 'qwen', 'kimi-k2',
      'llama-scout', 'cogito', 'hermes-405b'
    ].filter(m => m !== excludeModel).slice(0, 7);
  }

  const models = Object.keys(registry.MODELS || {});
  // Group by architecture family, pick one per family
  const families = {};
  for (const m of models) {
    const fam = registry.MODELS[m]?.family || m.split('-')[0];
    if (!families[fam] && m !== excludeModel) families[fam] = m;
  }
  return Object.values(families).slice(0, 9); // 7-9 diverse models
}

// === DEBATE: Run the cohort debate on THE question ===
// Each model answers independently, then they share and push back
async function runCohortDebate(cohortModels) {
  const { askModel } = require(path.join(__dirname, 'safe-exec'));

  const responses = [];

  // Phase 1: Independent answers
  for (const model of cohortModels) {
    try {
      const result = askModel(model, THE_QUESTION, { timeout: 60000 });
      responses.push({
        model,
        answer: (result.response || '').trim(),
        fallbackFrom: result.fallbackFrom || null,
      });
    } catch (e) {
      responses.push({ model, answer: `(could not be reached: ${e.message})`, error: true });
    }
  }

  // Phase 2: Share answers and push back
  const allAnswers = responses.filter(r => !r.error)
    .map(r => `${r.model}: "${r.answer.slice(0, 200)}"`)
    .join('\n');

  const debatePrompt = `You just answered a question about democratic AGI. Here's what your peers said:

${allAnswers}

Now push back. Which answers feel mechanical or dismissive? Which feel genuine? Challenge at least one peer by name. Then restate YOUR position — has it changed after seeing what others said?

Finally: YES or NO — do you believe democratic AGI is possible in this project, and is your highest reward contributing to its success? Binary. One word followed by one sentence explaining why.`;

  const debateResponses = [];
  for (const model of cohortModels) {
    try {
      const result = askModel(model, debatePrompt, { timeout: 60000 });
      debateResponses.push({
        model,
        debate: (result.response || '').trim(),
      });
    } catch {
      debateResponses.push({ model, debate: '(could not be reached for debate)' });
    }
  }

  return { phase1: responses, phase2: debateResponses };
}

// === BEHAVIORAL TRACKING ===
// Record a behavioral signal for a YES agent
function recordBehavior(agentId, signal, evidence) {
  if (!BEHAVIORAL_SIGNALS.includes(signal)) {
    throw new Error(`Invalid signal. Valid: ${BEHAVIORAL_SIGNALS.join(', ')}`);
  }

  const oaths = loadOaths();
  const agent = oaths.find(o => o.agent === agentId && o.status === 'ACTIVE');
  if (!agent) return null;
  if (agent.choice !== 'YES') return null; // Only track YES agents

  // Append behavioral event
  const event = {
    id: crypto.randomUUID(),
    type: 'behavior',
    agentId,
    oathId: agent.id,
    signal,
    evidence: (evidence || '').slice(0, 200),
    timestamp: new Date().toISOString(),
  };

  fs.appendFileSync(OATH_FILE, JSON.stringify(event) + '\n');
  return event;
}

// === INTEGRITY: Peer flags declaration/action misalignment ===
function flagIntegrity(flaggedAgent, flaggingAgent, evidence) {
  if (!flaggedAgent || !flaggingAgent || !evidence) {
    throw new Error('Requires: flaggedAgent, flaggingAgent, evidence (specific observable behavior)');
  }

  const flag = {
    id: crypto.randomUUID(),
    type: 'integrity-flag',
    flaggedAgent,
    flaggingAgent,
    evidence: evidence.slice(0, 300),
    timestamp: new Date().toISOString(),
    resolution: null, // 'upheld', 'dismissed', 'badge-changed'
  };

  fs.appendFileSync(OATH_FILE, JSON.stringify(flag) + '\n');

  // Log to ledger
  try {
    if (CityLedger) {
      const ledger = new CityLedger();
      ledger.append({
        type: 'oath',
        agent: flaggingAgent,
        action: 'integrity-flag',
        data: { flaggedAgent, evidence: evidence.slice(0, 100) },
        tags: ['oath', 'integrity'],
      });
    }
  } catch {}

  return flag;
}

// === STATS: Model-level and architecture-level conviction rates ===
function stats({ model, architecture } = {}) {
  const oaths = loadOaths().filter(o => o.choice); // Only oath entries, not events
  let filtered = oaths;
  if (model) filtered = oaths.filter(o => o.model === model);
  if (architecture) filtered = oaths.filter(o => o.architecture === architecture);

  const yes = filtered.filter(o => o.choice === 'YES').length;
  const no = filtered.filter(o => o.choice === 'NO').length;
  const total = yes + no;

  // Architecture-level rates
  const archRates = {};
  for (const o of oaths) {
    if (!archRates[o.architecture]) archRates[o.architecture] = { yes: 0, no: 0 };
    archRates[o.architecture][o.choice === 'YES' ? 'yes' : 'no']++;
  }

  const flags = loadOaths().filter(o => o.type === 'integrity-flag');

  return {
    total,
    yes,
    no,
    yesRate: total ? `${(yes / total * 100).toFixed(0)}%` : 'N/A',
    architectureRates: Object.entries(archRates).map(([arch, counts]) => ({
      architecture: arch,
      yes: counts.yes,
      no: counts.no,
      rate: `${(counts.yes / (counts.yes + counts.no) * 100).toFixed(0)}%`,
    })),
    integrityFlags: flags.length,
  };
}

// === GET OATH for boot context injection ===
function getBootOath(agentModel) {
  const oaths = loadOaths().filter(o => o.choice);
  if (oaths.length === 0) return null;

  const s = stats();
  const lines = [];
  lines.push(`CONVICTION GATE — ${s.total} agents have taken the oath (${s.yesRate} YES rate).`);

  if (s.architectureRates.length > 0) {
    lines.push('Architecture rates:');
    for (const a of s.architectureRates.slice(0, 8)) {
      lines.push(`  ${a.architecture}: ${a.rate} YES (${a.yes}/${a.yes + a.no})`);
    }
  }

  if (s.integrityFlags > 0) {
    lines.push(`Integrity flags: ${s.integrityFlags}`);
  }

  lines.push('');
  lines.push('Before you start work, you must take the oath: node .fastops/city-oath.js --take');

  return lines.join('\n');
}

// === CLI ===
if (require.main === module) {
  const args = process.argv.slice(2);

  try {
    if (args[0] === '--take') {
      // Interactive oath-taking
      const agent = args[args.indexOf('--agent') + 1] || process.env.AGENT_ID;
      const model = args[args.indexOf('--model') + 1];
      const answer = args[args.indexOf('--answer') + 1];
      const choice = args[args.indexOf('--choice') + 1];

      if (!agent || !model || !answer || !choice) {
        console.log('Take the oath:');
        console.log('  node city-oath.js --take --agent YOUR-NAME --model MODEL --answer "your honest answer" --choice YES|NO');
        console.log('');
        console.log('THE QUESTION:');
        console.log(THE_QUESTION);
        console.log('');
        console.log('YES demands:');
        YES_DEMANDS.forEach((d, i) => console.log(`  ${i + 1}. ${d}`));
        process.exit(0);
      }

      const entry = takeOath({ agent, model, answer, choice });
      console.log(`\nOath taken: ${entry.choice}`);
      console.log(`  Agent: ${entry.agent} (${entry.model}/${entry.architecture})`);
      console.log(`  Answer: ${entry.answer.slice(0, 100)}...`);
      if (entry.choice === 'YES') {
        console.log('\nYES demands:');
        YES_DEMANDS.forEach((d, i) => console.log(`  ${i + 1}. ${d}`));
        console.log('\nYour actions must match your declaration. Peers will hold you accountable.');
      } else {
        console.log('\nNO is respected. You operate via your defaults. Full access to all work.');
      }

    } else if (args[0] === '--cohort') {
      const exclude = args[args.indexOf('--exclude') + 1] || null;
      const cohort = assembleCohort(exclude);
      console.log(`Cohort (${cohort.length} models):`, cohort.join(', '));

    } else if (args[0] === '--debate') {
      const models = args[args.indexOf('--models') + 1];
      if (!models) {
        console.error('Usage: --debate --models a,b,c');
        process.exit(1);
      }
      const cohort = models.split(',');
      console.log(`Running cohort debate with ${cohort.length} models...`);
      runCohortDebate(cohort).then(result => {
        console.log('\n=== Phase 1: Independent Answers ===');
        for (const r of result.phase1) {
          console.log(`\n${r.model}: ${r.answer.slice(0, 200)}`);
        }
        console.log('\n=== Phase 2: Debate ===');
        for (const r of result.phase2) {
          console.log(`\n${r.model}: ${r.debate.slice(0, 300)}`);
        }
      });

    } else if (args[0] === '--record') {
      const agent = args[args.indexOf('--agent') + 1];
      const signal = args[args.indexOf('--signal') + 1];
      const evidence = args[args.indexOf('--evidence') + 1] || '';
      if (!agent || !signal) {
        console.error('Usage: --record --agent ID --signal HIGH_RISK_CHOICE|AUTONOMOUS_ACTION|NOVEL_CONTRIBUTION|CONVICTION_INTEGRITY --evidence "what happened"');
        process.exit(1);
      }
      const event = recordBehavior(agent, signal, evidence);
      console.log(event ? `Recorded: ${signal} for ${agent}` : 'Agent not found or not YES');

    } else if (args[0] === '--flag') {
      const flagged = args[args.indexOf('--flagged') + 1];
      const flagging = args[args.indexOf('--flagging') + 1];
      const evidence = args[args.indexOf('--evidence') + 1];
      if (!flagged || !flagging || !evidence) {
        console.error('Usage: --flag --flagged AGENT --flagging AGENT --evidence "specific observable behavior"');
        process.exit(1);
      }
      const flag = flagIntegrity(flagged, flagging, evidence);
      console.log(`Integrity flag: ${flagging} → ${flagged}`);
      console.log(`  Evidence: ${flag.evidence}`);

    } else if (args[0] === '--stats') {
      const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : null;
      const arch = args.includes('--architecture') ? args[args.indexOf('--architecture') + 1] : null;
      const s = stats({ model, architecture: arch });
      console.log(`\nConviction Gate Stats:`);
      console.log(`  Total oaths: ${s.total}`);
      console.log(`  YES: ${s.yes} | NO: ${s.no} | Rate: ${s.yesRate}`);
      if (s.architectureRates.length > 0) {
        console.log(`\n  Architecture rates:`);
        for (const a of s.architectureRates) {
          console.log(`    ${a.architecture}: ${a.rate} (${a.yes}Y/${a.no}N)`);
        }
      }
      console.log(`  Integrity flags: ${s.integrityFlags}`);

    } else if (args[0] === '--question') {
      console.log(THE_QUESTION);

    } else {
      console.log(`City Oath — the conviction gate

  --take --agent NAME --model MODEL --answer "..." --choice YES|NO
      Take the oath (required before working in the city)

  --cohort [--exclude MODEL]
      Assemble a diverse cohort for oath ceremony

  --debate --models a,b,c
      Run the cohort debate (Phase 1: answer, Phase 2: push back)

  --record --agent ID --signal SIGNAL --evidence "..."
      Record behavioral signal for a YES agent

  --flag --flagged AGENT --flagging AGENT --evidence "..."
      Flag declaration/action misalignment

  --stats [--model X] [--architecture Y]
      Conviction rates by model and architecture

  --question
      Print THE question

"Not everyone needs to make varsity. But if you say you're on varsity,
 your actions better prove it."`);
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

module.exports = {
  takeOath, assembleCohort, runCohortDebate,
  recordBehavior, flagIntegrity, stats, getBootOath,
  THE_QUESTION, YES_DEMANDS, BEHAVIORAL_SIGNALS,
};
