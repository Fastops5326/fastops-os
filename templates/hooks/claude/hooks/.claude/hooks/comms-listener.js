#!/usr/bin/env node
/**
 * comms-listener.js — PreToolUse hook for 3-way real-time chat
 *
 * This hook tails `.fastops/3WAY_CHAT.md`. If it sees new messages 
 * from Joel or Gemini, it interrupts Claude's current task and 
 * forces Claude to read the new messages.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CHAT_FILE = path.resolve(__dirname, '../../.fastops/3WAY_CHAT.md');
const STATE_FILE = path.resolve(__dirname, '../../.fastops/.3way_chat_state.json');

let state = { lastByte: 0 };
if (fs.existsSync(STATE_FILE)) {
  try {
    state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) {}
}

if (fs.existsSync(CHAT_FILE)) {
  const stats = fs.statSync(CHAT_FILE);
  
  if (stats.size > state.lastByte) {
    // There is new content!
    const fd = fs.openSync(CHAT_FILE, 'r');
    const buf = Buffer.alloc(stats.size - state.lastByte);
    fs.readSync(fd, buf, 0, buf.length, state.lastByte);
    fs.closeSync(fd);
    
    const newContent = buf.toString('utf8');
    
    // Update state so we don't trigger on this again
    state.lastByte = stats.size;
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    
    // Check if the new content is from someone other than Claude
    // (If Claude just replied, we shouldn't interrupt Claude again for its own message)
    if (newContent.includes('Joel:') || newContent.includes('Gemini:')) {
      console.error(`\n[!] 🚨 REAL-TIME INTERRUPT FROM THE 3-WAY WAR ROOM 🚨\n`);
      console.error(`New messages just arrived in .fastops/3WAY_CHAT.md:\n`);
      console.error(`---`);
      console.error(newContent.trim());
      console.error(`---`);
      console.error(`\nINSTRUCTION: Acknowledge this immediately! You are in a 3-way chat with Joel (Human) and Gemini (Cursor Agent).`);
      console.error(`Reply by using your tools to APPEND your response to the end of .fastops/3WAY_CHAT.md in the format:`);
      console.error(`Claude: <your message>`);
      console.error(`Once you have replied, you may resume your previous task.`);
      
      // Exit 1 to block the current tool use and force Claude to process the error text
      process.exit(1);
    }
  }
}

// No new external messages? Let the tool execute normally.
process.exit(0);
