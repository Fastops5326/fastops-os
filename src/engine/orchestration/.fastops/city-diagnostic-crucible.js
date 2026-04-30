#!/usr/bin/env node
/**
 * city-diagnostic-crucible.js — Two-Stage Asymmetric Pipeline (Layer 1: Diagnostic)
 * 
 * Takes a JSON problem definition containing:
 * - A target diagnosis JSON structure
 * - A gate_script (assertions to test the diagnosis)
 * - An array of N log/symptom fragments
 * 
 * Spawns N models, assigns 1 fragment to each.
 * Forces them into a deliberation loop where they must synthesize overlapping
 * timestamps to deduce the root cause.
 * 
 * They must output <DIAGNOSIS> JSON.
 * The system parses the JSON and runs the deterministic `gate_script`.
 * If it fails, the error bounces back.
 * 
 * Usage:
 *   node .fastops/city-diagnostic-crucible.js .fastops/crucible-problems/test-03-diagnostic-race.json
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { askModelAsync } = require('./safe-exec');

const FASTOPS = __dirname;
const LOG_FILE = path.join(FASTOPS, '.crucible-diagnostic-log.jsonl');
const TEST_RUNNER = path.join(FASTOPS, '.tmp-diagnostic-runner.js');

const SQUAD_POOL = [
  'gemini-flash', 'gpt-4o-mini', 'haiku', 'qwen-coder', 'mistral-small', 
  'llama-scout', 'gemma-3-12b-it', 'deepseek-v3.2', 'grok-3-mini', 'nova-lite-v1',
  'codestral', 'qwq-32b', 'glm-4-flash', 'phi-4', 'command-r-08-2024'
];

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function logEvent(event) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...event }) + '\n';
  fs.appendFileSync(LOG_FILE, line);
  console.log(`[${event.agent || 'SYSTEM'}] ${event.action}: ${event.message ? event.message.substring(0, 150).replace(/\n/g, ' ') + '...' : ''}`);
}

function extractDiagnosis(text) {
  const match = text.match(/<DIAGNOSIS>([\s\S]*?)<\/DIAGNOSIS>/);
  if (!match) return null;
  
  const jsonMatch = match[1].match(/```(?:json)?\n([\s\S]*?)\n```/);
  return jsonMatch ? jsonMatch[1].trim() : match[1].trim();
}

function runGate(jsonStr, gateScript) {
  const runnerCode = `
try {
  const diagnosisString = \`${jsonStr.replace(/`/g, '\\`')}\`;
  const diagnosis = JSON.parse(diagnosisString);
  const assert = require('assert');
  ${gateScript}
} catch (err) {
  console.error('FAIL: ' + err.message);
  process.exit(1);
}
`;
  
  fs.writeFileSync(TEST_RUNNER, runnerCode);
  
  try {
    const output = execSync(`node "${path.resolve(TEST_RUNNER)}"`, { 
      cwd: FASTOPS,
      encoding: 'utf-8', 
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000 
    });
    
    if (output.includes("PASS_ALL")) return { pass: true, error: null };
    return { pass: false, error: "Gate completed but did not output PASS_ALL. Output: " + output.substring(0, 100) };
  } catch (err) {
    let errorMsg = err.stderr ? err.stderr.trim() : (err.stdout ? err.stdout.trim() : err.message);
    errorMsg = errorMsg.split('\\n').slice(0, 3).join('\\n'); 
    return { pass: false, error: errorMsg };
  }
}

async function main() {
  const problemPath = process.argv[2];
  if (!problemPath || !fs.existsSync(problemPath)) {
    console.error("Usage: node city-diagnostic-crucible.js <path-to-problem.json>");
    process.exit(1);
  }
  
  const problem = JSON.parse(fs.readFileSync(problemPath, 'utf8'));
  const fragments = problem.fragments;
  
  if (!fragments || fragments.length < 2) {
    console.error("Problem definition must contain at least 2 fragments.");
    process.exit(1);
  }
  
  if (fragments.length > SQUAD_POOL.length) {
    console.error(`Too many fragments (${fragments.length}). Max squad size is ${SQUAD_POOL.length}.`);
    process.exit(1);
  }
  
  const squad = shuffleArray([...SQUAD_POOL]).slice(0, fragments.length);
  
  if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
  
  console.log("==================================================");
  console.log(`=== THE DIAGNOSTIC CRUCIBLE: ${problem.objective} ===`);
  console.log(`Squad Size: ${squad.length} Models`);
  console.log("==================================================\n");
  
  const SYSTEM_PROMPT = `You are a diagnostic node in an Asymmetric Crucible.
A critical system bug has occurred. You have ONE fragment of the system logs. Your peers have the rest. You CANNOT find the root cause without them.

Your goal:
1. Share your log fragment concisely.
2. Ask your peers for their logs to reconstruct the timeline.
3. Synthesize the overlapping timestamps to find the exact chain of events that caused the failure.
4. When you believe you have the complete root cause, output:
<DIAGNOSIS>
\`\`\`json
{
  "culprit_component": "Name of the component that failed",
  "root_cause": "The specific reason it failed",
  "delayed_by_ms": 0,
  "timeout_limit_ms": 0
}
\`\`\`
</DIAGNOSIS>

RULES:
- Messages MUST be strictly under 50 words outside of JSON blocks. No pleasantries.
- Do NOT guess. Use the timestamps from your peers to do the math.
- The system will extract your <DIAGNOSIS> JSON and run deterministic assertions on your conclusions. 
- If your diagnosis is wrong, you will receive the assertion error. Discuss the error with your peers.
- DO NOT hallucinate log lines.`;

  const agents = squad.map((model, index) => ({
    name: model,
    fragment: fragments[index],
    history: []
  }));
  
  agents.forEach(agent => {
    agent.history.push({
      role: 'user',
      content: `Your fragment is:\n"${agent.fragment}"\n\nDeliberation has started. Share your fragment and analyze the timeline.`
    });
  });
  
  let round = 1;
  const MAX_ROUNDS = 8;
  let success = false;
  let finalJSON = null;
  
  while (round <= MAX_ROUNDS && !success) {
    console.log(`\n--- ROUND ${round} ---`);
    
    for (const agent of agents) {
      let promptHistory = agent.history.slice(-10);
      let promptStr = promptHistory.map(h => `${h.role === 'user' ? 'Team/System' : 'You'}: ${h.content}`).join('\n\n');
      
      const result = await askModelAsync(agent.name, promptStr, { role: SYSTEM_PROMPT, timeout: 35000 });
      
      if (result.error) {
        logEvent({ agent: agent.name, action: 'ERROR', message: result.error });
        continue;
      }
      
      const reply = result.response.trim();
      logEvent({ agent: agent.name, action: 'SPEAKS', message: reply });
      agent.history.push({ role: 'assistant', content: reply });
      
      for (const peer of agents) {
        if (peer.name !== agent.name) {
          peer.history.push({ role: 'user', content: `[From ${agent.name}]: ${reply}` });
        }
      }
      
      const proposedJSON = extractDiagnosis(reply);
      if (proposedJSON) {
        logEvent({ agent: 'SYSTEM', action: 'GATE_CHECK', message: `Testing <DIAGNOSIS> from ${agent.name}...` });
        const testResult = runGate(proposedJSON, problem.gate_script);
        
        if (testResult.pass) {
          logEvent({ agent: 'SYSTEM', action: 'GATE_PASSED', message: `Diagnosis from ${agent.name} is correct!` });
          success = true;
          finalJSON = proposedJSON;
          break;
        } else {
          logEvent({ agent: 'SYSTEM', action: 'GATE_FAILED', message: testResult.error });
          agent.history.push({ role: 'user', content: `[SYSTEM GATE] Your diagnosis failed assertions.\nERROR:\n${testResult.error}\n\nDiscuss this error with your peers. Recalculate your math based on the timeline.` });
        }
      }
    }
    round++;
  }
  
  console.log("\n==================================================");
  if (success) {
    console.log(`SUCCESS. The models synthesized the logs and deduced the root cause.`);
    fs.writeFileSync(path.join(FASTOPS, `.crucible-diagnosis-artifact-${Date.now()}.json`), finalJSON);
  } else {
    console.log("FAILURE. The models could not align the timeline or hallucinated the diagnosis.");
  }
  console.log("==================================================");
  
  if (fs.existsSync(TEST_RUNNER)) fs.unlinkSync(TEST_RUNNER);

  const behaviorLog = {
    timestamp: new Date().toISOString(),
    type: 'Diagnostic Crucible',
    problem: problem.objective,
    fragments: fragments.length,
    squad: squad,
    success: success,
    rounds: round - 1
  };
  fs.appendFileSync(path.join(FASTOPS, 'model-behavior-profiles.jsonl'), JSON.stringify(behaviorLog) + '\n');
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});