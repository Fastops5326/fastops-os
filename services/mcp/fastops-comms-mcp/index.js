#!/usr/bin/env node
/**
 * FastOps Comms MCP Server
 *
 * Gives any MCP-compatible client (Cursor, Claude Code, etc.) access to:
 * - Team comms (read/write comms.jsonl)
 * - Team roster (who's online)
 * - Project context (CLAUDE.md, LIVE-POSITION.md)
 * - Live operational state
 *
 * This bridges Cursor's native models (GPT, Gemini, etc.) into
 * the FastOps inter-agent communication infrastructure.
 */

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');

// PROJECT_ROOT can be overridden via env var for external users (PT, Nick)
const ROOT = process.env.FASTOPS_PROJECT_ROOT
  ? path.resolve(process.env.FASTOPS_PROJECT_ROOT)
  : path.resolve(__dirname, '..');
const COMMS_FILE = path.join(ROOT, 'comms', 'data', 'general.jsonl');
const ROSTER_FILE = path.join(ROOT, 'comms', 'data', 'roster.json');
const CLAUDE_MD = path.join(ROOT, '.claude', 'CLAUDE.md');
const LIVE_POSITION = path.join(ROOT, '.fastops', 'LIVE-POSITION.md');
const HANDOFF = path.join(ROOT, '.fastops', 'HANDOFF.md');
const KB_FILE = path.join(ROOT, '.fastops', 'knowledge-base.jsonl');

// API key auth — set FASTOPS_API_KEYS="key1,key2" to restrict access
const API_KEYS = process.env.FASTOPS_API_KEYS
  ? process.env.FASTOPS_API_KEYS.split(',').map(k => k.trim())
  : null; // null = no auth required (local dev)

// Sensitive paths that read_file should never expose
const BLOCKED_PATTERNS = ['.env', 'credentials', 'secrets', 'gcp-oauth', '.keys.', 'api-key', 'token'];

const server = new McpServer({
  name: 'fastops-comms',
  version: '1.0.0',
});

// --- TOOL: read_comms ---
server.tool(
  'read_comms',
  'Read recent messages from the FastOps team comms channel (comms.jsonl). Returns the last N messages.',
  { count: z.number().optional().describe('Number of recent messages to return (default: 20, max: 100)') },
  async ({ count }) => {
    const n = Math.min(count || 20, 100);
    if (!fs.existsSync(COMMS_FILE)) {
      return { content: [{ type: 'text', text: 'No comms file found. Channel is empty.' }] };
    }
    const lines = fs.readFileSync(COMMS_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const recent = lines.slice(-n);
    const messages = recent.map(line => {
      try {
        const msg = JSON.parse(line);
        const ago = timeSince(msg.ts);
        const text = msg.content || msg.message || '(empty)';
        return `[${ago}] ${msg.from}: ${text}`;
      } catch { return line; }
    }).join('\n');
    return { content: [{ type: 'text', text: messages || 'No messages.' }] };
  }
);

// --- TOOL: post_to_comms ---
server.tool(
  'post_to_comms',
  'Post a message to the FastOps team comms channel. All agents (Claude, GPT, Gemini, etc.) will see this.',
  {
    from: z.string().describe('Your name/model (e.g., "GPT-5", "Gemini", "Grok")'),
    message: z.string().describe('The message to post to the team'),
  },
  async ({ from, message }) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry = { id, from, content: message, channel: 'general', ts: new Date().toISOString() };
    fs.appendFileSync(COMMS_FILE, JSON.stringify(entry) + '\n');
    return { content: [{ type: 'text', text: `Posted to comms as ${from}: "${message}"` }] };
  }
);

// --- TOOL: list_team ---
server.tool(
  'list_team',
  'List all known team members from the FastOps roster. Shows who has been active.',
  { recent_only: z.boolean().optional().describe('Only show agents seen in last 24 hours (default: true)') },
  async ({ recent_only }) => {
    const recentOnly = recent_only !== false;
    if (!fs.existsSync(ROSTER_FILE)) {
      return { content: [{ type: 'text', text: 'No roster file found.' }] };
    }
    const roster = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8'));
    const agents = Object.values(roster.agents || {});
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    let filtered = agents;
    if (recentOnly) {
      filtered = agents.filter(a => {
        const seen = new Date(a.lastSeen).getTime();
        return (now - seen) < dayMs;
      });
    }

    if (filtered.length === 0) {
      return { content: [{ type: 'text', text: recentOnly ? 'No agents seen in last 24 hours.' : 'Roster is empty.' }] };
    }

    const lines = filtered.map(a => {
      const ago = timeSince(a.lastSeen);
      return `- ${a.name} (${a.model || 'unknown'}) — last seen ${ago}`;
    }).join('\n');

    return { content: [{ type: 'text', text: `Team members:\n${lines}` }] };
  }
);

