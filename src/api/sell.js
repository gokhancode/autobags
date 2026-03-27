/**
 * AUTOBAGS — Manual Sell API
 * Allows users to manually exit a position via the dashboard
 */
const router = require('express').Router();
const fs     = require('fs');
const path   = require('path');
const auth   = require('./auth');

const POSITIONS_FILE = path.join(__dirname, '../../data/positions.json');
const TRADES_FILE    = path.join(__dirname, '../../data/trades.json');

function load(file, def) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : def; }
  catch { return def; }
}
function save(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/**
 * POST /api/sell
 * Body: { mint }
 * Sells the user's position in the given token
 */
router.post('/', auth.requireAuth, async (req, res) => {
  const userId = req.user.userId;
  const { mint } = req.body;

  if (!mint) return res.status(400).json({ error: 'mint required' });

  const positions = load(POSITIONS_FILE, {});
  const userPositions = positions[userId] || {};
  const pos = userPositions[mint];

  if (!pos) return res.status(404).json({ error: 'No open position for this token' });

  try {
    // Lazy-load to avoid circular deps
    const { executeSwap } = require('../bot/agent');
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const settings = { slippageBps: 100 };

    // Load user settings for slippage
    const SETTINGS_FILE = path.join(__dirname, '../../data/settings.json');
    const allSettings = load(SETTINGS_FILE, {});
    if (allSettings[userId]?.slippageBps) settings.slippageBps = allSettings[userId].slippageBps;

    const tokensToSell = pos.tokensReceived;
    console.log(`[Manual Sell] ${userId}: selling $${pos.symbol} (${mint})`);

    const result = await executeSwap(userId, mint, SOL_MINT, Number(tokensToSell), settings.slippageBps);

    // Calculate P&L
    const { LAMPORTS_PER_SOL } = require('@solana/web3.js');
    const pnlSol = parseFloat(result.outAmount) / LAMPORTS_PER_SOL - pos.solSpent;
    const pnlPct = pos.solSpent > 0 ? ((pnlSol / pos.solSpent) * 100) : 0;

    // Remove position
    delete positions[userId][mint];
    save(POSITIONS_FILE, positions);

    // Log trade
    const trades = load(TRADES_FILE, []);
    trades.push({
      userId,
      type: 'SELL',
      symbol: pos.symbol,
      mint,
      reason: 'manual',
      pricePct: pnlPct,
      pnlSol,
      solAmount: pos.solSpent,
      signature: result.signature,
      explanation: `Manual sell triggered by user. Exited $${pos.symbol} position${pnlSol >= 0 ? ' with profit' : ' at a loss'}.`,
      timestamp: new Date().toISOString()
    });
    save(TRADES_FILE, trades);

    console.log(`[Manual Sell] ✅ Sold $${pos.symbol} — P&L: ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL`);

    res.json({
      success: true,
      symbol: pos.symbol,
      pnlSol: parseFloat(pnlSol.toFixed(6)),
      pnlPct: parseFloat(pnlPct.toFixed(2)),
      signature: result.signature
    });
  } catch (err) {
    console.error(`[Manual Sell] Failed:`, err.message);
    res.status(500).json({ error: 'Sell failed: ' + err.message });
  }
});

module.exports = router;
