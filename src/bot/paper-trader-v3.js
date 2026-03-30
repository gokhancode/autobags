/**
 * AUTOBAGS Paper Trader v3 — Sura's Strategy
 * 
 * Built from 62 trades of data. The old bot bled out on stop losses
 * (-7.7 SOL from 22 SL trades) while take profits only made +6.35 SOL.
 * 
 * Key insights:
 * 1. Score >= 70 trades had 57% WR and +1.5% avg — below that is a coin flip
 * 2. 6 big losses (>10%) cost 4+ SOL — need to cut faster
 * 3. Trailing stops were NET NEGATIVE — they turned winners into losers
 * 4. Stale holds were basically free (only -0.36 SOL) — patience isn't the problem
 * 
 * My rules:
 * - Score 70+ ONLY. No exceptions. Quality > quantity.
 * - Cut losers at -3% HARD. Don't hope. Don't wait. Get out.
 * - Let winners breathe. No trailing until +6%. Then trail at -2.5% from peak.
 * - Take profit at +15%. The old 10% TP left meat on the bone.
 * - Max 3 positions. Focus > spray.
 * - 15% of balance per trade. Meaningful but not reckless.
 * - Never re-enter a token that lost money. Blacklist it for the session.
 * - Social sentiment > 40 required. Don't buy dead tokens nobody's talking about.
 */

const fs = require('fs');
const path = require('path');
const notifier = require('./notifier');

const STATE_FILE = path.join(__dirname, '../../data/paper-state-v3.json');
const TRADES_FILE = path.join(__dirname, '../../data/paper-trades-v3.json');
const BAGS_KEY = process.env.BAGS_API_KEY;

