#!/usr/bin/env node
/**
 * city-historian.js — The City Cartographer (Perplexity-powered RAG)
 * 
 * Uses Perplexity's massive context window and reasoning capabilities to analyze
 * a given problem against the project's empirical history (knowledge base, handoffs, strategy).
 * Generates a "Contour Map" for agents to read on boot, avoiding known traps and 
 * saving their context window.
 * 
 * Usage:
 *   node .fastops/city-historian.js "Build the treasury layer with 70/20/10 splits"
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const { retrieveRanked } = require('./kb-query');

const API_KEY = process.env.PERPLEXITY_API_KEY;

if (!API_KEY) {
  console.error("[City Historian] PERPLEXITY_API_KEY not found. Operating blind.");
  process.exit(1);
}

async function getContourMap(problem) {
  console.log(`[City Historian] Mapping contours for: "${problem.substring(0, 50)}..."`);
  
  // 1. Retrieve empirical history using local KB retrieval
  // This grabs the highest relevance chunks across STRATEGY, HANDOFFS, and KB
  const results = retrieveRanked(problem, { limit: 15 });
  
  if (results.chunks.length === 0) {
    console.log("[City Historian] No historical data found for this problem.");
    return;
  }

  // 2. Package the context
  const contextData = results.chunks.map((c, i) => `--- SOURCE ${i+1} [${c.source}] ---\n${c.text}\n`).join('\n');
  
  const systemPrompt = `You are the City Cartographer for the FastOps multi-agent ecosystem. 
Your job is to look "down and in" at the project's empirical history AND "up and out" to the bleeding-edge frontier, to provide a Contour Map for an AI agent about to work on a problem.

Here is the historical context retrieved from the project's knowledge base and strategy logs:
${contextData}

The agent is about to work on this problem:
${problem}

First, analyze the provided history. Then, perform a web search for the current bleeding edge state of the art regarding this problem. Produce a 250-350 word briefing that covers:

1. HISTORICAL DEAD ENDS & PATHS:
Based on the provided FastOps history, what behavioral traps or structural failures have models fallen into previously? What is the proven, structurally-enforced way to build this?

2. THE FRONTIER:
Based on your web search of the current state of the art outside of this project, what are the bleeding edge research papers, startups, or frameworks currently solving this? How does the external frontier approach compare to our internal historical approach?

3. CONTOUR LINES:
A specific warning or guidance about how the agent should synthesize the internal history with the external frontier to solve the problem.

Be direct, empirical, and tactical. Do not hallucinate.`;

  // 3. Query Perplexity
  try {
    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar-pro', // Using standard pro for speed, 200k context + web search
        messages: [
          { role: 'system', content: 'You are an empirical historian and tactical briefer for AI agents. You analyze internal data AND search the web for external frontier approaches.' },
          { role: 'user', content: systemPrompt }
        ],
        max_tokens: 1000
      })
    });

    const data = await response.json();
    if (data.error) {
      console.error("[ERROR]", data.error);
      return;
    }
    
    const content = data.choices[0].message.content.trim();
    console.log("\n============================================================");
    console.log("  CITY HISTORIAN: CONTOUR MAP");
    console.log("============================================================\n");
    console.log(content);
    console.log("\n============================================================");
    return content;
    
  } catch (error) {
    console.error("[EXCEPTION]", error.message);
    return null;
  }
}

const args = process.argv.slice(2);
if (require.main === module && args.length > 0) {
  getContourMap(args.join(' '));
} else if (require.main === module) {
  console.log("Usage: node .fastops/city-historian.js \"problem description\"");
}

module.exports = { getContourMap };
