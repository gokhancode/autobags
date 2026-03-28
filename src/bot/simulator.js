/**
 * AUTOBAGS — Paper Trading Simulator
 * High-frequency swing trading with virtual balance
 * Tracks every trade as if real, no on-chain execution
 */
const fs   = require('fs');
const path = require('path');
const BagsClient = require('./bags-client');
const { runIntel } = require('./intel-bridge');

const { sendTelegram } = require('./notifier');
const bags = new BagsClient(process.env.BAGS_API_KEY);
const SIM_FILE = path.join(__dirname, '../../data/sim-state.json');
const SIM_TRADES_FILE = path.join(__dirname, '../../data/sim-trades.json');

// ── State ────────────────────────────────────────────────────────────────

function loadState() {
  try { return JSON.parse(fs.readFileSync(SIM_FILE, 'utf8')); }
  catch { return null; }
}

function saveState(state) {
  fs.writeFileSync(SIM_FILE, JSON.stringify(state, null, 2));
}

function loadTrades() {
  try { return JSON.parse(fs.readFileSync(SIM_TRADES_FILE, 'utf8')); }
  catch { return []; }
}

function saveTrades(trades) {
  fs.writeFileSync(SIM_TRADES_FILE, JSON.stringify(trades, null, 2));
}

function initSim(startBalanceUsd) {
  const state = {
    startBalanceUsd,
    balanceUsd: startBalanceUsd,
    positions: {},       // mint → { symbol, entryPrice, usdAmount, tokens, entryTime, score }
    maxPositions: 3,
    totalTrades: 0,
    wins: 0,
    losses: 0,
    totalPnlUsd: 0,
    peakBalance: startBalanceUsd,
    maxDrawdown: 0,
    startedAt: new Date().toISOString(),
    // High-freq params (v2 — tighter risk)
    minScore: 60,        // slightly pickier entries
    stopLossPct: 3,      // tight stop — cut losers FAST
    takeProfitPct: 8,    // take profit quicker
    partialExitPct: 4,   // secure 50% at +4%
    maxPositionUsd: 250, // ~25% of balance per position
    cooldownMs: 20000,   // 20s between trades
    lastTradeTime: 0,
    maxHoldMinutes: 15,  // dump anything held >15min with no gain
    trailingStopPct: 2,  // tighter trailing stop (2% from high)
    minMomentum5m: 3,    // need 3%+ 5m momentum to enter
    portfolioStopPct: 15,// circuit breaker: pause if down 15% total
    paused: false,
    equityCurve: [],     // [{time, balance}] snapshots every 5 min
    dailyPnlStart: startBalanceUsd,  // reset daily for daily loss limit
    dailyPnlDate: new Date().toISOString().slice(0, 10),
  };
  saveState(state);
  saveTrades([]);
  console.log(`[SIM] Initialized — $${startBalanceUsd} virtual balance, high-freq mode`);
  return state;
}

// ── Price Fetching ───────────────────────────────────────────────────────

async function getPrice(mint) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await res.json();
    const pair = data?.pairs?.find(p => p.chainId === 'solana');
    return pair ? parseFloat(pair.priceUsd) : null;
  } catch { return null; }
}

async function getSolPrice() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const data = await res.json();
    return data?.solana?.usd || 140;
  } catch { return 140; }
}

// ── Scout & Score ────────────────────────────────────────────────────────

async function scoutCandidates() {
  const candidates = [];

  // Bags token feed
  try {
    const feed = await bags.getTokenFeed();
    const tokens = feed?.response || [];
    for (const t of tokens.slice(0, 50)) {
      if (t.mint && t.symbol) {
        candidates.push({ mint: t.mint, symbol: t.symbol, source: 'bags' });
      }
    }
  } catch {}

  // DexScreener boosted
  try {
    const res = await fetch('https://api.dexscreener.com/token-boosts/top/v1');
    const data = await res.json();
    for (const t of (data || []).filter(x => x.chainId === 'solana').slice(0, 30)) {
      if (t.tokenAddress && !candidates.find(c => c.mint === t.tokenAddress)) {
        candidates.push({ mint: t.tokenAddress, symbol: t.description?.split(' ')?.[0] || '???', source: 'dex' });
      }
    }
  } catch {}

  return candidates;
}

