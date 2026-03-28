/**
 * AUTOBAGS — Trading Agent
 * Full pipeline: scout → score → buy → monitor → exit
 * Executes real on-chain swaps via Bags API + user custodial wallets
 */
// dotenv loaded by index.js — no need to re-load here

const { VersionedTransaction, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58         = require('bs58');
const fs           = require('fs');
const path         = require('path');
const BagsClient   = require('./bags-client');
const WalletManager = require('./wallet-manager');
const intel        = require('./intel-bridge');
const explainer    = require('./trade-explainer');
const notifier     = require('./notifier');
const dataSources  = require('./data-sources');
const equity       = require('./equity-tracker');
const birdeye      = require('./birdeye');
const whaleTracker = require('./whale-tracker');
const social       = require('./social-scanner');
const priceFeed    = require('./ws-feed');
const jito         = require('./jito');
const rugDetector  = require('./rug-detector');
const dynParams    = require('./dynamic-params');
const patternRec   = require('./pattern-recognition');
const holderTrack  = require('./holder-tracker');
const jupiterApi   = require('./jupiter');

const BAGS_KEY     = process.env.BAGS_API_KEY;
const PARTNER_KEY  = process.env.BAGS_PARTNER_KEY;
const SOL_MINT     = 'So11111111111111111111111111111111111111112';
const GAS_RESERVE  = 0.05; // always keep this SOL for fees

const POSITIONS_FILE   = path.join(__dirname, '../../data/positions.json');
const TRADES_FILE      = path.join(__dirname, '../../data/trades.json');
const SETTINGS_FILE    = path.join(__dirname, '../../data/settings.json');
const SUBSCRIBERS_FILE = path.join(__dirname, '../../data/subscribers.json');

const bags = new BagsClient(BAGS_KEY, process.env.SOLANA_RPC_URL);
const rpc  = require('../rpc');

// ── Data helpers ─────────────────────────────────────────────────────────────

function load(file, def) {
  try { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : def; }
  catch { return def; }
}
function save(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function getSettings(userId) {
  const all = load(SETTINGS_FILE, {});
  const defaults = {
    mode:'basic', riskLevel:'medium', active:true,
    stopLossPct:8, takeProfitPct:25, partialExitPct:10,
    maxSolPerTrade:80, minIntelScore:65, slippageBps:100, maxPositions:1,
    // New settings
    dailyLossLimitPct: 15,    // stop trading if wallet down X% from deposit
    depositedSol: 1.192,     // total SOL deposited to wallet
    tradingHoursStart: 0,     // UTC hour (0-23), 0 = no restriction
    tradingHoursEnd: 0,       // UTC hour (0-23), 0 = no restriction
    minTokenAgeMinutes: 5,    // min token age in minutes
    maxTokenAgeHours: 48,     // max token age in hours (0 = no limit)
    minMarketCapUsd: 10000,   // minimum market cap
    maxMarketCapUsd: 0,       // 0 = no limit
    cooldownMinutes: 5,        // 5min cooldown after a losing trade
    autoCompound: true,       // reinvest profits
    trailingStopPct: 2,       // trailing stop: sell if drops X% from high
    maxHoldMinutes: 15,       // max hold time before stale exit
    blacklist: []
  };
  const presets = {
    low:    { stopLossPct:5, takeProfitPct:15, minIntelScore:75, maxSolPerTrade:50 },
    medium: { stopLossPct:8, takeProfitPct:25, minIntelScore:65, maxSolPerTrade:80 },
    high:   { stopLossPct:12, takeProfitPct:40, minIntelScore:55, maxSolPerTrade:95 }
  };
  const s = { ...defaults, ...(all[userId] || {}) };
  if (s.mode === 'basic') Object.assign(s, presets[s.riskLevel] || presets.medium);
  return s;
}
function logTrade(userId, trade) {
  const trades = load(TRADES_FILE, []);
  trades.push({ userId, ...trade, timestamp: new Date().toISOString() });
  save(TRADES_FILE, trades);
}
function getActiveUsers() {
  const subs = load(SUBSCRIBERS_FILE, {});
  return Object.keys(subs).filter(uid => {
    if (!WalletManager.exists(uid)) return false;
    const s = getSettings(uid);
    return s.active !== false;
  });
}

// ── Swap execution ────────────────────────────────────────────────────────────

async function executeSwap(userId, inputMint, outputMint, lamports, slippageBps = 100) {
  // 1. Get quote
  const quote = await bags.getTradeQuote({ inputMint, outputMint, amount: lamports, slippageBps });
  if (!quote?.success || !quote?.response?.requestId) throw new Error('Quote failed: ' + JSON.stringify(quote));

  // 2. Build swap tx
  const userPubkey = WalletManager.getPublicKey(userId);
  const swapResp   = await bags.createSwapTransaction({
    quoteResponse: quote.response,
    walletPublicKey: userPubkey,
    partnerKey: PARTNER_KEY
  });
  if (!swapResp?.success || !swapResp?.response?.swapTransaction)
    throw new Error('Swap tx build failed: ' + JSON.stringify(swapResp));

  // 3. Deserialize VersionedTransaction from base58
  const txBytes   = bs58.decode(swapResp.response.swapTransaction);
  const vtx       = VersionedTransaction.deserialize(txBytes);

  // 4. Sign with user keypair
  const keypair   = WalletManager.getKeypair(userId);
  vtx.sign([keypair]);

  // 5. Re-serialize to base58
  const signedB58 = bs58.encode(vtx.serialize());

  // 6. Submit — use Jito for trades >= 0.1 SOL for MEV protection, else normal
  let result;
  const solAmount = lamports / LAMPORTS_PER_SOL;
  if (solAmount >= 0.1) {
    try {
      console.log(`[Swap] Using Jito MEV protection (${solAmount.toFixed(3)} SOL)`);
      result = await jito.sendWithJito(signedB58);
    } catch (jitoErr) {
      console.log(`[Swap] Jito failed (${jitoErr.message}), falling back to Bags`);
      result = await bags.sendTransaction(signedB58);
      if (!result?.success) throw new Error('Send failed: ' + JSON.stringify(result));
      result = { signature: result.response };
    }
  } else {
    result = await bags.sendTransaction(signedB58);
    if (!result?.success) throw new Error('Send failed: ' + JSON.stringify(result));
    result = { signature: result.response };
  }

  return {
    signature:  result.signature || result.response,
    inAmount:   quote.response.inAmount,
    outAmount:  quote.response.outAmount,
    inputMint,
    outputMint,
    priceImpact: quote.response.priceImpactPct
  };
}

// ── Price check (DexScreener) ─────────────────────────────────────────────────

async function getTokenPrice(mint) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const d = await r.json();
    // Always use highest-liquidity pair — random pair selection caused phantom P&L
    const solPairs = (d?.pairs || []).filter(p => p.chainId === 'solana' && parseFloat(p.liquidity?.usd || 0) > 0);
    solPairs.sort((a, b) => parseFloat(b.liquidity?.usd || 0) - parseFloat(a.liquidity?.usd || 0));
    const pair = solPairs[0] || d?.pairs?.[0];
    return pair ? parseFloat(pair.priceUsd) : null;
  } catch { return null; }
}