function load(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return def; } }
function save(f, d) { fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

// ── Price engine with pair locking ──────────────────────────────────────
const pairLocks = {};
const priceCache = {};

async function getPrice(mint) {
  const cached = priceCache[mint];
  if (cached && Date.now() - cached.time < 10000) return cached;

  try {
    if (pairLocks[mint]) {
      const r = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${pairLocks[mint]}`);
      const d = await r.json();
      const pair = d?.pair || d?.pairs?.[0];
      if (pair) {
        const result = { priceNative: parseFloat(pair.priceNative) || 0, priceUsd: parseFloat(pair.priceUsd) || 0, pair, time: Date.now() };
        priceCache[mint] = result;
        return result;
      }
    }
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const d = await r.json();
    const pair = (d?.pairs || [])
      .filter(p => p.chainId === 'solana' && parseFloat(p.liquidity?.usd || 0) > 1000)
      .sort((a, b) => parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0))[0];
    if (!pair) return null;
    const result = { priceNative: parseFloat(pair.priceNative) || 0, priceUsd: parseFloat(pair.priceUsd) || 0, pair, time: Date.now() };
    priceCache[mint] = result;
    return result;
  } catch { return null; }
}

// ── Scoring v3 — proven signals only ────────────────────────────────────

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

  // ── HARD REJECTS ──
  if (liq < 8000) return { score: 0, reasons: ['liq < $8k'] };
  if (vol24 / Math.max(liq, 1) > 15) return { score: 0, reasons: ['vol/liq ratio dangerous'] };
  // vol/liq > 8x on 1h = active dump in progress (data: SHARE, ANIME both had 6x+ before -20%+ losses)
  if (vol1h / Math.max(liq, 1) > 8) return { score: 0, reasons: ['1h vol/liq dump signal'] };
  if (m5 < 1) return { score: 0, reasons: ['no 5m momentum'] };
  if (m5 > 30) return { score: 0, reasons: ['already pumped'] };
  if (h1 > 60) return { score: 0, reasons: ['too late, h1 > 60%'] };
  if (h6 > 100) return { score: 0, reasons: ['way too late'] };
  if (mcap > 8000000) return { score: 0, reasons: ['mcap > $8M'] };
  if (mcap < 5000) return { score: 0, reasons: ['mcap too low'] };
  if (buys5m + sells5m < 3) return { score: 0, reasons: ['dead'] };
  
  // Sell pressure kill — if more sellers than buyers in last 5m, skip
  if (sells5m > buys5m * 1.5 && sells5m > 5) return { score: 0, reasons: ['sell dump'] };

  // ── LIQUIDITY (0-15) ──
  if (liq > 100000) { score += 15; reasons.push('deep liq'); }
  else if (liq > 50000) { score += 12; reasons.push('good liq'); }
  else if (liq > 20000) { score += 8; reasons.push('ok liq'); }
  else { score += 3; }

  // ── VOLUME ACCELERATION (0-25) — THE key signal from v2 data ──
  const avgHourlyVol = vol6h / 6;
  if (avgHourlyVol > 0) {
    const accel = vol1h / avgHourlyVol;
    if (accel > 5)      { score += 25; reasons.push(`vol 🚀${accel.toFixed(1)}x`); }
    else if (accel > 3) { score += 20; reasons.push(`vol ⬆️${accel.toFixed(1)}x`); }
    else if (accel > 2) { score += 15; reasons.push(`vol up ${accel.toFixed(1)}x`); }
    else if (accel > 1.3) { score += 8; reasons.push('vol rising'); }
  } else if (vol1h > 15000) {
    score += 15; reasons.push('fresh volume');
  }

  // ── BUY PRESSURE (0-20) ──
  const bp5m = buys5m / Math.max(buys5m + sells5m, 1);
  const bp1h = buys1h / Math.max(buys1h + sells1h, 1);

  if (bp5m > 0.70 && bp1h > 0.58) { score += 20; reasons.push('strong buys'); }
  else if (bp5m > 0.60 && bp1h > 0.52) { score += 13; reasons.push('buy dominant'); }
  else if (bp5m > 0.52) { score += 5; }
  else { score -= 10; reasons.push('weak buys'); }

  // ── PRICE ACTION (0-20) ──
  // Best: fresh breakout (5m up, 6h flat = START of move, not end)
  if (m5 > 5 && m5 < 20 && h1 > 0 && h6 < 30) {
    score += 20; reasons.push('fresh breakout');
  } else if (m5 > 3 && h1 > 0 && h1 < 40) {
    score += 12; reasons.push('momentum');
  } else if (m5 > 2) {
    score += 5;
  }

  // Penalize chasing
  if (h1 > 30) { score -= 8; reasons.push('chasing'); }

  // ── MARKET CAP SWEET SPOT (0-10) ──
  if (mcap > 30000 && mcap < 300000) { score += 10; reasons.push('micro'); }
  else if (mcap >= 300000 && mcap < 2000000) { score += 7; reasons.push('small cap'); }
  else if (mcap >= 2000000) { score += 3; }

  // ── ACTIVITY (0-10) ──
  const totalTxns = buys1h + sells1h;
  if (totalTxns > 300) { score += 10; reasons.push('very active'); }
  else if (totalTxns > 100) { score += 7; reasons.push('active'); }
  else if (totalTxns > 30) { score += 3; }

  return { score, reasons };
}

// ── Social intelligence check ───────────────────────────────────────────

async function getSocialScore(symbol, mint) {
  try {
    const twitter = require('./twitter-tracker');
    const result = await twitter.getFullSocialScore(symbol, mint);
    return {
      score: result.score || 0,
      hasRealPresence: result.hasRealPresence || false,
    };
  } catch { return { score: 0, hasRealPresence: false }; }
}

// ── Main tick ───────────────────────────────────────────────────────────

async function tick() {
  const state = load(STATE_FILE, {
    balanceSol: 20.29,
    startBalanceSol: 20.29,
    positions: {},
    totalTrades: 0,
    wins: 0,
    losses: 0,
    peakBalance: 20.29,
    blacklist: {},       // mint → reason (never re-enter losers)
    recentTrades: {},    // mint → timestamp
    feesAccumulated: 0,
    startedAt: new Date().toISOString()
  });

  const trades = load(TRADES_FILE, []);

  // Restore pair locks
  for (const [mint, pos] of Object.entries(state.positions)) {
    if (pos.pairAddress && !pairLocks[mint]) pairLocks[mint] = pos.pairAddress;
  }

  // ── Monitor positions (exits) ─────────────────────────────────────────
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
    const highPct = pos.highPrice ? ((pos.highPrice - pos.entryPrice) / pos.entryPrice) * 100 : 0;
    const fromHigh = pos.highPrice ? ((current - pos.highPrice) / pos.highPrice) * 100 : 0;

    // ── HARD STOP: -3% from entry. No exceptions. ──
    if (pricePct <= -3) {
      shouldSell = true;
      reason = `hard stop (${pricePct.toFixed(1)}%)`;
    }

    // ── TRAILING STOP: only activates after +6% from entry ──
    // After +6%: trail at -2.5% from peak
    // After +10%: trail at -2% from peak (tighter to lock gains)
    if (!shouldSell && highPct >= 10 && fromHigh < -2) {
      shouldSell = true;
      reason = `tight trail (peak +${highPct.toFixed(1)}%, dropped ${fromHigh.toFixed(1)}%)`;
    } else if (!shouldSell && highPct >= 6 && fromHigh < -2.5) {
      shouldSell = true;
      reason = `trail (peak +${highPct.toFixed(1)}%, dropped ${fromHigh.toFixed(1)}%)`;
    }

    // ── TAKE PROFIT: +15% ──
    if (!shouldSell && pricePct >= 15) {
      shouldSell = true;
      reason = `take profit (+${pricePct.toFixed(1)}%)`;
    }

    // ── STALE EXIT: 8 min and not moving ──
    if (!shouldSell && holdMin >= 8 && pricePct < 2) {
      shouldSell = true;
      reason = `stale (${Math.round(holdMin)}min, ${pricePct.toFixed(1)}%)`;
    }

    // ── EXTENDED HOLD: 15 min max regardless ──
    if (!shouldSell && holdMin >= 15) {
      shouldSell = true;
      reason = `max hold (${Math.round(holdMin)}min, ${pricePct.toFixed(1)}%)`;
    }

    if (shouldSell) {
      const fee = pos.solSpent * 0.005;
      const valueNow = (pos.tokenAmount * current) - fee;
      const pnlSol = valueNow - pos.solSpent;
      const pnlPct = (pnlSol / pos.solSpent) * 100;

      state.balanceSol += valueNow;
      state.feesAccumulated = (state.feesAccumulated || 0) + fee;
      delete state.positions[mint];
      state.totalTrades++;
      if (pnlSol > 0) state.wins++; else state.losses++;

      // Blacklist losers — never trade them again this session
      if (pnlPct < -1) {
        state.blacklist[mint] = `lost ${pnlPct.toFixed(1)}%`;
      }

      trades.push({
        type: 'SELL', symbol: pos.symbol, mint, reason,
        pnlSol: +pnlSol.toFixed(6), pnlPct: +pnlPct.toFixed(2),
        solReceived: +valueNow.toFixed(6), fee: +fee.toFixed(6),
        holdMinutes: +holdMin.toFixed(1),
        time: new Date().toISOString()
      });

      const emoji = pnlSol >= 0 ? '🟢' : '🔴';
      const totalPnlPct = ((state.balanceSol - state.startBalanceSol) / state.startBalanceSol * 100).toFixed(1);
      const msg = `📝 v3 ${emoji} SELL $${pos.symbol}\n💰 ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL (${pnlPct.toFixed(1)}%)\n⏱ ${holdMin.toFixed(0)}min | ${reason}\n💼 ${state.balanceSol.toFixed(2)} SOL (${totalPnlPct}%) | ${state.wins}W/${state.losses}L`;
      console.log(`[v3] ${emoji} SELL $${pos.symbol} | ${pnlPct.toFixed(1)}% | ${reason} | bal ${state.balanceSol.toFixed(2)}`);
      notifier.sendTelegram(msg);
    }
  }

  // ── Daily loss limit: -12% ────────────────────────────────────────────
  const sessionPnl = ((state.balanceSol - state.startBalanceSol) / state.startBalanceSol) * 100;
  if (sessionPnl <= -12) {
    save(STATE_FILE, state); save(TRADES_FILE, trades);
    return; // shut it down, regroup tomorrow
  }

  // ── Max 3 positions ───────────────────────────────────────────────────
  const openCount = Object.keys(state.positions).length;
  if (openCount >= 3) {
    save(STATE_FILE, state); save(TRADES_FILE, trades);
    return;
  }

  // ── Time gate: only trade proven profitable hours ─────────────────────
  // Data: 01-02 UTC (+13%), 08-09 UTC (+12%), 13 UTC (+5.9%)
  // Data: 15-18 UTC (-4.7% to -12%) = hard block
  const utcHour = new Date().getUTCHours();
  const BLOCKED_HOURS = [10, 11, 12, 15, 16, 17, 18, 19]; // data-proven bad
  if (BLOCKED_HOURS.includes(utcHour)) {
    save(STATE_FILE, state); save(TRADES_FILE, trades);
    return; // sit on hands
  }

  // ── Scout candidates ──────────────────────────────────────────────────
  let candidates = [];

  // Source 1: DexScreener boosted
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

  // Source 3: DexScreener profiles (tokens with effort behind them)
  try {
    const r = await fetch('https://api.dexscreener.com/token-profiles/latest/v1');
    const profiles = await r.json();
    if (Array.isArray(profiles)) {
      profiles.filter(p => p.chainId === 'solana').slice(0, 20).forEach(p => {
        if (p.tokenAddress && !candidates.find(c => c.mint === p.tokenAddress)) {
          candidates.push({ mint: p.tokenAddress });
        }
      });
    }
  } catch {}

  console.log(`[v3] Scanning ${candidates.length} candidates | ${state.balanceSol.toFixed(2)} SOL | ${openCount} open | ${state.wins}W/${state.losses}L`);

  let bestCandidate = null;
  let bestScore = 0;

  for (const c of candidates) {
    const mint = c.mint;
    if (!mint) continue;
    if (state.positions[mint]) continue;
    if (state.blacklist[mint]) continue; // never re-enter losers
    if (state.recentTrades[mint] && Date.now() - state.recentTrades[mint] < 60 * 60 * 1000) continue; // 1h cooldown

    const priceData = await getPrice(mint);
    if (!priceData?.pair) continue;

    const { score, reasons } = scoreCandidate(priceData.pair);
    if (score < 70) continue; // hard threshold — no compromises

    // Social intelligence — real presence check
    const symbol = priceData.pair.baseToken?.symbol;
    const socialData = await getSocialScore(symbol, mint);
    const socialScore = socialData.score;
    
    // Bonus for real social presence (up to +10)
    const socialBonus = socialScore > 60 ? 10 : socialScore > 30 ? 5 : 0;
    // Penalty for NO social presence at all — sketchy token
    const socialPenalty = (!socialData.hasRealPresence && socialScore < 10) ? -10 : 0;
    const finalScore = score + socialBonus + socialPenalty;

    if (finalScore > bestScore) {
      bestScore = finalScore;
      bestCandidate = { mint, score: finalScore, baseScore: score, socialScore, reasons, priceData };
    }

    await new Promise(r => setTimeout(r, 80));
  }

  // ── Execute ───────────────────────────────────────────────────────────
  if (bestCandidate) {
    const { mint, score, baseScore, socialScore, reasons, priceData } = bestCandidate;
    const pair = priceData.pair;
    const symbol = pair.baseToken?.symbol || mint.slice(0, 6);
    const priceNative = priceData.priceNative;

    pairLocks[mint] = pair.pairAddress;

    // 15% of balance per trade
    const solToSpend = Math.min(state.balanceSol * 0.15, state.balanceSol - 0.3);
    if (solToSpend < 0.1) {
      save(STATE_FILE, state); save(TRADES_FILE, trades);
      return;
    }

    const fee = solToSpend * 0.005;
    const solTotal = solToSpend + fee;
    const tokenAmount = solToSpend / priceNative;

    state.balanceSol -= solTotal;
    state.feesAccumulated = (state.feesAccumulated || 0) + fee;
    state.positions[mint] = {
      symbol, mint, entryPrice: priceNative,
      solSpent: solTotal, tokenAmount,
      entryTime: new Date().toISOString(),
      score, partialExited: false,
      highPrice: priceNative,
      pairAddress: pair.pairAddress,
    };
    state.recentTrades[mint] = Date.now();

    trades.push({
      type: 'BUY', symbol, mint, solAmount: +solTotal.toFixed(6),
      score, baseScore, socialScore,
      fee: +fee.toFixed(6), reasons: reasons.join(', '),
      time: new Date().toISOString()
    });

    const msg = `📝 v3 🟢 BUY $${symbol}\n📊 Score: ${score} (social: ${socialScore}) — ${reasons.join(', ')}\n💰 ${solTotal.toFixed(4)} SOL\n💼 ${state.balanceSol.toFixed(2)} SOL | ${openCount + 1} positions`;
    console.log(`[v3] 🟢 BUY $${symbol} | Score: ${score} (s:${socialScore}) | ${reasons.join(', ')}`);
    notifier.sendTelegram(msg);
  }

  // Track peak
  const totalValue = state.balanceSol + Object.values(state.positions).reduce((s, p) => {
    const cached = priceCache[p.mint];
    const price = cached?.priceNative || p.entryPrice;
    return s + (p.tokenAmount * price);
  }, 0);
  if (totalValue > (state.peakBalance || 0)) state.peakBalance = totalValue;

  save(STATE_FILE, state);
  save(TRADES_FILE, trades);
}

// ── Start ───────────────────────────────────────────────────────────────

function start(intervalMs = 15000) {
  console.log('📝 AUTOBAGS Paper Trader v3 — Sura\'s Strategy');
  console.log('   Score 70+ | -3% SL | +15% TP | trail after +6% | max 3 positions');
  console.log('   Built from 62 trades of data. Quality > quantity.');
  tick().catch(console.error);
  return setInterval(() => tick().catch(console.error), intervalMs);
}

module.exports = { start, tick, scoreCandidate };
