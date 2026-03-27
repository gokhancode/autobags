#!/usr/bin/env node
/**
 * AUTOBAGS — Sim Auto-Tuner
 * Runs every 30min via cron. Analyzes performance, adjusts strategy, learns.
 * Self-improving trading loop.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../config/.env') });
const fs   = require('fs');
const path = require('path');

const SIM_FILE    = path.join(__dirname, '../../data/sim-state.json');
const TRADES_FILE = path.join(__dirname, '../../data/sim-trades.json');
const LEARN_FILE  = path.join(__dirname, '../../data/sim-learnings.json');
const LOG_FILE    = path.join(__dirname, '../../data/sim-tuner-log.json');

function load(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function save(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

function loadLearnings() { return load(LEARN_FILE) || { adjustments: [], patterns: {}, version: 0 }; }

async function run() {
  const state = load(SIM_FILE);
  const trades = load(TRADES_FILE) || [];
  
  if (!state) {
    console.log('[TUNER] No sim state found');
    return;
  }

  const learnings = loadLearnings();
  const now = Date.now();
  const runMinutes = (now - new Date(state.startedAt).getTime()) / 60000;

  // ── Analyze recent performance ──────────────────────────────────────
  
  // Last 30min of trades
  const cutoff = new Date(now - 30 * 60000).toISOString();
  const recentTrades = trades.filter(t => t.timestamp > cutoff);
  const recentSells = recentTrades.filter(t => t.type === 'SELL');
  const recentWins = recentSells.filter(t => parseFloat(t.pnlUsd) > 0);
  const recentLosses = recentSells.filter(t => parseFloat(t.pnlUsd) <= 0);
  
  // All-time stats
  const allSells = trades.filter(t => t.type === 'SELL');
  const totalWins = allSells.filter(t => parseFloat(t.pnlUsd) > 0);
  const totalLosses = allSells.filter(t => parseFloat(t.pnlUsd) <= 0);
  const winRate = allSells.length > 0 ? (totalWins.length / allSells.length) * 100 : 0;
  
  // Average win/loss size
  const avgWin = totalWins.length > 0 
    ? totalWins.reduce((s, t) => s + parseFloat(t.pnlUsd), 0) / totalWins.length : 0;
  const avgLoss = totalLosses.length > 0 
    ? totalLosses.reduce((s, t) => s + Math.abs(parseFloat(t.pnlUsd)), 0) / totalLosses.length : 0;
  
  // Profit factor
  const grossWin = totalWins.reduce((s, t) => s + parseFloat(t.pnlUsd), 0);
  const grossLoss = Math.abs(totalLosses.reduce((s, t) => s + parseFloat(t.pnlUsd), 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 999 : 0;

  // Analyze loss reasons
  const stopLossCount = allSells.filter(t => t.reason?.includes('Stop loss')).length;
  const staleCount = allSells.filter(t => t.reason?.includes('Stale')).length;
  const trailingCount = allSells.filter(t => t.reason?.includes('Trailing')).length;
  const tpCount = allSells.filter(t => t.reason?.includes('Take profit')).length;

  // Average hold time for wins vs losses
  const avgWinHold = totalWins.length > 0
    ? totalWins.reduce((s, t) => s + parseInt(t.holdTime || '0'), 0) / totalWins.length : 0;
  const avgLossHold = totalLosses.length > 0
    ? totalLosses.reduce((s, t) => s + parseInt(t.holdTime || '0'), 0) / totalLosses.length : 0;

  // Score analysis — what scores produce winners?
  const scoreWins = {};
  const scoreLosses = {};
  for (const t of allSells) {
    const buy = trades.find(b => b.type === 'BUY' && b.mint === t.mint && b.timestamp < t.timestamp);
    const score = buy?.score || 0;
    const bucket = Math.floor(score / 10) * 10; // 50s, 60s, 70s, etc
    if (parseFloat(t.pnlUsd) > 0) scoreWins[bucket] = (scoreWins[bucket] || 0) + 1;
    else scoreLosses[bucket] = (scoreLosses[bucket] || 0) + 1;
  }

  // ── Decision engine ─────────────────────────────────────────────────

  const adjustments = [];
  const oldParams = { ...state };

  // 1. Stop loss too tight? (>70% of losses are stop losses, avg loss < 2%)
  if (stopLossCount > totalLosses.length * 0.7 && avgLoss < state.maxPositionUsd * 0.02 && totalLosses.length > 3) {
    state.stopLossPct = Math.min(state.stopLossPct + 0.5, 6);
    adjustments.push(`Loosened SL ${oldParams.stopLossPct}% → ${state.stopLossPct}% (too many small stop-outs)`);
  }
  // Stop loss too loose? (avg loss > 4% of position)
  if (avgLoss > state.maxPositionUsd * 0.04 && totalLosses.length > 3) {
    state.stopLossPct = Math.max(state.stopLossPct - 0.5, 2);
    adjustments.push(`Tightened SL ${oldParams.stopLossPct}% → ${state.stopLossPct}% (losses too big)`);
  }

  // 2. Win rate below 50%? Raise score threshold
  if (winRate < 50 && allSells.length > 5) {
    state.minScore = Math.min(state.minScore + 5, 85);
    adjustments.push(`Raised min score ${oldParams.minScore} → ${state.minScore} (win rate ${winRate.toFixed(0)}% too low)`);
  }
  // Win rate above 65%? Can be more aggressive
  if (winRate > 65 && allSells.length > 5) {
    state.minScore = Math.max(state.minScore - 5, 45);
    adjustments.push(`Lowered min score ${oldParams.minScore} → ${state.minScore} (win rate ${winRate.toFixed(0)}% strong)`);
  }

  // 3. Profit factor below 1? (losing money) — tighten everything
  if (profitFactor < 1 && allSells.length > 5) {
    state.maxPositionUsd = Math.max(state.maxPositionUsd - 25, 100);
    state.minMomentum5m = Math.min((state.minMomentum5m || 3) + 1, 8);
    adjustments.push(`Reduced position size → $${state.maxPositionUsd} and raised momentum filter → ${state.minMomentum5m}% (profit factor ${profitFactor.toFixed(2)} < 1)`);
  }
  // Profit factor above 2? Scale up
  if (profitFactor > 2 && allSells.length > 8) {
    state.maxPositionUsd = Math.min(state.maxPositionUsd + 25, 400);
    adjustments.push(`Increased position size → $${state.maxPositionUsd} (profit factor ${profitFactor.toFixed(2)} strong)`);
  }

  // 4. Too many stale exits? Lower hold time or raise momentum requirement
  if (staleCount > allSells.length * 0.3 && allSells.length > 5) {
    state.maxHoldMinutes = Math.max((state.maxHoldMinutes || 15) - 2, 5);
    state.minMomentum5m = Math.min((state.minMomentum5m || 3) + 0.5, 8);
    adjustments.push(`Reduced max hold → ${state.maxHoldMinutes}min, raised momentum → ${state.minMomentum5m}% (too many stale exits: ${staleCount})`);
  }

  // 5. Take profits too rare? Lower TP target
  if (tpCount < allSells.length * 0.15 && allSells.length > 8) {
    state.takeProfitPct = Math.max(state.takeProfitPct - 1, 5);
    adjustments.push(`Lowered TP ${oldParams.takeProfitPct}% → ${state.takeProfitPct}% (only ${tpCount} TPs in ${allSells.length} sells)`);
  }

  // 6. Trailing stops catching winners too early?
  if (trailingCount > tpCount * 2 && trailingCount > 3) {
    state.trailingStopPct = Math.min((state.trailingStopPct || 2) + 0.5, 5);
    adjustments.push(`Loosened trailing stop → ${state.trailingStopPct}% (trailing exits ${trailingCount} >> TPs ${tpCount})`);
  }

  // 7. Best performing score bucket → note it
  let bestBucket = null;
  let bestWinRate = 0;
  for (const [bucket, wins] of Object.entries(scoreWins)) {
    const losses = scoreLosses[bucket] || 0;
    const wr = wins / (wins + losses);
    if (wr > bestWinRate && (wins + losses) >= 3) {
      bestWinRate = wr;
      bestBucket = bucket;
    }
  }

  // ── Save adjustments ───────────────────────────────────────────────

  if (adjustments.length > 0) {
    save(SIM_FILE, state);
    console.log(`[TUNER] Made ${adjustments.length} adjustments:`);
    adjustments.forEach(a => console.log(`  → ${a}`));
  } else {
    console.log('[TUNER] No adjustments needed — params look good');
  }

  // ── Log everything ─────────────────────────────────────────────────

  const report = {
    timestamp: new Date().toISOString(),
    runMinutes: Math.round(runMinutes),
    balance: parseFloat(state.balanceUsd || state.balanceUsd),
    pnlUsd: parseFloat(state.totalPnlUsd),
    totalTrades: state.totalTrades,
    recentTrades: recentTrades.length,
    recentSells: recentSells.length,
    winRate: parseFloat(winRate.toFixed(1)),
    profitFactor: parseFloat(profitFactor.toFixed(2)),
    avgWin: parseFloat(avgWin.toFixed(2)),
    avgLoss: parseFloat(avgLoss.toFixed(2)),
    avgWinHoldMin: Math.round(avgWinHold),
    avgLossHoldMin: Math.round(avgLossHold),
    exitBreakdown: { stopLoss: stopLossCount, stale: staleCount, trailing: trailingCount, takeProfit: tpCount },
    bestScoreBucket: bestBucket ? `${bestBucket}s (${(bestWinRate*100).toFixed(0)}% WR)` : 'N/A',
    adjustments,
    currentParams: {
      stopLossPct: state.stopLossPct,
      takeProfitPct: state.takeProfitPct,
      partialExitPct: state.partialExitPct,
      trailingStopPct: state.trailingStopPct,
      maxPositionUsd: state.maxPositionUsd,
      maxHoldMinutes: state.maxHoldMinutes,
      minScore: state.minScore,
      minMomentum5m: state.minMomentum5m,
      cooldownMs: state.cooldownMs
    }
  };

  // Append to log
  const log = load(LOG_FILE) || [];
  log.push(report);
  save(LOG_FILE, log);

  // Update learnings
  learnings.version++;
  learnings.adjustments.push({ time: report.timestamp, changes: adjustments, winRate, profitFactor });
  if (bestBucket) learnings.patterns.bestScoreBucket = bestBucket;
  learnings.patterns.avgWinHoldMin = Math.round(avgWinHold);
  learnings.patterns.avgLossHoldMin = Math.round(avgLossHold);
  learnings.patterns.lastProfitFactor = profitFactor;
  learnings.patterns.lastWinRate = winRate;
  save(LEARN_FILE, learnings);

  // ── Summary ────────────────────────────────────────────────────────

  console.log(`[TUNER] === Report ===`);
  console.log(`  Balance: $${state.balanceUsd} | PnL: $${state.totalPnlUsd} | Trades: ${state.totalTrades}`);
  console.log(`  Win Rate: ${winRate.toFixed(1)}% | Profit Factor: ${profitFactor.toFixed(2)}`);
  console.log(`  Avg Win: $${avgWin.toFixed(2)} (${Math.round(avgWinHold)}min) | Avg Loss: $${avgLoss.toFixed(2)} (${Math.round(avgLossHold)}min)`);
  console.log(`  Exits: SL=${stopLossCount} Stale=${staleCount} Trail=${trailingCount} TP=${tpCount}`);
  console.log(`  Best score bucket: ${bestBucket || 'N/A'}`);
  if (adjustments.length) console.log(`  Adjustments: ${adjustments.length}`);
  console.log(`[TUNER] === End ===`);
}

run().catch(e => console.error('[TUNER] Error:', e.message));
