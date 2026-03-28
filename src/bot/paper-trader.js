/**
 * AUTOBAGS — Paper Trading Mode
 * Same scoring pipeline as real agent, but no on-chain swaps.
 * Tracks simulated positions with virtual balance.
 */
const fs = require('fs');
const path = require('path');
const notifier = require('./notifier');
const birdeye = require('./birdeye');
const social = require('./social-scanner');
const whaleTracker = require('./whale-tracker');
const rugDetector = require('./rug-detector');
const dynParams = require('./dynamic-params');
const patternRec = require('./pattern-recognition');
const holderTrack = require('./holder-tracker');
const priceFeed = require('./ws-feed');

const STATE_FILE = path.join(__dirname, '../../data/paper-state.json');
const TRADES_FILE = path.join(__dirname, '../../data/paper-trades.json');

const BAGS_KEY = process.env.BAGS_API_KEY;

function load(file, def) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; } }
function save(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

// Token price cache
const priceCache = {};
async function getTokenPrice(mint) {
  const cached = priceCache[mint];
  if (cached && Date.now() - cached.time < 30000) return cached.price;
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const d = await r.json();
    // ALWAYS use highest-liquidity Solana pair to avoid price inconsistency between ticks
    const solPairs = (d?.pairs || []).filter(p => p.chainId === 'solana' && parseFloat(p.liquidity?.usd || 0) > 0);
    solPairs.sort((a, b) => parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0));
    const pair = solPairs[0] || d?.pairs?.[0];
    const price = pair ? parseFloat(pair.priceUsd) : 0;
    const priceNative = pair ? parseFloat(pair.priceNative) : 0;
    priceCache[mint] = { price, priceNative, time: Date.now(), pair, pairAddress: pair?.pairAddress };
    return priceNative; // return SOL price
  } catch { return 0; }
}

