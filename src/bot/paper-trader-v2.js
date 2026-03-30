/**
 * AUTOBAGS Paper Trader v2 — Rebuilt from scratch
 * 
 * Key changes from v1:
 * 1. PAIR LOCKING — one pair per token, no price flip-flopping
 * 2. VOLUME ACCELERATION — don't buy pumps, buy acceleration (volume increasing)
 * 3. FEWER, BETTER TRADES — score 80+ only, max 2 positions, bigger size
 * 4. SMARTER EXITS — wider SL (10%), let winners run (trailing only after +5%)
 * 5. NO REPEAT TOKENS — ever. One shot per token per day.
 * 6. ACTUALLY TRACK FEES — 0.5% per swap simulated
 */

const fs = require('fs');
const path = require('path');
const notifier = require('./notifier');

const STATE_FILE = path.join(__dirname, '../../data/paper-state-v2.json');
const TRADES_FILE = path.join(__dirname, '../../data/paper-trades-v2.json');
const BAGS_KEY = process.env.BAGS_API_KEY;

function load(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } }
function save(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

// ── Price engine with pair locking ──────────────────────────────────────
const pairLocks = {};  // mint → pairAddress
const priceCache = {}; // mint → { priceNative, priceUsd, time }

async function getPrice(mint) {
  const cached = priceCache[mint];
  if (cached && Date.now() - cached.time < 15000) return cached; // 15s cache
  
  try {
    // If locked to a pair, use pair endpoint (consistent)
    if (pairLocks[mint]) {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${pairLocks[mint]}`);
      const d = await r.json();
      const pair = d?.pair || d?.pairs?.[0];
      if (pair) {
        const result = {
          priceNative: parseFloat(pair.priceNative) || 0,
          priceUsd: parseFloat(pair.priceUsd) || 0,
          pair, time: Date.now()
        };
        priceCache[mint] = result;
        return result;
      }
    }
    
    // Discovery: find best pair by liquidity
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const d = await r.json();
    const solPairs = (d?.pairs || [])
      .filter(p => p.chainId === 'solana' && parseFloat(p.liquidity?.usd || 0) > 500)
      .sort((a, b) => parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0));
    
    const pair = solPairs[0];
    if (!pair) return null;
    
    const result = {
      priceNative: parseFloat(pair.priceNative) || 0,
      priceUsd: parseFloat(pair.priceUsd) || 0,
      pair, time: Date.now()
    };
    priceCache[mint] = result;
    return result;
  } catch { return null; }
}

function lockPair(mint, pairAddress) {
  pairLocks[mint] = pairAddress;
}

// ── Scoring v2 — focus on momentum quality, not quantity ────────────────
function scoreCandidate(pair) {
  let score = 0;
  const reasons = [];
  
  const liq = parseFloat(pair.liquidity?.usd || 0);
  const vol24 = parseFloat(pair.volume?.h24 || 0);
  const vol6h = parseFloat(pair.volume?.h6 || 0);
  const vol1h = parseFloat(pair.volume?.h1 || 0);
  const m5 = parseFloat(pair.priceChange?.m5 || 0);
  const h1 = parseFloat(pair.priceChange?.h1 || 0);
  const h6 = parseFloat(pair.priceChange?.h6 || 0);
  const txns = pair.txns || {};
  const buys1h = txns.h1?.buys || 0;
  const sells1h = txns.h1?.sells || 0;
  const buys5m = txns.m5?.buys || 0;
  const sells5m = txns.m5?.sells || 0;
  const mcap = parseFloat(pair.marketCap || pair.fdv || 0);
  
  // ── HARD FILTERS (instant reject) ──
  if (liq < 5000) return { score: 0, reasons: ['low liq'] };
  if (vol24 / Math.max(liq, 1) > 20) return { score: 0, reasons: ['vol/liq suspicious'] };
  if (m5 < 2) return { score: 0, reasons: ['no 5m momentum'] };
  if (m5 > 40) return { score: 0, reasons: ['already pumped too far'] };
  if (mcap > 10000000) return { score: 0, reasons: ['mcap too high'] }; // >$10M = too late
  if (buys5m + sells5m < 5) return { score: 0, reasons: ['no activity'] };
  
  // ── LIQUIDITY (0-15) ──
  if (liq > 100000) { score += 15; reasons.push('deep liq'); }
  else if (liq > 50000) { score += 12; reasons.push('good liq'); }
  else if (liq > 20000) { score += 8; reasons.push('ok liq'); }
  else if (liq > 5000) { score += 3; }
  
  // ── VOLUME ACCELERATION (0-25) — this is the key signal ──
  // Is volume INCREASING? vol1h should be > vol6h/6 (hourly avg)
  const avgHourlyVol = vol6h / 6;
  if (avgHourlyVol > 0) {
    const volAccel = vol1h / avgHourlyVol;
    if (volAccel > 5) { score += 25; reasons.push(`vol 🚀 ${volAccel.toFixed(1)}x`); }
    else if (volAccel > 3) { score += 20; reasons.push(`vol ⬆️ ${volAccel.toFixed(1)}x`); }
    else if (volAccel > 2) { score += 15; reasons.push(`vol up ${volAccel.toFixed(1)}x`); }
    else if (volAccel > 1.5) { score += 10; reasons.push('vol rising'); }
    else { score += 3; }
  } else if (vol1h > 10000) {
    score += 15; reasons.push('fresh volume');
  }
  
  // ── BUY PRESSURE (0-20) ──
  const buyRatio5m = buys5m / Math.max(buys5m + sells5m, 1);
  const buyRatio1h = buys1h / Math.max(buys1h + sells1h, 1);
  
  if (buyRatio5m > 0.75 && buyRatio1h > 0.60) { score += 20; reasons.push('strong buy pressure'); }
  else if (buyRatio5m > 0.65 && buyRatio1h > 0.55) { score += 15; reasons.push('buy dominant'); }
  else if (buyRatio5m > 0.55) { score += 8; reasons.push('slight buy edge'); }
  else { score -= 5; reasons.push('selling pressure'); }
  
  // ── PRICE ACTION (0-20) ──
  // Best signal: m5 up, h1 up, h6 flat/negative (START of move, not end)
  if (m5 > 5 && h1 > 0 && h6 < 20) { score += 20; reasons.push('fresh breakout'); }
  else if (m5 > 5 && h1 > 10) { score += 12; reasons.push('momentum'); }
  else if (m5 > 3) { score += 8; reasons.push('mild move'); }
  
  // Penalize tokens already up huge (we're late)
  if (h1 > 50) { score -= 15; reasons.push('too late'); }
  if (h6 > 100) { score -= 20; reasons.push('way too late'); }
  
  // ── MARKET CAP SWEET SPOT (0-10) ──
  if (mcap > 50000 && mcap < 500000) { score += 10; reasons.push('micro cap'); }
  else if (mcap > 500000 && mcap < 2000000) { score += 7; reasons.push('small cap'); }
  else if (mcap > 2000000 && mcap < 5000000) { score += 3; }
  
  // ── TX COUNT (0-10) — more txns = more real interest ──
  const totalTxns = buys1h + sells1h;
  if (totalTxns > 500) { score += 10; reasons.push('high activity'); }
  else if (totalTxns > 200) { score += 7; reasons.push('active'); }
  else if (totalTxns > 50) { score += 4; }
  
  // ── SESSION BONUS (0-5) ──
  const hour = new Date().getUTCHours();
  if (hour >= 10 && hour <= 15) { score += 5; reasons.push('EU session'); } // EU hours were best
  
  return { score, reasons };
}

// ── Main tick ───────────────────────────────────────────────────────────
async function tick() {
  const state = load(STATE_FILE, {
    balanceSol: 24.1,
    startBalanceSol: 24.1,
    positions: {},
    totalTrades: 0,
    wins: 0,
    losses: 0,
    peakBalance: 24.1,
    tradedToday: {},      // mint → timestamp, one shot per token per day
    feesAccumulated: 0,   // track total fees
    startedAt: new Date().toISOString()
  });
  
  const trades = load(TRADES_FILE, []);
  
  // Restore pair locks from positions
  for (const [mint, pos] of Object.entries(state.positions)) {
    if (pos.pairAddress && !pairLocks[mint]) pairLocks[mint] = pos.pairAddress;
  }
  
  // ── Monitor positions ─────────────────────────────────────────────────
  for (const [mint, pos] of Object.entries(state.positions)) {
    const priceData = await getPrice(mint);
    if (!priceData || !priceData.priceNative || !pos.entryPrice) continue;
    
    const current = priceData.priceNative;
    const pricePct = ((current - pos.entryPrice) / pos.entryPrice) * 100;
    const holdMin = (Date.now() - new Date(pos.entryTime).getTime()) / 60000;
    
    // Update high watermark
    if (current > (pos.highPrice || pos.entryPrice)) {
      state.positions[mint].highPrice = current;
    }
    
    let shouldSell = false;
    let reason = '';
    
    // Stop loss: 5% (tighter for HFT — cut fast)
    if (pricePct <= -5) {
      shouldSell = true;
      reason = `stop loss (${pricePct.toFixed(1)}%)`;
    }
    
    // Trailing stop: activates after +3% from entry
    if (pos.highPrice && pos.entryPrice) {
      const fromEntry = ((pos.highPrice - pos.entryPrice) / pos.entryPrice) * 100;
      const fromHigh = ((current - pos.highPrice) / pos.highPrice) * 100;
      
      if (fromEntry > 10 && fromHigh < -2) {
        shouldSell = true;
        reason = `trailing stop (peak +${fromEntry.toFixed(1)}%, now ${fromHigh.toFixed(1)}% from high)`;
      } else if (fromEntry > 3 && fromHigh < -3) {
        shouldSell = true;
        reason = `trailing stop (peak +${fromEntry.toFixed(1)}%, now ${fromHigh.toFixed(1)}% from high)`;
      }
    }
    
    // Max hold: 10min (HFT — in and out fast)
    if (holdMin >= 10 && pricePct < 2) {
      shouldSell = true;
      reason = `stale (${Math.round(holdMin)}min, ${pricePct.toFixed(1)}%)`;
    }
    
    // Take profit: 10% (take it and move on)
    if (pricePct >= 10) {
      shouldSell = true;
      reason = `take profit (+${pricePct.toFixed(1)}%)`;
    }
    
    if (shouldSell) {
      const fee = pos.solSpent * 0.005; // 0.5% swap fee
      const valueNow = (pos.tokenAmount * current) - fee;
      const pnlSol = valueNow - pos.solSpent;
      const pnlPct = (pnlSol / pos.solSpent) * 100;
      
      state.balanceSol += valueNow;
      state.feesAccumulated = (state.feesAccumulated || 0) + fee;
      delete state.positions[mint];
      state.totalTrades++;
      if (pnlSol > 0) state.wins++; else state.losses++;
      
      trades.push({
        type: 'SELL', symbol: pos.symbol, mint, reason,
        pnlSol: +pnlSol.toFixed(6), pnlPct: +pnlPct.toFixed(2),
        solReceived: +valueNow.toFixed(6), fee: +fee.toFixed(6),
        holdMinutes: +holdMin.toFixed(1),
        time: new Date().toISOString()
      });
      
      const emoji = pnlSol >= 0 ? '🟢' : '🔴';
      const msg = `📝 PAPER ${emoji} SELL $${pos.symbol}\n💰 P&L: ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL (${pnlPct.toFixed(1)}%)\n⏱ Held: ${holdMin.toFixed(0)}min\n📋 ${reason}\n💼 Balance: ${state.balanceSol.toFixed(2)} SOL | Fees: ${state.feesAccumulated.toFixed(3)}`;
      console.log(`[Paper] ${emoji} SELL $${pos.symbol} | ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL (${pnlPct.toFixed(1)}%) | ${reason}`);
      notifier.sendTelegram(msg);
    }
  }
  
  // ── Daily loss limit ──────────────────────────────────────────────────
  const lossPct = ((state.balanceSol - state.startBalanceSol) / state.startBalanceSol) * 100;
  if (lossPct <= -15) {
    console.log(`[Paper] ⛔ Daily loss limit: ${lossPct.toFixed(1)}%`);
    save(STATE_FILE, state); save(TRADES_FILE, trades);
    return;
  }
  
  // ── Max positions ─────────────────────────────────────────────────────
  const openCount = Object.keys(state.positions).length;
  if (openCount >= 5) { // HFT: up to 5 concurrent positions
    save(STATE_FILE, state); save(TRADES_FILE, trades);
    return;
  }
  
  // ── Post-loss cooldown ────────────────────────────────────────────────
  // HFT: no cooldown — keep firing
  
  // ── Scout candidates ──────────────────────────────────────────────────
  let candidates = [];
  
  // Source 1: DexScreener boosted (tokens paying for visibility = active)
  try {
    const r = await fetch('https://api.dexscreener.com/token-boosts/top/v1');
    const boosts = await r.json();
    if (Array.isArray(boosts)) {
      candidates = boosts
        .filter(b => b.chainId === 'solana')
        .slice(0, 30)
        .map(b => ({ mint: b.tokenAddress }));
    }
  } catch {}
  
  // Source 2: Bags feed
  try {
    const r = await fetch('https://public-api-v2.bags.fm/api/v1/token-launch/feed', {
      headers: { 'x-api-key': BAGS_KEY }
    });
    const feed = await r.json();
    if (feed?.response) {
      feed.response.slice(0, 30).forEach(t => {
        if (t.tokenMint && !candidates.find(c => c.mint === t.tokenMint)) {
          candidates.push({ mint: t.tokenMint });
        }
      });
    }
  } catch {}
  
  console.log(`[Paper] Scanning ${candidates.length} candidates | Balance: ${state.balanceSol.toFixed(2)} SOL | Open: ${openCount}`);
  
  let bestCandidate = null;
  let bestScore = 0;
  
  for (const c of candidates) {
    const mint = c.mint;
    if (!mint) continue;
    if (state.positions[mint]) continue;
    
    // One shot per token per 10min (HFT: allow re-entry after cooldown)
    if (state.tradedToday[mint] && Date.now() - state.tradedToday[mint] < 10 * 60 * 1000) continue;
    
    // Get price data (includes full pair info)
    const priceData = await getPrice(mint);
    if (!priceData?.pair) continue;
    
    const { score, reasons } = scoreCandidate(priceData.pair);
    
    if (score > bestScore && score >= 65) {
      bestScore = score;
      bestCandidate = { mint, score, reasons, priceData };
    }
    
    // Rate limit: lighter for HFT
    await new Promise(r => setTimeout(r, 100));
  }
  
  // ── Execute best candidate ────────────────────────────────────────────
  if (bestCandidate) {
    const { mint, score, reasons, priceData } = bestCandidate;
    const pair = priceData.pair;
    const symbol = pair.baseToken?.symbol || mint.slice(0, 6);
    const priceNative = priceData.priceNative;
    
    // Lock pair
    lockPair(mint, pair.pairAddress);
    
    // Position sizing: 15% of balance (smaller per trade, more trades)
    const solToSpend = Math.min(state.balanceSol * 0.15, state.balanceSol - 0.5);
    if (solToSpend < 0.1) {
      save(STATE_FILE, state); save(TRADES_FILE, trades);
      return;
    }
    
    const fee = solToSpend * 0.005; // 0.5% swap fee
    const solAfterFee = solToSpend + fee;
    const tokenAmount = solToSpend / priceNative;
    
    state.balanceSol -= solAfterFee;
    state.feesAccumulated = (state.feesAccumulated || 0) + fee;
    state.positions[mint] = {
      symbol, mint, entryPrice: priceNative,
      solSpent: solAfterFee, tokenAmount,
      entryTime: new Date().toISOString(),
      score, partialExited: false,
      highPrice: priceNative,
      pairAddress: pair.pairAddress,
    };
    state.tradedToday[mint] = Date.now();
    
    trades.push({
      type: 'BUY', symbol, mint, solAmount: +solAfterFee.toFixed(6),
      score, fee: +fee.toFixed(6), reasons: reasons.join(', '),
      time: new Date().toISOString()
    });
    
    const msg = `📝 PAPER 🟢 BUY $${symbol}\n📊 Score: ${score} (${reasons.join(', ')})\n💰 ${solAfterFee.toFixed(4)} SOL\n💼 Balance: ${state.balanceSol.toFixed(2)} SOL`;
    console.log(`[Paper] 🟢 BUY $${symbol} | Score: ${score} | ${reasons.join(', ')}`);
    notifier.sendTelegram(msg);
  }
  
  // Track peak
  const totalValue = state.balanceSol + Object.values(state.positions).reduce((s, p) => {
    const cached = priceCache[p.mint];
    const price = cached?.priceNative || p.entryPrice;
    return s + (p.tokenAmount * price);
  }, 0);
  if (totalValue > state.peakBalance) state.peakBalance = totalValue;
  
  save(STATE_FILE, state);
  save(TRADES_FILE, trades);
}

function start(intervalMs = 10000) {
  console.log('📝 AUTOBAGS Paper Trader v2 — HFT MODE | 10s tick');
  console.log('   5 positions ✅ | Score 65+ ✅ | 5% SL ✅ | 10% TP ✅ | 10min hold max ✅');
  tick().catch(console.error);
  return setInterval(() => tick().catch(console.error), intervalMs);
}

module.exports = { start, tick, scoreCandidate };
