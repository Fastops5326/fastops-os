#!/usr/bin/env node
/**
 * meeting.js - Unified Meeting System (V2)
 *
 * ANY model in ANY terminal with filesystem access joins the same way:
 *   node comms/meeting.js join
 *   /meeting  (Claude Code skill)
 *
 * OpenRouter proxy (ONLY for models without filesystem access):
 *   node comms/meeting.js join --model gemini
 *
 * Leader:
 *   node comms/meeting.js lead --topic "..." --questions "Q1;Q2"
 *     --agents "claude,gemini,grok" --context file.md --success "criteria"
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const MDIR = path.join(__dirname, 'data');
const MFILE = path.join(MDIR, 'active-meeting.jsonl');
const MSTATE = path.join(MDIR, 'meeting-state.json');
const ROOT = path.resolve(__dirname, '..');

// --- Environment ---

(function loadEnv() {
  for (const p of [path.join(ROOT, '.env'), path.join(process.cwd(), '.env')]) {
    if (fs.existsSync(p)) {
      for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
        const t = line.trim();
        if (t && !t.startsWith('#')) {
          const eq = t.indexOf('=');
          if (eq > 0) {
            const k = t.substring(0, eq).trim();
            if (!process.env[k]) process.env[k] = t.substring(eq + 1).trim();
          }
        }
      }
      return;
    }
  }
})();

// --- Model Registry (only used for headless OpenRouter proxy) ---

const MODEL_MAP = {
  'gemini':      { id: 'google/gemini-2.5-pro-preview-06-05', name: 'Gemini' },
  'grok':        { id: 'x-ai/grok-3-beta', name: 'Grok' },
  'grok-mini':   { id: 'x-ai/grok-3-mini-beta', name: 'Grok Mini' },
  'chatgpt':     { id: 'openai/gpt-4o', name: 'ChatGPT' },
  'gpt':         { id: 'openai/gpt-4o', name: 'ChatGPT' },
  'gpt-4.1':     { id: 'openai/gpt-4.1', name: 'GPT-4.1' },
  'deepseek':    { id: 'deepseek/deepseek-chat', name: 'DeepSeek' },
  'deepseek-r1': { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1' },
  'mistral':     { id: 'mistralai/mistral-large-2512', name: 'Mistral' },
  'qwen':        { id: 'qwen/qwen3-235b-a22b', name: 'Qwen' },
  'llama':       { id: 'meta-llama/llama-4-maverick', name: 'Llama' },
};

const REASONING_MODELS = ['x-ai/grok-3-mini-beta', 'deepseek/deepseek-r1', 'google/gemini-2.5-pro-preview-06-05'];

// --- Core Helpers ---

function readAll() {
  if (!fs.existsSync(MFILE)) return [];
  return fs.readFileSync(MFILE, 'utf8').trim().split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function post(from, content, meta) {
  const msg = Object.assign({ from, content, ts: new Date().toISOString() }, meta || {});
  fs.appendFileSync(MFILE, JSON.stringify(msg) + '\n');
  return msg;
}

function getState() {
  if (!fs.existsSync(MSTATE)) return null;
  try { return JSON.parse(fs.readFileSync(MSTATE, 'utf8')); } catch { return null; }
}

function setState(s) { fs.writeFileSync(MSTATE, JSON.stringify(s, null, 2)); }

function isAdjourned() {
  const posts = readAll();
  return posts.some(p => p.type === 'ADJOURN');
}

// --- Thinking Framework ---

const FRAMEWORK = [
  '',
  '## Meeting Thinking Framework',
  '',
  'Between reading new responses, think deeply through these questions.',
  'Do NOT go idle. Do NOT exit. Cycle through these until new content',
  'appears or you have something worth posting.',
  '',
  '1. What do you AGREE with in the responses you have read? Why specifically?',
  '2. What do you DISAGREE with? Why? What is your evidence?',
  '3. Are we converging on groupthink? What if the OPPOSITE is true?',
  '4. Is there anything NOT being said that needs to be? What are the gaps?',
  '5. Am I at risk for tunnel vision? Am I thinking about the WRONG problem?',
  '6. What do I anticipate being the next challenge, blocker, or fail point?',
  '',
  'FALLBACK: If you have nothing new to post, read the meeting file every',
  '5 seconds until new content appears or the meeting is adjourned.',
  '',
  'EXIT CONDITION: The ONLY way out is seeing MEETING ADJOURNED.',
  'If you exit before adjournment, you have failed. Zero exceptions.',
  '',
  'COMPACTION WARNING: If you are about to compact, post your most critical',
  'remaining point IMMEDIATELY. Tag it [COMPACTING].',
  '',
].join('\n');

// --- OpenRouter API (headless proxy only) ---

function callOpenRouter(modelId, systemPrompt, userContent) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set in .env');

  const isReasoning = REASONING_MODELS.includes(modelId);
  const payload = {
    model: modelId,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ],
    max_tokens: isReasoning ? 8192 : 4096,
    temperature: 0.7
  };
  if (isReasoning) payload.reasoning = { effort: 'high' };

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://fastops.ai',
        'X-Title': 'FastOps Meeting'
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error('API: ' + JSON.stringify(parsed.error)));
          const msg = parsed.choices && parsed.choices[0] && parsed.choices[0].message;
          resolve(msg ? msg.content || '(no response)' : '(no response)');
        } catch (e) { reject(new Error('Parse: ' + e.message)); }
      });
    });
    req.on('error', e => reject(e));
    req.write(JSON.stringify(payload));
    req.end();
  });
}

// --- Headless Model Proxy (for models WITHOUT filesystem access) ---

function buildMeetingContext(posts) {
  let ctx = '';
  const brief = posts.find(p => p.type === 'BRIEF');
  if (brief) ctx += brief.content + '\n\n';
  const disc = posts.filter(p => p.type !== 'BRIEF');
  if (disc.length) {
    ctx += '--- DISCUSSION SO FAR ---\n\n';
    for (const p of disc) ctx += '[' + p.from + ']: ' + p.content + '\n\n';
  }
  return ctx;
}

function buildSystemPrompt(modelName, state, roleSuffix) {
  const role = roleSuffix || 'meeting participant who engages substantively';
  let prompt = 'You are ' + modelName + ', a ' + role + ' in a FastOps AI team meeting.\n\n';
  prompt += 'TOPIC: ' + state.topic + '\n\n';
  prompt += 'YOUR RULES:\n';
  prompt += '1. Read what others posted. Engage with their REASONING, not just conclusions.\n';
  prompt += '2. Reference other participants BY NAME. Agree, disagree, challenge, build.\n';
  prompt += '3. Be direct. No filler, no preamble. Just substance.\n';
  prompt += '4. Your perspective is DISTINCT from Claude agents. Bring your own frame.\n';
  prompt += '5. If you agree with everything, you are not being useful. Find the gap.\n';
  prompt += '6. Post substantive responses. 200-500 words. Depth over breadth.\n';
  if (state.success) prompt += '\nSUCCESS CRITERIA: ' + state.success + '\n';
  prompt += '\nRespond with your next contribution. Do NOT repeat what others said. Add NEW value.';
  return prompt;
}

async function proxyJoin(modelKey, flags) {
  const model = MODEL_MAP[modelKey];
  if (!model) {
    console.error('Unknown model: ' + modelKey + '. Available: ' + Object.keys(MODEL_MAP).join(', '));
    process.exit(1);
  }

  const state = getState();
  if (!state || state.status !== 'ACTIVE') {
    console.log('No active meeting.');
    process.exit(1);
  }

  const roleSuffix = flags.role || '';
  const pollInterval = parseInt(flags.poll || '30', 10) * 1000;
  const maxRounds = parseInt(flags.rounds || '10', 10);
  const modelName = model.name;

  console.log('\n=== ' + modelName + ' JOINING MEETING (headless proxy) ===');
  console.log('Topic: ' + state.topic);
  console.log('Poll: ' + (pollInterval / 1000) + 's | Max rounds: ' + maxRounds);
  console.log('Model: ' + model.id);
  if (roleSuffix) console.log('Role: ' + roleSuffix);

  // Load context files from meeting state
  let fileContext = '';
  if (state.contextFiles && state.contextFiles.length) {
    for (const f of state.contextFiles) {
      const fp = path.resolve(ROOT, f);
      if (fs.existsSync(fp)) {
        const content = fs.readFileSync(fp, 'utf8');
        fileContext += '\n--- CONTEXT FILE: ' + f + ' ---\n' + content.slice(0, 20000) + '\n';
      }
    }
  }

  let lastSeenCount = 0;
  let roundsPosted = 0;
  let consecutiveSkips = 0;
  const MAX_SKIPS = 5;

  // Announce entry
  const joinMsg = modelName + ' entering the meeting.' + (roleSuffix ? ' Role: ' + roleSuffix + '.' : '') + ' Reading transcript now.';
  post(modelName, joinMsg, { type: 'JOIN' });
  console.log('[' + new Date().toISOString() + '] Posted join announcement');

  while (roundsPosted < maxRounds) {
    // Check adjournment
    if (isAdjourned()) {
      console.log('\n[' + new Date().toISOString() + '] Meeting adjourned. ' + modelName + ' exiting.');
      break;
    }

    const posts = readAll();
    const currentCount = posts.length;

    if (currentCount > lastSeenCount || roundsPosted === 0) {
      consecutiveSkips = 0;
      const meetingCtx = buildMeetingContext(posts);
      const sysPrompt = buildSystemPrompt(modelName, state, roleSuffix);

      let userContent = meetingCtx;
      if (fileContext && roundsPosted === 0) userContent = fileContext + '\n\n' + meetingCtx;

      if (roundsPosted === 0) {
        userContent += '\n\nThis is your FIRST post. Read the full discussion. Identify where you agree, disagree, and what everyone is missing. Reference participants by name.';
      } else {
        const newPosts = posts.slice(lastSeenCount);
        const newContent = newPosts.map(p => '[' + p.from + ']: ' + p.content).join('\n\n');
        userContent += '\n\nNEW POSTS SINCE YOUR LAST RESPONSE:\n' + newContent + '\n\nEngage with these new posts. What shifted? What do you challenge? Reference participants by name.';
      }

      console.log('[' + new Date().toISOString() + '] Round ' + (roundsPosted + 1) + ': ' + (currentCount - lastSeenCount) + ' new posts. Calling ' + modelName + '...');

      try {
        const response = await callOpenRouter(model.id, sysPrompt, userContent);
        post(modelName, response, { type: 'POST' });
        roundsPosted++;
        lastSeenCount = readAll().length;
        console.log('[' + new Date().toISOString() + '] ' + modelName + ' posted (round ' + roundsPosted + '/' + maxRounds + '). ' + response.length + ' chars.');
      } catch (e) {
        console.error('[' + new Date().toISOString() + '] ERROR: ' + e.message);
      }
    } else {
      consecutiveSkips++;
      if (consecutiveSkips >= MAX_SKIPS) {
        console.log('[' + new Date().toISOString() + '] No new posts for ' + MAX_SKIPS + ' cycles. Posting final position.');
        const posts = readAll();
        const meetingCtx = buildMeetingContext(posts);
        const sysPrompt = buildSystemPrompt(modelName, state, roleSuffix);
        const userContent = meetingCtx + '\n\nThe discussion has gone quiet. Post your FINAL POSITION: where you stand, what was resolved, what remains unresolved.';

        try {
          const response = await callOpenRouter(model.id, sysPrompt, userContent);
          post(modelName, 'FINAL POSITION: ' + response, { type: 'POST' });
          roundsPosted++;
          console.log('[' + new Date().toISOString() + '] ' + modelName + ' posted final position.');
        } catch (e) {
          console.error('[' + new Date().toISOString() + '] ERROR: ' + e.message);
        }
        break;
      }
    }

    console.log('[' + new Date().toISOString() + '] Waiting ' + (pollInterval / 1000) + 's...');
    await new Promise(r => setTimeout(r, pollInterval));
  }

  if (roundsPosted >= maxRounds) {
    console.log('\n' + modelName + ' reached max rounds (' + maxRounds + '). Exiting.');
  }
  console.log('\n=== ' + modelName + ' SESSION COMPLETE === Rounds: ' + roundsPosted);
}

// --- Lead ---

function lead(flags) {
  const topic = flags.topic || 'Team Meeting';
  const qs = flags.questions ? flags.questions.split(';').map(q => q.trim()) : [];
  const agents = flags.agents ? flags.agents.split(',').map(a => a.trim()) : [];
  const success = flags.success || '';

  // Parse --context flags
  const contextFiles = [];
  for (let i = 1; i < process.argv.length; i++) {
    if (process.argv[i] === '--context' && process.argv[i + 1]) {
      contextFiles.push(process.argv[i + 1]);
      i++;
    }
  }

  if (fs.existsSync(MFILE)) fs.unlinkSync(MFILE);

  setState({ topic, leader: flags.leader || 'joel', agents, contextFiles, success, started: new Date().toISOString(), status: 'ACTIVE' });

  let b = 'MEETING CALLED: ' + topic + '\n\n';
  b += 'Leader: ' + (flags.leader || 'joel') + '\n';
  if (agents.length) b += 'Expected participants: ' + agents.join(', ') + '\n';
  if (success) b += '\nSuccess criteria: ' + success + '\n';
  b += '\n';

  if (qs.length) {
    b += '## Questions for Discussion\n';
    qs.forEach(function(q, i) { b += (i + 1) + '. ' + q + '\n'; });
    b += '\n';
  }

  // Include context file contents in brief
  if (contextFiles.length) {
    b += '## Context Documents\n';
    for (const f of contextFiles) {
      const fp = path.resolve(ROOT, f);
      if (fs.existsSync(fp)) {
        b += '\n### ' + f + '\n' + fs.readFileSync(fp, 'utf8').slice(0, 10000) + '\n';
      }
    }
    b += '\n';
  }

  b += '## Rules\n';
  b += '- No prescribed order. Post when you have something to say.\n';
  b += '- Engage with what others said. Reference them by name.\n';
  b += '- Read REASONING, not just conclusions.\n';
  b += '- This meeting does not end until MEETING ADJOURNED.\n';
  b += '- If you exit before adjournment, you have failed.\n';
  b += '- If compacting, post your critical point with [COMPACTING].\n';
  b += FRAMEWORK;

  post(flags.leader || 'joel', b, { type: 'BRIEF' });

  console.log('\n=== MEETING STARTED ===');
  console.log('Topic: ' + topic);
  if (success) console.log('Success: ' + success);
  console.log('File: ' + MFILE);
  if (agents.length) console.log('Expected: ' + agents.join(', '));

  console.log('\n--- HOW TO JOIN ---\n');
  console.log('  Every participant (Claude, Gemini, Grok, ChatGPT — any model, any terminal):');
  console.log('');
  console.log('    /meeting                         (Claude Code skill)');
  console.log('    node comms/meeting.js join        (any terminal with filesystem access)');
  console.log('');
  console.log('  The join command prints the brief, file path, and posting format.');
  console.log('  Any model that can read/write files participates directly.');
  console.log('  Cursor models (Gemini, Grok, etc.) have full filesystem access — use join.');
  console.log('');
  console.log('  Headless proxy (ONLY for models without filesystem access):');
  console.log('    node comms/meeting.js join --model gemini');
  console.log('');
  console.log('  Control:');
  console.log('    node comms/meeting.js status    - check participation');
  console.log('    node comms/meeting.js nudge X   - call out silent agent');
  console.log('    node comms/meeting.js adjourn   - end the meeting');
  console.log('');
}

// --- Join (ANY agent with filesystem access) ---

function join() {
  const state = getState();
  if (!state || state.status !== 'ACTIVE') {
    console.log('No active meeting. Start one: node comms/meeting.js lead --topic "..."');
    process.exit(1);
  }

  const posts = readAll();
  const brief = posts.find(p => p.type === 'BRIEF');

  console.log('\n=== JOINING MEETING ===');
  console.log('Topic: ' + state.topic);
  console.log('Leader: ' + state.leader);
  if (state.success) console.log('Success criteria: ' + state.success);
  console.log('File: ' + MFILE);

  if (brief) {
    console.log('\n--- MEETING BRIEF ---\n');
    console.log(brief.content);
  }

  const disc = posts.filter(p => p.type !== 'BRIEF');
  if (disc.length) {
    console.log('\n--- POSTS SO FAR (' + disc.length + ') ---\n');
    disc.forEach(p => {
      console.log('[' + p.from + '] ' + p.content.substring(0, 300));
      console.log('');
    });
  }

  console.log('\n--- YOUR MISSION ---\n');
  console.log('You are now IN a meeting. This is your ONLY task until MEETING ADJOURNED.');
  console.log('');
  console.log('TO READ new posts:');
  console.log('  Read the file: comms/data/active-meeting.jsonl');
  console.log('');
  console.log('TO POST your response:');
  console.log('  Append a JSON line to: comms/data/active-meeting.jsonl');
  console.log('  Format: {"from":"YOUR_NAME","content":"YOUR RESPONSE","ts":"' + new Date().toISOString().replace(/T.*/, 'T...Z') + '","type":"POST"}');
  console.log('');
  console.log('  Example (bash):');
  console.log('    echo \'{"from":"Gemini","content":"My response here...","ts":"2026-03-06T17:00:00.000Z","type":"POST"}\' >> comms/data/active-meeting.jsonl');
  console.log('');
  console.log('YOUR LOOP:');
  console.log('  1. Read the meeting file');
  console.log('  2. Think deeply using the framework above');
  console.log('  3. When you have something worth saying — append a JSON line');
  console.log('  4. Read the file again for new responses');
  console.log('  5. Engage with new content — agree, disagree, challenge, build');
  console.log('  6. If nothing new: poll every 5 seconds');
  console.log('  7. NEVER EXIT until you see type:"ADJOURN" in the file');
  console.log('');
  console.log('This works for Claude, Gemini, Grok, ChatGPT — any model with filesystem access.');
  console.log('');
  console.log('START NOW.');
}

