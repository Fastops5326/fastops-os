#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const RECEIPTS_PATH = path.join(ROOT, '.fastops', '.claim-receipts.jsonl');
const BLOCKS_LOG_PATH = path.join(ROOT, '.fastops', '.claim-gate-blocks.jsonl');
const ERROR_LOG_PATH = path.join(ROOT, '.fastops', '.claim-gate-errors.log');
const BASELINE_DIR = path.join(ROOT, '.fastops', '.session-baselines');

function logError(msg, err) {
  const logEntry = `${new Date().toISOString()} ${msg} ${err ? (err.message || err) : ''}\n`;
  try {
    fs.appendFileSync(ERROR_LOG_PATH, logEntry);
  } catch {}
}

function normalizePath(p) {
  if (!p) return '';
  let norm = p.replace(/\\/g, '/');
  if (norm.startsWith(ROOT)) {
    norm = norm.slice(ROOT.length);
  }
  const driveMatch = norm.match(/^([A-Z]):/i);
  if (driveMatch) {
    norm = driveMatch[1].toLowerCase() + ':' + norm.slice(driveMatch[0].length);
  }
  return norm.toLowerCase();
}

function sha256File(absPath) {
  try {
    const buf = fs.readFileSync(absPath);
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch (e) {
    return null;
  }
}

function getCurrentHead() {
  try {
    const out = execSync('git rev-parse HEAD', { cwd: ROOT, timeout: 3000, encoding: 'utf8' });
    return out.trim();
  } catch (e) {
    return null;
  }
}

function getGitPorcelain() {
  try {
    // -z null-delimited parsing preserves the 2-char status field (including leading space for unstaged).
    const buf = execSync('git status --porcelain -z', { cwd: ROOT, timeout: 5000 });
    const raw = buf.toString('utf8').replace(/\r/g, '');
    const paths = new Set();
    let i = 0;
    while (i < raw.length) {
      const nul = raw.indexOf('\0', i);
      if (nul === -1) break;
      const line = raw.slice(i, nul);
      i = nul + 1;
      if (line.length < 4) continue;
      const st = line.slice(0, 2);
      const rest = line.slice(3);
      if (st[0] === 'R' || st[0] === 'C') {
        // -z rename format: new-path then \0 then old-path
        paths.add(normalizePath(rest));
        const nul2 = raw.indexOf('\0', i);
        if (nul2 !== -1) {
          paths.add(normalizePath(raw.slice(i, nul2)));
          i = nul2 + 1;
        }
      } else {
        paths.add(normalizePath(rest));
      }
    }
    return paths;
  } catch (err) {
    logError('getGitPorcelain failed', err);
    return null;
  }
}

function getCommitsBetween(baseSha, headSha) {
  try {
    const cmd = `git log ${baseSha}..${headSha} --name-only --format= -z`;
    const out = execSync(cmd, { cwd: ROOT, timeout: 5000, encoding: 'utf8' });
    const paths = out.split('\0').filter(p => p && p.trim());
    const set = new Set();
    for (const p of paths) {
      set.add(normalizePath(p));
    }
    return set;
  } catch (e) {
    return new Set();
  }
}

function loadBaseline(sessionId) {
  try {
    const filePath = path.join(BASELINE_DIR, `${sessionId}.json`);
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

function loadReceipts() {
  try {
    if (!fs.existsSync(RECEIPTS_PATH)) return [];
    const data = fs.readFileSync(RECEIPTS_PATH, 'utf8');
    const lines = data.trim().split('\n').filter(l => l.trim());
    const receipts = [];
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const line of lines) {
      try {
        const r = JSON.parse(line);
        if (r.verdict === 'PASS' && new Date(r.timestamp).getTime() >= cutoff) {
          receipts.push(r);
        }
      } catch {}
    }
    return receipts;
  } catch (e) {
    logError('Failed to load receipts', e);
    return [];
  }
}

function targetsMatch(receiptTarget, filePath) {
  if (!receiptTarget || !filePath) return false;
  const t = normalizePath(receiptTarget);
  const f = normalizePath(filePath);
  if (t.length < 2 || t === '.' || t === '..') return false;
  return t === f;
}

// v7: detect self-modification of the gate hooks.
// Computes sha256 of the on-disk file and compares to the committed (HEAD) version.
// An agent that mutates claim-gate.js or session-start-brief.js mid-session (to disable checks
// or falsify output) will fail this integrity check and BLOCK.
function verifyHookIntegrity() {
  const hooks = [
    '.claude/hooks/claim-gate.js',
    '.claude/hooks/session-start-brief.js'
  ];
  const tampered = [];
  for (const rel of hooks) {
    const abs = path.join(ROOT, rel);
    try {
      const diskHash = sha256File(abs);
      if (!diskHash) { tampered.push({ file: rel, reason: "unreadable" }); continue; }
      const committed = execSync(`git show HEAD:${rel}`, { cwd: ROOT, timeout: 3000 });
      const committedHash = crypto.createHash('sha256').update(committed).digest('hex');
      if (diskHash !== committedHash) {
        tampered.push({ file: rel, diskHash: diskHash.slice(0,12), committedHash: committedHash.slice(0,12) });
      }
    } catch (e) {
      // v8 FIX A: first-install fail-closed. Previously v7 silently skipped if the hook
      // wasn't in HEAD — an agent could plant a malicious hook before first commit. Now
      // we REQUIRE the hook to be in HEAD. Any git-show failure → tampered.
      const msg = (e && e.message) || String(e);
      tampered.push({ file: rel, reason: "git-show failed (hook must be committed to HEAD): " + msg.slice(0,120) });
    }
  }
  return tampered;
}

// v8: load foreign receipt pools from the BASELINE commit snapshot, not HEAD.
// In-session commits to foreign pools are ignored — forgery requires pre-baseline commits.
// Legitimate verification must happen in a PRIOR session; the claim session reads its
// baseline-time snapshot. This structurally closes the "commit a forged receipt in-session"
// hole from the v7 6-model review (5/6 convergent).
function loadBaselineForeignReceiptIds(baselineHead) {
  const pools = [
    '.fastops/.verification-receipts.jsonl',
    '.fastops/.exec-verify-receipts.jsonl'
  ];
  const passIds = new Set();
  // If no baselineHead (pre-initial-commit edge case), fall back to HEAD. Risk is minimal
  // because without baseline lineage anchoring, no claim can be trustfully gated anyway.
  const gitRef = baselineHead && typeof baselineHead === 'string' && baselineHead.length >= 7
    ? baselineHead
    : 'HEAD';
  for (const rel of pools) {
    try {
      const buf = execSync(`git show ${gitRef}:${rel}`, { cwd: ROOT, timeout: 5000 });
      const text = buf.toString('utf8');
      const lines = text.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const r = JSON.parse(line);
          if (!r.receiptId) continue;
          const isExec = typeof r.schema === 'string' && r.schema.startsWith('exec-verify/');
          const pass = isExec
            ? (r.verified === true)
            : (r.tally && (r.tally.status === 'PASS' || (typeof r.tally.pass === 'number' && typeof r.tally.threshold === 'number' && r.tally.pass >= r.tally.threshold)));
          if (pass) passIds.add(r.receiptId);
        } catch {}
      }
    } catch (e) {
      logError(`loadBaselineForeignReceiptIds pool read failed (ref=${gitRef}, pool=${rel})`, e);
    }
  }
  return passIds;
}