async function tick() {
  const state = load(STATE_FILE, {
    balanceSol: 24.1, // ~$2000
    startBalanceSol: 24.1,
    positions: {},
    totalTrades: 0,
    wins: 0,
    losses: 0,
    peakBalance: 24.1,
    tokenCooldowns: {},
    tokenBuyCounts: {},
  });

  const settings = load(path.join(__dirname, '../../data/settings.json'), {}).testacc || {};
  const trades = load(TRADES_FILE, []);

  // ── Monitor open positions first ───────────────────────────────────────
  for (const [mint, pos] of Object.entries(state.positions)) {
    const currentPrice = await getTokenPrice(mint);
    if (!currentPrice || !pos.entryPrice) continue;

    const pricePct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;

    // Dynamic SL/TP
    let dynSL = settings.stopLossPct || 8;
    let dynTP = settings.takeProfitPct || 15;
    let dynTrailing = settings.trailingStopPct || 2;
    try {
      const dp = await dynParams.getDynamicParams(mint, pos.symbol, settings);
      dynSL = dp.stopLoss;
      dynTP = dp.takeProfit;
      dynTrailing = dp.trailingStop || dynTrailing;
    } catch {}

    let shouldSell = false;
    let reason = '';

    if (pricePct <= -dynSL) { shouldSell = true; reason = `stop loss (${pricePct.toFixed(1)}%)`; }
    if (pricePct >= dynTP) { shouldSell = true; reason = `take profit (+${pricePct.toFixed(1)}%)`; }

    // Max hold
    const holdMin = (Date.now() - new Date(pos.entryTime).getTime()) / 60000;
    if ((settings.maxHoldMinutes || 15) > 0 && holdMin >= (settings.maxHoldMinutes || 15) && pricePct < 2) {
      shouldSell = true; reason = `stale (${Math.round(holdMin)}min, ${pricePct.toFixed(1)}%)`;
    }

    // Trailing stop
    if (pos.highPrice && pos.entryPrice) {
      const fromHigh = ((currentPrice - pos.highPrice) / pos.highPrice) * 100;
      const fromEntry = ((pos.highPrice - pos.entryPrice) / pos.entryPrice) * 100;
      if (fromEntry > 3 && fromHigh < -dynTrailing) {
        shouldSell = true; reason = `trailing stop (${fromHigh.toFixed(1)}% from high)`;
      }
    }

    // Update high watermark
    if (currentPrice > (pos.highPrice || pos.entryPrice)) {
      state.positions[mint].highPrice = currentPrice;
    }

    if (shouldSell) {
      // Simulate sell — return SOL to balance (with 0.5% slippage)
      const valueNow = pos.tokenAmount * currentPrice * 0.995; // 0.5% slippage
      const pnlSol = valueNow - pos.solSpent;
      const pnlPct = (pnlSol / pos.solSpent) * 100;

      state.balanceSol += valueNow;
      delete state.positions[mint];
      state.totalTrades++;
      if (pnlSol > 0) state.wins++; else state.losses++;

      // Cooldown
      state.tokenCooldowns[mint] = Date.now();

      trades.push({
        type: 'SELL', symbol: pos.symbol, mint, reason,
        pnlSol: parseFloat(pnlSol.toFixed(6)),
        pnlPct: parseFloat(pnlPct.toFixed(2)),
        solReceived: parseFloat(valueNow.toFixed(6)),
        time: new Date().toISOString()
      });

      const emoji = pnlSol >= 0 ? '🟢' : '🔴';
      console.log(`[Paper] ${emoji} SELL $${pos.symbol} | P&L: ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL (${pnlPct.toFixed(1)}%) | ${reason}`);
      notifier.sendTelegram(`📝 PAPER ${emoji} SELL $${pos.symbol}\n💰 P&L: ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL (${pnlPct.toFixed(1)}%)\n📋 ${reason}\n💼 Balance: ${state.balanceSol.toFixed(2)} SOL`);
    }
  }

  // ── Daily loss limit ───────────────────────────────────────────────────
  const lossPct = ((state.balanceSol - state.startBalanceSol) / state.startBalanceSol) * 100;
  if (lossPct <= -(settings.dailyLossLimitPct || 15)) {
    console.log(`[Paper] ⛔ Daily loss limit: ${lossPct.toFixed(1)}%`);
    save(STATE_FILE, state);
    save(TRADES_FILE, trades);
    return;
  }

  // ── Max positions check ────────────────────────────────────────────────
  const openCount = Object.keys(state.positions).length;
  if (openCount >= (settings.maxPositions || 3)) {
    save(STATE_FILE, state);
    save(TRADES_FILE, trades);
    return;
  }

  // ── Scout candidates ───────────────────────────────────────────────────
  let candidates = [];
  try {
    const feedRes = await fetch(`https://public-api-v2.bags.fm/api/v1/token-launch/feed`, {
      headers: { 'x-api-key': BAGS_KEY }
    });
    const feed = await feedRes.json();
    if (feed?.response) candidates = feed.response.slice(0, 50);
  } catch {}

  // Add DexScreener boosted
  try {
    const boostRes = await fetch('https://api.dexscreener.com/token-boosts/top/v1');
    const boosts = await boostRes.json();
    if (Array.isArray(boosts)) {
      const solBoosts = boosts.filter(b => b.chainId === 'solana').slice(0, 30);
      solBoosts.forEach(b => candidates.push({ tokenMint: b.tokenAddress, symbol: b.tokenAddress?.slice(0, 6) }));
    }
  } catch {}

  console.log(`[Paper] Scanning ${candidates.length} candidates | Balance: ${state.balanceSol.toFixed(2)} SOL | Open: ${Object.keys(state.positions).length}`);
  let scored = 0;
  
  // Score and filter
  for (const token of candidates) {
    const mint = token.tokenMint;
    if (!mint) continue;

    // Skip if already holding
    if (state.positions[mint]) continue;

    // Blacklist
    if (settings.blacklist?.includes(mint)) continue;

    // Per-token cooldown (60min)
    if (state.tokenCooldowns[mint] && Date.now() - state.tokenCooldowns[mint] < 60 * 60 * 1000) continue;

    // Max 3 buys per token
    if ((state.tokenBuyCounts[mint] || 0) >= 3) continue;

    // Score using DexScreener
    let score = 0;
    try {
      const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
      const dexData = await dexRes.json();
      const p = dexData?.pairs?.find(pp => pp.chainId === 'solana') || dexData?.pairs?.[0];
      if (!p) continue;

      const symbol = p.baseToken?.symbol || token.symbol || mint.slice(0, 6);
      const liq = parseFloat(p.liquidity?.usd || 0);
      const vol24 = parseFloat(p.volume?.h24 || 0);
      const m5 = parseFloat(p.priceChange?.m5) || 0;
      const h1 = parseFloat(p.priceChange?.h1) || 0;
      const txns = p.txns?.h1 || {};
      const buys1h = txns.buys || 0;
      const sells1h = txns.sells || 0;
      const buyRatio = buys1h + sells1h > 0 ? buys1h / (buys1h + sells1h) : 0.5;
      const mcap = parseFloat(p.marketCap || p.fdv || 0);

      // Hard filters
      if (liq < 2000) continue;
      if (vol24 / liq > 15) continue;
      if (h1 < -25) continue;
      if (m5 < 3) continue;

      // Scoring (same as real agent)
      if (liq > 50000) score += 15; else if (liq > 20000) score += 10; else if (liq > 5000) score += 5;
      if (vol24 > 100000) score += 15; else if (vol24 > 50000) score += 10; else if (vol24 > 10000) score += 5;
      if (m5 > 10) score += 20; else if (m5 > 5) score += 15; else if (m5 > 3) score += 10;
      if (h1 > 20) score += 15; else if (h1 > 10) score += 10; else if (h1 > 5) score += 5;
      if (buyRatio > 0.70) score += 15; else if (buyRatio > 0.60) score += 10; else if (buyRatio > 0.55) score += 5;
      if (mcap > 50000 && mcap < 2000000) score += 10; else if (mcap > 10000 && mcap < 5000000) score += 5;
      if (buys1h + sells1h > 200) score += 10; else if (buys1h + sells1h > 50) score += 5;
      if (m5 > 20) score -= 10;
      if (h1 < -10) score -= 10;
      if (buyRatio < 0.4) score -= 15;

      // Session scoring
      const hour = new Date().getUTCHours();
      const session = hour >= 0 && hour < 8 ? 'asia' : hour >= 7 && hour < 15 ? 'europe' : hour >= 13 && hour < 22 ? 'us' : 'off';
      if (session === 'asia' && mcap < 500000 && m5 > 8) score += 10;
      if (session === 'europe' && h1 > 5 && liq > 20000) score += 10;
      if (session === 'us' && vol24 > 50000 && buys1h > sells1h * 1.5) score += 10;
      if (session === 'off') score -= 5;

      // Pattern recognition (local)
      try { const pr = patternRec.scorePattern(p); if (pr.score !== 0) score += pr.score; } catch {}

      if (score >= 50) scored++;
      if (score < (settings.minIntelScore || 75)) continue;
      console.log(`[Paper] ${symbol} scored ${score} — checking rug...`);

      // Rug check
      try {
        const risk = await rugDetector.checkRug(mint);
        if (!risk.safe) continue;
      } catch {}

      // BUY (paper)
      const priceNative = parseFloat(p.priceNative) || 0;
      if (!priceNative) continue;

      const positionPct = (settings.maxSolPerTrade || 35) / 100;
      const solToSpend = Math.min(state.balanceSol * positionPct, state.balanceSol - 0.05);
      if (solToSpend < 0.01) continue;

      const tokenAmount = solToSpend / priceNative;
      const solAfterSlippage = solToSpend * 1.005; // 0.5% slippage on buy

      state.balanceSol -= solAfterSlippage;
      state.positions[mint] = {
        symbol, mint,
        entryPrice: priceNative,
        solSpent: solAfterSlippage,
        tokenAmount,
        entryTime: new Date().toISOString(),
        score,
        partialExited: false,
        highPrice: priceNative,
      };
      state.tokenBuyCounts[mint] = (state.tokenBuyCounts[mint] || 0) + 1;
      state.tokenCooldowns[mint] = Date.now();

      trades.push({
        type: 'BUY', symbol, mint, solAmount: solAfterSlippage, score,
        time: new Date().toISOString()
      });

      console.log(`[Paper] 🟢 BUY $${symbol} | Score: ${score} | ${solAfterSlippage.toFixed(4)} SOL | Balance: ${state.balanceSol.toFixed(2)} SOL`);
      notifier.sendTelegram(`📝 PAPER 🟢 BUY $${symbol}\n📊 Score: ${score}\n💰 ${solAfterSlippage.toFixed(4)} SOL\n💼 Balance: ${state.balanceSol.toFixed(2)} SOL`);
      break; // one buy per tick
    } catch { continue; }
  }

  // Update peak
  const totalValue = state.balanceSol + Object.values(state.positions).reduce((s, p) => {
    const price = priceCache[p.mint]?.priceNative || p.entryPrice;
    return s + (p.tokenAmount * price);
  }, 0);
  if (totalValue > state.peakBalance) state.peakBalance = totalValue;

  save(STATE_FILE, state);
  save(TRADES_FILE, trades);
}

