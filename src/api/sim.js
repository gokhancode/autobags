/**
 * AUTOBAGS — Simulator API
 * Paper trading stats + control
 */
const router = require('express').Router();
const sim = require('../bot/simulator');

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

// POST /api/sim/reset — reset with new balance
router.post('/reset', (req, res) => {
  const balance = parseFloat(req.body.balanceUsd) || 1000;
  sim.stop();
  sim.initSim(balance);
  sim.start(15000);
  res.json({ success: true, message: `Simulator reset with $${balance}` });
});

module.exports = router;
