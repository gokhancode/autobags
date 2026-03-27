const router  = require('express').Router();
const fs       = require('fs');
const path     = require('path');
const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const WalletManager = require('../bot/wallet-manager');

const TRADE_FILE = path.join(__dirname, '../../data/trades.json');
const USERS_FILE = path.join(__dirname, '../../data/users.json');

const connection = new Connection(
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  'confirmed'
);

// GET /api/portfolio/:userId
router.get('/:userId', async (req, res) => {
  const { userId } = req.params;

  // Load trade history
  const trades = fs.existsSync(TRADE_FILE)
    ? JSON.parse(fs.readFileSync(TRADE_FILE, 'utf8'))
    : [];
  const userTrades = trades.filter(t => t.userId === userId || !t.userId);
  const wins       = userTrades.filter(t => (t.pnlSol || 0) > 0).length;
  const totalPnl   = userTrades.reduce((s, t) => s + (t.pnlSol || 0), 0);
  const winRate    = userTrades.length
    ? ((wins / userTrades.length) * 100).toFixed(1) + '%'
    : null;

  // Fetch live on-chain SOL balance
  let balanceSol = null;
  let walletPublicKey = null;
  try {
    walletPublicKey = WalletManager.getPublicKey(userId);
    if (walletPublicKey) {
      const pubkey  = new PublicKey(walletPublicKey);
      const lamports = await connection.getBalance(pubkey);
      balanceSol = (lamports / LAMPORTS_PER_SOL).toFixed(4);
    }
  } catch (e) {
    console.error('[Portfolio] Balance fetch error:', e.message);
  }

  res.json({
    success:      true,
    userId,
    walletPublicKey,
    balanceSol,
    totalTrades:  userTrades.length,
    totalPnlSol:  totalPnl.toFixed(4),
    winRate,
    recentTrades: userTrades.slice(-5).reverse()
  });
});

module.exports = router;