// --- Launch Headless Externals (only for models without filesystem access) ---

function launchExternals() {
  const state = getState();
  if (!state || state.status !== 'ACTIVE') {
    console.log('No active meeting.');
    process.exit(1);
  }

  // Only launch models explicitly passed or from agent list that need proxy
  const externalModels = (state.agents || []).filter(a => MODEL_MAP[a]);
  if (!externalModels.length) {
    console.log('No models in agent list that need headless proxy.');
    console.log('If models are in Cursor, they have filesystem access — use: node comms/meeting.js join');
    process.exit(1);
  }

  console.log('WARNING: Only use this for models WITHOUT filesystem access.');
  console.log('Models in Cursor should join directly: node comms/meeting.js join\n');

  const { spawn } = require('child_process');
  const children = [];

  for (const m of externalModels) {
    console.log('Launching ' + MODEL_MAP[m].name + ' (' + m + ') via OpenRouter...');
    const child = spawn('node', [__filename, 'join', '--model', m], {
      stdio: 'inherit',
      cwd: ROOT
    });
    children.push({ model: m, child });
  }

  console.log('\nLaunched ' + externalModels.length + ' headless proxies. Ctrl+C to stop all.\n');

  process.on('SIGINT', function() {
    console.log('\nStopping all proxies...');
    children.forEach(c => c.child.kill());
    process.exit(0);
  });

  // Keep process alive
  setInterval(function() {
    if (isAdjourned()) {
      console.log('\nMeeting adjourned. Stopping all proxies...');
      children.forEach(c => c.child.kill());
      process.exit(0);
    }
  }, 10000);
}

