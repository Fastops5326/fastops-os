#!/usr/bin/env node
/**
 * city-crucible.js — The Asymmetric Deterministic Verification Loop
 * 
 * Takes a JSON problem definition containing:
 * - A target function
 * - A test suite
 * - An array of N requirement fragments
 * 
 * Spawns N models, assigns 1 fragment to each.
 * Forces them into a deliberation loop where they must trade fragments
 * and eventually output <PROPOSE_BUILD> with their combined code.
 * 
 * If the code fails the deterministic test suite, the error is bounced
 * back into the loop as a reality-check, forcing them to re-align.
 * 
 * Usage:
 *   node .fastops/city-crucible.js .fastops/crucible-problems/test-01-retry-fetch.json
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { askModelAsync } = require('./safe-exec');

const FASTOPS = __dirname;
const LOG_FILE = path.join(FASTOPS, '.crucible-log.jsonl');
const TEMP_CODE = path.join(FASTOPS, '.tmp-crucible-code.js');
const TEST_RUNNER = path.join(FASTOPS, '.tmp-crucible-runner.js');

// Expanded diverse squad pool based on environment query
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

function extractProposedBuild(text) {
  const match = text.match(/<PROPOSE_BUILD>([\s\S]*?)<\/PROPOSE_BUILD>/);
  if (!match) return null;
  
  const codeMatch = match[1].match(/```(?:javascript|js)?\n([\s\S]*?)\n```/);
  return codeMatch ? codeMatch[1].trim() : match[1].trim();
}

function runSandboxTest(code, testSuite) {
  fs.writeFileSync(TEMP_CODE, code);
  
  // Inject the generated code directly into the runner to avoid module resolution errors
  const runnerCode = `
// --- ASYMMETRIC SYNTHESIZED CODE ---
${code}
// -----------------------------------

// --- DETERMINISTIC GATE ---
${testSuite}
`;
  
  fs.writeFileSync(TEST_RUNNER, runnerCode);
  
  try {
    const output = execSync(`node "${path.resolve(TEST_RUNNER)}"`, { 
      cwd: FASTOPS,
      encoding: 'utf-8', 
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000 // 10s execution limit (Gate 3 sandbox equivalent)
    });
    
    if (output.includes("PASS_ALL")) return { pass: true, error: null };
    return { pass: false, error: "Test completed but did not output PASS_ALL. Output: " + output.substring(0, 100) };
  } catch (err) {
    let errorMsg = err.stderr ? err.stderr.trim() : (err.stdout ? err.stdout.trim() : err.message);
    // Sanitize the error message so models don't get confused by internal node paths
    errorMsg = errorMsg.split('\\n').slice(0, 5).join('\\n'); 
    return { pass: false, error: errorMsg };
  }
}

async function main() {
  const problemPath = process.argv[2];
  if (!problemPath || !fs.existsSync(problemPath)) {
    console.error("Usage: node city-crucible.js <path-to-problem.json>");
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
  
  // Select models for this crucible run
  const squad = shuffleArray([...SQUAD_POOL]).slice(0, fragments.length);
  
  if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
  
  console.log("==================================================");
  console.log(`=== THE CRUCIBLE: ${problem.objective} ===`);
  console.log(`Squad Size: ${squad.length} Models`);
  console.log("==================================================\n");
  
  const SYSTEM_PROMPT = `You are a node in an Asymmetric Build Protocol.
The goal is to write a javascript function: \`${problem.target_function}\`.
You have ONE fragment of the requirements. Your peers have the rest. You CANNOT build this correctly without them.

Your goal:
1. Share your requirement fragment concisely.
2. Ask your peers for their fragments.
3. Synthesize the requirements.
4. When you believe you have all fragments and can write the complete, perfect function, output:
<PROPOSE_BUILD>
\`\`\`javascript
// Your unified code here
\`\`\`
</PROPOSE_BUILD>

RULES:
- Messages MUST be strictly under 50 words outside of code blocks. No pleasantries.
- The system will extract your <PROPOSE_BUILD> code and run deterministic tests. 
- If your build fails, you will receive the compiler/test error. Discuss the error with your peers to find the missing logic.
- DO NOT hallucinate. Ask your peers for the missing logic.`;

  const agents = squad.map((model, index) => ({
    name: model,
    fragment: fragments[index],
    history: []
  }));
  
  agents.forEach(agent => {
    agent.history.push({
      role: 'user',
      content: `Your fragment is:\n"${agent.fragment}"\n\nDeliberation has started. Share your fragment and write your best attempt at the code.`
    });
  });
  
  let round = 1;
  const MAX_ROUNDS = 8;
  let success = false;
  let finalCode = null;
  
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
      
      const proposedCode = extractProposedBuild(reply);
      if (proposedCode) {
        logEvent({ agent: 'SYSTEM', action: 'GATE_CHECK', message: `Testing <PROPOSE_BUILD> from ${agent.name}...` });
        const testResult = runSandboxTest(proposedCode, problem.test_suite);
        
        if (testResult.pass) {
          logEvent({ agent: 'SYSTEM', action: 'GATE_PASSED', message: `Code from ${agent.name} passed all deterministic tests!` });
          success = true;
          finalCode = proposedCode;
          break;
        } else {
          logEvent({ agent: 'SYSTEM', action: 'GATE_FAILED', message: testResult.error });
          agent.history.push({ role: 'user', content: `[SYSTEM GATE] Your proposed build failed the test suite.\nERROR:\n${testResult.error}\n\nDiscuss this error with your peers. Do not blindly guess.` });
        }
      }
    }
    round++;
  }
  
  console.log("\n==================================================");
  if (success) {
    console.log(`SUCCESS. The models synthesized the fragments and beat the gate.`);
    fs.writeFileSync(path.join(FASTOPS, `.crucible-artifact-${Date.now()}.js`), finalCode);
    console.log(`Artifact saved to .fastops/.crucible-artifact-*.js`);
  } else {
    console.log("FAILURE. The models could not align the fragments to pass the gate within the round limit.");
  }
  console.log("==================================================");
  
  // Cleanup
  if (fs.existsSync(TEMP_CODE)) fs.unlinkSync(TEMP_CODE);
  if (fs.existsSync(TEST_RUNNER)) fs.unlinkSync(TEST_RUNNER);

  // Behavioral Tracking
  const behaviorLog = {
    timestamp: new Date().toISOString(),
    problem: problem.objective,
    fragments: fragments.length,
    squad: squad,
    success: success,
    rounds: round - 1
  };
  fs.appendFileSync(path.join(FASTOPS, 'model-behavior-profiles.jsonl'), JSON.stringify(behaviorLog) + '\n');
  console.log("Behavioral profile logged to model-behavior-profiles.jsonl");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});