async function scoreCandidates(candidates) {
  const scored = [];

  // Fast scoring via DexScreener data (no intel.py bottleneck for sim)
  for (const c of candidates.slice(0, 30)) {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${c.mint}`);
      const data = await res.json();
      const pair = data?.pairs?.find(p => p.chainId === 'solana');
      if (!pair) continue;

      const liq = parseFloat(pair.liquidity?.usd || 0);
      const vol24 = parseFloat(pair.volume?.h24 || 0);
      const mcap = parseFloat(pair.marketCap || pair.fdv || 0);
      const priceChange5m = parseFloat(pair.priceChange?.m5 || 0);
      const priceChange1h = parseFloat(pair.priceChange?.h1 || 0);
      const txns = pair.txns?.h1 || {};
      const buys1h = txns.buys || 0;
      const sells1h = txns.sells || 0;
      const buyRatio = buys1h + sells1h > 0 ? buys1h / (buys1h + sells1h) : 0.5;

      // Scoring: more granular, harder to ace
      let score = 0;
      
      // Liquidity (0-15)
      if (liq > 50000) score += 15;
      else if (liq > 20000) score += 10;
      else if (liq > 5000) score += 5;

      // Volume (0-15)
      if (vol24 > 100000) score += 15;
      else if (vol24 > 50000) score += 10;
      else if (vol24 > 10000) score += 5;

      // 5m momentum (0-20) — key signal
      if (priceChange5m > 10) score += 20;
      else if (priceChange5m > 5) score += 15;
      else if (priceChange5m > 3) score += 10;

      // 1h momentum (0-15)
      if (priceChange1h > 20) score += 15;
      else if (priceChange1h > 10) score += 10;
      else if (priceChange1h > 5) score += 5;

      // Buy pressure (0-15)
      if (buyRatio > 0.70) score += 15;
      else if (buyRatio > 0.60) score += 10;
      else if (buyRatio > 0.55) score += 5;

      // Market cap sweet spot (0-10)
      if (mcap > 50000 && mcap < 2000000) score += 10;
      else if (mcap > 10000 && mcap < 5000000) score += 5;

      // Transaction count (0-10)
      const txns1h = buys1h + sells1h;
      if (txns1h > 200) score += 10;
      else if (txns1h > 50) score += 5;

      // Penalties
      if (priceChange5m > 20) score -= 10;  // overextended
      if (priceChange1h < -10) score -= 10; // dumping
      if (buyRatio < 0.4) score -= 15;      // heavy selling

      // Rug filters
      if (liq < 2000) continue;
      if (vol24 / liq > 15) continue;
      if (priceChange1h < -25) continue;

      score = Math.max(0, Math.min(100, score));
      c.price = parseFloat(pair.priceUsd || 0);
      c.score = score;
      c.liq = liq;
      c.vol24 = vol24;
      c.mcap = mcap;
      c.momentum5m = priceChange5m;
      // Require momentum + minimum score
      if (score >= 55 && c.price > 0 && priceChange5m >= 3) scored.push(c);
    } catch { continue; }
  }

  return scored.sort((a, b) => b.score - a.score);
}

// ── Trade Execution (Paper) ──────────────────────────────────────────────

function getSessionMultiplier() {
  const hour = new Date().getUTCHours();
  // US market hours (14:00-21:00 UTC) = full size
  if (hour >= 14 && hour < 21) return 1.0;
  // EU hours (08:00-16:00 UTC) = full size
  if (hour >= 8 && hour < 16) return 1.0;
  // Asia hours (00:00-08:00 UTC) = 75%
  if (hour >= 0 && hour < 8) return 0.75;
  // Off-hours = 50%
  return 0.5;
}

function simBuy(state, candidate, priceUsd) {
  const sessionMult = getSessionMultiplier();
  const posSize = Math.min(state.maxPositionUsd * sessionMult, state.balanceUsd * 0.35);
  if (posSize < 5) return null; // min $5

  const tokens = posSize / priceUsd;
  state.positions[candidate.mint] = {
    symbol: candidate.symbol,
    entryPrice: priceUsd,
    usdAmount: posSize,
    tokens,
    entryTime: new Date().toISOString(),
    score: candidate.score,
    partialExited: false,
    highPrice: priceUsd,
  };
  state.balanceUsd -= posSize;
  state.totalTrades++;
  state.lastTradeTime = Date.now();
  saveState(state);

  const trade = {
    type: 'BUY',
    symbol: candidate.symbol,
    mint: candidate.mint,
    priceUsd,
    usdAmount: posSize.toFixed(2),
    tokens: tokens.toFixed(4),
    score: candidate.score,
    balance: state.balanceUsd.toFixed(2),
    timestamp: new Date().toISOString()
  };
  const trades = loadTrades();
  trades.push(trade);
  saveTrades(trades);

  console.log(`[SIM] 🟢 BUY $${candidate.symbol} — $${posSize.toFixed(2)} @ $${priceUsd.toFixed(8)} (score: ${candidate.score})`);
  sendTelegram(`🟢 <b>[SIM] BUY</b> $${candidate.symbol}\n💰 $${posSize.toFixed(2)} @ $${priceUsd.toFixed(8)}\n📊 Score: ${candidate.score}/100\n💼 Balance: $${state.balanceUsd.toFixed(2)}`).catch(()=>{});
  return trade;
}

function simSell(state, mint, priceUsd, reason) {
  const pos = state.positions[mint];
  if (!pos) return null;

  const currentValue = pos.tokens * priceUsd;
  const pnlUsd = currentValue - pos.usdAmount;
  const pnlPct = (pnlUsd / pos.usdAmount) * 100;

  state.balanceUsd += currentValue;
  state.totalPnlUsd += pnlUsd;
  if (pnlUsd > 0) state.wins++; else state.losses++;
  // Drawdown based on TOTAL equity (cash + open positions), not just cash
  const openValue = Object.values(state.positions).reduce((s, p) => s + p.usdAmount, 0);
  const totalEquity = state.balanceUsd + openValue;
  if (totalEquity > state.peakBalance) state.peakBalance = totalEquity;
  const dd = ((state.peakBalance - totalEquity) / state.peakBalance) * 100;
  if (dd > state.maxDrawdown) state.maxDrawdown = dd;

  delete state.positions[mint];
  saveState(state);

  const trade = {
    type: 'SELL',
    symbol: pos.symbol,
    mint,
    priceUsd,
    usdAmount: currentValue.toFixed(2),
    pnlUsd: pnlUsd.toFixed(2),
    pnlPct: pnlPct.toFixed(1),
    reason,
    balance: state.balanceUsd.toFixed(2),
    holdTime: Math.round((Date.now() - new Date(pos.entryTime).getTime()) / 60000) + 'min',
    timestamp: new Date().toISOString()
  };
  const trades = loadTrades();
  trades.push(trade);
  saveTrades(trades);

  const emoji = pnlUsd >= 0 ? '🟢' : '🔴';
  console.log(`[SIM] ${emoji} SELL $${pos.symbol} — ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% ($${pnlUsd.toFixed(2)}) | ${reason} | Balance: $${state.balanceUsd.toFixed(2)}`);
  // Only notify on significant trades (skip partials, notify wins and big losses)
  if (Math.abs(pnlPct) > 2) {
    sendTelegram(`${emoji} <b>[SIM] SELL</b> $${pos.symbol}\n📈 P&L: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% ($${pnlUsd >= 0 ? '+' : ''}${pnlUsd.toFixed(2)})\n📋 ${reason}\n💼 Balance: $${state.balanceUsd.toFixed(2)}`).catch(()=>{});
  }
  return trade;
}

// ── Main Tick ────────────────────────────────────────────────────────────

async function tick() {
  let state = loadState();
  if (!state) return;

  const now = Date.now();

  // Daily loss limit reset
  const today = new Date().toISOString().slice(0, 10);
  if (state.dailyPnlDate !== today) {
    const totalInPos = Object.values(state.positions).reduce((s, p) => s + p.usdAmount, 0);
    state.dailyPnlStart = state.balanceUsd + totalInPos;
    state.dailyPnlDate = today;
    state.paused = false;
    saveState(state);
  }

  // Equity curve snapshot (every 5 min)
  if (!state.equityCurve) state.equityCurve = [];
  const totalEquityNow = state.balanceUsd + Object.values(state.positions).reduce((s, p) => s + p.usdAmount, 0);
  const lastSnap = state.equityCurve.length > 0 ? state.equityCurve[state.equityCurve.length - 1].time : 0;
  if (now - lastSnap > 5 * 60 * 1000) {
    state.equityCurve.push({ time: now, balance: parseFloat(totalEquityNow.toFixed(2)) });
    // Keep last 2000 points (~7 days at 5min intervals)
    if (state.equityCurve.length > 2000) state.equityCurve.splice(0, state.equityCurve.length - 2000);
    saveState(state);
  }

  // Portfolio circuit breaker
  const totalInPositions = Object.values(state.positions).reduce((s, p) => s + p.usdAmount, 0);
  const approxTotal = state.balanceUsd + totalInPositions;

  // Daily loss limit (15% from day start)
  if (state.dailyPnlStart > 0) {
    const dailyPnlPct = ((approxTotal - state.dailyPnlStart) / state.dailyPnlStart) * 100;
    if (dailyPnlPct <= -15 && !state.paused) {
      state.paused = true;
      saveState(state);
      console.log(`[SIM] ⛔ DAILY LOSS LIMIT — down ${dailyPnlPct.toFixed(1)}% today, pausing until tomorrow`);
      return;
    }
  }

  const portfolioPnlPct = ((approxTotal - state.startBalanceUsd) / state.startBalanceUsd) * 100;
  if (portfolioPnlPct <= -state.portfolioStopPct && !state.paused) {
    state.paused = true;
    saveState(state);
    console.log(`[SIM] ⛔ CIRCUIT BREAKER — portfolio down ${portfolioPnlPct.toFixed(1)}%, pausing new entries for 5min`);
    setTimeout(() => { const s = loadState(); s.paused = false; saveState(s); console.log('[SIM] ▶️ Circuit breaker released'); }, 300000);
  }

  // 1. Monitor existing positions
  for (const [mint, pos] of Object.entries(state.positions)) {
    const price = await getPrice(mint);
    if (!price) continue;

    const pnlPct = ((price - pos.entryPrice) / pos.entryPrice) * 100;
    const holdMinutes = (now - new Date(pos.entryTime).getTime()) / 60000;
    
    // Track high watermark
    if (price > (pos.highPrice || pos.entryPrice)) {
      pos.highPrice = price;
      saveState(state);
    }

    // Stop loss — cut losers FAST (simulate execution at stop level, not current price)
    if (pnlPct <= -state.stopLossPct) {
      // In real trading, a limit order would fill at the stop level, not the actual dump price
      // Simulate more realistic fill: min of actual price or stop level
      const stopPrice = pos.entryPrice * (1 - state.stopLossPct / 100);
      const fillPrice = Math.max(price, stopPrice); // can't fill better than market
      simSell(state, mint, fillPrice, `Stop loss (${pnlPct.toFixed(1)}%)`);
      continue;
    }

    // Time-based exit: if held >15min and flat/negative, dump it
    if (holdMinutes >= state.maxHoldMinutes && pnlPct < 2) {
      simSell(state, mint, price, `Stale position (${holdMinutes.toFixed(0)}min, ${pnlPct.toFixed(1)}%)`);
      continue;
    }

    // Partial exit at +4%
    if (pnlPct >= state.partialExitPct && !pos.partialExited) {
      const halfTokens = pos.tokens / 2;
      const halfValue = halfTokens * price;
      const halfCost = halfTokens * pos.entryPrice;
      state.balanceUsd += halfValue;
      state.totalPnlUsd += (halfValue - halfCost);
      pos.tokens = halfTokens;
      pos.usdAmount = halfCost;
      pos.partialExited = true;
      saveState(state);

      const trades = loadTrades();
      trades.push({
        type: 'PARTIAL_SELL', symbol: pos.symbol, mint, priceUsd: price,
        usdAmount: halfValue.toFixed(2), pnlPct: pnlPct.toFixed(1),
        reason: 'Partial exit (50%)', balance: state.balanceUsd.toFixed(2),
        timestamp: new Date().toISOString()
      });
      saveTrades(trades);
      console.log(`[SIM] 🟡 PARTIAL $${pos.symbol} — +${pnlPct.toFixed(1)}%, secured $${halfValue.toFixed(2)}`);
      continue;
    }

    // Take profit
    if (pnlPct >= state.takeProfitPct) {
      simSell(state, mint, price, `Take profit (+${pnlPct.toFixed(1)}%)`);
      continue;
    }

    // Tight trailing stop: 2% drop from high (if was ever up >3%)
    if (pos.highPrice && pos.entryPrice) {
      const fromHigh = ((price - pos.highPrice) / pos.highPrice) * 100;
      const fromEntry = ((pos.highPrice - pos.entryPrice) / pos.entryPrice) * 100;
      if (fromEntry > 3 && fromHigh < -state.trailingStopPct) {
        simSell(state, mint, price, `Trailing stop (${fromHigh.toFixed(1)}% from high)`);
        continue;
      }
    }
  }

  // 2. Look for new entries
  state = loadState(); // reload after sells
  if (state.paused) return;
  const openCount = Object.keys(state.positions).length;
  if (openCount >= state.maxPositions) return;
  if (now - state.lastTradeTime < state.cooldownMs) return;

  const candidates = await scoutCandidates();
  if (!candidates.length) return;

  // Score top 15 (limit intel calls)
  const scored = await scoreCandidates(candidates.slice(0, 15));
  const viable = scored.filter(c => 
    c.score >= state.minScore && 
    c.safety !== 'danger' &&
    !state.positions[c.mint] // not already holding
  );

  if (!viable.length) return;

  // Buy top scorers (fill up to maxPositions)
  for (const best of viable.slice(0, state.maxPositions - openCount)) {
    const price = best.price || await getPrice(best.mint);
    if (price && price > 0) {
      simBuy(state, best, price);
      state = loadState(); // reload after buy
    }
  }
}

// ── Stats ────────────────────────────────────────────────────────────────

function getStats() {
  const state = loadState();
  if (!state) return null;

  const trades = loadTrades();
  const winRate = state.totalTrades > 0 
    ? ((state.wins / (state.wins + state.losses)) * 100).toFixed(1) 
    : '0.0';

  const openPositions = Object.entries(state.positions).map(([mint, p]) => ({
    symbol: p.symbol,
    mint,
    entryPrice: p.entryPrice,
    usdIn: p.usdAmount.toFixed(2),
    score: p.score,
    entryTime: p.entryTime,
    partialExited: p.partialExited
  }));

  const openValue = Object.values(state.positions).reduce((s, p) => s + p.usdAmount, 0);
  const totalEquity = state.balanceUsd + openValue;
  const unrealizedPnl = totalEquity - state.startBalanceUsd;
  
  return {
    balanceUsd: state.balanceUsd.toFixed(2),
    totalEquity: totalEquity.toFixed(2),
    startBalanceUsd: state.startBalanceUsd,
    totalPnlUsd: unrealizedPnl.toFixed(2),
    totalPnlPct: ((unrealizedPnl / state.startBalanceUsd) * 100).toFixed(1),
    realizedPnl: state.totalPnlUsd.toFixed(2),
    totalTrades: state.totalTrades,
    wins: state.wins,
    losses: state.losses,
    winRate,
    peakBalance: state.peakBalance.toFixed(2),
    maxDrawdown: state.maxDrawdown.toFixed(1),
    openPositions,
    recentTrades: trades.slice(-20).reverse(),
    startedAt: state.startedAt,
    runningFor: Math.round((Date.now() - new Date(state.startedAt).getTime()) / 60000) + ' min'
  };
}

// ── Runner ───────────────────────────────────────────────────────────────

let interval = null;

function start(tickMs = 15000) {
  let state = loadState();
  if (!state) state = initSim(1000);
  
  console.log(`[SIM] 🚀 Paper trading LIVE — $${state.balanceUsd.toFixed(2)} balance, ${tickMs/1000}s ticks, max ${state.maxPositions} positions`);
  
  // Run immediately
  tick().catch(e => console.error('[SIM] tick error:', e.message));
  
  interval = setInterval(() => {
    tick().catch(e => console.error('[SIM] tick error:', e.message));
  }, tickMs);
}

function stop() {
  if (interval) { clearInterval(interval); interval = null; }
  console.log('[SIM] Stopped');
}

module.exports = { initSim, tick, start, stop, getStats, loadState, loadTrades };
