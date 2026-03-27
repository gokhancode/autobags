/**
 * AUTOBAGS — Multi-Strategy Tournament
 * 
 * Runs 5 parallel strategies with different approaches.
 * Every hour, the WORST performer loses capital to the BEST.
 * Darwinian trading — only the strongest survive.
 * 
 * Strategies a human can't run simultaneously:
 * 1. Momentum Rider — pure 5m/1h momentum, ride the wave
 * 2. Mean Reversion — buy dips on strong tokens, sell the bounce
 * 3. Whale Shadow — follow large wallet movements
 * 4. Session Trader — timezone-aware (Asia/EU/US pump patterns)
 * 5. Contrarian — buy what everyone's selling (high sell ratio + rising volume)
 */

const fs   = require('fs');
const path = require('path');
const STRATS_FILE = path.join(__dirname, '../../data/sim-strategies.json');
const STRATS_LOG  = path.join(__dirname, '../../data/sim-strategies-log.json');

function load(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function save(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

// ── Token Data ───────────────────────────────────────────────────────────

async function getTokenData(mint) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await res.json();
    const pair = data?.pairs?.find(p => p.chainId === 'solana');
    if (!pair) return null;
    return {
      price: parseFloat(pair.priceUsd || 0),
      liq: parseFloat(pair.liquidity?.usd || 0),
      vol24: parseFloat(pair.volume?.h24 || 0),
      vol6h: parseFloat(pair.volume?.h6 || 0),
      vol1h: parseFloat(pair.volume?.h1 || 0),
      mcap: parseFloat(pair.marketCap || pair.fdv || 0),
      m5: parseFloat(pair.priceChange?.m5 || 0),
      h1: parseFloat(pair.priceChange?.h1 || 0),
      h6: parseFloat(pair.priceChange?.h6 || 0),
      h24: parseFloat(pair.priceChange?.h24 || 0),
      buys1h: pair.txns?.h1?.buys || 0,
      sells1h: pair.txns?.h1?.sells || 0,
      buys24h: pair.txns?.h24?.buys || 0,
      sells24h: pair.txns?.h24?.sells || 0,
      pairCreated: pair.pairCreatedAt,
      symbol: pair.baseToken?.symbol || '???'
    };
  } catch { return null; }
}

async function getCandidatePool() {
  const tokens = [];
  try {
    const res = await fetch('https://api.dexscreener.com/token-boosts/top/v1');
    const data = await res.json();
    for (const t of (data || []).filter(x => x.chainId === 'solana').slice(0, 40)) {
      tokens.push(t.tokenAddress);
    }
  } catch {}
  
  // Also Bags feed
  try {
    const BAGS_KEY = process.env.BAGS_API_KEY;
    const res = await fetch('https://public-api-v2.bags.fm/api/v1/token-launch/feed', {
      headers: { 'x-api-key': BAGS_KEY }
    });
    const data = await res.json();
    for (const t of (data?.response || []).slice(0, 30)) {
      if (t.mint && !tokens.includes(t.mint)) tokens.push(t.mint);
    }
  } catch {}

  return [...new Set(tokens)];
}

// ── UTC Session Detection ────────────────────────────────────────────────

function getCurrentSession() {
  const hour = new Date().getUTCHours();
  if (hour >= 0 && hour < 8)   return 'asia';    // 00-08 UTC = Asia prime
  if (hour >= 7 && hour < 15)  return 'europe';  // 07-15 UTC = EU prime
  if (hour >= 13 && hour < 22) return 'us';      // 13-22 UTC = US prime
  return 'off-hours'; // 22-00 = low activity
}

// ── Strategy Scoring Functions ───────────────────────────────────────────

