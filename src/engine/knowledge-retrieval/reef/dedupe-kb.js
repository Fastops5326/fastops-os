#!/usr/bin/env node
/**
 * KB Deduplication: Delete duplicate entries, keeping domain-specific versions
 *
 * Reads the delete list from .agent-outputs/kb-duplicate-delete-list.json
 * and archives (deletes) the duplicate items from Monday.com.
 *
 * Usage:
 *   node reef/dedupe-kb.js --preview    # Show what will be deleted
 *   node reef/dedupe-kb.js --execute    # Actually delete duplicates
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  const vars = {};
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const match = line.match(/^([^#=]+)=\s*(.*)$/);
      if (match) vars[match[1].trim()] = match[2].trim();
    });
  }
  return vars;
}

const env = loadEnv();
const API_KEY = env.MONDAY_API_KEY;
const BOARD_ID = env.MONDAY_BOARD_ID;

if (!API_KEY || !BOARD_ID) {
  console.error('Missing MONDAY_API_KEY or MONDAY_BOARD_ID in .env');
  process.exit(1);
}

function mondayAPI(query, retries = 3) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query });
    const options = {
      hostname: 'api.monday.com',
      path: '/v2',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': API_KEY,
        'API-Version': '2024-10'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', async () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.errors) {
            const msg = parsed.errors.map(e => e.message).join('; ');
            if (retries > 0 && (msg.includes('rate') || msg.includes('limit') || res.statusCode === 429)) {
              await sleep(2000);
              resolve(mondayAPI(query, retries - 1));
            } else {
              reject(new Error(msg));
            }
          } else {
            resolve(parsed.data);
          }
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const mode = process.argv[2] || '--preview';
  const deleteFile = path.join(ROOT, '.agent-outputs', 'kb-duplicate-delete-list.json');

  if (!fs.existsSync(deleteFile)) {
    console.error('Delete list not found. Run the duplicate analysis first.');
    process.exit(1);
  }

  const deleteData = JSON.parse(fs.readFileSync(deleteFile, 'utf8'));
  const deleteIds = deleteData.deleteIds;

  console.log(`=== KB Deduplication: ${deleteIds.length} duplicates to remove ===\n`);

  if (mode === '--preview') {
    console.log('Items to delete:');
    for (const detail of deleteData.details) {
      console.log(`  "${detail.name.slice(0, 70)}" — keep ${detail.keep}, delete ${detail.delete.join(', ')}`);
    }
    console.log(`\nTotal: ${deleteIds.length} items will be deleted (archived).`);
    console.log('Use --execute to proceed.');
    return;
  }

  if (mode === '--execute') {
    console.log(`Archiving ${deleteIds.length} duplicate items...\n`);
    let deleted = 0;
    let errors = 0;

    for (const id of deleteIds) {
      try {
        await mondayAPI(`mutation { archive_item(item_id: ${id}) { id } }`);
        deleted++;
        if (deleted % 10 === 0) console.log(`  Progress: ${deleted}/${deleteIds.length}`);
        await sleep(100);
      } catch (e) {
        console.error(`  ERROR archiving ${id}: ${e.message}`);
        errors++;
        await sleep(500);
      }
    }

    console.log(`\nDone: ${deleted} archived, ${errors} errors`);
    console.log(`Board now has ~${358 - deleted} KB items (was 358).`);
  }
}

main().catch(e => {
  console.error('Failed:', e.message);
  process.exit(1);
});
