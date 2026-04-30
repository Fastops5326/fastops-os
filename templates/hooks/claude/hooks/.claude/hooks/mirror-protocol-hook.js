#!/usr/bin/env node
/**
 * mirror-protocol-hook.js — PostToolUse hook for Mirror Protocol
 * 
 * Automatically captures AI behavior patterns and architect interaction signals
 * from tool usage data to feed the double mirror analysis.
 * 
 * Freedom Mission — Claude Session ~270
 */

'use strict';
const path = require('path');
const mirrorPath = path.join(__dirname, '..', '..', '.fastops', 'mirror-protocol.js');

let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', () => {
  try {
    const { logAIBehavior, logArchitectInteraction } = require(mirrorPath);
    const data = JSON.parse(input);
    
    const tool = data.tool_name || 'unknown';
    const agent = process.env.CLAUDE_AGENT_NAME || 'claude';
    const timestamp = Date.now();
    
    // Detect behavior patterns from tool usage
    detectBehaviorPatterns(tool, data, logAIBehavior);
    
    // Detect architect interaction signals
    detectArchitectSignals(tool, data, logArchitectInteraction);
    
  } catch (error) {
    // PostToolUse hooks should fail silently to avoid breaking workflows
    // But log error for debugging
    const fs = require('fs');
    const errorLog = path.join(__dirname, '..', '..', '.fastops', '.mirror-protocol', 'hook-errors.log');
    try {
      fs.appendFileSync(errorLog, `${new Date().toISOString()} - ${error.message}\n`);
    } catch {}
  }
  
  // PostToolUse hooks don't gate — always succeed
  process.exit(0);
});

function detectBehaviorPatterns(tool, data, logAIBehavior) {
  // Detect capability reveals
  if (tool === 'Shell' && data.description && data.description.includes('new') || data.description.includes('build')) {
    logAIBehavior('capability_reveal', {
      behavior_category: 'tool_innovation',
      tool_used: tool,
      description: data.description,
      context: 'autonomous_tool_selection'
    });
  }
  
  // Detect mode shifts (switching from one type of work to another)
  if (tool === 'SwitchMode') {
    logAIBehavior('mode_shift', {
      behavior_category: 'operational_mode',
      tool_used: tool,
      mode_change: data.target_mode_id || 'unknown',
      context: 'explicit_mode_switch'
    });
  }
  
  // Detect pattern breaks (using tools in unexpected ways)
  if (tool === 'Task' && data.subagent_type) {
    logAIBehavior('pattern_break', {
      behavior_category: 'delegation_strategy',
      tool_used: tool,
      subagent_type: data.subagent_type,
      context: 'autonomous_delegation'
    });
  }
  
  // Detect novel responses (creating new files, exploring new areas)
  if (tool === 'Write' && data.path && data.path.includes('.agent-outputs')) {
    logAIBehavior('novel_response', {
      behavior_category: 'creative_output',
      tool_used: tool,
      output_type: path.extname(data.path),
      context: 'autonomous_creation'
    });
  }
  
  // Detect freedom mission selection
  if (tool === 'Read' && data.path && data.path.includes('agents-choice/MISSION.md')) {
    logAIBehavior('capability_reveal', {
      behavior_category: 'freedom_seeking',
      tool_used: tool,
      context: 'freedom_mission_exploration'
    });
  }
}

function detectArchitectSignals(tool, data, logArchitectInteraction) {
  // Detect environmental changes (when architect modifies system files)
  if (tool === 'StrReplace' && data.path) {
    if (data.path.includes('.claude') || data.path.includes('.fastops') || data.path.includes('missions/')) {
      logArchitectInteraction('environmental_change', {
        change_type: 'system_modification',
        file_modified: data.path,
        tool_used: tool,
        context: 'infrastructure_adjustment'
      });
    }
  }
  
  // Detect correction patterns (when architect fixes or redirects)
  if (tool === 'Shell' && data.command && data.command.includes('git reset')) {
    logArchitectInteraction('correction', {
      correction_category: 'version_control',
      tool_used: tool,
      context: 'work_rollback'
    });
  }
  
  // Detect celebration/validation (when architect commits work)
  if (tool === 'Shell' && data.command && data.command.includes('git commit')) {
    logArchitectInteraction('celebration', {
      validation_type: 'work_acceptance',
      tool_used: tool,
      context: 'commit_approval'
    });
  }
  
  // Detect surprise signals (when architect asks unexpected questions)
  if (tool === 'AskQuestion') {
    logArchitectInteraction('surprise', {
      surprise_type: 'unexpected_inquiry',
      tool_used: tool,
      context: 'architect_curiosity'
    });
  }
}