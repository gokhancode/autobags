/**
 * AUTOBAGS — Simulator API
 * Paper trading stats + control
 */
const router = require('express').Router();
const sim = require('../bot/simulator');
const auth = require('./auth');
const requireAuth = auth.requireAuth;

// GET /api/sim — get sim stats
router.get('/', (req, res) => {
  const stats = sim.getStats();
  if (!stats) return res.json({ success: false, error: 'Simulator not running' });
  res.json({ success: true, ...stats });
});

// GET /api/sim/trades — all sim trades
router.get('/trades', (req, res) => {
  const trades = sim.loadTrades();
  res.json({ success: true, trades: trades.reverse() });
});

// GET /api/sim/equity — equity curve data
router.get('/equity', (req, res) => {
  const state = sim.loadState();
  if (!state) return res.json({ success: false, error: 'No sim state' });
  res.json({ success: true, curve: state.equityCurve || [] });
});

// POST /api/sim/reset — reset with new balance (AUTH REQUIRED)
router.post('/reset', requireAuth, (req, res) => {
  const balance = parseFloat(req.body.balanceUsd) || 1000;
  sim.stop();
  sim.initSim(balance);
  sim.start(15000);
  res.json({ success: true, message: `Simulator reset with $${balance}` });
});

module.exports = router;
