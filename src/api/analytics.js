/**
 * AUTOBAGS — Analytics API
 * Heatmap, per-token breakdown, performance metrics
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const TRADES_FILE = path.join(__dirname, '../../data/trades.json');

function load(f, def) {
  try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : def; }
  catch { return def; }
}

// GET /api/analytics/heatmap/:userId — time of day vs profitability
router.get('/heatmap/:userId', (req, res) => {
  const trades = load(TRADES_FILE, []).filter(t => t.userId === req.params.userId && t.type === 'SELL');
  
  // 24 hours x 7 days grid
  const heatmap = Array(7).fill(null).map(() => Array(24).fill(null).map(() => ({ trades: 0, pnl: 0, wins: 0 })));
  
  trades.forEach(t => {
    const d = new Date(t.timestamp);
    const day = d.getUTCDay(); // 0=Sun, 6=Sat
    const hour = d.getUTCHours();
    heatmap[day][hour].trades++;
    heatmap[day][hour].pnl += (t.pnlSol || 0);
    if ((t.pnlSol || 0) > 0) heatmap[day][hour].wins++;
  });
  
  // Convert to flat array for frontend
  const data = [];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const cell = heatmap[d][h];
      if (cell.trades > 0) {
        data.push({
          day: days[d],
          hour: h,
          trades: cell.trades,
          pnl: parseFloat(cell.pnl.toFixed(6)),
          winRate: cell.trades > 0 ? Math.round(cell.wins / cell.trades * 100) : 0,
        });
      }
    }
  }
  
  res.json({ success: true, heatmap: data });
});

// GET /api/analytics/tokens/:userId — per-token performance breakdown
router.get('/tokens/:userId', (req, res) => {
  const trades = load(TRADES_FILE, []).filter(t => t.userId === req.params.userId);
  
  const tokenStats = {};
  trades.forEach(t => {
    const key = t.symbol || t.mint?.slice(0, 8) || 'unknown';
    if (!tokenStats[key]) {
      tokenStats[key] = { symbol: key, mint: t.mint, buys: 0, sells: 0, totalPnl: 0, totalSpent: 0, wins: 0, trades: [] };
    }
    if (t.type === 'BUY') {
      tokenStats[key].buys++;
      tokenStats[key].totalSpent += (t.solAmount || 0);
    }
    if (t.type === 'SELL') {
      tokenStats[key].sells++;
      tokenStats[key].totalPnl += (t.pnlSol || 0);
      if ((t.pnlSol || 0) > 0) tokenStats[key].wins++;
    }
    tokenStats[key].trades.push({
      type: t.type,
      amount: t.solAmount || t.solReceived || 0,
      pnl: t.pnlSol || 0,
      time: t.timestamp,
    });
  });
  
  const tokens = Object.values(tokenStats).sort((a, b) => b.totalPnl - a.totalPnl);
  
  res.json({ 
    success: true, 
    tokens: tokens.map(t => ({
      ...t,
      winRate: t.sells > 0 ? Math.round(t.wins / t.sells * 100) : 0,
      avgPnl: t.sells > 0 ? parseFloat((t.totalPnl / t.sells).toFixed(6)) : 0,
      trades: undefined, // don't send full trade list in summary
    })),
  });
});

// GET /api/analytics/summary/:userId — overall performance metrics
router.get('/summary/:userId', (req, res) => {
  const trades = load(TRADES_FILE, []).filter(t => t.userId === req.params.userId);
  const sells = trades.filter(t => t.type === 'SELL');
  
  const wins = sells.filter(t => (t.pnlSol || 0) > 0);
  const losses = sells.filter(t => (t.pnlSol || 0) < 0);
  
  const totalPnl = sells.reduce((s, t) => s + (t.pnlSol || 0), 0);
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlSol, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + t.pnlSol, 0) / losses.length : 0;
  const profitFactor = avgLoss !== 0 ? Math.abs(avgWin * wins.length / (avgLoss * losses.length)) : 0;
  
  // Max drawdown
  let peak = 0, maxDD = 0, runningPnl = 0;
  sells.forEach(t => {
    runningPnl += (t.pnlSol || 0);
    if (runningPnl > peak) peak = runningPnl;
    const dd = peak - runningPnl;
    if (dd > maxDD) maxDD = dd;
  });
  
  // Win streak / lose streak
  let maxWinStreak = 0, maxLoseStreak = 0, curStreak = 0;
  sells.forEach(t => {
    if ((t.pnlSol || 0) > 0) {
      curStreak = curStreak > 0 ? curStreak + 1 : 1;
      maxWinStreak = Math.max(maxWinStreak, curStreak);
    } else {
      curStreak = curStreak < 0 ? curStreak - 1 : -1;
      maxLoseStreak = Math.max(maxLoseStreak, Math.abs(curStreak));
    }
  });
  
  // Average hold time
  const holdTimes = [];
  const buys = {};
  trades.forEach(t => {
    if (t.type === 'BUY') buys[t.mint] = t.timestamp;
    if (t.type === 'SELL' && buys[t.mint]) {
      holdTimes.push(new Date(t.timestamp) - new Date(buys[t.mint]));
      delete buys[t.mint];
    }
  });
  const avgHoldMin = holdTimes.length > 0 ? holdTimes.reduce((s, h) => s + h, 0) / holdTimes.length / 60000 : 0;
  
  res.json({
    success: true,
    totalTrades: sells.length,
    wins: wins.length,
    losses: losses.length,
    winRate: sells.length > 0 ? Math.round(wins.length / sells.length * 100) : 0,
    totalPnl: parseFloat(totalPnl.toFixed(6)),
    avgWin: parseFloat(avgWin.toFixed(6)),
    avgLoss: parseFloat(avgLoss.toFixed(6)),
    profitFactor: parseFloat(profitFactor.toFixed(2)),
    maxDrawdown: parseFloat(maxDD.toFixed(6)),
    maxWinStreak,
    maxLoseStreak,
    avgHoldMinutes: Math.round(avgHoldMin),
  });
});

module.exports = router;
