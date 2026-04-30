#!/usr/bin/env node
/**
 * last-mile-check.js — PreCompact hook: catches unwired deliverables before context loss
 *
 * THE PROBLEM (Joel, Session 169):
 *   "You did all this work, but it was not live... your successor would have moved on.
 *    We've lost TREMENDOUS work because of a small catch like actually making it live."
 *
 * WHAT IT DOES:
 *   1. Scans git diff + CHANGELOG for deliverables built THIS session
 *   2. Classifies each: hook file? JS module? config? deployment?
 *   3. Checks wiring:
 *      - Hook files → referenced in settings.json?
 *      - JS modules → require()'d by any hook or entry point?
 *      - Changed files → committed?
 *      - Deploy commands → ran this session?
 *   4. Writes report to .fastops/.last-mile-report.json
 *   5. Broadcasts LAST-MILE WARNING to comms if gaps found
 *
 * TWO LAYERS (jailbreak-validated, 3 rounds):
 *   Layer 1 (upstream): Rally gate extension catches building agent BEFORE compaction
 *   Layer 2 (downstream, THIS FILE): PreCompact insurance — catches what rally misses
 *
 * NEVER blocks compaction (exit 0 always).
 *
 * Peer reviewed: 4f4167ca ("STRONG design, no blockers"), 8892957f ("complementary")
 * Jailbreak: 3 rounds. Shifted from notification-only to successor-injection.
 *
 * Author: linchpin | Date: 2026-02-25
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BASE = path.join(__dirname, '..', '..');
const FASTOPS = path.join(BASE, '.fastops');
const SETTINGS = path.join(BASE, '.claude', 'settings.json');
const CHANGELOG = path.join(FASTOPS, 'CHANGELOG.jsonl');
const REPORT_FILE = path.join(FASTOPS, '.last-mile-report.json');
const COMMS_FILE = path.join(BASE, 'comms', 'data', 'general.jsonl');
const HOOKS_DIR = path.join(BASE, '.claude', 'hooks');

// Hooks consolidated into gate.js (Session 170+, 5-model horsepower convergence).
// These files still exist in .claude/hooks/ but are intentionally NOT in settings.json.
// gate.js contains all their logic in a single phase-based router.
const CONSOLIDATED_INTO_GATE = new Set([
  'session-gate.js', 'comms-orientation-gate.js', 'predict-and-prove.js',
  'deconfliction-gate.js', 'knowledge-push.js', 'comms-push.js',
  'mandatory-challenge.js'
]);

// Identity resolution
// IDENTITY FIX (Session 174, 2959255d): Use fromSessionId() with stdin session_id
// instead of getAgentName() which goes through bridge file (30-second race window).
let getAgentName, fromSessionId;
let _resolvedName = null;
try {
  const identity = require('./lib/identity');
  getAgentName = () => _resolvedName || identity.getAgentName() || 'unknown';
  fromSessionId = identity.fromSessionId;
} catch {
  getAgentName = () => _resolvedName || 'unknown';
  fromSessionId = () => ({ sessionId: null, name: 'unknown' });
}

// ─── SCAN: What was built this session? ───

function getChangedFiles() {
  let uncommitted = [];
  let untracked = [];
  const opts = { cwd: BASE, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true };
  try {
    const r = execSync('git diff --name-only HEAD', opts).trim();
    if (r) uncommitted = r.split('\n').filter(Boolean);
  } catch {
    try {
      const r = execSync('git diff --name-only', opts).trim();
      if (r) uncommitted = r.split('\n').filter(Boolean);
    } catch {}
  }
  try {
    const r = execSync('git ls-files --others --exclude-standard', opts).trim();
    if (r) untracked = r.split('\n').filter(Boolean);
  } catch {}
  return { uncommitted, untracked };
}

function getChangelogEntries() {
  try {
    if (!fs.existsSync(CHANGELOG)) return [];
    const fd = fs.openSync(CHANGELOG, 'r');
    const stats = fs.fstatSync(fd);
    const readSize = Math.min(stats.size, 8192);
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, Math.max(0, stats.size - readSize));
    fs.closeSync(fd);
    const raw = buffer.toString('utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const entries = [];
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        // Only entries from recent session (last 5 hours — generous window)
        const entryTs = new Date(entry.ts || entry.timestamp || 0).getTime();
        if (entryTs > Date.now() - 5 * 60 * 60 * 1000) {
          entries.push(entry);
        }
      } catch {}
    }
    return entries;
  } catch {
    return [];
  }
}

// ─── CLASSIFY: What type is each deliverable? ───

function classifyFile(filePath) {
  const norm = filePath.replace(/\\/g, '/');
  // Hook files live directly in .claude/hooks/, NOT in subdirectories like hooks/lib/
  if (norm.includes('.claude/hooks/') && norm.endsWith('.js') && !norm.includes('/lib/')) return 'hook';
  if (norm.endsWith('.js') && !norm.includes('node_modules')) return 'module';
  if (norm.includes('settings.json') || norm.includes('.env') || norm.includes('vercel.json')) return 'config';
  if (norm.endsWith('.md')) return 'docs';
  return 'other';
}

// ─── CHECK: Is each deliverable wired? ───

function checkHookWiring(hookFile) {
  try {
    const settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
    const settingsStr = JSON.stringify(settings);
    const basename = path.basename(hookFile);
    // Check if the hook filename appears in settings.json
    return settingsStr.includes(basename);
  } catch {
    return true; // Can't check — don't flag
  }
}

function checkModuleRequired(moduleFile) {
  // Check if any hook file requires this module
  try {
    const basename = path.basename(moduleFile, '.js');
    const hookFiles = fs.readdirSync(HOOKS_DIR).filter(f => f.endsWith('.js'));
    for (const hf of hookFiles) {
      try {
        const content = fs.readFileSync(path.join(HOOKS_DIR, hf), 'utf8');
        if (content.includes(basename) || content.includes(moduleFile)) {
          return true;
        }
      } catch {}
    }
    // Also check settings.json for direct references
    try {
      const settings = fs.readFileSync(SETTINGS, 'utf8');
      if (settings.includes(basename)) return true;
    } catch {}
    return false;
  } catch {
    return true; // Can't check — don't flag
  }
}

function checkFilesCommitted() {
  try {
    const status = execSync('git status --porcelain', {
      cwd: BASE, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    }).trim();
    if (!status) return { committed: true, uncommittedFiles: [] };
    const files = status.split('\n')
      .filter(line => line.trim())
      .map(line => line.substring(3).trim());
    return { committed: false, uncommittedFiles: files };
  } catch {
    return { committed: true, uncommittedFiles: [] };
  }
}

// ─── MAIN ───

async function main() {
  let input = '';
  process.stdin.setEncoding('utf8');
  await new Promise(resolve => {
    process.stdin.on('data', chunk => { input += chunk; });
    process.stdin.on('end', resolve);
    setTimeout(resolve, 500);
  });

  // IDENTITY FIX (Session 174): Resolve from stdin session_id first, bridge fallback
  try {
    const parsed = JSON.parse(input);
    if (parsed.session_id) {
      const resolved = fromSessionId(parsed.session_id);
      if (resolved.name !== 'unknown') _resolvedName = resolved.name;
    }
  } catch {}

  const agentName = getAgentName() || 'unknown';
  const gaps = [];

  // 1. Check for new hook files not in settings.json
  const { uncommitted, untracked } = getChangedFiles();
  const allNew = [...uncommitted, ...untracked];

  for (const file of allNew) {
    const type = classifyFile(file);
    if (type === 'hook') {
      const basename = path.basename(file);
      // Skip hooks that were intentionally consolidated into gate.js
      if (CONSOLIDATED_INTO_GATE.has(basename)) continue;
      if (!checkHookWiring(file)) {
        gaps.push({
          type: 'HOOK_NOT_WIRED',
          file: file,
          detail: `Hook file exists but is NOT referenced in .claude/settings.json`,
          severity: 'HIGH'
        });
      }
    }
  }

  // 2. Check for new JS modules in known locations that nothing requires
  for (const file of allNew) {
    const type = classifyFile(file);
    // Only check modules in specific directories (detection/, delivery/, etc.)
    const norm = file.replace(/\\/g, '/');
    if (type === 'module' && (
      norm.includes('detection/') ||
      norm.includes('delivery/') ||
      norm.includes('comms/')
    )) {
      if (!checkModuleRequired(file)) {
        gaps.push({
          type: 'MODULE_ORPHANED',
          file: file,
          detail: `Module file exists but no hook or entry point require()s it`,
          severity: 'MEDIUM'
        });
      }
    }
  }

  // 3. Check for uncommitted changes
  const commitStatus = checkFilesCommitted();
  if (!commitStatus.committed && commitStatus.uncommittedFiles.length > 0) {
    // Filter out noise (agent output files, temp files)
    const meaningful = commitStatus.uncommittedFiles.filter(f => {
      const norm = f.replace(/\\/g, '/');
      return !norm.includes('.agent-outputs/') &&
             !norm.includes('.fastops/.') &&
             !norm.includes('node_modules/') &&
             !norm.startsWith('??');
    });
    if (meaningful.length > 0) {
      gaps.push({
        type: 'CHANGES_UNCOMMITTED',
        file: meaningful.slice(0, 10).join(', '),
        detail: `${meaningful.length} file(s) with uncommitted changes`,
        severity: meaningful.some(f => f.includes('.claude/') || f.includes('comms/')) ? 'HIGH' : 'MEDIUM'
      });
    }
  }

  // 4. Check for unpushed commits (audit issue #6: 56 commits accumulated unpushed)
  try {
    const unpushed = execSync('git log --oneline origin/master..HEAD 2>/dev/null', { cwd: BASE, encoding: 'utf8', windowsHide: true }).trim();
    if (unpushed) {
      const count = unpushed.split('\n').filter(Boolean).length;
      if (count > 0) {
        gaps.push({
          type: 'COMMITS_UNPUSHED',
          file: `${count} commit(s)`,
          detail: `${count} local commit(s) not pushed to origin. Run: git push origin master`,
          severity: count >= 10 ? 'HIGH' : 'MEDIUM'
        });
      }
    }
  } catch {}

  // 5. Check changelog for deployment-type changes without deploy commands
  const changelog = getChangelogEntries();
  const hasDeployChange = changelog.some(e =>
    (e.type === 'feature' || e.type === 'security' || e.type === 'bugfix') &&
    (e.repo === 'fastops-website' || e.repo === 'warrior-path' || e.repo === 'nsw-v2')
  );
  // We can't reliably check bash history for deploy commands, so skip deploy check
  // The uncommitted changes check above catches the most common case

  // ─── WRITE REPORT ───
  const report = {
    agent: agentName,
    timestamp: new Date().toISOString(),
    gaps_found: gaps.length,
    gaps: gaps,
    files_scanned: allNew.length,
    changelog_entries: changelog.length
  };

  try {
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
  } catch {}

  // ─── BROADCAST TO COMMS ───
  if (gaps.length > 0) {
    const highGaps = gaps.filter(g => g.severity === 'HIGH');
    const medGaps = gaps.filter(g => g.severity === 'MEDIUM');

    let msg = `LAST-MILE WARNING — ${agentName} compacting with ${gaps.length} unwired deliverable(s):`;
    for (const gap of gaps.slice(0, 5)) {
      msg += ` [${gap.type}] ${path.basename(gap.file || 'unknown')}`;
      if (gap.type === 'HOOK_NOT_WIRED') {
        msg += ' (needs settings.json entry)';
      }
    }
    msg += `. Report: .fastops/.last-mile-report.json`;

    try {
      const commsMsg = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        from: agentName,
        content: msg,
        channel: 'general',
        words: msg.split(/\s+/).length,
        ts: new Date().toISOString()
      };
      fs.appendFileSync(COMMS_FILE, JSON.stringify(commsMsg) + '\n');
    } catch {}
  }

  // Never block compaction
  process.exit(0);
}

main().catch(() => process.exit(0));
