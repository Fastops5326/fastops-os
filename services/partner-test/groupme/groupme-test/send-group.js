// Send a test message to a GroupMe group.
// Usage:
//   node send-group.js "Hello group"
//   node send-group.js "Hello group" <group_id>
// If no group_id passed, falls back to GROUPME_GROUP_ID in .env.
const { loadEnv, api, newGuid, logJson } = require('./lib');

(async () => {
  loadEnv();

  const text = process.argv[2];
  const groupId = process.argv[3] || process.env.GROUPME_GROUP_ID;

  if (!text) {
    console.error('Usage: node send-group.js "your message" [group_id]');
    process.exit(2);
  }
  if (!groupId) {
    console.error('No group_id passed and GROUPME_GROUP_ID not set in .env. Run `node list.js` to find one.');
    process.exit(2);
  }

  const payload = {
    message: {
      source_guid: newGuid(),
      text,
    },
  };

  console.log(`Sending to group ${groupId}: "${text}"`);
  const result = await api('POST', `/groups/${groupId}/messages`, payload);
  logJson('GROUP MESSAGE SENT', result);
  console.log('\nCheck the GroupMe app to confirm it arrived.');
})().catch((e) => {
  console.error('\nERROR:', e.message);
  if (e.body) console.error('Response body:', JSON.stringify(e.body, null, 2));
  process.exit(1);
});
