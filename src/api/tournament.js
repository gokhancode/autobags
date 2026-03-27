/**
 * AUTOBAGS — Tournament API
 * Multi-strategy leaderboard
 */
const router = require('express').Router();
const tournament = require('../bot/sim-strategies');

// GET /api/tournament — leaderboard
router.get('/', (req, res) => {
  const lb = tournament.getLeaderboard();
  if (!lb) return res.json({ success: false, error: 'Tournament not running' });
  res.json({ success: true, ...lb });
});

// POST /api/tournament/rebalance — force rebalance
router.post('/rebalance', (req, res) => {
  tournament.rebalance();
  const lb = tournament.getLeaderboard();
  res.json({ success: true, message: 'Rebalanced', ...lb });
});

module.exports = router;
