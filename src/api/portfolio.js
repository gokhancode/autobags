const router = require('express').Router();
const fs = require('fs');
const path = require('path');

const TRADE_FILE = path.join(__dirname, '../../data/trades.json');

// GET /api/portfolio/:wallet
router.get('/:wallet', (req, res) => {
  const trades = fs.existsSync(TRADE_FILE)
    ? JSON.parse(fs.readFileSync(TRADE_FILE, 'utf8'))
    : [];

  const walletTrades = trades.filter(t => t.wallet === req.params.wallet);
  const totalPnl = walletTrades.reduce((sum, t) => sum + (t.pnlSol || 0), 0);
  const winRate = walletTrades.length
    ? walletTrades.filter(t => t.pnlSol > 0).length / walletTrades.length
    : 0;

  res.json({
    wallet: req.params.wallet,
    totalTrades: walletTrades.length,
    totalPnlSol: totalPnl.toFixed(4),
    winRate: (winRate * 100).toFixed(1) + '%',
    recentTrades: walletTrades.slice(-5)
  });
});

module.exports = router;