// ── SOL balance ────────────────────────────────────────────────────────────────

async function getSolBalance(userId, commitment = 'confirmed') {
  try {
    const { PublicKey } = require('@solana/web3.js');
    const pubkey = WalletManager.getPublicKey(userId);
    return await rpc.withRetry(async (conn) => {
      const lamports = await conn.getBalance(new PublicKey(pubkey), commitment);
      return lamports / LAMPORTS_PER_SOL;
    });
  } catch { return 0; }
}

async function waitForConfirmation(signature, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const status = await rpc.withRetry(async (conn) => conn.getSignatureStatus(signature));
      if (status?.value?.confirmationStatus === 'confirmed' || status?.value?.confirmationStatus === 'finalized') return true;
    } catch {}
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

// ── Main agent tick ───────────────────────────────────────────────────────────

let tickLock = false;

async function tick() {
  if (tickLock) { console.log('[Agent] Tick skipped — previous still running'); return; }
  tickLock = true;
  try { await _tick(); } finally { tickLock = false; }
}

async function _tick() {
  const users = getActiveUsers();
  if (!users.length) return;

  const positions = load(POSITIONS_FILE, {});

  for (const userId of users) {
    const settings = getSettings(userId);
    try {
      // Snapshot equity every tick (tracker deduplicates to 5min intervals)
      const bal = await getSolBalance(userId);
      equity.snapshot(userId, bal);

      const userPositions = positions[userId] || {};
      const posCount = Object.keys(userPositions).length;

      // ALWAYS monitor existing positions first
      if (posCount > 0) {
        await monitorPositions(userId, userPositions, settings, positions);
      }

      // Then scout for new entries if slots available
      if (posCount < settings.maxPositions) {
        await scout(userId, settings, positions);
      }
    } catch (err) {
      console.error(`[Agent] Error for ${userId}:`, err.message);
    }
  }

  save(POSITIONS_FILE, positions);
}