function start(intervalMs = 30000) {
  // Seed buy counts from REAL trade history so we never rebuy addicted tokens
  try {
    const realTrades = load(path.join(__dirname, '../../data/trades.json'), []);
    const state = load(STATE_FILE, { tokenBuyCounts: {} });
    let seeded = 0;
    realTrades.filter(t => t.type === 'BUY' && t.mint).forEach(t => {
      const real = (state.tokenBuyCounts[t.mint] || 0);
      // Only increase if real history has MORE buys than current count
      const realCount = realTrades.filter(r => r.type === 'BUY' && r.mint === t.mint).length;
      if (realCount > real) { state.tokenBuyCounts[t.mint] = realCount; seeded++; }
    });
    if (seeded > 0) { save(STATE_FILE, state); console.log(`[Paper] Seeded ${seeded} token buy counts from real trade history`); }
    const blocked = Object.entries(state.tokenBuyCounts).filter(([,c]) => c >= 3);
    if (blocked.length) console.log(`[Paper] ${blocked.length} tokens permanently blocked`);
  } catch {}

  console.log('📝 AUTOBAGS Paper Trader started — $2000 virtual | interval:', intervalMs / 1000 + 's');
  tick().catch(console.error);
  return setInterval(() => tick().catch(console.error), intervalMs);
}

module.exports = { start, tick };