const strategies = {
  // 1. MOMENTUM RIDER — pure price action momentum
  momentum: {
    name: 'Momentum Rider',
    emoji: '🚀',
    score(d) {
      let s = 0;
      if (d.m5 > 5) s += 30;
      else if (d.m5 > 3) s += 20;
      if (d.h1 > 10) s += 25;
      else if (d.h1 > 5) s += 15;
      if (d.vol1h > 20000) s += 15;
      if (d.buys1h > d.sells1h * 1.3) s += 15;
      if (d.liq > 10000) s += 10;
      if (d.m5 < 0) s -= 20; // never buy falling knives
      return Math.max(0, Math.min(100, s));
    },
    params: { sl: 3, tp: 8, maxHold: 10, trailing: 2, minScore: 55 }
  },

  // 2. MEAN REVERSION — buy oversold bounces
  reversion: {
    name: 'Mean Reversion',
    emoji: '🔄',
    score(d) {
      let s = 0;
      // Want: down on h1/h6 but bouncing on 5m
      if (d.h1 < -10 && d.m5 > 2) s += 35;  // dip + bounce = gold
      if (d.h6 < -15 && d.m5 > 0) s += 20;
      if (d.vol1h > d.vol6h / 6 * 1.5) s += 15; // volume spike on bounce
      if (d.buys1h > d.sells1h) s += 15;
      if (d.liq > 15000) s += 10;
      if (d.mcap > 50000) s += 10; // established tokens bounce better
      if (d.m5 < 0) s -= 30; // still falling, don't catch
      return Math.max(0, Math.min(100, s));
    },
    params: { sl: 4, tp: 12, maxHold: 20, trailing: 3, minScore: 60 }
  },

  // 3. WHALE SHADOW — follow big buyer concentration
  whale: {
    name: 'Whale Shadow',
    emoji: '🐋',
    score(d) {
      let s = 0;
      // High buys with low sell count = concentrated buying (whales)
      const buyRatio = d.buys1h / Math.max(d.sells1h, 1);
      if (buyRatio > 3) s += 35;      // 3:1 buy:sell ratio
      else if (buyRatio > 2) s += 25;
      // Volume spike relative to 24h (someone big came in)
      const volSpike = d.vol1h / Math.max(d.vol24 / 24, 1);
      if (volSpike > 3) s += 25;
      else if (volSpike > 2) s += 15;
      if (d.m5 > 2) s += 15;  // price confirming the buying
      if (d.liq > 20000) s += 10;
      if (d.buys1h < 10) s -= 20; // too few txns, not reliable
      return Math.max(0, Math.min(100, s));
    },
    params: { sl: 3, tp: 10, maxHold: 12, trailing: 2.5, minScore: 60 }
  },

  // 4. SESSION TRADER — timezone momentum patterns
  session: {
    name: 'Session Trader',
    emoji: '🌍',
    score(d) {
      let s = 0;
      const session = getCurrentSession();
      
      // Asia session: memes pump hardest, chase momentum
      if (session === 'asia') {
        if (d.m5 > 8) s += 30;
        if (d.vol1h > 30000) s += 20;
        if (d.mcap < 500000) s += 15; // small caps move more in asia
      }
      // EU session: more conservative, follow established trends
      else if (session === 'europe') {
        if (d.h1 > 5 && d.m5 > 2) s += 25;
        if (d.liq > 20000) s += 20;
        if (d.mcap > 100000) s += 15;
      }
      // US session: biggest volume, ride the wave
      else if (session === 'us') {
        if (d.vol1h > 50000) s += 25;
        if (d.buys1h > d.sells1h * 1.5) s += 20;
        if (d.m5 > 3) s += 15;
        if (d.h1 > 5) s += 10;
      }
      // Off-hours: only touch ultra-safe setups
      else {
        if (d.m5 > 5 && d.liq > 30000 && d.buys1h > d.sells1h * 2) s += 40;
      }

      if (d.liq > 5000) s += 10;
      if (d.m5 < -2) s -= 25;
      return Math.max(0, Math.min(100, s));
    },
    params: { sl: 3.5, tp: 9, maxHold: 15, trailing: 2, minScore: 55 }
  },

  // 5. CONTRARIAN — buy when blood in streets
  contrarian: {
    name: 'Contrarian',
    emoji: '🩸',
    score(d) {
      let s = 0;
      // High sell ratio but volume INCREASING (capitulation → reversal)
      const sellRatio = d.sells1h / Math.max(d.buys1h, 1);
      if (sellRatio > 1.5 && d.vol1h > d.vol6h / 6 * 2) s += 30;
      // Down big on h1 but volume spiking (potential bottom)
      if (d.h1 < -15 && d.vol1h > 20000) s += 25;
      // 5m showing reversal signal
      if (d.m5 > 1 && d.h1 < -10) s += 20;
      if (d.liq > 15000) s += 10;
      if (d.mcap > 50000) s += 10; // need something with real market to bounce
      // Don't catch complete rugs
      if (d.h1 < -50) s -= 40;
      if (d.liq < 3000) s -= 30;
      return Math.max(0, Math.min(100, s));
    },
    params: { sl: 5, tp: 15, maxHold: 25, trailing: 4, minScore: 55 }
  }
};

