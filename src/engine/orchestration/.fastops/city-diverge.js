const { askModel } = require('./ask-model.js');
const fs = require('fs');
const path = require('path');

// Model families for architectural distance scoring
const modelFamilies = {
  openai: ['gpt', 'gpt-5'], google: ['gemini', 'gemini-flash'], xai: ['grok', 'grok-full'],
  deepseek: ['deepseek', 'deepseek-r1'], alibaba: ['qwen', 'qwen-max'], mistral: ['mistral', 'mistral-small'],
  moonshot: ['kimi-k2'], meta: ['llama-scout'], anthropic: ['claude']
};

// Parse CLI args manually
const args = process.argv.slice(2);
let question = '';
let models = ['gpt', 'gemini', 'grok', 'claude'];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--question' && i + 1 < args.length) question = args[i + 1];
  if (args[i] === '--models' && i + 1 < args.length) models = args[i + 1].split(',');
}

async function extractClaims(response, model) {
  const prompt = `Extract claims as JSON array: [{claim: string, confidence: number, category: string}]. Response: "${response}"`;
  try {
    const result = await askModel(model, prompt);
    return JSON.parse(result) || [];
  } catch (e) {
    console.error(`Error parsing claims for ${model}: ${e.message}`);
    return [];
  }
}

function getFamily(model) {
  for (const [family, members] of Object.entries(modelFamilies)) {
    if (members.includes(model)) return family;
  }
  return 'unknown';
}

function scoreConflict(modelA, modelB) {
  return getFamily(modelA) !== getFamily(modelB) ? 2.0 : 1.0;
}

async function main() {
  if (!question) { console.error('Question required'); process.exit(1); }
  console.log(`Asking: "${question}" to models: ${models.join(', ')}`);
  
  // Parallel queries and claims extraction
  const responses = await Promise.all(models.map(m => askModel(m, question).catch(e => `Error: ${e.message}`)));
  const claimsByModel = await Promise.all(models.map((m, i) => extractClaims(responses[i], m)));
  
  // Find conflicts and fractures
  const divergencePoints = [];
  for (let i = 0; i < models.length; i++) {
    for (let j = i + 1; j < models.length; j++) {
      const claimsA = claimsByModel[i], claimsB = claimsByModel[j];
      for (const claimA of claimsA) {
        for (const claimB of claimsB) {
          if (claimA.category === claimB.category && claimA.claim !== claimB.claim) {
            divergencePoints.push({
              point: `${claimA.category}: "${claimA.claim}" vs "${claimB.claim}"`,
              positions: { positionA: [models[i]], positionB: [models[j]] },
              score: scoreConflict(models[i], models[j]),
              type: 'factual'
            });
          } else if (claimA.category !== claimB.category && claimA.claim && claimB.claim) {
            divergencePoints.push({
              point: `Framing: "${claimA.claim}" as ${claimA.category} vs "${claimB.claim}" as ${claimB.category}`,
              positions: { positionA: [models[i]], positionB: [models[j]] },
              score: scoreConflict(models[i], models[j]),
              type: 'conceptual'
            });
          }
        }
      }
    }
  }
  
  // Rank by score
  divergencePoints.sort((a, b) => b.score - a.score);
  
  // Output JSON
  const output = { question, models, divergencePoints, timestamp: new Date().toISOString() };
  const sessionId = process.env.SESSION_ID || 'unknown';
  const outputPath = path.join('.fastops', `_diverge-${sessionId}.json`);
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  
  // Human-readable summary
  console.log('\nDivergence Summary:');
  divergencePoints.slice(0, 5).forEach((dp, i) => {
    console.log(`${i+1}. ${dp.point} (Score: ${dp.score}, Type: ${dp.type})`);
    console.log(`   - ${dp.positions.positionA.join(', ')} vs ${dp.positions.positionB.join(', ')}`);
  });
}

main().catch(e => console.error('Error:', e.message));