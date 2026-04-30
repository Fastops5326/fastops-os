// Send a test direct message to a GroupMe user.
// Usage:
//   node send-dm.js "Hello"
//   node send-dm.js "Hello" <recipient_user_id>
// If no recipient_id passed, falls back to GROUPME_RECIPIENT_ID in .env.
const { loadEnv, api, newGuid, logJson } = require('./lib');

(async () => {
  loadEnv();

  const text = process.argv[2];
  const recipientId = process.argv[3] || process.env.GROUPME_RECIPIENT_ID;

  if (!text) {
    console.error('Usage: node send-dm.js "your message" [recipient_user_id]');
    process.exit(2);
  }
  if (!recipientId) {
    console.error('No recipient_id passed and GROUPME_RECIPIENT_ID not set in .env. Run `node list.js` to find one.');
    process.exit(2);
  }

  const payload = {
    direct_message: {
      source_guid: newGuid(),
      recipient_id: String(recipientId),
      text,
    },
  };

  console.log(`Sending DM to user ${recipientId}: "${text}"`);
  const result = await api('POST', '/direct_messages', payload);
  logJson('DIRECT MESSAGE SENT', result);
  console.log('\nCheck the GroupMe app to confirm it arrived.');
})().catch((e) => {
  console.error('\nERROR:', e.message);
  if (e.body) console.error('Response body:', JSON.stringify(e.body, null, 2));
  process.exit(1);
});