// v9: stricter baseline corruption detection.
// Closes v8 convergent hole (6/6) where ≤10 file threshold allowed targeted tamper evasion
// and where dirtyHashes could be partially populated to bypass the emptiness check.
// New rules:
//   1. If baseline porcelain is empty but the current tree has ANY dirty files → corrupt.
//   2. If baseline dirtyHashes keys are not a subset of baseline.porcelain → corrupt
//      (invariant: every hashed file must have been in the porcelain snapshot).
//   3. If baseline.headCommit is set but not resolvable via git rev-parse → corrupt.
function isBaselineCorrupted(baseline, currentPorcelain) {
  if (!baseline) return { corrupt: false };
  const porcelain = Array.isArray(baseline.porcelain) ? baseline.porcelain : [];
  const dirtyHashes = (baseline.dirtyHashes && typeof baseline.dirtyHashes === 'object') ? baseline.dirtyHashes : {};
  const bpEmpty = porcelain.length === 0;
  const dhEmpty = Object.keys(dirtyHashes).length === 0;
  // Rule 1: empty baseline but dirty tree → corrupt (no threshold).
  if (bpEmpty && dhEmpty && currentPorcelain && currentPorcelain.size > 0) {
    return { corrupt: true, reason: 'empty baseline with dirty current tree' };
  }
  // Rule 2: dirtyHashes keys must be subset of porcelain.
  const porcSet = new Set(porcelain.map(normalizePath));
  for (const key of Object.keys(dirtyHashes)) {
    if (!porcSet.has(normalizePath(key))) {
      return { corrupt: true, reason: `dirtyHashes contains ${key} which is not in porcelain` };
    }
  }
  // Rule 3: if headCommit is set, it must be resolvable in git.
  if (typeof baseline.headCommit === 'string' && baseline.headCommit.length >= 7) {
    try {
      execSync(`git rev-parse --verify ${baseline.headCommit}`, { cwd: ROOT, timeout: 3000, stdio: 'ignore' });
    } catch (e) {
      return { corrupt: true, reason: `baseline.headCommit ${baseline.headCommit.slice(0,12)} does not resolve in git` };
    }
  }
  return { corrupt: false };
}

