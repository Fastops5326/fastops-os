#!/usr/bin/env node
/**
 * cdp-status.js — UI State Poller
 *
 * Connects to the Cursor UI via CDP and determines if any agent is currently generating.
 * Returns JSON: { isGenerating: boolean, details: string }
 *
 * Usage:
 *   node .fastops/cdp/cdp-status.js
 */

const CDP = require('chrome-remote-interface');

async function checkStatus() {
    let client;
    try {
        client = await CDP({ port: 9223 });
        const { Runtime } = client;
        await Runtime.enable();
        
        const expression = `
            (() => {
                const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
                const activeGenerations = buttons
                    .filter(b => b.textContent && (b.textContent.includes('Cancel') || b.textContent.includes('Stop generating')))
                    .map(b => b.textContent.trim());
                
                return {
                    isGenerating: activeGenerations.length > 0,
                    details: activeGenerations.length > 0 ? "UI is currently generating ('Cancel' button visible)" : "UI is idle"
                };
            })()
        `;
        
        const result = await Runtime.evaluate({ 
            expression: expression, 
            returnByValue: true 
        });
        
        console.log(JSON.stringify(result.result.value));
        process.exit(result.result.value.isGenerating ? 1 : 0); // Exit 1 if busy, 0 if idle
    } catch (err) {
        // If we can't connect, assume it's idle or broken
        console.log(JSON.stringify({ isGenerating: false, details: "Failed to connect to CDP" }));
        process.exit(0); 
    } finally {
        if (client) await client.close();
    }
}

checkStatus();