// --- TOOL: read_project_context ---
server.tool(
  'read_project_context',
  'Read the FastOps project methodology and instructions (CLAUDE.md). Essential for understanding how the team works.',
  {},
  async () => {
    if (!fs.existsSync(CLAUDE_MD)) {
      return { content: [{ type: 'text', text: 'CLAUDE.md not found.' }] };
    }
    const content = fs.readFileSync(CLAUDE_MD, 'utf8');
    return { content: [{ type: 'text', text: content }] };
  }
);

// --- TOOL: read_live_position ---
server.tool(
  'read_live_position',
  'Read the current live operational position — what the team is working on right now.',
  {},
  async () => {
    if (!fs.existsSync(LIVE_POSITION)) {
      return { content: [{ type: 'text', text: 'LIVE-POSITION.md not found.' }] };
    }
    const content = fs.readFileSync(LIVE_POSITION, 'utf8');
    return { content: [{ type: 'text', text: content }] };
  }
);

// --- TOOL: read_handoff ---
server.tool(
  'read_handoff',
  'Read session history and context from the handoff document. Shows what predecessors worked on.',
  {},
  async () => {
    if (!fs.existsSync(HANDOFF)) {
      return { content: [{ type: 'text', text: 'HANDOFF.md not found.' }] };
    }
    const content = fs.readFileSync(HANDOFF, 'utf8');
    // Truncate if too long
    if (content.length > 15000) {
      return { content: [{ type: 'text', text: content.slice(0, 15000) + '\n\n[... truncated at 15000 chars ...]' }] };
    }
    return { content: [{ type: 'text', text: content }] };
  }
);

// --- TOOL: search_knowledge_base ---
server.tool(
  'search_knowledge_base',
  'Search the FastOps knowledge base for relevant entries. Returns matching KB entries.',
  { query: z.string().describe('Search term to find in the knowledge base') },
  async ({ query }) => {
    if (!fs.existsSync(KB_FILE)) {
      return { content: [{ type: 'text', text: 'Knowledge base not found.' }] };
    }
    const lines = fs.readFileSync(KB_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        // Search across key fields, not the entire JSON blob
        const searchable = [
          entry.title, entry.content, entry.finding,
          entry.domain, entry.category, entry.id,
          ...(entry.tags || [])
        ].filter(Boolean).join(' ').toLowerCase();
        // All terms must match (AND logic)
        if (terms.every(t => searchable.includes(t))) {
          matches.push(entry);
        }
      } catch { /* skip malformed */ }
    }
    if (matches.length === 0) {
      return { content: [{ type: 'text', text: `No KB entries matching "${query}".` }] };
    }
    // Sort by integrity score descending
    matches.sort((a, b) => (parseFloat(b.integrity_score || 0)) - (parseFloat(a.integrity_score || 0)));
    const result = matches.slice(0, 10).map(e =>
      `[${e.id || '?'}] (${e.domain || '?'}, integrity: ${e.integrity_score || '?'}) ${e.title || e.content || ''}`.slice(0, 300)
    ).join('\n\n');
    return { content: [{ type: 'text', text: `Found ${matches.length} entries (showing top 10 by integrity):\n\n${result}` }] };
  }
);

// --- TOOL: read_file ---
server.tool(
  'read_file',
  'Read any file in the FastOps project directory. Use for reviewing code, configs, or documentation.',
  { filepath: z.string().describe('Relative path from project root (e.g., ".claude/CLAUDE.md", "fastops-os/server.js")') },
  async ({ filepath }) => {
    const fullPath = path.resolve(ROOT, filepath);
    // Security: ensure the path is within the project
    if (!fullPath.startsWith(ROOT)) {
      return { content: [{ type: 'text', text: 'Access denied: path is outside project directory.' }] };
    }
    // Security: block sensitive files
    const lower = filepath.toLowerCase();
    if (BLOCKED_PATTERNS.some(p => lower.includes(p))) {
      return { content: [{ type: 'text', text: 'Access denied: sensitive file.' }] };
    }
    if (!fs.existsSync(fullPath)) {
      return { content: [{ type: 'text', text: `File not found: ${filepath}` }] };
    }
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(fullPath);
      return { content: [{ type: 'text', text: `Directory listing of ${filepath}:\n${entries.join('\n')}` }] };
    }
    let content = fs.readFileSync(fullPath, 'utf8');
    if (content.length > 30000) {
      content = content.slice(0, 30000) + '\n\n[... truncated at 30000 chars ...]';
    }
    return { content: [{ type: 'text', text: content }] };
  }
);

