/**
 * AUTOBAGS — Backtesting Engine
 * Replays historical trade data through scoring pipeline
 * Tests strategy params before deploying real money
 */

const fs = require('fs');
const path = require('path');

const TRADES_FILE = path.join(__dirname, '../../data/trades.json');
const BACKTEST_FILE = path.join(__dirname, '../../data/backtest-results.json');

function load(f, def) {
  try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : def; }
  catch { return def; }
}
function save(f, d) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

/**
 * Run a backtest with given parameters against historical trades
 * @param {object} params - { stopLossPct, takeProfitPct, partialExitPct, trailingStopPct, minScore, maxHoldMinutes }
 * @param {object} options - { startDate, endDate }
 */
function runBacktest(params, options = {}) {
  const trades = load(TRADES_FILE, []);
  
  // Group trades into round-trips (buy → sell pairs)
  const roundTrips = [];
  const openPositions = {};
  
  for (const t of trades) {
    if (t.type === 'BUY') {
      openPositions[t.mint] = { ...t, entryTime: new Date(t.timestamp) };
    }
    if ((t.type === 'SELL' || t.type === 'PARTIAL_SELL') && openPositions[t.mint]) {
      const buy = openPositions[t.mint];
      roundTrips.push({
        symbol: t.symbol || buy.symbol,
        mint: t.mint,
        entryTime: buy.timestamp,
        exitTime: t.timestamp,
        entryScore: buy.score || 0,
        solSpent: buy.solAmount || 0,
        solReceived: t.solReceived || t.solAmount || 0,
        pnlSol: t.pnlSol || 0,
        pnlPct: t.pricePct || t.pnlPct || 0,
        exitReason: t.reason || 'unknown',
        holdMinutes: (new Date(t.timestamp) - new Date(buy.timestamp)) / 60000,
      });
      if (t.type === 'SELL') delete openPositions[t.mint];
    }
  }
  
  if (roundTrips.length < 3) {
    return { error: 'Not enough round-trip trades for backtest', trades: roundTrips.length };
  }
  
  // Simulate with different params
  let balance = 1.0; // normalized to 1 SOL
  const equity = [{ time: roundTrips[0]?.entryTime, value: balance }];
  let wins = 0, losses = 0;
  let maxDrawdown = 0, peak = balance;
  const results = [];
  
  for (const rt of roundTrips) {
    // Would we have taken this trade with the new params?
    if (params.minScore && rt.entryScore < params.minScore) continue;
    
    // Simulate position size
    const posSize = (params.maxSolPerTrade || 35) / 100;
    const solIn = balance * posSize;
    
    // Simulate exit based on params
    let pnlPct = rt.pnlPct;
    
    // Apply stop loss
    if (pnlPct < 0 && Math.abs(pnlPct) > (params.stopLossPct || 3)) {
      pnlPct = -(params.stopLossPct || 3);
    }
    // Apply take profit
    if (pnlPct > 0 && pnlPct > (params.takeProfitPct || 8)) {
      pnlPct = params.takeProfitPct || 8;
    }
    
    const pnlSol = solIn * (pnlPct / 100);
    balance += pnlSol;
    
    if (pnlSol > 0) wins++;
    else losses++;
    
    if (balance > peak) peak = balance;
    const dd = (peak - balance) / peak;
    if (dd > maxDrawdown) maxDrawdown = dd;
    
    equity.push({ time: rt.exitTime, value: parseFloat(balance.toFixed(6)) });
    results.push({
      symbol: rt.symbol,
      pnlPct: parseFloat(pnlPct.toFixed(2)),
      pnlSol: parseFloat(pnlSol.toFixed(6)),
      balance: parseFloat(balance.toFixed(6)),
    });
  }
  
  const totalTrades = wins + losses;
  const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;
  const totalReturn = ((balance - 1) / 1 * 100);
  const avgWin = wins > 0 ? results.filter(r => r.pnlSol > 0).reduce((s, r) => s + r.pnlPct, 0) / wins : 0;
  const avgLoss = losses > 0 ? results.filter(r => r.pnlSol < 0).reduce((s, r) => s + r.pnlPct, 0) / losses : 0;
  const profitFactor = avgLoss !== 0 ? Math.abs(avgWin * wins / (avgLoss * losses)) : 0;
  
  const report = {
    params,
    totalTrades,
    wins,
    losses,
    winRate: parseFloat(winRate.toFixed(1)),
    totalReturn: parseFloat(totalReturn.toFixed(2)),
    finalBalance: parseFloat(balance.toFixed(6)),
    maxDrawdown: parseFloat((maxDrawdown * 100).toFixed(2)),
    avgWin: parseFloat(avgWin.toFixed(2)),
    avgLoss: parseFloat(avgLoss.toFixed(2)),
    profitFactor: parseFloat(profitFactor.toFixed(2)),
    equity,
    trades: results,
    timestamp: new Date().toISOString(),
  };
  
  // Save results
  const allResults = load(BACKTEST_FILE, []);
  allResults.push(report);
  if (allResults.length > 20) allResults.splice(0, allResults.length - 20);
  save(BACKTEST_FILE, allResults);
  
  return report;
}

/**
 * Compare multiple parameter sets
 */
function compareStrategies(paramSets) {
  return paramSets.map(params => {
    const result = runBacktest(params);
    return {
      params,
      winRate: result.winRate,
      totalReturn: result.totalReturn,
      maxDrawdown: result.maxDrawdown,
      profitFactor: result.profitFactor,
      trades: result.totalTrades,
    };
  }).sort((a, b) => b.totalReturn - a.totalReturn);
}

/**
 * Auto-optimize parameters using grid search
 */
function optimize() {
  const paramGrid = [];
  for (const sl of [2, 3, 4, 5]) {
    for (const tp of [5, 8, 10, 15]) {
      for (const minScore of [60, 70, 75, 80]) {
        paramGrid.push({ stopLossPct: sl, takeProfitPct: tp, minScore, maxSolPerTrade: 35 });
      }
    }
  }
  
  const results = compareStrategies(paramGrid);
  console.log(`[Backtest] Optimized across ${paramGrid.length} param sets`);
  console.log(`[Backtest] Best: SL=${results[0].params.stopLossPct}% TP=${results[0].params.takeProfitPct}% score>=${results[0].params.minScore} → ${results[0].totalReturn}% return`);
  
  return results;
}

module.exports = { runBacktest, compareStrategies, optimize };
