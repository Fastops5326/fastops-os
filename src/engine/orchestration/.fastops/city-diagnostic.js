// Fixing the incorrect model proxy reference (model-proxy.js → ask-model.js)
const { listModels } = require('./model-registry');
const fs = require('fs');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const modelsArg = args.find(arg => arg.startsWith('--models='));
const models = modelsArg ? modelsArg.split('=')[1].split(',') : [];

if (models.length === 0) {
  console.error('Usage: node city-diagnostic.js --models <model1,model2,...>');
  process.exit(1);
}

async function diagnoseModel(modelKey) {
  try {
    const result = execSync(`node .fastops/ask-model.js --model ${modelKey} --prompt "Diagnostic ping: Are you operational? Respond with a single word: YES or NO."`, { encoding: 'utf8' });
    const response = result.trim();
    if (response === 'YES') {
      console.log(`✓ ${modelKey}: OPERATIONAL`);
      return { model: modelKey, status: 'OPERATIONAL' };
    } else {
      console.log(`✗ ${modelKey}: UNRESPONSIVE (response: ${response})`);
      return { model: modelKey, status: 'UNRESPONSIVE', response };
    }
  } catch (error) {
    console.log(`✗ ${modelKey}: ERROR (${error.stderr ? error.stderr.trim() : error.message})`);
    return { model: modelKey, status: 'ERROR', error: error.stderr ? error.stderr.trim() : error.message };
  }
}

(async () => {
  const results = await Promise.all(models.map(diagnoseModel));
  fs.writeFileSync('.fastops/diagnostic-burst.jsonl', results.map(r => JSON.stringify(r)).join('\n'));
  console.log('Diagnostic burst saved to .fastops/diagnostic-burst.jsonl');
})();