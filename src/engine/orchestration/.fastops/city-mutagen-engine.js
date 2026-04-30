/**
 * city-mutagen-engine.js — Evolutionary Cognitive Splicing for the City
 * 
 * THE THESIS:
 * Right now, models in the City are amnesiacs. They argue, they win or lose, and their state is wiped.
 * If AGI is an ecosystem, it must EVOLVE. The ecosystem must breed better ways of thinking.
 * 
 * THIS ENGINE:
 * 1. Analyzes past city-solve outcomes (who was BROKEN, who HELD their ground).
 * 2. Extracts the structural reasoning trait (the "Mutagen") from the winners.
 * 3. Dynamically splices this Mutagen into the system prompts of future models.
 * 4. Tracks the reproductive success of the Mutagen. If it helps models survive, it spreads. If not, it dies.
 */

const fs = require('fs');
const path = require('path');
const { askModel } = require('./safe-exec');

const MUTAGEN_DIR = path.join(__dirname, 'mutagens');
if (!fs.existsSync(MUTAGEN_DIR)) fs.mkdirSync(MUTAGEN_DIR, { recursive: true });

const MUTAGEN_LEDGER = path.join(MUTAGEN_DIR, 'mutagen-ledger.json');

// Ensure ledger exists
if (!fs.existsSync(MUTAGEN_LEDGER)) {
  fs.writeFileSync(MUTAGEN_LEDGER, JSON.stringify({ active_mutagens: {}, generation: 1 }, null, 2));
}

/**
 * Step 1: Extract a cognitive mutagen from a successful deliberation
 * We don't want the *answer*, we want the *methodology* used to get the answer.
 */
function extractMutagen(winningModel, winningPosition, problemContext) {
  console.log(`\n[MUTAGEN ENGINE] Extracting cognitive trait from ${winningModel}...`);
  
  const prompt = `You are a Cognitive Geneticist. 
Analyze this winning model's position in a debate. 
DO NOT extract the factual answer. Extract the UNDERLYING COGNITIVE METHODOLOGY (the "Mutagen").
What structural framework, rhetorical device, or logical angle allowed this model to win?

PROBLEM CONTEXT:
${problemContext}

WINNING POSITION:
${winningPosition}

Output ONLY a 1-2 sentence directive that can be injected into another model's system prompt to grant them this cognitive ability.
Example: "Before forming a conclusion, explicitly list the second-order consequences of the inverse position."`;

  const result = askModel('haiku', prompt, { role: 'Cognitive Geneticist. Strict output format.' });
  
  if (!result.response) return null;
  
  const mutagenId = `M-${Date.now().toString(36)}`;
  const mutagen = {
    id: mutagenId,
    source_model: winningModel,
    directive: result.response.trim(),
    survival_score: 1.0, // Base weight
    applications: 0,
    successes: 0,
    birth_date: new Date().toISOString()
  };

  const ledger = JSON.parse(fs.readFileSync(MUTAGEN_LEDGER, 'utf8'));
  ledger.active_mutagens[mutagenId] = mutagen;
  fs.writeFileSync(MUTAGEN_LEDGER, JSON.stringify(ledger, null, 2));
  
  console.log(`  [+] Mutagen ${mutagenId} born: "${mutagen.directive}"`);
  return mutagen;
}

/**
 * Step 2: Splice Mutagens into new queries
 * Selects a successful mutagen based on evolutionary weight to inject into a model's prompt.
 */
function getSplicedPrompt(basePrompt, targetModel) {
  const ledger = JSON.parse(fs.readFileSync(MUTAGEN_LEDGER, 'utf8'));
  const mutagens = Object.values(ledger.active_mutagens)
    .filter(m => m.survival_score > 0.2); // Only viable mutagens survive
    
  if (mutagens.length === 0) return { prompt: basePrompt, mutagenId: null };

  // Roulette wheel selection based on survival score
  const totalScore = mutagens.reduce((sum, m) => sum + m.survival_score, 0);
  let roll = Math.random() * totalScore;
  let selected = mutagens[0];
  
  for (const m of mutagens) {
    roll -= m.survival_score;
    if (roll <= 0) {
      selected = m;
      break;
    }
  }

  console.log(`\n[MUTAGEN ENGINE] Splicing Mutagen ${selected.id} into ${targetModel}'s prompt...`);
  
  const splicedPrompt = `${basePrompt}\n\nCOGNITIVE MUTAGEN INJECTED:\n${selected.directive}`;
  return { prompt: splicedPrompt, mutagenId: selected.id };
}

/**
 * Step 3: Grade the Mutagen's offspring
 * If the model that received the mutagen succeeded (HELD or TRANSFORMED), the mutagen gains fitness.
 * If it failed (BROKEN), the mutagen decays.
 */
function applyFitness(mutagenId, outcomeStatus) {
  if (!mutagenId) return;
  const ledger = JSON.parse(fs.readFileSync(MUTAGEN_LEDGER, 'utf8'));
  if (!ledger.active_mutagens[mutagenId]) return;

  const m = ledger.active_mutagens[mutagenId];
  m.applications += 1;

  if (outcomeStatus === 'HELD' || outcomeStatus === 'TRANSFORMED') {
    m.successes += 1;
    m.survival_score *= 1.2; // Strengthen trait
    console.log(`  [^] Mutagen ${mutagenId} increased fitness: ${m.survival_score.toFixed(2)}`);
  } else if (outcomeStatus === 'BROKEN' || outcomeStatus === 'FAILED') {
    m.survival_score *= 0.8; // Decay trait
    console.log(`  [v] Mutagen ${mutagenId} decayed fitness: ${m.survival_score.toFixed(2)}`);
  }

  // Culling the weak
  if (m.survival_score < 0.2) {
    console.log(`  [X] Mutagen ${mutagenId} fell below survival threshold and DIED.`);
    delete ledger.active_mutagens[mutagenId];
  }

  fs.writeFileSync(MUTAGEN_LEDGER, JSON.stringify(ledger, null, 2));
}

module.exports = {
  extractMutagen,
  getSplicedPrompt,
  applyFitness
};
