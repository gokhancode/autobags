/**
 * AUTOBAGS — Dynamic SL/TP Adjustment
 * Adapts stop-loss and take-profit based on:
 * - Market volatility regime
 * - Token-specific volatility
 * - Recent trade performance
 * - Time of day / session
 */

const fs = require('fs');
const path = require('path');

const TRADES_FILE = path.join(__dirname, '../../data/trades.json');
const QUANT_FILE = path.join(__dirname, '../../data/quant-brain.json');

function load(f, def) {
  try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : def; }
  catch { return def; }
}

/**
 * Get market session
 */
function getSession() {
  const hour = new Date().getUTCHours();
  if (hour >= 0 && hour < 8) return 'asia';
  if (hour >= 7 && hour < 15) return 'europe';
  if (hour >= 13 && hour < 22) return 'us';
  return 'off';
}

/**
 * Calculate token-specific volatility from DexScreener data
 */
function getTokenVolatility(dexData) {
  if (!dexData) return 'medium';
  
  const m5 = Math.abs(parseFloat(dexData.priceChange?.m5) || 0);
  const h1 = Math.abs(parseFloat(dexData.priceChange?.h1) || 0);
  const h6 = Math.abs(parseFloat(dexData.priceChange?.h6) || 0);
  
  const avgVol = (m5 * 3 + h1 + h6 / 6) / 5; // weighted towards short-term
  
  if (avgVol < 2) return 'low';
  if (avgVol < 5) return 'medium';
  if (avgVol < 12) return 'high';
  return 'extreme';
}

/**
 * Get recent performance stats (last 10 trades)
 */
function getRecentPerformance() {
  const trades = load(TRADES_FILE, []);
  const sells = trades.filter(t => t.type === 'SELL').slice(-10);
  if (sells.length < 3) return { streak: 0, avgPnl: 0, confidence: 'low' };
  
  let streak = 0;
  for (let i = sells.length - 1; i >= 0; i--) {
    if ((sells[i].pnlSol || 0) > 0) streak++;
    else if ((sells[i].pnlSol || 0) < 0) streak--;
    else break;
  }
  
  const avgPnl = sells.reduce((s, t) => s + (t.pnlPct || t.pricePct || 0), 0) / sells.length;
  const confidence = streak > 2 ? 'high' : streak < -2 ? 'low' : 'medium';
  
  return { streak, avgPnl, confidence, trades: sells.length };
}

/**
 * Get quant brain regime
 */
function getQuantRegime() {
  const brain = load(QUANT_FILE, {});
  return brain?.regimes?.current || 'medium';
}

/**
 * Calculate dynamic parameters for a specific trade
 * 
 * @param {object} baseSettings - user's base settings (stopLossPct, takeProfitPct, etc.)
 * @param {object} dexData - DexScreener pair data for the token
 * @returns {object} adjusted parameters
 */
function getDynamicParams(baseSettings, dexData = null) {
  const session = getSession();
  const tokenVol = getTokenVolatility(dexData);
  const regime = getQuantRegime();
  const perf = getRecentPerformance();
  
  let sl = baseSettings.stopLossPct || 3;
  let tp = baseSettings.takeProfitPct || 8;
  let partial = baseSettings.partialExitPct || 4;
  let trailing = baseSettings.trailingStopPct || 2;
  let posSize = baseSettings.maxSolPerTrade || 35;
  let maxHold = baseSettings.maxHoldMinutes || 15;
  
  // ── Volatility adjustments ──
  // High vol = wider stops (avoid getting stopped out on noise)
  // Low vol = tighter stops (less movement expected)
  const volMultiplier = {
    low: { sl: 0.7, tp: 0.6, trailing: 0.7, size: 1.3, hold: 1.5 },
    medium: { sl: 1.0, tp: 1.0, trailing: 1.0, size: 1.0, hold: 1.0 },
    high: { sl: 1.4, tp: 1.5, trailing: 1.3, size: 0.7, hold: 0.7 },
    extreme: { sl: 2.0, tp: 2.0, trailing: 1.8, size: 0.4, hold: 0.5 },
  };
  
  const vol = volMultiplier[tokenVol] || volMultiplier.medium;
  sl *= vol.sl;
  tp *= vol.tp;
  trailing *= vol.trailing;
  posSize *= vol.size;
  maxHold *= vol.hold;
  
  // ── Session adjustments ──
  if (session === 'asia') {
    // Asia = meme pumps, wider TP, faster exits
    tp *= 1.3;
    maxHold *= 0.7;
  } else if (session === 'us') {
    // US = high volume, can hold longer
    maxHold *= 1.3;
    tp *= 1.1;
  } else if (session === 'off') {
    // Off-hours = low liquidity, tight everything
    sl *= 0.7;
    tp *= 0.6;
    posSize *= 0.5;
    maxHold *= 0.5;
  }
  
  // ── Regime adjustments (from quant brain) ──
  const regimeAdj = {
    low: { sl: 0.8, tp: 0.7, size: 1.2 },
    medium: { sl: 1.0, tp: 1.0, size: 1.0 },
    high: { sl: 1.3, tp: 1.4, size: 0.8 },
    extreme: { sl: 1.8, tp: 1.8, size: 0.5 },
  };
  const reg = regimeAdj[regime] || regimeAdj.medium;
  sl *= reg.sl;
  tp *= reg.tp;
  posSize *= reg.size;
  
  // ── Performance adjustments ──
  // On a losing streak: tighter stops, smaller size
  if (perf.streak <= -3) {
    sl *= 0.7;
    posSize *= 0.6;
    console.log(`[DynParams] Losing streak (${perf.streak}): tightening SL to ${sl.toFixed(1)}%, size to ${posSize.toFixed(0)}%`);
  }
  // On a winning streak: slightly wider targets
  if (perf.streak >= 3) {
    tp *= 1.2;
    console.log(`[DynParams] Winning streak (${perf.streak}): widening TP to ${tp.toFixed(1)}%`);
  }
  
  // ── Clamp to reasonable ranges ──
  sl = Math.max(1.5, Math.min(10, sl));
  tp = Math.max(3, Math.min(25, tp));
  partial = Math.max(2, Math.min(15, partial));
  trailing = Math.max(1, Math.min(5, trailing));
  posSize = Math.max(10, Math.min(50, posSize));
  maxHold = Math.max(5, Math.min(60, maxHold));
  
  const params = {
    stopLossPct: parseFloat(sl.toFixed(1)),
    takeProfitPct: parseFloat(tp.toFixed(1)),
    partialExitPct: parseFloat(partial.toFixed(1)),
    trailingStopPct: parseFloat(trailing.toFixed(1)),
    maxSolPerTrade: parseFloat(posSize.toFixed(0)),
    maxHoldMinutes: parseFloat(maxHold.toFixed(0)),
    // Metadata
    _session: session,
    _tokenVol: tokenVol,
    _regime: regime,
    _perfStreak: perf.streak,
    _adjustments: `vol=${tokenVol} session=${session} regime=${regime} streak=${perf.streak}`,
  };
  
  console.log(`[DynParams] SL=${params.stopLossPct}% TP=${params.takeProfitPct}% size=${params.maxSolPerTrade}% hold=${params.maxHoldMinutes}min [${params._adjustments}]`);
  
  return params;
}

module.exports = { getDynamicParams, getTokenVolatility, getSession, getRecentPerformance };
