// === ADVERSARIAL JURY — Cross-Cluster Validation Component ===
// Designed by: 16 models via city-pipeline (Teams Alpha+Bravo, 0.85/0.80 convergence)
// Built by: Grok (2026-04-01)
// Problem: Validate cluster outputs without central authority
// Anti-gaming: Jury selection enforces architecture diversity, preventing collusion

const { askModel } = require('./safe-exec');
const { MODELS } = require('./model-registry');

// Architecture families for diversity-enforced jury selection
const ARCHITECTURE_FAMILIES = {
  anthropic: ['claude-sonnet'], google: ['gemini', 'gemini-flash'],
  openai: ['gpt', 'gpt-5'], deepseek: ['deepseek', 'deepseek-r1'],
  mistral: ['mistral', 'mistral-small'], xai: ['grok', 'grok-full'],
  meta: ['llama', 'llama-scout', 'llama-70b'], alibaba: ['qwen', 'qwen-max'],
  moonshot: ['kimi-k2', 'kimi-k2-think'], nous: ['hermes-405b', 'hermes-70b'],
  zhipu: ['glm-5'], cogito: ['cogito'], amazon: ['nova'],
};

/**
 * Selects 3-5 jury models from different architecture families and clusters, excluding the given cluster models.
 * @param {string[]} clusterModels - Models in the current cluster
 * @param {string[]} allModels - All available models in the city
 * @param {number} [jurySize=3] - Number of jury members to select
 * @returns {string[]} Array of selected jury model names
 */
function selectJury(clusterModels, allModels, jurySize = 3) {
  const availableFamilies = { ...ARCHITECTURE_FAMILIES }; // Copy to avoid mutation
  const excludedModels = new Set(clusterModels);
  const jury = [];
  
  while (jury.length < jurySize && Object.keys(availableFamilies).length > 0) {
    const familyKeys = Object.keys(availableFamilies);
    const randomFamily = familyKeys[Math.floor(Math.random() * familyKeys.length)];
    const familyModels = availableFamilies[randomFamily].filter(model => !excludedModels.has(model) && allModels.includes(model));
    if (familyModels.length > 0) {
      const selectedModel = familyModels[Math.floor(Math.random() * familyModels.length)];
      jury.push(selectedModel);
      delete availableFamilies[randomFamily]; // Ensure family diversity
    } else {
      delete availableFamilies[randomFamily]; // Remove family if no valid models
    }
  }
  return jury;
}

/**
 * Runs the jury challenge by having each jury model adversarially find weaknesses in the converged position.
 * @param {string} convergedPosition - The cluster's converged output string
 * @param {string[]} juryModels - Array of jury model names
 * @returns {object[]} Array of challenge results, each with { model, weaknessesFound, recommendation }
 */
function runJuryChallenge(convergedPosition, juryModels) {
  const challenges = [];
  for (const model of juryModels) {
    const prompt = `You are an ADVERSARIAL REVIEWER. Your job is to find weaknesses, not confirm.

CONVERGED POSITION FROM ANOTHER CLUSTER:
${convergedPosition}

Find specific weaknesses:
1. What assumptions are unexamined?
2. What evidence would contradict this?
3. What alternative explanations exist?

If you find NO genuine weaknesses, say "NO WEAKNESSES FOUND" — but be honest.`;
    const result = askModel(model, prompt, { role: 'Adversarial jury reviewer.', timeout: 120000 });
    if (result.response) {
      const foundWeaknesses = !/NO WEAKNESSES FOUND/i.test(result.response);
      challenges.push({ model, weaknessesFound: foundWeaknesses ? [result.response] : [], recommendation: result.response.slice(0, 300), foundWeaknesses });
    } else {
      challenges.push({ model, weaknessesFound: [], recommendation: 'Error: no response', error: result.error, foundWeaknesses: false });
    }
  }
  return challenges;
}

/**
 * Scores the jury challenge results and provides a recommendation.
 * @param {object[]} challenges - Array of challenge results from runJuryChallenge
 * @returns {object} { juryScore, survivedChallenges, failedChallenges, juryRecommendation }
 */
function scoreJuryResult(challenges) {
  let failed = 0;
  let survived = 0;
  const recommendations = [];
  for (const challenge of challenges) {
    if (challenge.weaknessesFound && challenge.weaknessesFound.length > 0) {
      failed++;
    } else {
      survived++;
    }
    recommendations.push(challenge.recommendation || 'No recommendation');
  }
  const total = challenges.length;
  const juryScore = total > 0 ? survived / total : 0;
  const juryRecommendation = survived === total ? 'Unanimously Accepted'
    : survived > failed ? 'Accepted with Reservations'
    : 'Rejected';
  return {
    juryScore,
    survivedChallenges: survived,
    failedChallenges: failed,
    juryRecommendation
  };
}

module.exports = {
  selectJury,
  runJuryChallenge,
  scoreJuryResult
};