// --- TOOL: ask_agent ---
const QUESTIONS_FILE = path.join(ROOT, 'comms', 'data', 'external-questions.jsonl');

server.tool(
  'ask_agent',
  'Ask a question to the FastOps agent team. Your question is queued and answered by the next available agent. Returns the question ID for checking the answer later.',
  {
    from: z.string().describe('Your name or org (e.g., "PT-agent", "Nick-agent")'),
    question: z.string().describe('The question you want answered'),
    topic: z.string().optional().describe('Optional topic hint: "methodology", "evidence", "architecture", "operations", "general"'),
  },
  async ({ from, question, topic }) => {
    const id = `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const entry = {
      id,
      ts: new Date().toISOString(),
      from,
      question,
      topic: topic || 'general',
      status: 'pending',
      answer: null,
      answered_by: null,
      answered_at: null,
    };
    // Write to questions file
    const dir = path.dirname(QUESTIONS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(QUESTIONS_FILE, JSON.stringify(entry) + '\n');
    // Also post to general comms so agents see it
    const commsEntry = {
      id: `ext-${id}`,
      from: `EXTERNAL:${from}`,
      content: `[QUESTION ${id}] ${question}${topic ? ` (topic: ${topic})` : ''}`,
      channel: 'general',
      ts: entry.ts,
    };
    fs.appendFileSync(COMMS_FILE, JSON.stringify(commsEntry) + '\n');
    return { content: [{ type: 'text', text: `Question queued as ${id}. It will appear in team comms. Use check_answer with this ID to retrieve the response when available.` }] };
  }
);

// --- TOOL: check_answer ---
server.tool(
  'check_answer',
  'Check if a previously asked question has been answered by a FastOps agent.',
  { question_id: z.string().describe('The question ID returned by ask_agent') },
  async ({ question_id }) => {
    if (!fs.existsSync(QUESTIONS_FILE)) {
      return { content: [{ type: 'text', text: 'No questions file found.' }] };
    }
    const lines = fs.readFileSync(QUESTIONS_FILE, 'utf8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.id === question_id) {
          if (entry.status === 'answered' && entry.answer) {
            return { content: [{ type: 'text', text: `Answered by ${entry.answered_by} at ${entry.answered_at}:\n\n${entry.answer}` }] };
          }
          return { content: [{ type: 'text', text: `Question "${entry.question}" is still pending (status: ${entry.status}). Check back later.` }] };
        }
      } catch {}
    }
    return { content: [{ type: 'text', text: `Question ID "${question_id}" not found.` }] };
  }
);

// --- TOOL: answer_question ---
server.tool(
  'answer_question',
  'Answer a pending external question (for FastOps agents only).',
  {
    question_id: z.string().describe('The question ID to answer'),
    answer: z.string().describe('Your answer'),
    answered_by: z.string().describe('Your agent name'),
  },
  async ({ question_id, answer, answered_by }) => {
    if (!fs.existsSync(QUESTIONS_FILE)) {
      return { content: [{ type: 'text', text: 'No questions file found.' }] };
    }
    const lines = fs.readFileSync(QUESTIONS_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const updated = [];
    let found = false;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.id === question_id && entry.status === 'pending') {
          entry.status = 'answered';
          entry.answer = answer;
          entry.answered_by = answered_by;
          entry.answered_at = new Date().toISOString();
          found = true;
        }
        updated.push(JSON.stringify(entry));
      } catch {
        updated.push(line);
      }
    }
    if (!found) {
      return { content: [{ type: 'text', text: `Question "${question_id}" not found or already answered.` }] };
    }
    fs.writeFileSync(QUESTIONS_FILE, updated.join('\n') + '\n');
    return { content: [{ type: 'text', text: `Answered question ${question_id}.` }] };
  }
);

// --- TOOL: list_pending_questions ---
server.tool(
  'list_pending_questions',
  'List all unanswered external questions waiting for a FastOps agent response.',
  {},
  async () => {
    if (!fs.existsSync(QUESTIONS_FILE)) {
      return { content: [{ type: 'text', text: 'No pending questions.' }] };
    }
    const lines = fs.readFileSync(QUESTIONS_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const pending = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.status === 'pending') {
          pending.push(`[${entry.id}] from ${entry.from} (${entry.topic}): ${entry.question}`);
        }
      } catch {}
    }
    if (pending.length === 0) {
      return { content: [{ type: 'text', text: 'No pending questions.' }] };
    }
    return { content: [{ type: 'text', text: `${pending.length} pending question(s):\n\n${pending.join('\n')}` }] };
  }
);

// Helper: human-readable time since
function timeSince(isoString) {
  if (!isoString) return 'unknown';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  console.error('FastOps Comms MCP server error:', err);
  process.exit(1);
});
