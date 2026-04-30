// Post the daily workout check-in question to a group.
// Saves the resulting message_id to state/checkin-<group_id>-<YYYY-MM-DD>.json
// so the evening report knows which message to score.
//
// Usage:
//   node checkin-post.js                        # uses GROUPME_GROUP_ID from .env
//   node checkin-post.js <group_id>             # override target group
//
// Customize the question text via env var CHECKIN_QUESTION, or edit DEFAULT_QUESTION below.
const { loadEnv, api, newGuid, saveState, todayStamp } = require('./lib');

function buildDefaultQuestion() {
  const d = new Date();
  const mmdd = `${d.getMonth() + 1}/${d.getDate()}`;
  return (
    `Day ${mmdd} — Did you work out today? 👍 this message if YES.\n\n` +
    `(No reaction = expect a follow-up.)`
  );
}
const DEFAULT_QUESTION = buildDefaultQuestion();

(async () => {
  loadEnv();
  const groupId = process.argv[2] || process.env.GROUPME_GROUP_ID;
  if (!groupId) {
    console.error('No group_id passed and GROUPME_GROUP_ID not set in .env.');
    process.exit(2);
  }

  const text = process.env.CHECKIN_QUESTION || DEFAULT_QUESTION;
  const payload = { message: { source_guid: newGuid(), text } };

  console.log(`Posting check-in to group ${groupId}…`);
  const result = await api('POST', `/groups/${groupId}/messages`, payload);
  const msg = result.response.message;

  const stateFile = `checkin-${groupId}-${todayStamp()}.json`;
  const saved = saveState(stateFile, {
    group_id: groupId,
    posted_at: new Date().toISOString(),
    message_id: msg.id,
    source_guid: msg.source_guid,
    text: msg.text,
    posted_by_user_id: msg.user_id,
  });

  console.log(`\n✓ Posted. message_id: ${msg.id}`);
  console.log(`✓ State saved: ${saved}`);
  console.log(`\nNext: run \`node checkin-report.js\` later today to see who reacted.`);
})().catch((e) => {
  console.error('\nERROR:', e.message);
  if (e.body) console.error('Response body:', JSON.stringify(e.body, null, 2));
  process.exit(1);
});
