// Discovery: who am I, what groups am I in, what DM threads exist?
// Usage: node list.js
const { loadEnv, api } = require('./lib');

(async () => {
  loadEnv();

  const me = await api('GET', '/users/me');
  console.log('\n=== YOU ===');
  console.log(`name:    ${me.response.name}`);
  console.log(`user_id: ${me.response.user_id}`);
  console.log(`email:   ${me.response.email || '(none)'}`);

  const groups = await api('GET', '/groups?per_page=100');
  console.log('\n=== GROUPS ===');
  if (!groups.response.length) {
    console.log('(no groups)');
  } else {
    for (const g of groups.response) {
      console.log(`- ${g.name}`);
      console.log(`    group_id: ${g.id}`);
      console.log(`    members:  ${g.members.length}`);
    }
  }

  const chats = await api('GET', '/chats?per_page=100');
  console.log('\n=== DIRECT MESSAGE THREADS ===');
  if (!chats.response.length) {
    console.log('(no existing DM threads — you can only DM people you share a group with or who have messaged you)');
  } else {
    for (const c of chats.response) {
      const o = c.other_user || {};
      console.log(`- ${o.name || '(unknown)'}`);
      console.log(`    recipient_id (user_id): ${o.id}`);
      console.log(`    last_message: ${(c.last_message && c.last_message.text) || '(none)'}`);
    }
  }

  console.log('\nDone. Copy the group_id and recipient_id you want into your .env, then run:');
  console.log('  node send-group.js "Hello group"');
  console.log('  node send-dm.js    "Hello DM"');
})().catch((e) => {
  console.error('\nERROR:', e.message);
  if (e.body) console.error('Response body:', JSON.stringify(e.body, null, 2));
  process.exit(1);
});