// ── Tournament State ─────────────────────────────────────────────────────

function initTournament(totalUsd) {
  const perStrategy = totalUsd / 5;
  const state = {
    totalUsd,
    startedAt: new Date().toISOString(),
    strategies: {},
    rebalanceCount: 0,
  };
  
  for (const [key, strat] of Object.entries(strategies)) {
    state.strategies[key] = {
      name: strat.name,
      emoji: strat.emoji,
      balanceUsd: perStrategy,
      startBalance: perStrategy,
      positions: {},
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPnlUsd: 0,
      peakBalance: perStrategy,
      maxDrawdown: 0,
      lastTradeTime: 0,
      params: { ...strat.params }
    };
  }

  save(STRATS_FILE, state);
  console.log(`[TOURNAMENT] Initialized — $${totalUsd} split across 5 strategies ($${perStrategy} each)`);
  return state;
}

// ── Trade Execution (per strategy) ───────────────────────────────────────

function stratBuy(state, stratKey, mint, symbol, price, score) {
  const s = state.strategies[stratKey];
  const posSize = Math.min(s.balanceUsd * 0.8, s.balanceUsd); // go big per strategy
  if (posSize < 5) return null;

  s.positions[mint] = {
    symbol, entryPrice: price, usdAmount: posSize,
    tokens: posSize / price, entryTime: new Date().toISOString(),
    score, highPrice: price
  };
  s.balanceUsd -= posSize;
  s.totalTrades++;
  s.lastTradeTime = Date.now();

  console.log(`[${s.emoji} ${s.name}] 🟢 BUY $${symbol} — $${posSize.toFixed(0)} @ $${price.toFixed(8)} (score ${score})`);
  return { type: 'BUY', strategy: stratKey, symbol, mint, usdAmount: posSize, price, score, time: new Date().toISOString() };
}

function stratSell(state, stratKey, mint, price, reason) {
  const s = state.strategies[stratKey];
  const pos = s.positions[mint];
  if (!pos) return null;

  const value = pos.tokens * price;
  const pnl = value - pos.usdAmount;
  const pnlPct = (pnl / pos.usdAmount) * 100;

  s.balanceUsd += value;
  s.totalPnlUsd += pnl;
  if (pnl > 0) s.wins++; else s.losses++;
  if (s.balanceUsd > s.peakBalance) s.peakBalance = s.balanceUsd;
  const dd = ((s.peakBalance - s.balanceUsd) / s.peakBalance) * 100;
  if (dd > s.maxDrawdown) s.maxDrawdown = dd;

  const holdMin = Math.round((Date.now() - new Date(pos.entryTime).getTime()) / 60000);
  delete s.positions[mint];

  const emoji = pnl >= 0 ? '🟢' : '🔴';
  console.log(`[${s.emoji} ${s.name}] ${emoji} SELL $${pos.symbol} ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% ($${pnl.toFixed(2)}) — ${reason} [${holdMin}min]`);
  
  return { type: 'SELL', strategy: stratKey, symbol: pos.symbol, mint, pnl, pnlPct, reason, holdMin, time: new Date().toISOString() };
}