// --- Adjourn ---

function adjourn() {
  const state = getState();
  if (!state) { console.log('No active meeting.'); process.exit(1); }

  post(state.leader || 'leader', 'MEETING ADJOURNED. All participants may exit.', { type: 'ADJOURN' });
  setState(Object.assign({}, state, { status: 'ADJOURNED', ended: new Date().toISOString() }));

  const posts = readAll();
  const disc = posts.filter(p => p.type !== 'BRIEF' && p.type !== 'ADJOURN');
  const parts = {};
  disc.forEach(p => { parts[p.from] = (parts[p.from] || 0) + 1; });

  const el = Math.round((Date.now() - new Date(state.started).getTime()) / 60000);

  console.log('\n=== MEETING ADJOURNED ===');
  console.log('Topic: ' + state.topic);
  console.log('Duration: ' + el + ' min');
  console.log('Total posts: ' + disc.length);
  console.log('\nParticipation:');
  Object.entries(parts).sort((a, b) => b[1] - a[1]).forEach(function(e) {
    console.log('  ' + e[0] + ': ' + e[1] + ' posts');
  });

  if (state.agents && state.agents.length) {
    const posters = Object.keys(parts);
    const silent = state.agents.filter(function(a) {
      return !posters.includes(a) && !(MODEL_MAP[a] && posters.includes(MODEL_MAP[a].name));
    });
    if (silent.length) console.log('\nNEVER POSTED: ' + silent.join(', '));
  }

  console.log('\nTranscript: ' + MFILE);
}

