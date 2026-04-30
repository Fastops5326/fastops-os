// Read today's check-in message and report:
//   - Who reacted 👍 (counted as "worked out")
//   - Who did NOT react (followup list)
//
// Usage:
//   node checkin-report.js                      # uses GROUPME_GROUP_ID + today's date
//   node checkin-report.js <group_id>           # override group
//   node checkin-report.js <group_id> <YYYY-MM-DD>  # specific past day
const fs = require('fs');
const path = require('path');
const { loadEnv, api, loadState, todayStamp, STATE_DIR } = require('./lib');

async function findMessage(groupId, messageId) {
  // Walk backwards through recent messages until we find ours.
  // Default page is 20; we'll try up to ~200 (10 pages).
  let beforeId = null;
  for (let page = 0; page < 10; page++) {
    const qs = beforeId ? `?limit=100&before_id=${beforeId}` : '?limit=100';
    let res;
    try {
      res = await api('GET', `/groups/${groupId}/messages${qs}`);
    } catch (e) {
      if (e.status === 304) return null;
      throw e;
    }
    const msgs = res.response.messages || [];
    const hit = msgs.find((m) => m.id === messageId);
    if (hit) return hit;
    if (msgs.length === 0) return null;
    beforeId = msgs[msgs.length - 1].id;
  }
  return null;
}

(async () => {
  loadEnv();
  const groupId = process.argv[2] || process.env.GROUPME_GROUP_ID;
  const dateStamp = process.argv[3] || todayStamp();
  if (!groupId) {
    console.error('No group_id passed and GROUPME_GROUP_ID not set in .env.');
    process.exit(2);
  }

  const stateFile = `checkin-${groupId}-${dateStamp}.json`;
  const state = loadState(stateFile);
  if (!state) {
    console.error(`No check-in state found for ${dateStamp} (file: ${path.join(STATE_DIR, stateFile)}).`);
    console.error('Did you run `node checkin-post.js` today?');
    process.exit(2);
  }

  console.log(`Loading group + members…`);
  const groupRes = await api('GET', `/groups/${groupId}`);
  const group = groupRes.response;
  const members = group.members || [];

  console.log(`Looking up check-in message ${state.message_id}…`);
  const msg = await findMessage(groupId, state.message_id);
  if (!msg) {
    console.error('Could not find the check-in message in recent history. It may have scrolled off (>1000 messages since post).');
    process.exit(1);
  }

  const reactedIds = new Set(msg.favorited_by || []);
  const posterId = String(state.posted_by_user_id);

  const respondedMembers = [];
  const noResponseMembers = [];
  for (const m of members) {
    const uid = String(m.user_id);
    if (uid === posterId) continue;
    if (reactedIds.has(uid)) respondedMembers.push(m);
    else noResponseMembers.push(m);
  }

  // Reactors who aren't in the current member list (rare — left the group, etc.)
  const memberIds = new Set(members.map((m) => String(m.user_id)));
  const ghostReactors = [...reactedIds].filter((id) => !memberIds.has(id));

  const totalEligible = members.length - 1; // minus poster
  const respondedCount = respondedMembers.length;
  const noResponseCount = noResponseMembers.length;
  const responseRate = totalEligible ? ((respondedCount / totalEligible) * 100).toFixed(1) : '0.0';

  console.log(`\n=== ${group.name} — Check-in Report (${dateStamp}) ===`);
  console.log(`Posted at:       ${state.posted_at}`);
  console.log(`Total members:   ${members.length} (excluding you, eligible: ${totalEligible})`);
  console.log(`Worked out (👍): ${respondedCount}`);
  console.log(`No response:     ${noResponseCount}`);
  console.log(`Response rate:   ${responseRate}%`);
  if (ghostReactors.length) console.log(`(Note: ${ghostReactors.length} reactors no longer in group roster)`);

  console.log(`\n--- ✓ WORKED OUT (${respondedCount}) ---`);
  if (!respondedMembers.length) {
    console.log('(none yet)');
  } else {
    for (const m of respondedMembers.sort((a, b) => a.nickname.localeCompare(b.nickname))) {
      console.log(`  ${m.nickname}  (user_id: ${m.user_id})`);
    }
  }

  console.log(`\n--- ⚠ NO RESPONSE — FOLLOW UP (${noResponseCount}) ---`);
  if (!noResponseMembers.length) {
    console.log('(everyone responded — incredible)');
  } else {
    for (const m of noResponseMembers.sort((a, b) => a.nickname.localeCompare(b.nickname))) {
      console.log(`  ${m.nickname}  (user_id: ${m.user_id})`);
    }
  }

  // Save a report file too — useful for historical tracking + future Monday.com sync.
  const reportPath = path.join(STATE_DIR, `report-${groupId}-${dateStamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({
    group_id: groupId,
    group_name: group.name,
    date: dateStamp,
    posted_at: state.posted_at,
    message_id: state.message_id,
    totals: { eligible: totalEligible, responded: respondedCount, no_response: noResponseCount, response_rate_pct: Number(responseRate) },
    responded: respondedMembers.map((m) => ({ user_id: m.user_id, nickname: m.nickname })),
    no_response: noResponseMembers.map((m) => ({ user_id: m.user_id, nickname: m.nickname })),
    ghost_reactor_ids: ghostReactors,
  }, null, 2));
  console.log(`\nReport saved: ${reportPath}`);
})().catch((e) => {
  console.error('\nERROR:', e.message);
  if (e.body) console.error('Response body:', JSON.stringify(e.body, null, 2));
  process.exit(1);
});
