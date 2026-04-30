/**
 * Shared seat-map resolution for cdp-wake.js, cdp-target-model.js, and tooling.
 */
const fs = require('fs');
const path = require('path');

function loadSeatMap() {
  const mapPath = path.join(__dirname, 'seat-map.json');
  if (!fs.existsSync(mapPath)) {
    throw new Error(`Missing seat-map.json at ${mapPath}`);
  }
  return JSON.parse(fs.readFileSync(mapPath, 'utf8'));
}

/** Resolve FASTOPS_SEAT (alias, seat-N, agent, sidebar, model) → canonical seat id. */
function resolveEnvSeatToId(raw, map) {
  if (!raw || !String(raw).trim()) return null;
  const lower = String(raw).toLowerCase().trim();
  if (map.seats && map.seats[lower]) return lower;
  if (map.aliases && map.aliases[lower]) return map.aliases[lower];
  for (const [sid, cfg] of Object.entries(map.seats || {})) {
    if (cfg.agent && String(cfg.agent).toLowerCase() === lower) return sid;
    if (cfg.sidebar && String(cfg.sidebar).toLowerCase() === lower) return sid;
    if (cfg.model && String(cfg.model).toLowerCase() === lower) return sid;
  }
  return null;
}

/** Resolve --target string (alias or seat id) to canonical seat id. */
function resolveTargetToSeatId(targetLower, map) {
  const t = String(targetLower).toLowerCase().trim();
  if (map.seats && map.seats[t]) return t;
  if (map.aliases && map.aliases[t]) return map.aliases[t];
  for (const [sid, cfg] of Object.entries(map.seats || {})) {
    if (cfg.agent && String(cfg.agent).toLowerCase() === t) return sid;
    if (cfg.sidebar && String(cfg.sidebar).toLowerCase() === t) return sid;
    if (cfg.model && String(cfg.model).toLowerCase() === t) return sid;
  }
  return null;
}

/** Map sidebar model key (e.g. composer, gemini) to seat id. */
function resolveModelToSeatId(modelLower, map) {
  const m = String(modelLower).toLowerCase().trim();
  if (map.aliases && map.aliases[m]) return map.aliases[m];
  for (const [sid, cfg] of Object.entries(map.seats || {})) {
    if (cfg.model && String(cfg.model).toLowerCase() === m) return sid;
  }
  return null;
}

module.exports = {
  loadSeatMap,
  resolveEnvSeatToId,
  resolveTargetToSeatId,
  resolveModelToSeatId,
};
