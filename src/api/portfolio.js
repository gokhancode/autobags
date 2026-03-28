const router  = require('express').Router();
const fs       = require('fs');
const path     = require('path');
const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const WalletManager = require('../bot/wallet-manager');

const TRADE_FILE     = path.join(__dirname, '../../data/trades.json');
const POSITIONS_FILE = path.join(__dirname, '../../data/positions.json');

const connection = new Connection(
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  'confirmed'
);

// Cache SOL price for 5 min
let cachedSolPrice = 83;
let solPriceCacheTime = 0;
async function getSolPrice() {
  if (Date.now() - solPriceCacheTime < 300000) return cachedSolPrice;
  try {
    const res = await fetch('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112');
    const data = await res.json();
    const pair = data?.pairs?.find(p => p.quoteToken?.symbol === 'USDC' || p.quoteToken?.symbol === 'USDT');
    if (pair) cachedSolPrice = parseFloat(pair.priceUsd) || 83;
    solPriceCacheTime = Date.now();
  } catch {}
  return cachedSolPrice;
}

// Cache token prices for 60s
const tokenPriceCache = {};
async function getTokenPriceUsd(mint) {
  const cached = tokenPriceCache[mint];
  if (cached && Date.now() - cached.time < 60000) return cached.price;
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await res.json();
    const pair = data?.pairs?.find(p => p.chainId === 'solana') || data?.pairs?.[0];
    const price = pair ? parseFloat(pair.priceUsd || 0) : 0;
    tokenPriceCache[mint] = { price, time: Date.now() };
    return price;
  } catch { return 0; }
}

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
  let balanceSol = 0;
  let walletPublicKey = null;
  try {
    walletPublicKey = WalletManager.getPublicKey(userId);
    if (walletPublicKey) {
      const pubkey  = new PublicKey(walletPublicKey);
      const lamports = await connection.getBalance(pubkey);
      balanceSol = lamports / LAMPORTS_PER_SOL;
    }
  } catch (e) {
    console.error('[Portfolio] Balance fetch error:', e.message);
  }

  // Fetch open positions — use ACTUAL on-chain token balances
  let openPositions = [];
  let holdingsValueSol = 0;
  try {
    const allPositions = fs.existsSync(POSITIONS_FILE)
      ? JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8'))
      : {};
    const userPositions = allPositions[userId] || {};

    const solPrice = await getSolPrice();

    for (const [mint, pos] of Object.entries(userPositions)) {
      let valueSol = 0;
      let onChainAmount = null;
      let decimals = 6;

      // Step 1: Get ACTUAL on-chain token balance
      try {
        const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
          new PublicKey(walletPublicKey),
          { mint: new PublicKey(mint) }
        );
        const info = tokenAccounts.value?.[0]?.account?.data?.parsed?.info;
        onChainAmount = info?.tokenAmount?.amount || '0';
        decimals = info?.tokenAmount?.decimals || 6;
      } catch {
        onChainAmount = '0';
      }

      if (!onChainAmount || onChainAmount === '0') continue;

      // Step 2: Value using cached DexScreener price
      const priceUsd = await getTokenPriceUsd(mint);
      if (priceUsd > 0 && solPrice > 0) {
        const uiAmount = parseInt(onChainAmount) / Math.pow(10, decimals);
        const valueUsd = uiAmount * priceUsd;
        valueSol = valueUsd / solPrice;
      }

      const pnlPct = pos.solSpent > 0 ? ((valueSol - pos.solSpent) / pos.solSpent * 100) : 0;
      openPositions.push({
        symbol: pos.symbol,
        mint,
        entryTime: pos.entryTime,
        solSpent: parseFloat(pos.solSpent.toFixed(4)),
        currentValueSol: parseFloat(valueSol.toFixed(6)),
        pnlPct: parseFloat(pnlPct.toFixed(2)),
        score: pos.score,
        onChainTokens: onChainAmount
      });
      holdingsValueSol += valueSol;
    }
  } catch (e) {
    console.error('[Portfolio] Positions fetch error:', e.message);
  }

  const totalWorthSol = parseFloat((balanceSol + holdingsValueSol).toFixed(6));

  res.json({
    success:      true,
    userId,
    walletPublicKey,
    balanceSol:    parseFloat(balanceSol.toFixed(6)),
    holdingsValueSol: parseFloat(holdingsValueSol.toFixed(6)),
    totalWorthSol,
    depositedSol:  1.192, // TODO: track deposits properly
    pnlSol:       parseFloat((totalWorthSol - 1.192).toFixed(6)),
    pnlPct:       parseFloat(((totalWorthSol - 1.192) / 1.192 * 100).toFixed(2)),
    openPositions,
    totalTrades:  userTrades.length,
    totalPnlSol:  totalPnl.toFixed(4),
    winRate,
    recentTrades: userTrades.slice(-5).reverse()
  });
});

// GET /api/portfolio/:userId/equity
router.get('/:userId/equity', async (req, res) => {
  const { userId } = req.params;
  const period = req.query.period || '7d';
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