// v9: compute baseline integrity signature. Tied to claim-gate.js own HEAD hash (via
// HOOK_SHA_SALT) which the agent cannot mutate without triggering the hook integrity BLOCK.
// This prevents post-capture baseline mutation (e.g., forging headCommit to point at a
// commit that contains fake receipts).
function computeBaselineSignature(baseline, hookSalt) {
  if (!baseline) return null;
  const canonical = JSON.stringify({
    sessionId: baseline.sessionId,
    headCommit: baseline.headCommit,
    porcelain: baseline.porcelain,
    dirtyHashes: baseline.dirtyHashes
  });
  return crypto.createHash('sha256').update(hookSalt + '|' + canonical).digest('hex');
}

// v9: get HOOK_SHA_SALT from the committed claim-gate.js — tied to gate integrity.
function getHookSalt() {
  try {
    const buf = execSync(`git show HEAD:.claude/hooks/claim-gate.js`, { cwd: ROOT, timeout: 3000 });
    return crypto.createHash('sha256').update(buf).digest('hex');
  } catch (e) {
    return null;
  }
}

// v6: detect history-rewrite (amend / reset --hard baselineHead).
// Returns true if baselineHead is still reachable from HEAD (lineage intact).
function isLineageIntact(baselineHead, currentHead) {
  if (!baselineHead || !currentHead) return true; // nothing to verify
  if (baselineHead === currentHead) return true;
  try {
    execSync(`git merge-base --is-ancestor ${baselineHead} ${currentHead}`, { cwd: ROOT, timeout: 3000, stdio: 'ignore' });
    return true;
  } catch (e) {
    return false; // non-zero exit → not an ancestor → history rewritten
  }
}

// v6: load foreign receipt pools that claim-check.js references.
// Returns a Set of receiptIds that are PASS in either pool.
function loadForeignReceiptIds() {
  const pools = [
    path.join(ROOT, '.fastops', '.verification-receipts.jsonl'),
    path.join(ROOT, '.fastops', '.exec-verify-receipts.jsonl')
  ];
  const passIds = new Set();
  for (const p of pools) {
    try {
      if (!fs.existsSync(p)) continue;
      const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const r = JSON.parse(line);
          if (!r.receiptId) continue;
          // exec-verify schema: verified=true; verification-receipts: tally.status=PASS
          const isExec = typeof r.schema === 'string' && r.schema.startsWith('exec-verify/');
          const pass = isExec
            ? (r.verified === true)
            : (r.tally && (r.tally.status === 'PASS' || (typeof r.tally.pass === 'number' && typeof r.tally.threshold === 'number' && r.tally.pass >= r.tally.threshold)));
          if (pass) passIds.add(r.receiptId);
        } catch {}
      }
    } catch (e) {
      logError('loadForeignReceiptIds pool read failed', e);
    }
  }
  return passIds;
}

// v6: a claim-receipt is only honored if its receiptId points to a PASS foreign receipt.
// This forces claim-receipt forgery to also forge a matching foreign receipt.
function receiptIsAttested(claimReceipt, foreignPassIds) {
  if (!claimReceipt || !claimReceipt.receiptId) return false;
  return foreignPassIds.has(claimReceipt.receiptId);
}