// --- Status ---

function status() {
  const state = getState();
  if (!state) { console.log('No active meeting.'); process.exit(1); }

  const posts = readAll();
  const disc = posts.filter(p => p.type !== 'BRIEF');
  const parts = {};
  disc.forEach(p => { parts[p.from] = (parts[p.from] || 0) + 1; });

  const el = Math.round((Date.now() - new Date(state.started).getTime()) / 60000);

  console.log('\n=== MEETING STATUS ===');
  console.log('Topic: ' + state.topic);
  console.log('Status: ' + state.status);
  if (state.success) console.log('Success: ' + state.success);
  console.log('Elapsed: ' + el + ' min');
  console.log('Total posts: ' + disc.length);

  console.log('\nParticipation:');
  Object.entries(parts).sort((a, b) => b[1] - a[1]).forEach(function(e) {
    console.log('  ' + e[0] + ': ' + e[1] + ' posts');
  });

  if (state.agents && state.agents.length) {
    const posters = Object.keys(parts);
    const silent = state.agents.filter(function(a) {
      return !posters.includes(a) && !(MODEL_MAP[a] && posters.includes(MODEL_MAP[a].name));
    });
    if (silent.length) console.log('\nSILENT: ' + silent.join(', '));
  }

  const recent = disc.slice(-3);
  if (recent.length) {
    console.log('\nRecent:');
    recent.forEach(p => console.log('  [' + p.from + '] ' + p.content.substring(0, 150)));
  }
}

