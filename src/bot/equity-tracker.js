/**
 * AUTOBAGS — Equity Curve Tracker
 * Snapshots portfolio value periodically for charting
 */
const fs   = require('fs');
const path = require('path');

const EQUITY_FILE = path.join(__dirname, '../../data/equity.json');

function load() {
  try { return fs.existsSync(EQUITY_FILE) ? JSON.parse(fs.readFileSync(EQUITY_FILE, 'utf8')) : {}; }
  catch { return {}; }
}
function save(data) {
  fs.mkdirSync(path.dirname(EQUITY_FILE), { recursive: true });
  fs.writeFileSync(EQUITY_FILE, JSON.stringify(data));
}

/**
 * Record a portfolio snapshot
 * Called every N ticks (e.g., every 5 min)
 */
function snapshot(userId, totalWorthSol) {
  const all = load();
  if (!all[userId]) all[userId] = [];

  const now = Date.now();
  const points = all[userId];

  // Don't record more than 1 point per 5 minutes
  if (points.length > 0 && now - points[points.length - 1][0] < 5 * 60 * 1000) return;

  points.push([now, parseFloat(totalWorthSol.toFixed(6))]);

  // Keep last 30 days (8640 points at 5min intervals)
  if (points.length > 8640) points.splice(0, points.length - 8640);

  all[userId] = points;
  save(all);
}

/**
 * Get equity curve data for a user
 * Returns [[timestamp, value], ...]
 */
function getCurve(userId, since = 0) {
  const all = load();
  const points = all[userId] || [];
  return since ? points.filter(p => p[0] >= since) : points;
}

module.exports = { snapshot, getCurve };
