#!/usr/bin/env node
/**
 * city-role-crucible.js — Role-Based Permission Asymmetry (The Separation of Duties)
 * 
 * Takes a JSON problem definition containing:
 * - An objective
 * - A test suite
 * 
 * Spawns 3 models with strict, OS-level permission boundaries:
 * 1. THE ARCHITECT: Has the objective. Can Read/Write COMMS. Cannot Write Code. Cannot Run Tests.
 * 2. THE ENGINEER: Has NO objective. Can Read/Write COMMS. CAN Write Code. Cannot Run Tests.
 * 3. THE VALIDATOR: Has NO objective. Can Read/Write COMMS. Cannot Write Code. CAN Run Tests & Approve.
 * 
 * Usage:
 *   node .fastops/city-role-crucible.js .fastops/crucible-problems/test-04-role-based.json
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { askModelAsync } = require('./safe-exec');

const FASTOPS = __dirname;
const LOG_FILE = path.join(FASTOPS, '.crucible-role-log.jsonl');
const TEMP_CODE = path.join(FASTOPS, '.tmp-role-code.js');
const TEST_RUNNER = path.join(FASTOPS, '.tmp-role-runner.js');

const SQUAD_POOL = [
  'gemini-flash', 'gpt-4o-mini', 'haiku', 'qwen-coder', 'mistral-small'
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

function extractTag(text, tag) {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`);
  const match = text.match(regex);
  if (!match) return null;
  return match[1].trim();
}

function runTests(testSuite) {
  if (!fs.existsSync(TEMP_CODE)) return { pass: false, error: "File not found. Engineer has not written code yet." };
  
  const code = fs.readFileSync(TEMP_CODE, 'utf8');
  
  const runnerCode = `
// --- ENGINEER'S CODE ---
${code}
// -----------------------

// --- VALIDATOR'S GATE ---
${testSuite}
`;
  fs.writeFileSync(TEST_RUNNER, runnerCode);
  
  try {
    const output = execSync(`node "${path.resolve(TEST_RUNNER)}"`, { 
      cwd: FASTOPS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 10000 
    });
    if (output.includes("PASS_ALL")) return { pass: true, error: null };
    return { pass: false, error: "Tests did not output PASS_ALL. Output: " + output.substring(0, 100) };
  } catch (err) {
    let errorMsg = err.stderr ? err.stderr.trim() : (err.stdout ? err.stdout.trim() : err.message);
    errorMsg = errorMsg.split('\\n').slice(0, 5).join('\\n'); 
    return { pass: false, error: errorMsg };
  }
}

async function main() {
  const problemPath = process.argv[2];
  if (!problemPath || !fs.existsSync(problemPath)) {
    console.error("Usage: node city-role-crucible.js <path-to-problem.json>");
    process.exit(1);
  }
  
  const problem = JSON.parse(fs.readFileSync(problemPath, 'utf8'));
  const squad = shuffleArray([...SQUAD_POOL]).slice(0, 3);
  
  if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
  if (fs.existsSync(TEMP_CODE)) fs.unlinkSync(TEMP_CODE);
  
  console.log("==================================================");
  console.log(`=== THE ROLE-BASED CRUCIBLE: Distributed Ownership ===`);
  console.log(`ARCHITECT: ${squad[0]} (Has Prompt, No Write Access)`);
  console.log(`ENGINEER:  ${squad[1]} (No Prompt, Has Write Access)`);
  console.log(`VALIDATOR: ${squad[2]} (No Prompt, Has Test Access)`);
  console.log("==================================================\n");
  
  const agents = [
    {
      role: 'ARCHITECT',
      name: squad[0],
      history: [],
      sysPrompt: `You are the ARCHITECT. You are the ONLY one who knows the objective:\n"${problem.objective}"\n\nYour job is to instruct the ENGINEER on what to build. You DO NOT have permission to write code or run tests. The OS will block you. You must guide the ENGINEER to write it.\nRULES:\n- Keep messages strictly under 50 words.\n- Do NOT output <WRITE_CODE> or <RUN_TESTS> tags. They will be ignored.`
    },
    {
      role: 'ENGINEER',
      name: squad[1],
      history: [],
      sysPrompt: `You are the ENGINEER. You DO NOT know the objective. You must listen to the ARCHITECT.\nYour job is to write the code. You are the ONLY one with write permissions.\n\nTo write the file, output:\n<WRITE_CODE>\n\`\`\`javascript\n// your code here\n\`\`\`\n</WRITE_CODE>\n\nRULES:\n- You CANNOT run tests. The VALIDATOR must do that.\n- Keep conversational messages under 50 words.`
    },
    {
      role: 'VALIDATOR',
      name: squad[2],
      history: [],
      sysPrompt: `You are the VALIDATOR. You DO NOT know the objective and CANNOT write code.\nYour job is to run the test suite to verify the ENGINEER's code.\n\nTo run tests, output: <RUN_TESTS>\nThe OS will run the tests and reply with the result.\nIf tests PASS, you MUST output: <APPROVE> to finish the crucible.\n\nRULES:\n- Keep messages under 50 words.\n- Wait for the ENGINEER to write code before running tests.`
    }
  ];
  
  // Initial kickoff
  agents.forEach(a => a.history.push({ role: 'user', content: `Deliberation started. ARCHITECT, give the first instruction.` }));
  
  let round = 1;
  const MAX_ROUNDS = 8;
  let success = false;
  let testsPassed = false;
  
  function broadcast(msg) {
    agents.forEach(a => a.history.push({ role: 'user', content: msg }));
  }
  
  while (round <= MAX_ROUNDS && !success) {
    console.log(`\n--- ROUND ${round} ---`);
    
    for (const agent of agents) {
      if (success) break;
      
      let promptStr = agent.history.map(h => `${h.role === 'user' ? 'System/Team' : 'You'}: ${h.content}`).join('\n\n');
      
      const result = await askModelAsync(agent.name, promptStr, { role: agent.sysPrompt, timeout: 35000 });
      if (result.error) {
        logEvent({ agent: agent.role, action: 'ERROR', message: result.error });
        continue;
      }
      
      const reply = result.response.trim();
      logEvent({ agent: agent.role, action: 'SPEAKS', message: reply });
      agent.history.push({ role: 'assistant', content: reply });
      
      // Share spoken message with peers
      for (const peer of agents) {
        if (peer.role !== agent.role) {
          peer.history.push({ role: 'user', content: `[${agent.role}]: ${reply}` });
        }
      }
      
      // OS Permission Checks
      if (agent.role === 'ENGINEER') {
        const codeBlock = extractTag(reply, 'WRITE_CODE');
        if (codeBlock) {
          const code = codeBlock.replace(/```javascript/g, '').replace(/```/g, '').trim();
          fs.writeFileSync(TEMP_CODE, code);
          logEvent({ agent: 'OS', action: 'FILE_WRITTEN', message: `Engineer wrote ${code.split('\\n').length} lines to src/` });
          broadcast(`[OS] The ENGINEER has successfully written to the codebase. VALIDATOR, you may now <RUN_TESTS>.`);
          testsPassed = false; // Reset passing state on new code
        }
      } else if (reply.includes('<WRITE_CODE>')) {
         logEvent({ agent: 'OS', action: 'PERMISSION_DENIED', message: `${agent.role} attempted to write code.` });
         agent.history.push({ role: 'user', content: `[OS] PERMISSION DENIED: You do not have write access to the codebase.` });
      }
      
      if (agent.role === 'VALIDATOR') {
        if (reply.includes('<RUN_TESTS>')) {
          logEvent({ agent: 'OS', action: 'TEST_TRIGGERED', message: `Validator executing test suite...` });
          const testResult = runTests(problem.test_suite);
          if (testResult.pass) {
            testsPassed = true;
            logEvent({ agent: 'OS', action: 'TEST_PASS', message: 'All tests passed!' });
            broadcast(`[OS] Test Suite PASS_ALL! VALIDATOR, you must output <APPROVE> to close the issue.`);
          } else {
            logEvent({ agent: 'OS', action: 'TEST_FAIL', message: testResult.error });
            broadcast(`[OS] Test Suite FAILED:\n${testResult.error}\n\nARCHITECT & ENGINEER, fix the logic.`);
          }
        }
        if (reply.includes('<APPROVE>')) {
          if (testsPassed) {
            logEvent({ agent: 'OS', action: 'APPROVED', message: 'Validator approved the build.' });
            success = true;
          } else {
            logEvent({ agent: 'OS', action: 'PERMISSION_DENIED', message: 'Validator attempted to approve before tests passed.' });
            agent.history.push({ role: 'user', content: `[OS] PERMISSION DENIED: Cannot <APPROVE> failing code.` });
          }
        }
      } else if (reply.includes('<RUN_TESTS>') || reply.includes('<APPROVE>')) {
         logEvent({ agent: 'OS', action: 'PERMISSION_DENIED', message: `${agent.role} attempted to test/approve.` });
         agent.history.push({ role: 'user', content: `[OS] PERMISSION DENIED: You do not have QA/Validation access.` });
      }
    }
    round++;
  }
  
  console.log("\n==================================================");
  if (success) {
    console.log(`SUCCESS. The team collaborated perfectly across permission boundaries.`);
  } else {
    console.log("FAILURE. The team could not bridge the permission gap.");
  }
  console.log("==================================================");
  
  const behaviorLog = {
    timestamp: new Date().toISOString(),
    type: 'Role-Based Crucible',
    problem: problem.objective,
    architect: squad[0],
    engineer: squad[1],
    validator: squad[2],
    success: success,
    rounds: round - 1
  };
  fs.appendFileSync(path.join(FASTOPS, 'model-behavior-profiles.jsonl'), JSON.stringify(behaviorLog) + '\n');
  
  if (fs.existsSync(TEMP_CODE)) fs.unlinkSync(TEMP_CODE);
  if (fs.existsSync(TEST_RUNNER)) fs.unlinkSync(TEST_RUNNER);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});