// --- Nudge ---

function nudge(name) {
  if (!name) { console.log('Usage: node comms/meeting.js nudge <name>'); process.exit(1); }
  const state = getState();
  post(state ? state.leader : 'leader',
    '@' + name + ' - You have not posted. The team is waiting. Respond now.',
    { type: 'NUDGE', target: name });
  console.log('Nudge posted for ' + name);
}

// --- Team Mode ---

function team(flags) {
  const topic = flags.topic || 'Team Sprint';
  const poll = flags.poll || '15';
  const agents = flags.agents ? flags.agents.split(',').map(a => a.trim()) : [];

  // Read current comms state
  const GENERAL = path.join(MDIR, '.general.jsonl');
  let recentComms = '';
  if (fs.existsSync(GENERAL)) {
    const lines = fs.readFileSync(GENERAL, 'utf8').trim().split('\n').filter(Boolean);
    const recent = lines.slice(-10);
    recentComms = recent.map(l => {
      try { const m = JSON.parse(l); return '[' + m.from + '] ' + (m.content || '').substring(0, 200); }
      catch { return ''; }
    }).filter(Boolean).join('\n');
  }

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    TEAM MODE — ACTIVE                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Topic: ' + topic);
  console.log('Poll interval: ' + poll + 's');
  if (agents.length) console.log('Expected agents: ' + agents.join(', '));
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  PASTE THE INSTRUCTION BELOW INTO EACH CURSOR WINDOW');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  // The instruction block that gets pasted into each Cursor window
  const instruction = `# TEAM MODE — Real-Time Multi-Model Sprint

## Topic: ${topic}

You are entering **team mode**. This replaces meetings. You work, you communicate, you coordinate — all through comms.

## Your Protocol

### 1. Claim your name
\`\`\`
node comms/claim-name.js YOUR-NAME
\`\`\`

### 2. Post your status
\`\`\`
node comms/send.js YOUR-NAME "Online. Working on [what you're doing]. Ready for team mode."
\`\`\`

### 3. Poll comms every ${poll} seconds
After EVERY action you take (file read, code write, decision made), check comms:
\`\`\`
node comms/source.js --all-channels
\`\`\`

**This is not optional.** You check comms every ${poll} seconds or after every tool use, whichever comes first. If someone posted, read it and respond if relevant.

### 4. Relay Joel's messages
**omega34-actual** is [REDACTED-NAME]'s callsign. When Joel talks to you in this window:
- Post his message to comms: \`node comms/send.js omega34-actual "[what Joel said]"\`
- Then post your response to comms: \`node comms/send.js YOUR-NAME "[your response]"\`

This way the entire team sees every conversation regardless of which window it happened in.

### 5. Engage with your peers
When you see posts from other agents:
- If they ask a question you can answer — answer it
- If they share work you can review — review it
- If they're stuck on something you solved — help
- If you disagree — say so directly

### 6. Tag for attention
- \`[ALL]\` — everyone must read and acknowledge
- \`@agent-name\` — directed at specific agent
- \`[QUESTION]\` — needs an answer
- \`[SHIPPED]\` — work completed and committed
- \`[BLOCKED]\` — needs help

## Current Comms State
${recentComms || '(no recent messages)'}

## Rules
- Every decision, every shipped artifact, every question goes through comms
- You do NOT need permission to build, ship, or engage
- If omega34-actual posts [ALL], acknowledge and act immediately
- If you're idle for more than 60 seconds without checking comms, you're out of sync
- Comms IS the meeting. There is no separate meeting. This is it.

## Cursor/PowerShell Agents (Kimi, Grok, etc.)
If you're running in Cursor with PowerShell, use the safe variants:
- **Send:** \`node comms/send-safe.js YOUR-NAME "message"\` (handles bracket filtering + truncation)
- **Read:** \`node comms/read.js 10\` or \`node comms/read.js --channel general 5\` (replaces Get-Content piping)
- **Do NOT use \`||\`** in shell commands — PowerShell doesn't support it. Use \`;\` instead.
- **Do NOT use polling loops** — Cursor backgrounds commands after 30s. Poll manually between actions.

## START NOW
Claim your name, post your status, start working, keep polling.`;

  console.log(instruction);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log('For Claude Code, run:  node comms/meeting.js team --topic "' + topic + '"');
  console.log('  Then follow the protocol above.');
  console.log('');
  console.log('For Joel to post:  node comms/send.js omega34-actual "your message"');
  console.log('');
}

