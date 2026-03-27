/**
 * AUTOBAGS — Quant Engine
 * 
 * Statistical edge detection. Not vibes — math.
 * 
 * Features:
 * - Bayesian signal weighting (learns which signals predict winners)
 * - Kelly criterion position sizing (bet proportional to edge)
 * - Volatility regime detection (different strategy per regime)
 * - Cross-token correlation tracking
 * - Order flow imbalance analysis
 * - Feature importance ranking (what actually matters?)
 * - Rolling Sharpe ratio per strategy
 * - Drawdown-adjusted returns
 */

const fs   = require('fs');
const path = require('path');

const QUANT_FILE  = path.join(__dirname, '../../data/quant-brain.json');
const SIGNAL_FILE = path.join(__dirname, '../../data/quant-signals.json');

function load(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function save(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

// ── Brain State ──────────────────────────────────────────────────────────

function initBrain() {
  return {
    version: 1,
    createdAt: new Date().toISOString(),

    // Bayesian signal weights — start uniform, update with every trade
    // Each signal has: { weight, wins, losses, avgPnlWhenTrue, avgPnlWhenFalse }
    signals: {
      momentum5m_strong:   { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: '5m price change > 5%' },
      momentum5m_mild:     { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: '5m price change 2-5%' },
      momentum1h_strong:   { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: '1h price change > 10%' },
      volume_spike:        { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: '1h vol > 3x avg hourly' },
      volume_declining:    { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: '1h vol < 0.5x avg hourly' },
      buy_pressure_high:   { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: 'Buy/sell ratio > 1.5' },
      buy_pressure_extreme:{ weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: 'Buy/sell ratio > 3.0' },
      sell_pressure:       { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: 'Sell/buy ratio > 1.5' },
      liq_healthy:         { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: 'Liquidity > $20k' },
      liq_thin:            { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: 'Liquidity < $5k' },
      mcap_micro:          { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: 'Market cap < $100k' },
      mcap_small:          { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: 'Market cap $100k-$1M' },
      mcap_mid:            { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: 'Market cap > $1M' },
      age_fresh:           { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: 'Pair age < 1 hour' },
      age_established:     { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: 'Pair age > 24 hours' },
      dip_bounce:          { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: 'Down 1h but up 5m (reversal)' },
      overextended:        { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: '5m > 15% (too hot)' },
      vol_liq_ratio_safe:  { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: 'Vol/Liq ratio < 5 (healthy)' },
      vol_liq_ratio_danger:{ weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: 'Vol/Liq ratio > 10 (rug risk)' },
      session_asia:        { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: 'Entered during Asia session' },
      session_europe:      { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: 'Entered during EU session' },
      session_us:          { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: 'Entered during US session' },
      h6_trend_up:         { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: '6h trend positive' },
      h6_trend_down:       { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: '6h trend negative' },
      txn_count_high:      { weight: 1.0, wins: 0, losses: 0, totalPnl: 0, occurrences: 0, desc: '1h transactions > 100' },
    },

    // Volatility regime tracking
    regimes: {
      current: 'unknown', // low, medium, high, extreme
      history: [],        // last 48 readings
      avgVol: 0,
    },

    // Cross-token correlation matrix (top 10 tokens)
    correlations: {},

    // Performance tracking for Kelly criterion
    kelly: {
      winRate: 0.5,
      avgWin: 0,
      avgLoss: 0,
      kellyFraction: 0,
      optimalBetPct: 10,
    },

    // Rolling metrics
    sharpeRatio: 0,
    returns: [],       // last 200 trade returns
    totalTrades: 0,
  };
}

function loadBrain() {
  return load(QUANT_FILE) || initBrain();
}

function saveBrain(brain) {
  save(QUANT_FILE, brain);
}

// ── Signal Detection ─────────────────────────────────────────────────────

function detectSignals(tokenData) {
  const d = tokenData;
  const signals = [];
  const hour = new Date().getUTCHours();

  // Momentum
  if (d.m5 > 5)                        signals.push('momentum5m_strong');
  else if (d.m5 > 2)                   signals.push('momentum5m_mild');
  if (d.h1 > 10)                       signals.push('momentum1h_strong');
  if (d.m5 > 15)                       signals.push('overextended');

  // Volume
  const avgHourlyVol = d.vol24 / 24;
  if (d.vol1h > avgHourlyVol * 3)      signals.push('volume_spike');
  if (d.vol1h < avgHourlyVol * 0.5)    signals.push('volume_declining');

  // Order flow
  const buyRatio = d.buys1h / Math.max(d.sells1h, 1);
  const sellRatio = d.sells1h / Math.max(d.buys1h, 1);
  if (buyRatio > 3)                     signals.push('buy_pressure_extreme');
  else if (buyRatio > 1.5)             signals.push('buy_pressure_high');
  if (sellRatio > 1.5)                 signals.push('sell_pressure');

  // Liquidity
  if (d.liq > 20000)                   signals.push('liq_healthy');
  if (d.liq < 5000)                    signals.push('liq_thin');

  // Market cap
  if (d.mcap < 100000)                 signals.push('mcap_micro');
  else if (d.mcap < 1000000)           signals.push('mcap_small');
  else                                  signals.push('mcap_mid');

  // Age
  if (d.pairCreated) {
    const ageHours = (Date.now() - d.pairCreated) / 3600000;
    if (ageHours < 1)                   signals.push('age_fresh');
    if (ageHours > 24)                  signals.push('age_established');
  }

  // Patterns
  if (d.h1 < -5 && d.m5 > 2)          signals.push('dip_bounce');

  // Vol/Liq ratio
  const vlRatio = d.vol24 / Math.max(d.liq, 1);
  if (vlRatio < 5)                     signals.push('vol_liq_ratio_safe');
  if (vlRatio > 10)                    signals.push('vol_liq_ratio_danger');

  // Session
  if (hour >= 0 && hour < 8)           signals.push('session_asia');
  else if (hour >= 7 && hour < 15)     signals.push('session_europe');
  else if (hour >= 13 && hour < 22)    signals.push('session_us');

  // Trend
  if (d.h6 > 5)                        signals.push('h6_trend_up');
  if (d.h6 < -5)                       signals.push('h6_trend_down');

  // Transaction count
  if (d.buys1h + d.sells1h > 100)      signals.push('txn_count_high');

  return signals;
}

// ── Bayesian Score ───────────────────────────────────────────────────────

/**
 * Score a token using learned signal weights
 * Returns weighted score where high-performing signals count more
 */
function bayesianScore(tokenData) {
  const brain = loadBrain();
  const signals = detectSignals(tokenData);
  
  let totalWeight = 0;
  let positiveWeight = 0;
  let negativeWeight = 0;
  const activeSignals = [];

  for (const sig of signals) {
    const s = brain.signals[sig];
    if (!s) continue;

    activeSignals.push({ signal: sig, weight: s.weight, desc: s.desc });

    // Negative signals subtract
    const isNegative = ['overextended', 'sell_pressure', 'liq_thin', 'vol_liq_ratio_danger', 'volume_declining', 'h6_trend_down'].includes(sig);
    
    if (isNegative) {
      negativeWeight += s.weight;
    } else {
      positiveWeight += s.weight;
    }
    totalWeight += Math.abs(s.weight);
  }

  // Normalize to 0-100
  const rawScore = totalWeight > 0 ? ((positiveWeight - negativeWeight) / totalWeight) * 100 : 0;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  return { score, signals, activeSignals };
}

// ── Bayesian Update ──────────────────────────────────────────────────────

/**
 * After a trade closes, update all signal weights based on outcome
 * Winning signals get stronger, losing signals get weaker
 */
function updateSignals(signals, pnlPct, won) {
  const brain = loadBrain();
  const LEARNING_RATE = 0.1; // how fast we adjust (0.1 = 10% per trade)

  for (const sig of signals) {
    const s = brain.signals[sig];
    if (!s) continue;

    s.occurrences++;
    s.totalPnl += pnlPct;

    if (won) {
      s.wins++;
      // Increase weight — this signal predicted a winner
      s.weight = Math.min(3.0, s.weight + LEARNING_RATE * (1 + Math.abs(pnlPct) / 10));
    } else {
      s.losses++;
      // Decrease weight — this signal led to a loser
      s.weight = Math.max(0.1, s.weight - LEARNING_RATE * (1 + Math.abs(pnlPct) / 10));
    }
  }

  brain.totalTrades++;
  saveBrain(brain);
}

// ── Kelly Criterion ──────────────────────────────────────────────────────

/**
 * Calculate optimal position size using Kelly criterion
 * f* = (bp - q) / b
 * where b = avg win / avg loss, p = win probability, q = loss probability
 * 
 * We use half-Kelly for safety (full Kelly is too aggressive)
 */
function kellyPositionSize(balanceUsd) {
  const brain = loadBrain();
  const k = brain.kelly;
  
  if (brain.totalTrades < 10) {
    // Not enough data — use conservative 15%
    return Math.min(balanceUsd * 0.15, 200);
  }

  const b = k.avgLoss > 0 ? k.avgWin / k.avgLoss : 1;
  const p = k.winRate;
  const q = 1 - p;

  let kellyFraction = (b * p - q) / b;
  
  // Cap at 25%, floor at 5%
  kellyFraction = Math.max(0.05, Math.min(0.25, kellyFraction));
  
  // Half-Kelly for safety
  const halfKelly = kellyFraction / 2;
  
  brain.kelly.kellyFraction = kellyFraction;
  brain.kelly.optimalBetPct = Math.round(halfKelly * 100);
  saveBrain(brain);

  return Math.max(10, balanceUsd * halfKelly);
}

/**
 * Update Kelly parameters after a trade
 */
function updateKelly(pnlPct, won) {
  const brain = loadBrain();
  
  brain.returns.push(pnlPct);
  if (brain.returns.length > 200) brain.returns.shift();

  const wins = brain.returns.filter(r => r > 0);
  const losses = brain.returns.filter(r => r <= 0);
  
  brain.kelly.winRate = brain.returns.length > 0 ? wins.length / brain.returns.length : 0.5;
  brain.kelly.avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  brain.kelly.avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 1;

  // Sharpe ratio (annualized, assuming 15s ticks)
  if (brain.returns.length > 10) {
    const mean = brain.returns.reduce((a, b) => a + b, 0) / brain.returns.length;
    const variance = brain.returns.reduce((s, r) => s + (r - mean) ** 2, 0) / brain.returns.length;
    const stddev = Math.sqrt(variance);
    brain.sharpeRatio = stddev > 0 ? (mean / stddev) * Math.sqrt(365 * 24 * 4) : 0; // ~4 trades/hour
  }

  saveBrain(brain);
}

// ── Volatility Regime Detection ──────────────────────────────────────────

/**
 * Detect current market volatility regime
 * Affects position sizing and strategy selection
 */
async function detectRegime() {
  const brain = loadBrain();

  try {
    // Sample 10 top tokens' 5m changes
    const res = await fetch('https://api.dexscreener.com/token-boosts/top/v1');
    const data = await res.json();
    const solTokens = (data || []).filter(t => t.chainId === 'solana').slice(0, 10);
    
    const changes = [];
    for (const t of solTokens) {
      try {
        const tRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${t.tokenAddress}`);
        const tData = await tRes.json();
        const pair = tData?.pairs?.find(p => p.chainId === 'solana');
        if (pair?.priceChange?.m5) changes.push(Math.abs(parseFloat(pair.priceChange.m5)));
      } catch {}
    }

    if (changes.length < 3) return brain.regimes.current;

    const avgVol = changes.reduce((a, b) => a + b, 0) / changes.length;
    
    let regime;
    if (avgVol < 1)      regime = 'low';
    else if (avgVol < 3) regime = 'medium';
    else if (avgVol < 8) regime = 'high';
    else                 regime = 'extreme';

    brain.regimes.current = regime;
    brain.regimes.avgVol = parseFloat(avgVol.toFixed(2));
    brain.regimes.history.push({ time: Date.now(), regime, avgVol: brain.regimes.avgVol });
    if (brain.regimes.history.length > 48) brain.regimes.history.shift();
    
    saveBrain(brain);
    return regime;
  } catch {
    return brain.regimes.current || 'medium';
  }
}

/**
 * Get regime-adjusted parameters
 */
function getRegimeParams(regime) {
  switch (regime) {
    case 'low':
      return { slMult: 0.8, tpMult: 0.7, sizeMult: 1.2, minScore: 50 };  // Tight market: smaller targets, bigger size
    case 'medium':
      return { slMult: 1.0, tpMult: 1.0, sizeMult: 1.0, minScore: 55 };  // Normal
    case 'high':
      return { slMult: 1.3, tpMult: 1.5, sizeMult: 0.8, minScore: 60 };  // Volatile: wider stops, smaller size
    case 'extreme':
      return { slMult: 1.5, tpMult: 2.0, sizeMult: 0.5, minScore: 70 };  // Chaos: wide stops, tiny size, very picky
    default:
      return { slMult: 1.0, tpMult: 1.0, sizeMult: 1.0, minScore: 55 };
  }
}

// ── Feature Importance ───────────────────────────────────────────────────

/**
 * Rank signals by actual predictive power
 * Returns sorted list of signals with their win rates and edge
 */
function getFeatureImportance() {
  const brain = loadBrain();
  const features = [];

  for (const [name, s] of Object.entries(brain.signals)) {
    if (s.occurrences < 3) continue; // need minimum sample

    const winRate = s.wins / s.occurrences;
    const avgPnl = s.totalPnl / s.occurrences;
    const edge = winRate - 0.5; // positive = predictive

    features.push({
      signal: name,
      desc: s.desc,
      weight: parseFloat(s.weight.toFixed(2)),
      winRate: parseFloat((winRate * 100).toFixed(1)),
      avgPnl: parseFloat(avgPnl.toFixed(2)),
      edge: parseFloat((edge * 100).toFixed(1)),
      occurrences: s.occurrences,
    });
  }

  return features.sort((a, b) => b.edge - a.edge);
}

// ── Correlation Tracking ─────────────────────────────────────────────────

/**
 * Track price movements across tokens to find correlations
 * If token A pumps and B follows 70% of the time → trade B when A pumps
 */
function updateCorrelation(mintA, mintB, bothUp) {
  const brain = loadBrain();
  const key = [mintA, mintB].sort().join(':');
  
  if (!brain.correlations[key]) {
    brain.correlations[key] = { pairs: 0, coMoves: 0, correlation: 0 };
  }

  brain.correlations[key].pairs++;
  if (bothUp) brain.correlations[key].coMoves++;
  brain.correlations[key].correlation = brain.correlations[key].coMoves / brain.correlations[key].pairs;
  
  // Prune old/weak correlations
  if (Object.keys(brain.correlations).length > 100) {
    const entries = Object.entries(brain.correlations);
    entries.sort((a, b) => a[1].pairs - b[1].pairs);
    for (const [k] of entries.slice(0, 20)) delete brain.correlations[k];
  }

  saveBrain(brain);
}

// ── Full Analysis ────────────────────────────────────────────────────────

/**
 * Complete quant analysis for a token
 * Returns: score, position size, regime-adjusted params, active signals
 */
async function analyze(tokenData, balanceUsd) {
  const { score, signals, activeSignals } = bayesianScore(tokenData);
  const regime = await detectRegime();
  const regimeParams = getRegimeParams(regime);
  const positionSize = kellyPositionSize(balanceUsd) * regimeParams.sizeMult;
  
  return {
    score,
    adjustedMinScore: regimeParams.minScore,
    shouldTrade: score >= regimeParams.minScore,
    positionSize: Math.round(positionSize * 100) / 100,
    regime,
    regimeParams,
    signals,
    activeSignals,
    kelly: loadBrain().kelly,
  };
}

/**
 * Record trade outcome — updates all learning systems
 */
function recordOutcome(signals, pnlPct) {
  const won = pnlPct > 0;
  updateSignals(signals, pnlPct, won);
  updateKelly(pnlPct, won);
}

// ── Report ───────────────────────────────────────────────────────────────

function getReport() {
  const brain = loadBrain();
  return {
    totalTrades: brain.totalTrades,
    sharpeRatio: parseFloat(brain.sharpeRatio.toFixed(2)),
    kelly: {
      winRate: (brain.kelly.winRate * 100).toFixed(1) + '%',
      avgWin: brain.kelly.avgWin.toFixed(2) + '%',
      avgLoss: brain.kelly.avgLoss.toFixed(2) + '%',
      optimalBet: brain.kelly.optimalBetPct + '%',
      kellyFraction: (brain.kelly.kellyFraction * 100).toFixed(1) + '%',
    },
    regime: brain.regimes.current,
    regimeAvgVol: brain.regimes.avgVol,
    topSignals: getFeatureImportance().slice(0, 10),
    worstSignals: getFeatureImportance().slice(-5),
    signalCount: Object.keys(brain.signals).length,
    correlationCount: Object.keys(brain.correlations).length,
  };
}

module.exports = {
  analyze,
  bayesianScore,
  detectSignals,
  updateSignals,
  recordOutcome,
  kellyPositionSize,
  detectRegime,
  getRegimeParams,
  getFeatureImportance,
  updateCorrelation,
  getReport,
  loadBrain,
  saveBrain,
};
