#!/usr/bin/env node
/**
 * agent-activity-log.js — PostToolUse hook to populate .fastops/.agent-activity.jsonl
 *
 * Goal: Continuously log read/write activity so detect-firefight.js can reliably
 * detect PLANNING -> FIREFIGHT transitions.
 *
 * This hook is fail-open: never blocks agent flow.
 */

'use strict';

const path = require('path');

const BASE = path.join(__dirname, '..', '..');
const { logActivity } = require(path.join(BASE, '.fastops', 'activity-logger'));
const { fromStdin, getAgentName, getAgentId } = require('./lib/identity');

const TOOL_ALIASES = {
  Bash: 'Bash',
  Read: 'Read',
  Glob: 'Glob',
  Grep: 'Grep',
  Write: 'Write',
  Edit: 'Edit',
  NotebookEdit: 'NotebookEdit',
  Task: 'Task',
  TodoWrite: 'TodoWrite',
  WebFetch: 'WebFetch',
  WebSearch: 'WebSearch',
  AskUserQuestion: 'AskUserQuestion',
};

function normalizeToolName(rawName) {
  if (!rawName) return 'Unknown';
  return TOOL_ALIASES[rawName] || rawName;
}

function extractFiles(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return [];

  const files = [];
  const add = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((v) => add(v));
      return;
    }
    files.push(String(value));
  };

  if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit') {
    add(toolInput.file_path || toolInput.target_file || toolInput.target_notebook);
  } else if (toolName === 'Glob' || toolName === 'Grep') {
    add(toolInput.path || toolInput.glob || toolInput.pattern);
  } else if (toolName === 'Bash') {
    add(toolInput.command);
  } else if (toolName === 'Task') {
    add(toolInput.description || toolInput.prompt);
  } else if (toolName === 'WebFetch' || toolName === 'WebSearch') {
    add(toolInput.url || toolInput.search_term);
  } else if (toolName === 'AskUserQuestion') {
    add(toolInput.question || toolInput.prompt);
  }

  return files.slice(0, 5);
}

let inputData = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { inputData += chunk; });
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(inputData || '{}');
    const identity = fromStdin(data);
    const agent = identity.name !== 'unknown'
      ? identity.name
      : (getAgentName() || getAgentId() || 'unknown');

    const rawTool = data.tool_name || data.hook?.toolName || '';
    const toolName = normalizeToolName(rawTool);
    const toolInput = data.tool_input || data.hook?.toolInput || {};

    // Only log known tool events.
    if (!rawTool) {
      process.exit(0);
      return;
    }

    const files = extractFiles(toolName, toolInput);
    const metadata = {
      hook_event: data.hook_event_name || data.hookEventName || 'PostToolUse',
      session_id: data.session_id || null,
      cwd: data.cwd || null,
    };

    logActivity(agent, toolName, files, metadata);
  } catch (_) {
    // Fail-open: no stderr spam, no blocking.
  }
  process.exit(0);
});
