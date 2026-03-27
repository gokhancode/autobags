/**
 * AUTOBAGS — Admin API
 * Platform overview, user management, force actions
 * Admin = first registered user (by subscriber order)
 */
const router = require('express').Router();
const fs     = require('fs');
const path   = require('path');
const auth   = require('./auth');
const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const WalletManager = require('../bot/wallet-manager');

const DATA_DIR       = path.join(__dirname, '../../data');
const SUBSCRIBERS    = () => load(path.join(DATA_DIR, 'subscribers.json'), {});
const SETTINGS       = () => load(path.join(DATA_DIR, 'settings.json'), {});
const POSITIONS      = () => load(path.join(DATA_DIR, 'positions.json'), {});
const TRADES         = () => load(path.join(DATA_DIR, 'trades.json'), []);

const conn = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');

function load(file, def) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : def; }
  catch { return def; }
}
function save(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Admin check — first subscriber is admin
function isAdmin(userId) {
  const subs = SUBSCRIBERS();
  const firstUser = Object.keys(subs)[0];
  return userId === firstUser;
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req.user.userId)) {
    return res.status(403).json({ error: 'Admin access only' });
  }
  next();
}

// GET /api/admin/overview
router.get('/overview', auth.requireAuth, requireAdmin, async (req, res) => {
  try {
    const subs      = SUBSCRIBERS();
    const settings  = SETTINGS();
    const positions = POSITIONS();
    const trades    = TRADES();

    const userIds = Object.keys(subs);
    const activeBots = userIds.filter(uid => (settings[uid]?.active !== false)).length;

    // Per-user data
    const users = [];
    let totalAum = 0;
    let totalOpenPositions = 0;

    for (const uid of userIds) {
      const sub = subs[uid];
      const userTrades = trades.filter(t => t.userId === uid);
      const userPos = positions[uid] || {};
      const posCount = Object.keys(userPos).length;
      totalOpenPositions += posCount;

      let balance = null;
      try {
        const pubkey = WalletManager.getPublicKey(uid);
        if (pubkey) {
          const lamports = await conn.getBalance(new PublicKey(pubkey));
          balance = (lamports / LAMPORTS_PER_SOL).toFixed(4);
          totalAum += lamports / LAMPORTS_PER_SOL;
        }
      } catch {}

      const pnl = userTrades.reduce((s, t) => s + (t.pnlSol || 0), 0);

      users.push({
        userId: uid,
        wallet: sub.walletPublicKey,
        balance,
        openPositions: posCount,
        trades: userTrades.length,
        pnl,
        active: settings[uid]?.active !== false,
        joinedAt: sub.joinedAt
      });
    }

    // Platform totals
    const totalPnl = trades.reduce((s, t) => s + (t.pnlSol || 0), 0);
    const wins = trades.filter(t => (t.pnlSol || 0) > 0).length;
    const sellTrades = trades.filter(t => t.type === 'SELL' || t.type === 'PARTIAL_SELL');
    const winRate = sellTrades.length ? ((wins / sellTrades.length) * 100).toFixed(1) + '%' : null;

    // Estimated fee revenue (1.5% of all trade volume)
    const totalVolume = trades.reduce((s, t) => s + Math.abs(t.solAmount || 0), 0);
    const estFeeRevenue = totalVolume * 0.015;

    // All open positions with current values
    const allPositions = [];
    for (const [uid, userPos] of Object.entries(positions)) {
      for (const [mint, pos] of Object.entries(userPos)) {
        let currentValue = pos.solSpent;
        let pnlPct = 0;
        try {
          const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
          const d = await r.json();
          const pair = d?.pairs?.[0];
          if (pair && pos.entryPrice) {
            const currentPrice = parseFloat(pair.priceUsd);
            if (currentPrice > 0 && pos.entryPrice > 0) {
              const ratio = currentPrice / pos.entryPrice;
              const factor = pos.partialExited ? 0.7 : 1.0;
              currentValue = pos.solSpent * ratio * factor;
              pnlPct = ((currentValue - pos.solSpent) / pos.solSpent) * 100;
            }
          }
        } catch {}
        allPositions.push({
          userId: uid, symbol: pos.symbol, mint, solSpent: pos.solSpent,
          currentValue, pnlPct, score: pos.score, entryTime: pos.entryTime
        });
        totalAum += currentValue;
      }
    }

    // Health checks
    let bagsOk = false, rpcOk = false;
    try {
      const r = await fetch('https://public-api-v2.bags.fm/api/v1/token-launch/feed', {
        headers: { 'x-api-key': process.env.BAGS_API_KEY }
      });
      bagsOk = r.ok;
    } catch {}
    try {
      const slot = await conn.getSlot();
      rpcOk = slot > 0;
    } catch {}

    res.json({
      success: true,
      data: {
        totalUsers: userIds.length,
        activeBots,
        totalOpenPositions,
        totalTrades: trades.length,
        platformPnl: totalPnl,
        winRate,
        estFeeRevenue,
        totalAum,
        health: { bags: bagsOk, rpc: rpcOk, agent: true },
        users,
        positions: allPositions,
        recentTrades: trades.slice(-20).reverse()
      }
    });
  } catch (err) {
    console.error('[Admin] Overview error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/admin/toggle-user — pause/resume a user's bot
router.post('/toggle-user', auth.requireAuth, requireAdmin, (req, res) => {
  const { userId, active } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const settingsFile = path.join(DATA_DIR, 'settings.json');
  const all = load(settingsFile, {});
  if (!all[userId]) all[userId] = {};
  all[userId].active = !!active;
  save(settingsFile, all);

  console.log(`[Admin] ${active ? 'Resumed' : 'Paused'} bot for ${userId}`);
  res.json({ success: true, userId, active: !!active });
});

// POST /api/admin/force-sell — sell a user's position
router.post('/force-sell', auth.requireAuth, requireAdmin, async (req, res) => {
  const { userId, mint } = req.body;
  if (!userId || !mint) return res.status(400).json({ error: 'userId and mint required' });

  const positions = POSITIONS();
  const pos = positions[userId]?.[mint];
  if (!pos) return res.status(404).json({ error: 'Position not found' });

  try {
    const { executeSwap } = require('../bot/agent');
    const SOL_MINT = 'So11111111111111111111111111111111111111112';
    const result = await executeSwap(userId, mint, SOL_MINT, Number(pos.tokensReceived), 100);
    const pnlSol = parseFloat(result.outAmount) / LAMPORTS_PER_SOL - pos.solSpent;

    delete positions[userId][mint];
    save(path.join(DATA_DIR, 'positions.json'), positions);

    const trades = TRADES();
    trades.push({
      userId, type: 'SELL', symbol: pos.symbol, mint,
      reason: 'admin_force_sell', pnlSol,
      solAmount: pos.solSpent, signature: result.signature,
      explanation: 'Force-sold by admin.',
      timestamp: new Date().toISOString()
    });
    save(path.join(DATA_DIR, 'trades.json'), trades);

    console.log(`[Admin] Force sold $${pos.symbol} for ${userId} — P&L: ${pnlSol.toFixed(4)} SOL`);
    res.json({ success: true, pnlSol, signature: result.signature });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