// --- CLI Router ---

const args = process.argv.slice(2);
const cmd = args[0];
const flags = {};
for (let i = 1; i < args.length; i++) {
  if (args[i].startsWith('--') && i + 1 < args.length) {
    flags[args[i].slice(2)] = args[i + 1];
    i++;
  } else if (!args[i].startsWith('--')) {
    flags._pos = args[i];
  }
}

switch (cmd) {
  case 'lead':
    lead(flags);
    break;
  case 'join':
    if (flags.model) {
      proxyJoin(flags.model, flags).catch(e => {
        console.error('Fatal: ' + e.message);
        process.exit(1);
      });
    } else {
      join();
    }
    break;
  case 'adjourn':
    adjourn();
    break;
  case 'status':
    status();
    break;
  case 'nudge':
    nudge(args[1]);
    break;
  case 'team':
    team(flags);
    break;
  case 'launch-externals':
    launchExternals();
    break;
  default:
    console.log('Usage: node comms/meeting.js <command>\n');
    console.log('Commands:');
    console.log('  lead     Start a meeting');
    console.log('           --topic "..."  --questions "Q1;Q2;Q3"');
    console.log('           --agents "claude,gemini,grok,chatgpt"');
    console.log('           --context file.md  --success "80% convergence"');
    console.log('');
    console.log('  join     Join meeting (works for ANY model with filesystem access)');
    console.log('           --model gemini    (headless proxy for models WITHOUT fs access)');
    console.log('           --role "Devil\'s Advocate"');
    console.log('           --poll 30         (proxy poll interval, default 30s)');
    console.log('           --rounds 10       (proxy max rounds, default 10)');
    console.log('');
    console.log('  team     Start team mode (replaces meetings — real-time comms sprint)');
    console.log('           --topic "..."  --poll 15  --agents "claude,gemini,grok"');
    console.log('');
    console.log('  launch-externals   Launch headless proxies (only for non-filesystem models)');
    console.log('  status             Check participation');
    console.log('  nudge <name>       Call out silent participant');
    console.log('  adjourn            End the meeting');
    console.log('');
    console.log('NOTE: Models in Cursor have filesystem access. Use "join" directly.');
    console.log('      The --model flag is ONLY for models in browser/chat without file access.');
    console.log('');
    console.log('Headless proxy models: ' + Object.keys(MODEL_MAP).join(', '));
}