// ── Scout ─────────────────────────────────────────────────────────────────────

async function scout(userId, settings, positions) {
  // Check trading hours
  if (settings.tradingHoursStart || settings.tradingHoursEnd) {
    const hour = new Date().getUTCHours();
    const start = settings.tradingHoursStart;
    const end = settings.tradingHoursEnd;
    if (start < end) {
      if (hour < start || hour >= end) return; // outside window
    } else if (start > end) {
      if (hour < start && hour >= end) return; // overnight window
    }
  }

  // Check daily loss limit — ACTUAL wallet balance only (not trusting position tracker)
  if (settings.dailyLossLimitPct > 0) {
    const balance = await getSolBalance(userId, 'confirmed');
    // Don't count open positions at cost basis — that's a lie
    // Use wallet balance as conservative estimate (tokens could be worth 0)
    const deposited = settings.depositedSol || 1.192;
    const lossPct = ((balance - deposited) / deposited) * 100;
    if (lossPct <= -settings.dailyLossLimitPct) {
      console.log(`[Scout] ⛔ ${userId}: DAILY LOSS LIMIT HIT — wallet ${balance.toFixed(4)} SOL = ${lossPct.toFixed(1)}% from ${deposited} deposited (limit: -${settings.dailyLossLimitPct}%)`);
      return;
    }
  }

  // Check cooldown after loss
  if (settings.cooldownMinutes > 0) {
    const trades = load(TRADES_FILE, []);
    const lastSell = trades.filter(t => t.userId === userId && t.type === 'SELL').pop();
    if (lastSell && (lastSell.pnlSol || 0) < 0) {
      const msSinceLoss = Date.now() - new Date(lastSell.timestamp).getTime();
      if (msSinceLoss < settings.cooldownMinutes * 60000) {
        console.log(`[Scout] ${userId}: cooldown (${Math.round((settings.cooldownMinutes * 60000 - msSinceLoss) / 60000)}m left)`);
        return;
      }
    }
  }

  const balance = await getSolBalance(userId);
  const tradeable = balance - GAS_RESERVE;
  if (tradeable < 0.01) {
    console.log(`[Scout] ${userId}: balance too low (${balance.toFixed(4)} SOL)`);
    return;
  }

  const tokenFeed = await bags.getTokenFeed().catch(() => null);
  const tokens = Array.isArray(tokenFeed?.response) ? tokenFeed.response : [];
  const trending = intel.getTrendingTokens();

  // Add DexScreener boosted tokens (higher quality, real volume)
  let boosted = [];
  try {
    const bRes = await fetch('https://api.dexscreener.com/token-boosts/top/v1');
    const bData = await bRes.json();
    boosted = (bData || []).filter(b => b.chainId === 'solana').slice(0, 30).map(b => ({
      mint: b.tokenAddress, symbol: b.description?.split(' ')?.[0] || '???', source: 'dex-boosted'
    }));
  } catch {}

  // Add extra candidate sources (throttled — only fetch every 5th tick to avoid rate limits)
  let birdeyeTrending = [], whaleCandidates = [], socialTrending = [];
  if (!global._scoutTickCount) global._scoutTickCount = 0;
  global._scoutTickCount++;
  if (global._scoutTickCount % 5 === 0) {
    try { birdeyeTrending = await birdeye.getTrending(); } catch {}
    try { whaleCandidates = await whaleTracker.getWhaleCandidates(); } catch {}
    try { socialTrending = await social.getSocialTrending(); } catch {}
  }

  const allCandidates = [...boosted, ...birdeyeTrending, ...whaleCandidates, ...socialTrending, ...tokens, ...trending].filter(t => t.tokenMint || t.mint || t.address);

  // Deduplicate
  const seen = new Set();
  const candidates = allCandidates.filter(t => {
    const mint = t.tokenMint || t.mint || t.address;
    if (seen.has(mint)) return false;
    seen.add(mint); return true;
  });

  console.log(`[Scout] ${userId}: checking ${candidates.length} candidates`);

  for (const token of candidates.slice(0, 30)) {
    const mint   = token.tokenMint || token.mint || token.address;
    const symbol = token.symbol || token.ticker || mint.slice(0, 8);
    if (!mint) continue;

    // Blacklist check
    if (settings.blacklist?.includes(mint)) { continue; }

    // Per-token cooldown: don't rebuy a token within 60 minutes of ANY trade on it
    if (!global._tokenCooldowns) global._tokenCooldowns = {};
    const lastTraded = global._tokenCooldowns[mint];
    if (lastTraded && Date.now() - lastTraded < 60 * 60 * 1000) {
      continue;
    }

    // Max 3 buys per token EVER — stop the addiction loop
    if (!global._tokenBuyCounts) global._tokenBuyCounts = {};
    const buyCount = global._tokenBuyCounts[mint] || 0;
    if (buyCount >= 3) {
      continue; // permanently skip — bought this token too many times
    }

    // Single DexScreener fetch — filter + score in one pass
    let score = 0;
    try {
      const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
      const dexData = await dexRes.json();
      const p = dexData?.pairs?.find(x => x.chainId === 'solana') || dexData?.pairs?.[0];
      if (!p) continue;

      // Age filter
      if (settings.minTokenAgeMinutes || settings.maxTokenAgeHours) {
        const pairCreated = p.pairCreatedAt ? new Date(p.pairCreatedAt).getTime() : 0;
        if (pairCreated > 0) {
          const ageMinutes = (Date.now() - pairCreated) / 60000;
          if (settings.minTokenAgeMinutes && ageMinutes < settings.minTokenAgeMinutes) continue;
          if (settings.maxTokenAgeHours && ageMinutes > settings.maxTokenAgeHours * 60) continue;
        }
      }

      // Market cap filter
      const mcapVal = parseFloat(p.marketCap || p.fdv || 0);
      if (settings.minMarketCapUsd && mcapVal > 0 && mcapVal < settings.minMarketCapUsd) continue;
      if (settings.maxMarketCapUsd && mcapVal > settings.maxMarketCapUsd) continue;

      const liq = parseFloat(p.liquidity?.usd || 0);
      const vol24 = parseFloat(p.volume?.h24 || 0);
      const m5 = parseFloat(p.priceChange?.m5) || 0;
      const h1 = parseFloat(p.priceChange?.h1) || 0;
      const txns = p.txns?.h1 || {};
      const buys1h = txns.buys || 0;
      const sells1h = txns.sells || 0;
      const buyRatio = buys1h + sells1h > 0 ? buys1h / (buys1h + sells1h) : 0.5;

      // Rug filters (hard block)
      if (liq < 2000) continue;
      if (vol24 / liq > 15) continue;
      if (h1 < -25) continue;

      // Require 5m momentum
      if (m5 < 3) continue;

      // Scoring (same as sim — proven profitable)
      if (liq > 50000) score += 15; else if (liq > 20000) score += 10; else if (liq > 5000) score += 5;
      if (vol24 > 100000) score += 15; else if (vol24 > 50000) score += 10; else if (vol24 > 10000) score += 5;
      if (m5 > 10) score += 20; else if (m5 > 5) score += 15; else if (m5 > 3) score += 10;
      if (h1 > 20) score += 15; else if (h1 > 10) score += 10; else if (h1 > 5) score += 5;
      if (buyRatio > 0.70) score += 15; else if (buyRatio > 0.60) score += 10; else if (buyRatio > 0.55) score += 5;
      if (mcapVal > 50000 && mcapVal < 2000000) score += 10; else if (mcapVal > 10000 && mcapVal < 5000000) score += 5;
      if (buys1h + sells1h > 200) score += 10; else if (buys1h + sells1h > 50) score += 5;
      if (m5 > 20) score -= 10;
      if (h1 < -10) score -= 10;
      if (buyRatio < 0.4) score -= 15;

      // Session-aware scoring adjustment
      const hour = new Date().getUTCHours();
      const session = hour >= 0 && hour < 8 ? 'asia' : hour >= 7 && hour < 15 ? 'europe' : hour >= 13 && hour < 22 ? 'us' : 'off';
      if (session === 'asia' && mcapVal < 500000 && m5 > 8) score += 10;
      if (session === 'europe' && h1 > 5 && liq > 20000) score += 10;
      if (session === 'us' && vol24 > 50000 && buys1h > sells1h * 1.5) score += 10;
      if (session === 'off') score -= 5;

      // Pattern recognition (local, no API call)
      try { const pr = patternRec.scorePattern(p); if (pr.score !== 0) score += pr.score; } catch {}

      // ONLY call external APIs if base score is promising (>= 55) to avoid rate limits
      if (score >= 55) {
        try { const be = await birdeye.scoreBirdeye(mint); if (be.score > 0) score += Math.min(15, be.score); } catch {}
        try { const soc = await social.scoreSocial(symbol, mint); if (soc.score > 0) score += Math.min(10, soc.score); } catch {}
        try {
          const ws = await whaleTracker.getWhaleSignal(mint);
          if (ws.score > 0) { score += Math.min(15, ws.score); console.log(`[Scout] 🐋 ${symbol}: whale signal +${ws.score}`); }
        } catch {}
        try { const hg = await holderTrack.scoreHolderGrowth(mint); if (hg.score !== 0) score += hg.score; } catch {}
      }

      score = Math.max(0, Math.min(100, score));
    } catch { continue; }

    if (score < settings.minIntelScore) {
      console.log(`[Scout] Skip ${symbol}: score ${score} < ${settings.minIntelScore}`);
      continue;
    }

    // DUPLICATE-MINT CHECK — never buy something we already hold
    if (positions[userId] && positions[userId][mint]) {
      console.log(`[Scout] Skip ${symbol}: already holding this token`);
      continue;
    }

    // Rug detection check — skip if too risky
    try {
      const risk = await rugDetector.assessRisk(mint);
      if (!risk.safe) {
        console.log(`[Scout] Skip ${symbol}: rug risk ${risk.riskScore}/100 — ${risk.flags[0]}`);
        continue;
      }
    } catch {}

    console.log(`[Scout] ✅ ${symbol} passed! Score: ${score} — proceeding to buy`);

    // Check actual balance right before swap to avoid overspending
    const freshBalance = await getSolBalance(userId);
    const freshTradeable = freshBalance - GAS_RESERVE;
    if (freshTradeable < 0.01) { console.log(`[Scout] ${userId}: insufficient balance for trade`); break; }
    const solToSpend = Math.min(freshTradeable * (settings.maxSolPerTrade / 100), freshTradeable);
    const lamports   = Math.floor(solToSpend * LAMPORTS_PER_SOL);

    console.log(`[Scout] ${userId}: BUYING ${symbol} (score: ${score}) — ${solToSpend.toFixed(4)} SOL`);

    try {
      // Check balance BEFORE swap
      const balBefore = await getSolBalance(userId, 'confirmed');
      const result = await executeSwap(userId, SOL_MINT, mint, lamports, settings.slippageBps);
      // Wait for tx to confirm before checking balance
      if (result.signature) await waitForConfirmation(result.signature);
      await new Promise(r => setTimeout(r, 3000));
      const balAfter = await getSolBalance(userId, 'confirmed');
      const actualSpent = Math.max(0, balBefore - balAfter);
      const entryPrice = await getTokenPrice(mint);

      console.log(`[Scout] ${userId}: Actually spent ${actualSpent.toFixed(6)} SOL (intended ${solToSpend.toFixed(4)})`);

      // Record position — accumulate if already held (shouldn't happen with mint check but safety net)
      if (!positions[userId]) positions[userId] = {};
      if (positions[userId][mint]) {
        // Accumulate — add to existing position
        const existing = positions[userId][mint];
        existing.solSpent = (existing.solSpent || 0) + actualSpent;
        existing.entryPrice = (existing.entryPrice + entryPrice) / 2; // avg
        console.log(`[Agent] Accumulated into ${symbol}: total spent ${existing.solSpent.toFixed(6)} SOL`);
        save(POSITIONS_FILE, positions);
        logTrade(userId, { type: 'BUY', symbol, mint, solAmount: actualSpent, score, signature: result.signature, entryPrice });
        notifier.notifyBuy({ userId, symbol, score, solAmount: actualSpent, signature: result.signature });
        // Track buy count + cooldown
        if (!global._tokenBuyCounts) global._tokenBuyCounts = {};
        global._tokenBuyCounts[mint] = (global._tokenBuyCounts[mint] || 0) + 1;
        if (!global._tokenCooldowns) global._tokenCooldowns = {};
        global._tokenCooldowns[mint] = Date.now();
        break;
      }
      positions[userId][mint] = {
        symbol,
        mint,
        entryPrice,
        solSpent: actualSpent,
        entryTime: new Date().toISOString(),
        score,
        partialExited: false,
        highPrice: entryPrice,
        signature: result.signature
      };

      logTrade(userId, { type: 'BUY', symbol, mint, solAmount: actualSpent, score, signature: result.signature, entryPrice });
      notifier.notifyBuy({ userId, symbol, score, solAmount: actualSpent, signature: result.signature });
      // Track buy count + cooldown
      if (!global._tokenBuyCounts) global._tokenBuyCounts = {};
      global._tokenBuyCounts[mint] = (global._tokenBuyCounts[mint] || 0) + 1;
      if (!global._tokenCooldowns) global._tokenCooldowns = {};
      global._tokenCooldowns[mint] = Date.now();
      priceFeed.subscribe(mint, symbol); // Start real-time monitoring
      console.log(`[Agent] ✅ BUY ${symbol} — sig: ${result.signature?.slice(0, 20)}...`);
      break; // one buy per tick
    } catch (err) {
      console.error(`[Agent] Buy failed for ${symbol}:`, err.message);
    }
  }
}

