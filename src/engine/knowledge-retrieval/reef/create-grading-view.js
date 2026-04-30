#!/usr/bin/env node
/**
 * Create Monday.com "Joel Grading Queue" view
 *
 * 1. Creates a "Grading Queue" text column
 * 2. Tags the top 50 KB items with "grade-me"
 * 3. Creates a filtered table view showing only those items
 *
 * Usage: node reef/create-grading-view.js
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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

async function main() {
  // Step 1: Create the Grading Queue column
  console.log('Step 1: Creating "Grading Queue" column...');
  let gradingColId;
  try {
    const colData = await mondayAPI(
      'mutation { create_column(board_id: ' + BOARD_ID +
      ', title: "Grading Queue", column_type: text) { id title } }'
    );
    gradingColId = colData.create_column.id;
    console.log('  Created column: ' + gradingColId);
  } catch (e) {
    // Column might already exist
    if (e.message.includes('already exists') || e.message.includes('duplicate')) {
      console.log('  Column already exists, finding it...');
      const boardData = await mondayAPI(
        '{ boards(ids: [' + BOARD_ID + ']) { columns { id title } } }'
      );
      const col = boardData.boards[0].columns.find(c => c.title === 'Grading Queue');
      if (col) {
        gradingColId = col.id;
        console.log('  Found existing column: ' + gradingColId);
      } else {
        throw new Error('Could not find or create Grading Queue column');
      }
    } else {
      throw e;
    }
  }

  // Step 2: Load the 50 item IDs
  const top50File = path.join(ROOT, '.agent-outputs', 'kb-top50-scored.json');
  if (!fs.existsSync(top50File)) {
    console.error('Top 50 file not found. Run: node reef/rewrite-kb-briefs.js --fetch-only');
    process.exit(1);
  }
  const top50 = JSON.parse(fs.readFileSync(top50File, 'utf8'));
  console.log('\nStep 2: Tagging ' + top50.length + ' items with "grade-me"...');

  // Step 3: Tag each item
  let tagged = 0;
  let errors = 0;
  for (const item of top50) {
    try {
      const colValues = {};
      colValues[gradingColId] = item.outcomeType + ' | Score: ' + item.score;
      const colValuesStr = JSON.stringify(JSON.stringify(colValues));

      await mondayAPI(
        'mutation { change_multiple_column_values(' +
        'item_id: ' + item.id + ', ' +
        'board_id: ' + BOARD_ID + ', ' +
        'column_values: ' + colValuesStr +
        ') { id } }'
      );
      tagged++;
      if (tagged % 10 === 0) console.log('  Tagged: ' + tagged + '/' + top50.length);
      await sleep(100);
    } catch (e) {
      console.error('  ERROR tagging ' + item.id + ': ' + e.message);
      errors++;
      await sleep(500);
    }
  }
  console.log('  Done: ' + tagged + ' tagged, ' + errors + ' errors');

  // Step 4: Create the filtered table view
  console.log('\nStep 3: Creating "Joel Grading Queue" view...');
  try {
    // Build the view query — filter on grading column being non-empty
    const viewQuery =
      'mutation { create_view_table(' +
      'board_id: ' + BOARD_ID + ', ' +
      'name: "Joel Grading Queue", ' +
      'filter: { operator: and, rules: [{ column_id: "' + gradingColId + '", compare_value: ["is_not_empty"] }] }' +
      ') { id name } }';

    const viewData = await mondayAPI(viewQuery);
    console.log('  Created view: ' + JSON.stringify(viewData));
  } catch (e) {
    console.log('  View creation note: ' + e.message);
    console.log('  Fallback: In Monday.com, click the view dropdown and create a new table view.');
    console.log('  Filter by: "Grading Queue" is not empty.');
  }

  console.log('\n=== DONE ===');
  console.log('Column: ' + gradingColId);
  console.log('Items tagged: ' + tagged);
  console.log('\nIn Monday.com:');
  console.log('  1. Look for the "Joel Grading Queue" view tab at the top of the board');
  console.log('  2. If the view didnt auto-create, add a filter: "Grading Queue" is not empty');
  console.log('  3. Columns to focus on: Name, TLDR, Outcome Type, Joel Score, Joel Feedback');
  console.log('  4. Grade each item 1-5 stars in the "Joel Score" column');
}

main().catch(e => {
  console.error('Failed:', e.message);
  process.exit(1);
});
