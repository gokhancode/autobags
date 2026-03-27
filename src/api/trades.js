const router = require('express').Router();
const fs = require('fs');
const path = require('path');

const TRADE_FILE = path.join(__dirname, '../../data/trades.json');

function loadTrades() {
  if (!fs.existsSync(TRADE_FILE)) return [];
  return JSON.parse(fs.readFileSync(TRADE_FILE, 'utf8'));
}

// GET /api/trades — recent trades (public feed)
router.get('/', (req, res) => {
  const trades = loadTrades();
  const limit = parseInt(req.query.limit) || 20;
  res.json({ success: true, trades: trades.slice(-limit).reverse() });
});

module.exports = router;