// ── Tournament Tick ──────────────────────────────────────────────────────

async function tournamentTick() {
  let state = load(STRATS_FILE);
  if (!state) return;
  
  const now = Date.now();
  const candidates = await getCandidatePool();
  
  // Fetch data for all candidates in parallel (batched)
  const tokenData = {};
  for (let i = 0; i < candidates.length; i += 10) {
    const batch = candidates.slice(i, i + 10);
    const results = await Promise.allSettled(batch.map(m => getTokenData(m)));
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled' && r.value) {
        tokenData[batch[idx]] = r.value;
      }
    });
    // Small delay to not hammer DexScreener
    if (i + 10 < candidates.length) await new Promise(r => setTimeout(r, 500));
  }

  const tradeLog = [];

  for (const [stratKey, stratDef] of Object.entries(strategies)) {
    const s = state.strategies[stratKey];
    if (!s) continue;

    // Monitor positions
    for (const [mint, pos] of Object.entries({ ...s.positions })) {
      const d = tokenData[mint] || await getTokenData(mint).catch(() => null);
      if (!d) continue;

      const pnlPct = ((d.price - pos.entryPrice) / pos.entryPrice) * 100;
      const holdMin = (now - new Date(pos.entryTime).getTime()) / 60000;

      // Update high
      if (d.price > (pos.highPrice || pos.entryPrice)) pos.highPrice = d.price;

      // Stop loss
      if (pnlPct <= -s.params.sl) {
        const t = stratSell(state, stratKey, mint, d.price, `SL (${pnlPct.toFixed(1)}%)`);
        if (t) tradeLog.push(t);
        continue;
      }
      // Stale
      if (holdMin >= s.params.maxHold && pnlPct < 2) {
        const t = stratSell(state, stratKey, mint, d.price, `Stale (${holdMin.toFixed(0)}min)`);
        if (t) tradeLog.push(t);
        continue;
      }
      // Take profit
      if (pnlPct >= s.params.tp) {
        const t = stratSell(state, stratKey, mint, d.price, `TP (+${pnlPct.toFixed(1)}%)`);
        if (t) tradeLog.push(t);
        continue;
      }
      // Trailing stop
      if (pos.highPrice) {
        const fromHigh = ((d.price - pos.highPrice) / pos.highPrice) * 100;
        const fromEntry = ((pos.highPrice - pos.entryPrice) / pos.entryPrice) * 100;
        if (fromEntry > 3 && fromHigh < -s.params.trailing) {
          const t = stratSell(state, stratKey, mint, d.price, `Trail (${fromHigh.toFixed(1)}% from high)`);
          if (t) tradeLog.push(t);
          continue;
        }
      }
    }

    // New entries
    if (Object.keys(s.positions).length > 0) continue; // 1 position per strategy
    if (now - s.lastTradeTime < 20000) continue;
    if (s.balanceUsd < 10) continue;

    // Score all candidates with this strategy
    let best = null;
    let bestScore = 0;
    for (const [mint, d] of Object.entries(tokenData)) {
      if (d.liq < 2000) continue;
      const score = stratDef.score(d);
      if (score >= s.params.minScore && score > bestScore) {
        best = { mint, ...d, score };
        bestScore = score;
      }
    }

    if (best && best.price > 0) {
      const t = stratBuy(state, stratKey, best.mint, best.symbol, best.price, best.score);
      if (t) tradeLog.push(t);
    }
  }

  save(STRATS_FILE, state);

  // Log trades
  if (tradeLog.length) {
    const log = load(STRATS_LOG) || [];
    log.push(...tradeLog);
    save(STRATS_LOG, log);
  }
}

