const router  = require('express').Router();
const fs       = require('fs');
const path     = require('path');
const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const WalletManager = require('../bot/wallet-manager');

const TRADE_FILE     = path.join(__dirname, '../../data/trades.json');
const USERS_FILE     = path.join(__dirname, '../../data/users.json');
const POSITIONS_FILE = path.join(__dirname, '../../data/positions.json');

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

  // Fetch open positions and their current value
  let openPositions = [];
  let holdingsValueSol = 0;
  try {
    const allPositions = fs.existsSync(POSITIONS_FILE)
      ? JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8'))
      : {};
    const userPositions = allPositions[userId] || {};

    for (const [mint, pos] of Object.entries(userPositions)) {
      let valueSol = 0;
      try {
        // Get actual on-chain token balance
        const SOL_MINT = 'So11111111111111111111111111111111111111112';
        const BAGS_KEY = process.env.BAGS_API_KEY;
        let rawAmount = pos.tokensReceived;

        try {
          const tokenAccounts = await conn.getParsedTokenAccountsByOwner(
            new PublicKey(walletPublicKey),
            { mint: new PublicKey(mint) }
          );
          const onChainAmount = tokenAccounts.value?.[0]?.account?.data?.parsed?.info?.tokenAmount?.amount;
          if (onChainAmount) rawAmount = onChainAmount;
        } catch {}

        // Method 1: Bags trade quote (most accurate for Bags tokens)
        if (BAGS_KEY && rawAmount) {
          try {
            const qRes = await fetch(
              `https://public-api-v2.bags.fm/api/v1/trade/quote?inputMint=${mint}&outputMint=${SOL_MINT}&amount=${rawAmount}`,
              { headers: { 'x-api-key': BAGS_KEY } }
            );
            const qData = await qRes.json();
            if (qData?.success && qData?.response?.outAmount) {
              valueSol = parseInt(qData.response.outAmount) / 1e9;
            }
          } catch {}
        }

        // Method 2: Jupiter price fallback
        if (valueSol === 0) {
          try {
            const jupRes = await fetch(`https://api.jup.ag/price/v2?ids=${mint}&vsToken=${SOL_MINT}`);
            const jupData = await jupRes.json();
            const priceInSol = parseFloat(jupData?.data?.[mint]?.price || 0);
            if (priceInSol > 0) {
              const uiAmount = parseFloat(rawAmount) / 1e9; // assume 9 decimals
              valueSol = uiAmount * priceInSol;
            }
          } catch {}
        }

        // Method 3: DexScreener fallback
        if (valueSol === 0) {
          try {
            const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
            const d = await r.json();
            const pair = d?.pairs?.find(p => p.chainId === 'solana');
            if (pair && pos.solSpent) {
              const currentPrice = parseFloat(pair.priceUsd);
              const entryPrice = pos.entryPrice || 0;
              if (entryPrice > 0 && currentPrice > 0) {
                valueSol = pos.solSpent * (currentPrice / entryPrice);
              }
            }
          } catch {}
        }
      } catch {}
      const pnlPct = pos.solSpent > 0 ? ((valueSol - pos.solSpent) / pos.solSpent * 100) : 0;
      openPositions.push({
        symbol: pos.symbol,
        mint,
        entryTime: pos.entryTime,
        solSpent: pos.solSpent,
        currentValueSol: parseFloat(valueSol.toFixed(6)),
        pnlPct: parseFloat(pnlPct.toFixed(2)),
        score: pos.score
      });
      holdingsValueSol += valueSol;
    }
  } catch (e) {
    console.error('[Portfolio] Positions fetch error:', e.message);
  }

  const totalWorthSol = parseFloat(((parseFloat(balanceSol) || 0) + holdingsValueSol).toFixed(4));

  res.json({
    success:      true,
    userId,
    walletPublicKey,
    balanceSol,
    holdingsValueSol: parseFloat(holdingsValueSol.toFixed(4)),
    totalWorthSol,
    openPositions,
    totalTrades:  userTrades.length,
    totalPnlSol:  totalPnl.toFixed(4),
    winRate,
    recentTrades: userTrades.slice(-5).reverse()
  });
});

// GET /api/portfolio/:userId/equity — equity curve data
router.get('/:userId/equity', async (req, res) => {
  const { userId } = req.params;
  const period = req.query.period || '7d'; // 1d, 7d, 30d
  const now = Date.now();
  const sinceMap = { '1d': now - 86400000, '7d': now - 7*86400000, '30d': now - 30*86400000 };
  const since = sinceMap[period] || sinceMap['7d'];

  try {
    const { getCurve } = require('../bot/equity-tracker');
    const curve = getCurve(userId, since);
    res.json({ success: true, userId, period, points: curve });
  } catch (e) {
    res.json({ success: true, userId, period, points: [] });
  }
});

module.exports = router;
