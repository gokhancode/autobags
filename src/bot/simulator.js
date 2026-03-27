/**
 * AUTOBAGS — Paper Trading Simulator
 * High-frequency swing trading with virtual balance
 * Tracks every trade as if real, no on-chain execution
 */
const fs   = require('fs');
const path = require('path');
const BagsClient = require('./bags-client');
const { runIntel } = require('./intel-bridge');

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
    // High-freq params
    minScore: 55,        // lower threshold = more trades
    stopLossPct: 5,
    takeProfitPct: 10,
    partialExitPct: 6,   // secure 50% at +6%
    maxPositionUsd: 350, // ~1/3 of balance per position
    cooldownMs: 30000,   // 30s between trades
    lastTradeTime: 0,
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

      // Fast score: momentum + volume + liquidity + buy pressure
      let score = 0;
      if (liq > 5000) score += 15;       // decent liquidity
      if (liq > 20000) score += 10;
      if (vol24 > 10000) score += 15;     // active volume
      if (vol24 > 50000) score += 10;
      if (priceChange5m > 2) score += 15; // short-term momentum
      if (priceChange5m > 5) score += 10;
      if (priceChange1h > 5) score += 10; // hourly trend
      if (buyRatio > 0.55) score += 10;   // buy pressure
      if (buyRatio > 0.65) score += 10;
      if (mcap > 10000 && mcap < 5000000) score += 10; // sweet spot mcap

      // Rug filters
      if (liq < 1000) continue;           // skip dust
      if (vol24 / liq > 15) continue;     // suspicious vol/liq ratio
      if (priceChange1h < -20) continue;  // dumping

      c.price = parseFloat(pair.priceUsd || 0);
      c.score = score;
      c.liq = liq;
      c.vol24 = vol24;
      c.mcap = mcap;
      c.momentum5m = priceChange5m;
      if (score >= 40 && c.price > 0) scored.push(c);
    } catch { continue; }
  }

  return scored.sort((a, b) => b.score - a.score);
}

// ── Trade Execution (Paper) ──────────────────────────────────────────────

function simBuy(state, candidate, priceUsd) {
  const posSize = Math.min(state.maxPositionUsd, state.balanceUsd * 0.35);
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
  if (state.balanceUsd > state.peakBalance) state.peakBalance = state.balanceUsd;
  const dd = ((state.peakBalance - state.balanceUsd) / state.peakBalance) * 100;
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
  return trade;
}

// ── Main Tick ────────────────────────────────────────────────────────────

async function tick() {
  let state = loadState();
  if (!state) return;

  const now = Date.now();

  // 1. Monitor existing positions
  for (const [mint, pos] of Object.entries(state.positions)) {
    const price = await getPrice(mint);
    if (!price) continue;

    const pnlPct = ((price - pos.entryPrice) / pos.entryPrice) * 100;
    
    // Track high watermark
    if (price > (pos.highPrice || pos.entryPrice)) {
      pos.highPrice = price;
      saveState(state);
    }

    // Stop loss
    if (pnlPct <= -state.stopLossPct) {
      simSell(state, mint, price, `Stop loss (${pnlPct.toFixed(1)}%)`);
      continue;
    }

    // Partial exit at +6%
    if (pnlPct >= state.partialExitPct && !pos.partialExited) {
      // Sell 50% of position
      const halfTokens = pos.tokens / 2;
      const halfValue = halfTokens * price;
      state.balanceUsd += halfValue;
      pos.tokens = halfTokens;
      pos.usdAmount = halfTokens * pos.entryPrice;
      pos.partialExited = true;
      state.totalPnlUsd += (halfValue - (pos.tokens * pos.entryPrice));
      saveState(state);

      const trades = loadTrades();
      trades.push({
        type: 'PARTIAL_SELL',
        symbol: pos.symbol, mint, priceUsd: price,
        usdAmount: halfValue.toFixed(2),
        pnlPct: pnlPct.toFixed(1),
        reason: 'Partial exit (50%)',
        balance: state.balanceUsd.toFixed(2),
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

    // Trailing stop: if was up >5% and now dropping, cut it
    if (pos.highPrice && pos.entryPrice) {
      const fromHigh = ((price - pos.highPrice) / pos.highPrice) * 100;
      const fromEntry = ((pos.highPrice - pos.entryPrice) / pos.entryPrice) * 100;
      if (fromEntry > 4 && fromHigh < -3) {
        simSell(state, mint, price, `Trailing stop (${fromHigh.toFixed(1)}% from high)`);
        continue;
      }
    }
  }

  // 2. Look for new entries
  state = loadState(); // reload after sells
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

  return {
    balanceUsd: state.balanceUsd.toFixed(2),
    startBalanceUsd: state.startBalanceUsd,
    totalPnlUsd: state.totalPnlUsd.toFixed(2),
    totalPnlPct: ((state.totalPnlUsd / state.startBalanceUsd) * 100).toFixed(1),
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