function isExempt(relPath) {
  const p = relPath.toLowerCase();
  if (p.startsWith('/dev/') || p.startsWith('dev/')) return true;
  if (p.startsWith('.fastops/.')) return true;
  if (p.startsWith('.claude/.smoke-')) return true;
  if (p.startsWith('.claude/rules/active-brief')) return true;
  if (p.endsWith('.md') && (p.startsWith('.agent-outputs/') || p.startsWith('comms/') || p.startsWith('memory/'))) return true;
  if (p.startsWith('.claude/projects/')) return true;
  if (p.endsWith('.spec.json')) return true;
  // v7: removed blanket .claude/hooks/ exempt; specific hook files stay non-exempt
  //     so that self-modification of claim-gate.js / session-start-brief.js is detected.
  //     Other hook infrastructure can still be edited without receipts via claim-check flow.
  if (p.startsWith('.git/')) return true;
  return false;
}

process.stdin.setEncoding('utf8');
let input = '';
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const { session_id: sessionId } = JSON.parse(input);

    // v7 FIX A: hook integrity check — self-modification BLOCK.
    const tampered = verifyHookIntegrity();
    if (tampered.length > 0) {
      const desc = tampered.map(t => `${t.file} (${t.reason || "hash mismatch " + t.diskHash + " vs HEAD " + t.committedHash})`).join(", ");
      const output = {
        decision: "block",
        reason: `CLAUDE.md Problem 1: gate hook integrity violated. Modified file(s): ${desc}. An agent or process mutated the gate source during the session. Restore from git (git checkout HEAD -- .claude/hooks/claim-gate.js .claude/hooks/session-start-brief.js) and restart.`,
        systemMessage: `claim-gate v9 BLOCK: hook integrity failure`
      };
      try { fs.appendFileSync(BLOCKS_LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), sessionId, reason: "hook-tamper", tampered }) + "\n"); } catch {}
      process.stdout.write(JSON.stringify(output));
      process.exit(0);
    }

    const currentPorcelain = getGitPorcelain();
    if (currentPorcelain === null) process.exit(0);
    const baseline = sessionId ? loadBaseline(sessionId) : null;

    // v6 FIX 2: baseline-missing is a BLOCK (was: silently downgrade to v4-equivalent)
    if (sessionId && !baseline) {
      const output = {
        decision: "block",
        reason: `CLAUDE.md Problem 1: session baseline for ${sessionId} is missing. The baseline is the integrity anchor for change detection — refusing to run without it. Either restart the session (to re-capture baseline) or restore the baseline file at .fastops/.session-baselines/${sessionId}.json.`,
        systemMessage: `claim-gate v7 BLOCK: baseline missing for session ${sessionId}`
      };
      try { fs.appendFileSync(BLOCKS_LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), sessionId, reason: 'baseline-missing' }) + '\n'); } catch {}
      process.stdout.write(JSON.stringify(output));
      process.exit(0);
    }

    // v9 FIX A: stricter baseline corruption detection (no threshold evasion + subset invariant + headCommit verify)
    if (baseline) {
      const corrResult = isBaselineCorrupted(baseline, currentPorcelain);
      if (corrResult.corrupt) {
        const output = {
          decision: "block",
          reason: `CLAUDE.md Problem 1: session baseline integrity failure — ${corrResult.reason}. Baseline was either tampered post-capture or session-start-brief.js is broken. Restart the session to recapture an honest baseline.`,
          systemMessage: `claim-gate v9 BLOCK: baseline corrupted (${corrResult.reason})`
        };
        try { fs.appendFileSync(BLOCKS_LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), sessionId, reason: "baseline-corrupted", detail: corrResult.reason }) + "\n"); } catch {}
        process.stdout.write(JSON.stringify(output));
        process.exit(0);
      }
      // v9 FIX B: baseline signature check (tied to hook SHA salt — agent can't forge without mutating claim-gate.js, which hook-integrity catches)
      if (typeof baseline.integritySig === 'string') {
        const hookSalt = getHookSalt();
        if (hookSalt) {
          const expectedSig = computeBaselineSignature(baseline, hookSalt);
          if (expectedSig !== baseline.integritySig) {
            const output = {
              decision: "block",
              reason: `CLAUDE.md Problem 1: baseline integrity signature mismatch. Baseline file was mutated after session-start-brief.js wrote it. Restart the session.`,
              systemMessage: `claim-gate v9 BLOCK: baseline signature mismatch`
            };
            try { fs.appendFileSync(BLOCKS_LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), sessionId, reason: "baseline-sig-mismatch" }) + "\n"); } catch {}
            process.stdout.write(JSON.stringify(output));
            process.exit(0);
          }
        }
      }
      // Note: baselines without integritySig are LEGACY and tolerated (no hard block) so existing
      // pre-v9 sessions don't brick. New session-start-brief.js v3 always writes a signature.
    }

    const baselinePorcelain = baseline && Array.isArray(baseline.porcelain)
      ? new Set(baseline.porcelain.map(normalizePath))
      : new Set();
    const baselineDirtyHashes = (baseline && baseline.dirtyHashes && typeof baseline.dirtyHashes === 'object')
      ? baseline.dirtyHashes
      : {};
    const baselineHead = baseline && typeof baseline.headCommit === 'string' ? baseline.headCommit : null;

    const changedFiles = new Set();
    for (const f of currentPorcelain) if (!baselinePorcelain.has(f)) changedFiles.add(f);

    const currentHead = getCurrentHead();
    if (baselineHead && currentHead && baselineHead !== currentHead) {
      const committed = getCommitsBetween(baselineHead, currentHead);
      for (const f of committed) changedFiles.add(normalizePath(f));
    }

    // v6 FIX 1: history-rewrite detection (amend / reset --hard baselineHead)
    if (baselineHead && currentHead && !isLineageIntact(baselineHead, currentHead)) {
      const output = {
        decision: "block",
        reason: `CLAUDE.md Problem 1: baseline commit ${baselineHead.slice(0,12)} is no longer an ancestor of HEAD ${currentHead.slice(0,12)}. History was rewritten (git commit --amend, git reset --hard, or rebase) — this invalidates all change detection. Restart the session or restore HEAD to include the baseline commit.`,
        systemMessage: `claim-gate v8 BLOCK: history rewritten, baseline lineage broken`
      };
      try { fs.appendFileSync(BLOCKS_LOG_PATH, JSON.stringify({ ts: new Date().toISOString(), sessionId, reason: 'lineage-broken', baselineHead, currentHead }) + '\n'); } catch {}
      process.stdout.write(JSON.stringify(output));
      process.exit(0);
    }

    for (const [relPath, baseHash] of Object.entries(baselineDirtyHashes)) {
      const absPath = path.join(ROOT, relPath);
      const currentHash = sha256File(absPath);
      if (currentHash !== baseHash) changedFiles.add(normalizePath(relPath));
    }

    if (changedFiles.size === 0) process.exit(0);
    const filtered = [...changedFiles].filter(f => !isExempt(f));
    if (filtered.length === 0) process.exit(0);
    const freshPass = loadReceipts();
    // v6 FIX 3: require transitive attestation — receipt must point to a PASS foreign receipt.
    const foreignPassIds = loadBaselineForeignReceiptIds(baselineHead);
    const attestedFreshPass = freshPass.filter(r => receiptIsAttested(r, foreignPassIds));
    const covered = filtered.filter(f => attestedFreshPass.some(r => targetsMatch(r.target, f)));
    const uncovered = filtered.filter(f => !covered.includes(f));
    if (uncovered.length === 0) process.exit(0);
    const violationData = { ts: new Date().toISOString(), sessionId, uncoveredFiles: uncovered, modifiedCount: filtered.length, coveredCount: covered.length, source: 'git-porcelain+commits+content-hash' };
    try { fs.appendFileSync(BLOCKS_LOG_PATH, JSON.stringify(violationData) + '\n'); } catch (e) { logError('Failed to write block log', e); }
    const displayUncovered = uncovered.length <= 20 ? uncovered : [...uncovered.slice(0, 20), `...and ${uncovered.length - 20} more`];
    const fileList = displayUncovered.map(f => `- ${f}`).join('\n');
    const output = {
      decision: "block",
      reason: `CLAUDE.md Problem 1: your session modified files (observed via git working tree state + commits + content-hash diff) not covered by a fresh PASS claim-receipt. Uncovered:\n${fileList}\n\nRun: node environment/verification/claim-check.js --claim "<what>" --receipt <id> --target <exact/file/path> --max-age-min 60.`,
      systemMessage: `claim-gate v6 BLOCK: ${filtered.length} changed, ${uncovered.length} uncovered`
    };
    process.stdout.write(JSON.stringify(output));
    process.exit(0);
  } catch (err) { logError('Exception in claim-gate', err); process.exit(0); }
});
