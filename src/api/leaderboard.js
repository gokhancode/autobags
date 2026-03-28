/**
 * AUTOBAGS — Leaderboard + Strategy Sharing + Referrals + Developer API
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const TRADES_FILE = path.join(__dirname, '../../data/trades.json');
const SETTINGS_FILE = path.join(__dirname, '../../data/settings.json');
const SHARED_FILE = path.join(__dirname, '../../data/shared-strategies.json');
const REFERRAL_FILE = path.join(__dirname, '../../data/referrals.json');

function load(f, def) {
  try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : def; }
  catch { return def; }
}
function save(f, d) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

// ── Leaderboard ──────────────────────────────────────────────────────────

// GET /api/leaderboard — top traders by P&L
router.get('/', (req, res) => {
  const trades = load(TRADES_FILE, []);
  
  // Group by userId
  const userStats = {};
  trades.filter(t => t.type === 'SELL').forEach(t => {
    if (!userStats[t.userId]) userStats[t.userId] = { wins: 0, losses: 0, totalPnl: 0, trades: 0 };
    userStats[t.userId].trades++;
    userStats[t.userId].totalPnl += (t.pnlSol || 0);
    if ((t.pnlSol || 0) > 0) userStats[t.userId].wins++;
    else userStats[t.userId].losses++;
  });
  
  const leaderboard = Object.entries(userStats)
    .map(([userId, stats]) => ({
      userId: userId.slice(0, 3) + '***', // anonymize
      trades: stats.trades,
      winRate: stats.trades > 0 ? Math.round(stats.wins / stats.trades * 100) : 0,
      totalPnl: parseFloat(stats.totalPnl.toFixed(6)),
      rank: 0,
    }))
    .sort((a, b) => b.totalPnl - a.totalPnl)
    .map((entry, i) => ({ ...entry, rank: i + 1 }));
  
  res.json({ success: true, leaderboard });
});

// ── Strategy Sharing ─────────────────────────────────────────────────────

// POST /api/leaderboard/share — share your strategy settings
router.post('/share', (req, res) => {
  const { userId, name, description } = req.body;
  if (!userId || !name) return res.status(400).json({ error: 'userId and name required' });
  
  const settings = load(SETTINGS_FILE, {})[userId] || {};
  const shared = load(SHARED_FILE, []);
  
  const strategy = {
    id: Date.now().toString(36),
    userId: userId.slice(0, 3) + '***',
    name,
    description: description || '',
    settings: {
      stopLossPct: settings.stopLossPct,
      takeProfitPct: settings.takeProfitPct,
      partialExitPct: settings.partialExitPct,
      trailingStopPct: settings.trailingStopPct,
      maxSolPerTrade: settings.maxSolPerTrade,
      minIntelScore: settings.minIntelScore,
      maxHoldMinutes: settings.maxHoldMinutes,
    },
    sharedAt: new Date().toISOString(),
    copies: 0,
    likes: 0,
  };
  
  shared.push(strategy);
  save(SHARED_FILE, shared);
  
  res.json({ success: true, strategy });
});

// GET /api/leaderboard/strategies — list shared strategies
router.get('/strategies', (req, res) => {
  const shared = load(SHARED_FILE, []);
  res.json({ success: true, strategies: shared.sort((a, b) => b.likes - a.likes) });
});

// POST /api/leaderboard/copy — copy a shared strategy
router.post('/copy', (req, res) => {
  const { userId, strategyId } = req.body;
  if (!userId || !strategyId) return res.status(400).json({ error: 'userId and strategyId required' });
  
  const shared = load(SHARED_FILE, []);
  const strategy = shared.find(s => s.id === strategyId);
  if (!strategy) return res.status(404).json({ error: 'Strategy not found' });
  
  // Apply settings to user
  const allSettings = load(SETTINGS_FILE, {});
  if (!allSettings[userId]) allSettings[userId] = {};
  Object.assign(allSettings[userId], strategy.settings);
  save(SETTINGS_FILE, allSettings);
  
  strategy.copies++;
  save(SHARED_FILE, shared);
  
  res.json({ success: true, applied: strategy.settings });
});

// ── Referrals ────────────────────────────────────────────────────────────

// POST /api/leaderboard/referral — create referral code
router.post('/referral', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });
  
  const referrals = load(REFERRAL_FILE, {});
  const code = userId.slice(0, 4).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  
  if (!referrals[userId]) {
    referrals[userId] = { code, referred: [], totalBonus: 0, createdAt: new Date().toISOString() };
  }
  
  save(REFERRAL_FILE, referrals);
  res.json({ success: true, code: referrals[userId].code, referred: referrals[userId].referred.length });
});

// POST /api/leaderboard/referral/use — use a referral code
router.post('/referral/use', (req, res) => {
  const { userId, code } = req.body;
  if (!userId || !code) return res.status(400).json({ error: 'userId and code required' });
  
  const referrals = load(REFERRAL_FILE, {});
  const referrer = Object.entries(referrals).find(([_, r]) => r.code === code);
  
  if (!referrer) return res.status(404).json({ error: 'Invalid referral code' });
  if (referrer[0] === userId) return res.status(400).json({ error: 'Cannot refer yourself' });
  
  referrer[1].referred.push({ userId, joinedAt: new Date().toISOString() });
  save(REFERRAL_FILE, referrals);
  
  res.json({ success: true, referredBy: referrer[0].slice(0, 3) + '***', bonus: '10% fee reduction' });
});

// ── Developer API ────────────────────────────────────────────────────────

// GET /api/leaderboard/dev/docs — API documentation
router.get('/dev/docs', (req, res) => {
  res.json({
    name: 'AUTOBAGS Developer API',
    version: '1.0',
    base_url: 'https://autobags.io/api',
    endpoints: [
      { method: 'GET', path: '/stats', desc: 'Platform stats (SOL price, pools, TPS)' },
      { method: 'GET', path: '/leaderboard', desc: 'Top traders by P&L' },
      { method: 'GET', path: '/leaderboard/strategies', desc: 'Shared strategy presets' },
      { method: 'GET', path: '/analytics/heatmap/:userId', desc: 'Time of day vs profitability' },
      { method: 'GET', path: '/analytics/tokens/:userId', desc: 'Per-token performance' },
      { method: 'GET', path: '/analytics/summary/:userId', desc: 'Performance metrics' },
      { method: 'POST', path: '/chat', desc: 'AI strategy chat', body: '{ userId, message }' },
      { method: 'POST', path: '/chat/analyze', desc: 'Token analysis', body: '{ mint }' },
      { method: 'GET', path: '/quant', desc: 'Quant brain report + signals' },
      { method: 'GET', path: '/narratives', desc: 'AI narrative scanner' },
      { method: 'GET', path: '/portfolio/:userId', desc: 'Portfolio (balance, positions, P&L)' },
      { method: 'GET', path: '/portfolio/:userId/equity', desc: 'Equity curve data' },
      { method: 'GET', path: '/trades/:userId', desc: 'Trade history' },
    ],
    auth: 'JWT token in Authorization header (obtain via /api/auth/login)',
    rate_limits: '100 req/min per IP',
  });
});

module.exports = router;