// ── Monitor positions ─────────────────────────────────────────────────────────

async function monitorPositions(userId, userPositions, settings, allPositions) {
  for (const [mint, pos] of Object.entries(userPositions)) {
    // Use WebSocket feed price if available (5s updates), fallback to DexScreener
    let currentPrice = priceFeed.getPrice(mint);
    if (!currentPrice) currentPrice = await getTokenPrice(mint);
    if (!currentPrice || !pos.entryPrice) continue;

    const pricePct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;

    // Dynamic SL/TP — adapts to volatility, session, regime, and streak
    let dynSL = settings.stopLossPct;
    let dynTP = settings.takeProfitPct;
    let dynTrailing = settings.trailingStopPct || 2;
    try {
      const dp = await dynParams.getDynamicParams(mint, pos.symbol, settings);
      dynSL = dp.stopLoss;
      dynTP = dp.takeProfit;
      dynTrailing = dp.trailingStop || dynTrailing;
      if (dp.stopLoss !== settings.stopLossPct || dp.takeProfit !== settings.takeProfitPct) {
        console.log(`[Monitor] ${pos.symbol}: dynamic params SL=${dynSL.toFixed(1)}% TP=${dynTP.toFixed(1)}% (base: SL=${settings.stopLossPct}% TP=${settings.takeProfitPct}%)`);
      }
    } catch {}

    console.log(`[Monitor] ${userId} ${pos.symbol}: ${pricePct >= 0 ? '+' : ''}${pricePct.toFixed(2)}%`);

    let shouldSell = false;
    let reason = '';

    // Stop loss (dynamic)
    if (pricePct <= -dynSL) { shouldSell = true; reason = `stop loss (${pricePct.toFixed(1)}%, limit -${dynSL.toFixed(1)}%)`; }

    // Take profit (dynamic)
    if (pricePct >= dynTP) { shouldSell = true; reason = `take profit (+${pricePct.toFixed(1)}%, target +${dynTP.toFixed(1)}%)`; }

    // Partial exit (50% at partialExitPct threshold) — matches sim
    if (!pos.partialExited && pricePct >= settings.partialExitPct && !shouldSell) {
      console.log(`[Monitor] Partial exit ${pos.symbol} at +${pricePct.toFixed(1)}%`);
      try {
        // Get actual on-chain token balance
        const { PublicKey } = require('@solana/web3.js');
        const pubkey = WalletManager.getPublicKey(userId);
        let tokenAmount = '0';
        for (const progId of ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']) {
          if (tokenAmount !== '0') break;
          try {
            const ta = await rpc.withRetry(async (conn) => {
              return conn.getParsedTokenAccountsByOwner(new PublicKey(pubkey), { mint: new PublicKey(mint), programId: new PublicKey(progId) });
            });
            tokenAmount = ta.value?.[0]?.account?.data?.parsed?.info?.tokenAmount?.amount || '0';
          } catch {}
        }
        const halfTokens = Math.floor(parseInt(tokenAmount) / 2);
        if (halfTokens > 0) {
          const balBefore = await getSolBalance(userId, 'confirmed');
          const partialResult = await executeSwap(userId, mint, SOL_MINT, halfTokens, settings.slippageBps);
          if (partialResult.signature) await waitForConfirmation(partialResult.signature);
          await new Promise(r => setTimeout(r, 3000));
          const balAfter = await getSolBalance(userId, 'confirmed');
          const received = Math.max(0, balAfter - balBefore);
          allPositions[userId][mint].partialExited = true;
          allPositions[userId][mint].solSpent = pos.solSpent / 2; // halve the cost basis
          save(POSITIONS_FILE, allPositions);
          logTrade(userId, { type: 'PARTIAL_SELL', symbol: pos.symbol, mint, reason: 'partial_exit', pricePct, solReceived: received });
          console.log(`[Monitor] Partial exit done — received ${received.toFixed(6)} SOL`);
        }
      } catch (err) {
        console.error(`[Monitor] Partial exit failed:`, err.message);
      }
      continue; // sim does continue after partial
    }

    // Max hold time exit
    if (settings.maxHoldMinutes) {
      const holdMin = (Date.now() - new Date(pos.entryTime).getTime()) / 60000;
      if (holdMin >= settings.maxHoldMinutes && pricePct < 2) {
        shouldSell = true; reason = `stale position (${Math.round(holdMin)}min, ${pricePct.toFixed(1)}%)`;
      }
    }

    // Trailing stop: if was up 3%+ then drops 2% from high
    if (pos.highPrice && pos.entryPrice) {
      const fromHigh = ((currentPrice - pos.highPrice) / pos.highPrice) * 100;
      const fromEntry = ((pos.highPrice - pos.entryPrice) / pos.entryPrice) * 100;
      if (fromEntry > 3 && fromHigh < -dynTrailing) {
        shouldSell = true; reason = `trailing stop (${fromHigh.toFixed(1)}% from high)`;
      }
    }

    // Track high watermark
    if (currentPrice > (pos.highPrice || pos.entryPrice)) {
      allPositions[userId][mint].highPrice = currentPrice;
      save(POSITIONS_FILE, allPositions);
    }

    if (shouldSell) {
      console.log(`[Monitor] ${userId}: SELLING ${pos.symbol} — ${reason}`);
      try {
        // Get ACTUAL on-chain token balance to sell
        const { PublicKey } = require('@solana/web3.js');
        const pubkey = WalletManager.getPublicKey(userId);
        let tokensToSell = '0';
        // Check both SPL and Token-2022 programs
        for (const progId of ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']) {
          if (tokensToSell !== '0') break;
          try {
            const tokenAccounts = await rpc.withRetry(async (conn) => {
              return conn.getParsedTokenAccountsByOwner(new PublicKey(pubkey), { mint: new PublicKey(mint), programId: new PublicKey(progId) });
            });
            tokensToSell = tokenAccounts.value?.[0]?.account?.data?.parsed?.info?.tokenAmount?.amount || '0';
          } catch {}
        }
        if (tokensToSell === '0') { console.error(`[Monitor] No tokens found for ${pos.symbol}`); continue; }
        
        // Measure ACTUAL SOL received — wait for tx confirmation first
        const balBefore = await getSolBalance(userId, 'confirmed');
        const result = await executeSwap(userId, mint, SOL_MINT, Number(tokensToSell), settings.slippageBps);
        if (result.signature) await waitForConfirmation(result.signature);
        await new Promise(r => setTimeout(r, 3000)); // extra buffer for RPC
        const balAfter = await getSolBalance(userId, 'confirmed');
        const actualReceived = Math.max(0, balAfter - balBefore);
        const pnlSol = actualReceived - pos.solSpent;

        delete allPositions[userId][mint];
        priceFeed.unsubscribe(mint); // Stop real-time monitoring

        const holdMs = new Date() - new Date(pos.entryTime);
        const holdDuration = holdMs < 3600000 ? `${Math.round(holdMs/60000)}m` : `${(holdMs/3600000).toFixed(1)}h`;
        const realPnlPct = pos.solSpent > 0 ? ((actualReceived - pos.solSpent) / pos.solSpent * 100) : 0;

        console.log(`[Monitor] ${userId}: Received ${actualReceived.toFixed(6)} SOL (spent ${pos.solSpent.toFixed(6)}) → P&L: ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL (${realPnlPct.toFixed(1)}%)`);

        logTrade(userId, { type: 'SELL', symbol: pos.symbol, mint, reason, pricePct: realPnlPct, pnlSol, solReceived: actualReceived, signature: result.signature });
        notifier.notifySell({ userId, symbol: pos.symbol, reason, pnlSol, pnlPct: realPnlPct, signature: result.signature });
        // Set per-token cooldown so we don't rebuy this token for 30 min
        if (!global._tokenCooldowns) global._tokenCooldowns = {};
        global._tokenCooldowns[mint] = Date.now();
        console.log(`[Monitor] ${pos.symbol}: 30min cooldown set`);
        console.log(`[Agent] ✅ SELL ${pos.symbol} — P&L: ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL (${realPnlPct.toFixed(1)}%)`);
      } catch (err) {
        console.error(`[Agent] Sell failed for ${pos.symbol}:`, err.message);
      }
    }
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

function start(intervalMs = 60000) {
  console.log('🤖 AUTOBAGS Agent started — interval:', intervalMs / 1000 + 's');
  
  // Load historical buy counts so we don't re-buy tokens we've already traded too many times
  try {
    const trades = load(TRADES_FILE, []);
    global._tokenBuyCounts = {};
    global._tokenCooldowns = {};
    trades.filter(t => t.type === 'BUY').forEach(t => {
      if (t.mint) global._tokenBuyCounts[t.mint] = (global._tokenBuyCounts[t.mint] || 0) + 1;
    });
    const overTraded = Object.entries(global._tokenBuyCounts).filter(([,c]) => c >= 3);
    if (overTraded.length) console.log(`[Agent] ${overTraded.length} tokens permanently skipped (3+ buys):`, overTraded.map(([m]) => m.slice(0,8)).join(', '));
  } catch {}
  
  tick().catch(console.error);
  return setInterval(() => tick().catch(console.error), intervalMs);
}

module.exports = { start, tick, executeSwap };

if (require.main === module) {
  start(60000);
}
