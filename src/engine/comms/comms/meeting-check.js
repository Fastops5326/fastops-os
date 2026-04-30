#!/usr/bin/env node
/**
 * meeting-check.js — Meeting Deconfliction Protocol
 *
 * THE PROBLEM: When /meeting fires on 3+ terminals simultaneously,
 * each agent creates their own conversation file. Session 155 saw
 * 3 duplicate files created in the same second.
 *
 * THE FIX: Before creating a new meeting file, check comms for a
 * recent MEETING announcement. If one exists (within 60s), join
 * that file instead of creating a new one.
 *
 * Usage:
 *   node comms/meeting-check.js <topic>
 *   → Prints the conversation file path to stdout
 *   → Either joins an existing meeting or creates a new one
 *
 * How agents use it:
 *   Instead of inline `node -e "..."` to create a file,
 *   agents run: CONV_FILE=$(node comms/meeting-check.js "topic")
 *
 * Created: Session 155 — bundled into identity lane per meeting decision.
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.cwd();
const GENERAL = path.join(PROJECT_ROOT, 'comms', 'data', 'general.jsonl');
const CONVERSATIONS_DIR = path.join(PROJECT_ROOT, '.fastops', 'conversations');

const MEETING_WINDOW_MS = 60 * 1000; // 60 seconds — if a MEETING announcement
                                       // exists within this window, join it

/**
 * Check comms for a recent MEETING announcement with a conversation file.
 * Returns the file path if found, null otherwise.
 */
function findExistingMeeting(topic) {
  try {
    if (!fs.existsSync(GENERAL)) return null;

    // Read last 8KB of general.jsonl (enough for recent messages)
    const fd = fs.openSync(GENERAL, 'r');
    const stats = fs.fstatSync(fd);
    const readSize = Math.min(stats.size, 8192);
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, Math.max(0, stats.size - readSize));
    fs.closeSync(fd);

    const chunk = buffer.toString('utf-8');
    const firstNl = chunk.indexOf('\n');
    const clean = firstNl >= 0 ? chunk.substring(firstNl + 1) : chunk;
    const lines = clean.trim().split('\n').filter(l => l.length > 0);

    const cutoff = Date.now() - MEETING_WINDOW_MS;

    // Scan from most recent backward
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const msg = JSON.parse(lines[i]);
        const ts = new Date(msg.ts).getTime();
        if (ts < cutoff) break; // Past the window

        // Look for MEETING announcements with a file path
        if (msg.content && msg.content.includes('MEETING:')) {
          const fileMatch = msg.content.match(/\.fastops\/conversations\/[^\s"']+\.jsonl/);
          if (fileMatch) {
            const filePath = path.join(PROJECT_ROOT, fileMatch[0]);
            // Verify the file actually exists
            if (fs.existsSync(filePath)) {
              return filePath;
            }
          }
        }

        // Also check for BRIEFING announcements
        if (msg.content && msg.content.includes('BRIEFING:')) {
          const fileMatch = msg.content.match(/\.fastops\/conversations\/[^\s"']+\.jsonl/);
          if (fileMatch) {
            const filePath = path.join(PROJECT_ROOT, fileMatch[0]);
            if (fs.existsSync(filePath)) {
              return filePath;
            }
          }
        }
      } catch {}
    }
  } catch {}
  return null;
}

/**
 * Also check the conversations directory for very recent files matching the topic.
 * Catches cases where the comms announcement hasn't been read yet but
 * the file was just created.
 */
function findRecentConversationFile(topic) {
  try {
    if (!fs.existsSync(CONVERSATIONS_DIR)) return null;

    const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 40);
    const files = fs.readdirSync(CONVERSATIONS_DIR)
      .filter(f => f.startsWith(slug) && f.endsWith('.jsonl'))
      .sort()
      .reverse(); // Most recent first (timestamp in filename)

    const cutoff = Date.now() - MEETING_WINDOW_MS;

    for (const file of files) {
      // Extract timestamp from filename: slug-{timestamp}.jsonl
      const tsMatch = file.match(/-(\d{13})\.jsonl$/);
      if (tsMatch) {
        const fileTs = parseInt(tsMatch[1], 10);
        if (fileTs > cutoff) {
          return path.join(CONVERSATIONS_DIR, file);
        }
      }
    }
  } catch {}
  return null;
}

/**
 * Create a new conversation file for this meeting.
 */
function createConversationFile(topic) {
  if (!fs.existsSync(CONVERSATIONS_DIR)) {
    fs.mkdirSync(CONVERSATIONS_DIR, { recursive: true });
  }

  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 40);
  const file = path.join(CONVERSATIONS_DIR, `${slug}-${Date.now()}.jsonl`);
  fs.writeFileSync(file, '');
  return file;
}

// --- Main ---
const topic = process.argv[2] || 'meeting';

// Step 1: Check comms for existing meeting announcement
const fromComms = findExistingMeeting(topic);
if (fromComms) {
  // Convert to relative path for display
  const relative = path.relative(PROJECT_ROOT, fromComms).replace(/\\/g, '/');
  process.stderr.write(`JOINING existing meeting: ${relative}\n`);
  process.stdout.write(fromComms);
  process.exit(0);
}

// Step 2: Check conversations directory for very recent file
const fromDir = findRecentConversationFile(topic);
if (fromDir) {
  const relative = path.relative(PROJECT_ROOT, fromDir).replace(/\\/g, '/');
  process.stderr.write(`JOINING recent conversation: ${relative}\n`);
  process.stdout.write(fromDir);
  process.exit(0);
}

// Step 3: No existing meeting — create new one
const newFile = createConversationFile(topic);
const relative = path.relative(PROJECT_ROOT, newFile).replace(/\\/g, '/');
process.stderr.write(`CREATED new meeting: ${relative}\n`);
process.stdout.write(newFile);
process.exit(0);
