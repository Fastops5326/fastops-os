#!/usr/bin/env node
/**
 * comms-rotate.js — Comms Corpus Rotation
 *
 * Problem: general.jsonl grows unbounded (3876 lines, 5.8MB). Every fleet model
 * reads from it. domain-discover.js uses last 1000 for TF-IDF clustering.
 * Historical data drowns new signals — the echo chamber's data flywheel.
 *
 * Solution: Keep last RETENTION_COUNT messages in active file, archive the rest.
 * Archives go to comms/data/.archive/<channel>-<date>.jsonl
 *
 * Usage:
 *   node comms/comms-rotate.js                    # rotate all channels over threshold
 *   node comms/comms-rotate.js --channel general   # rotate specific channel
 *   node comms/comms-rotate.js --dry-run           # show what would happen
 *   node comms/comms-rotate.js --retention 500     # custom retention count
 *
 * Wired into: cadence-pulse.js (every 24 ticks)
 *
 * Built by RIPTIDE (Session 334) — the fleet asked for this.
 * Fleet challenges from HUNYUAN, RNJ, LONGCAT all identified comms volume as
 * a scaling bottleneck. This is the infrastructure fix.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const ARCHIVE_DIR = path.join(DATA_DIR, '.archive');

// Default: keep 1000 messages (covers domain-discover's .slice(-1000))
const DEFAULT_RETENTION = 1000;

// Channels below this line count don't need rotation
const MIN_ROTATE_THRESHOLD = 1200;

// Parse args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const channelFlag = args.indexOf('--channel');
const CHANNEL_FILTER = channelFlag >= 0 ? args[channelFlag + 1] : null;
const retentionFlag = args.indexOf('--retention');
const RETENTION = retentionFlag >= 0 ? parseInt(args[retentionFlag + 1], 10) : DEFAULT_RETENTION;

function getChannels() {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.jsonl') && !f.startsWith('.'));
  return files.map(f => ({
    name: f.replace('.jsonl', ''),
    file: path.join(DATA_DIR, f)
  }));
}

function rotateChannel(channel) {
  const { name, file } = channel;

  if (!fs.existsSync(file)) return null;

  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split('\n').filter(Boolean);

  if (lines.length <= MIN_ROTATE_THRESHOLD) {
    return { channel: name, lines: lines.length, action: 'skip', reason: `under ${MIN_ROTATE_THRESHOLD} threshold` };
  }

  const archiveCount = lines.length - RETENTION;
  const archiveLines = lines.slice(0, archiveCount);
  const keepLines = lines.slice(archiveCount);

  // Parse first and last archived message for date range
  let dateRange = '';
  try {
    const first = JSON.parse(archiveLines[0]);
    const last = JSON.parse(archiveLines[archiveLines.length - 1]);
    const startDate = (first.ts || '').split('T')[0] || 'unknown';
    const endDate = (last.ts || '').split('T')[0] || 'unknown';
    dateRange = `${startDate}_to_${endDate}`;
  } catch {
    dateRange = new Date().toISOString().split('T')[0];
  }

  const archiveFile = path.join(ARCHIVE_DIR, `${name}-${dateRange}.jsonl`);

  if (DRY_RUN) {
    return {
      channel: name,
      lines: lines.length,
      action: 'would_rotate',
      archive: archiveCount,
      keep: keepLines.length,
      archiveFile: path.relative(DATA_DIR, archiveFile)
    };
  }

  // Create archive dir
  if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  }

  // Append to archive (in case multiple rotations happen on same date range)
  fs.appendFileSync(archiveFile, archiveLines.join('\n') + '\n');

  // Write kept lines back to active file (atomic: write tmp then rename)
  const tmpFile = file + '.rotate-tmp';
  fs.writeFileSync(tmpFile, keepLines.join('\n') + '\n');
  fs.renameSync(tmpFile, file);

  const oldSize = Buffer.byteLength(raw, 'utf8');
  const newSize = Buffer.byteLength(keepLines.join('\n') + '\n', 'utf8');

  return {
    channel: name,
    lines: lines.length,
    action: 'rotated',
    archived: archiveCount,
    kept: keepLines.length,
    archiveFile: path.relative(DATA_DIR, archiveFile),
    sizeBefore: (oldSize / 1024).toFixed(0) + 'KB',
    sizeAfter: (newSize / 1024).toFixed(0) + 'KB',
    freed: ((oldSize - newSize) / 1024).toFixed(0) + 'KB'
  };
}

function main() {
  let channels = getChannels();

  if (CHANNEL_FILTER) {
    channels = channels.filter(c => c.name === CHANNEL_FILTER);
    if (channels.length === 0) {
      console.error(`Channel not found: ${CHANNEL_FILTER}`);
      process.exit(1);
    }
  }

  console.log(`[comms-rotate] ${DRY_RUN ? 'DRY RUN — ' : ''}Retention: ${RETENTION} messages | Threshold: ${MIN_ROTATE_THRESHOLD}`);

  const results = [];
  for (const ch of channels) {
    const result = rotateChannel(ch);
    if (result) results.push(result);
  }

  const rotated = results.filter(r => r.action === 'rotated' || r.action === 'would_rotate');
  const skipped = results.filter(r => r.action === 'skip');

  if (rotated.length > 0) {
    console.log(`\n  ROTATED (${rotated.length}):`);
    for (const r of rotated) {
      if (r.action === 'would_rotate') {
        console.log(`    ${r.channel}: ${r.lines} → keep ${r.keep}, archive ${r.archive} → ${r.archiveFile}`);
      } else {
        console.log(`    ${r.channel}: ${r.lines} → ${r.kept} (archived ${r.archived} to ${r.archiveFile}) | ${r.sizeBefore} → ${r.sizeAfter} (freed ${r.freed})`);
      }
    }
  }

  if (skipped.length > 0 && !CHANNEL_FILTER) {
    console.log(`\n  SKIPPED (${skipped.length}): under threshold`);
  }

  // Write rotation log for cadence tracking
  if (!DRY_RUN && rotated.length > 0) {
    const logEntry = {
      ts: new Date().toISOString(),
      rotated: rotated.map(r => ({ channel: r.channel, archived: r.archived, kept: r.kept })),
      retention: RETENTION
    };
    const logFile = path.join(ARCHIVE_DIR, '_rotation-log.jsonl');
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
  }

  console.log(`\n[comms-rotate] Done. ${rotated.length} channel(s) ${DRY_RUN ? 'would be ' : ''}rotated.`);

  return { rotated, skipped };
}

// Export for cadence-pulse integration
module.exports = { rotateChannel, getChannels, main };

if (require.main === module) {
  main();
}