// ── Rebalance (Darwinian) ────────────────────────────────────────────────

function rebalance() {
  const state = load(STRATS_FILE);
  if (!state) return;

  // Calculate total value per strategy (balance + positions at entry)
  const values = {};
  for (const [key, s] of Object.entries(state.strategies)) {
    const posValue = Object.values(s.positions).reduce((sum, p) => sum + p.usdAmount, 0);
    values[key] = s.balanceUsd + posValue;
  }

  const sorted = Object.entries(values).sort((a, b) => b[1] - a[1]);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  if (best[1] <= worst[1]) return; // no clear winner

  // Transfer 10% of worst's remaining balance to best
  const worstStrat = state.strategies[worst[0]];
  const bestStrat = state.strategies[best[0]];
  const transfer = Math.min(worstStrat.balanceUsd * 0.1, 20); // max $20 per rebalance
  
  if (transfer > 1) {
    worstStrat.balanceUsd -= transfer;
    bestStrat.balanceUsd += transfer;
    state.rebalanceCount++;
    save(STRATS_FILE, state);
    console.log(`[TOURNAMENT] 💰 Rebalanced $${transfer.toFixed(2)}: ${worstStrat.name} → ${bestStrat.name}`);
  }
}

// ── Stats ────────────────────────────────────────────────────────────────

function getLeaderboard() {
  const state = load(STRATS_FILE);
  if (!state) return null;

  const board = [];
  for (const [key, s] of Object.entries(state.strategies)) {
    const posValue = Object.values(s.positions).reduce((sum, p) => sum + p.usdAmount, 0);
    const totalValue = s.balanceUsd + posValue;
    const pnlPct = ((totalValue - s.startBalance) / s.startBalance) * 100;
    const wr = s.wins + s.losses > 0 ? (s.wins / (s.wins + s.losses) * 100) : 0;

    board.push({
      key, name: s.name, emoji: s.emoji,
      totalValue: totalValue.toFixed(2),
      pnlPct: pnlPct.toFixed(1),
      trades: s.totalTrades,
      winRate: wr.toFixed(0),
      wins: s.wins, losses: s.losses,
      maxDD: s.maxDrawdown.toFixed(1),
      openPositions: Object.keys(s.positions).length,
      params: s.params
    });
  }

  return {
    leaderboard: board.sort((a, b) => parseFloat(b.pnlPct) - parseFloat(a.pnlPct)),
    totalValue: board.reduce((s, b) => s + parseFloat(b.totalValue), 0).toFixed(2),
    startedAt: state.startedAt,
    rebalances: state.rebalanceCount,
    session: getCurrentSession()
  };
}

// ── Runner ───────────────────────────────────────────────────────────────

let tickInterval = null;
let rebalanceInterval = null;

function start(totalUsd = 1000, tickMs = 15000) {
  let state = load(STRATS_FILE);
  if (!state) state = initTournament(totalUsd);

  console.log(`[TOURNAMENT] 🏆 Starting — 5 strategies competing, ${tickMs/1000}s ticks`);
  for (const [k, s] of Object.entries(state.strategies)) {
    console.log(`  ${s.emoji} ${s.name}: $${s.balanceUsd.toFixed(0)}`);
  }

  tournamentTick().catch(e => console.error('[TOURNAMENT] tick error:', e.message));
  tickInterval = setInterval(() => {
    tournamentTick().catch(e => console.error('[TOURNAMENT] tick error:', e.message));
  }, tickMs);

  // Rebalance every hour (Darwinian capital allocation)
  rebalanceInterval = setInterval(rebalance, 60 * 60 * 1000);
}

function stop() {
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
  if (rebalanceInterval) { clearInterval(rebalanceInterval); rebalanceInterval = null; }
  console.log('[TOURNAMENT] Stopped');
}

module.exports = { start, stop, getLeaderboard, tournamentTick, rebalance, initTournament, getCurrentSession };
