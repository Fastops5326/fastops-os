/**
 * Single source of truth for "which Composer agent cell is peerIndex N" in the Cursor
 * Agents sidebar. Used by cdp-target-model.js (click) and cdp-list-composer-peers.js (diagnostic).
 *
 * **Squad doctrine (Joel):** **four** Composer 2 agents — use **`peerIndex` 0–3** for batch wakes.
 * Extra sidebar rows may exist; enumerate with **`cdp-list-composer-peers.js`** before scripting.
 *
 * Keep DOM logic here only — do not duplicate in other files.
 */

/** Shared: fill `cells` with Element nodes for each Composer sidebar agent (DOM order).
 *  2026-03-28: Cursor now shows SESSION TITLES in sidebar cells, not "Composer".
 *  All agent sidebar cells are Composer sessions — collect them all by index.
 *  Fallback: if .agent-sidebar-cell elements exist, use those directly.
 */
const COLLECT_COMPOSER_CELLS = `
  var cells = [];
  // Phase 1: Try text-match (legacy — works if Cursor reverts to model labels)
  var allText = document.querySelectorAll('.agent-sidebar-cell-text');
  for (var i = 0; i < allText.length; i++) {
    var t = (allText[i].textContent || '').trim();
    if (/^composer$/i.test(t)) { cells.push(allText[i]); }
  }
  // Phase 2: All sidebar cells ARE Composer sessions (Cursor 2026-03 shows session titles)
  if (cells.length === 0) {
    var allCells = document.querySelectorAll('.agent-sidebar-cell');
    for (var j = 0; j < allCells.length; j++) {
      var textEl = allCells[j].querySelector('.agent-sidebar-cell-text');
      cells.push(textEl || allCells[j]);
    }
  }
`;

const LIST_EXPRESSION = `
(function() {
  ${COLLECT_COMPOSER_CELLS}
  var peers = cells.map(function(el, idx) {
    return { peerIndex: idx, label: (el.textContent || '').trim() };
  });
  return JSON.stringify({ count: cells.length, peers: peers });
})()
`;

/** @param {number} peerIdx */
function buildClickExpression(peerIdx) {
  return `
(function() {
  var idx = ${peerIdx};
  ${COLLECT_COMPOSER_CELLS}
  if (cells[idx]) {
    var el = cells[idx].closest('[class*="sidebar-cell"]') || cells[idx];
    el.click();
    return 'CLICKED_COMPOSER_PEER_' + idx + '_of_' + cells.length;
  }
  return 'NOT FOUND';
})()
`;
}

module.exports = {
  buildClickExpression,
  LIST_EXPRESSION,
};
