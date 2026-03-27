/**
 * AUTOBAGS — Trading Agent
 * Full pipeline: scout → score → buy → monitor → exit
 * Executes real on-chain swaps via Bags API + user custodial wallets
 */
// dotenv loaded by index.js — no need to re-load here

const { VersionedTransaction, Connection, LAMPORTS_PER_SOL } = require('@solana/web3.js');
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

const BAGS_KEY     = process.env.BAGS_API_KEY;
const PARTNER_KEY  = process.env.BAGS_PARTNER_KEY;
const SOL_MINT     = 'So11111111111111111111111111111111111111112';
const GAS_RESERVE  = 0.05; // always keep this SOL for fees

const POSITIONS_FILE   = path.join(__dirname, '../../data/positions.json');
const TRADES_FILE      = path.join(__dirname, '../../data/trades.json');
const SETTINGS_FILE    = path.join(__dirname, '../../data/settings.json');
const SUBSCRIBERS_FILE = path.join(__dirname, '../../data/subscribers.json');

const bags = new BagsClient(BAGS_KEY, process.env.SOLANA_RPC_URL);
const conn = new Connection(process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');

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
    dailyLossLimitPct: 0,     // 0 = disabled, otherwise stop trading if down X% today
    tradingHoursStart: 0,     // UTC hour (0-23), 0 = no restriction
    tradingHoursEnd: 0,       // UTC hour (0-23), 0 = no restriction
    minTokenAgeMinutes: 5,    // min token age in minutes
    maxTokenAgeHours: 48,     // max token age in hours (0 = no limit)
    minMarketCapUsd: 10000,   // minimum market cap
    maxMarketCapUsd: 0,       // 0 = no limit
    cooldownMinutes: 0,       // wait X min after a loss before next trade
    autoCompound: true,       // reinvest profits
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

  // 6. Submit via Bags
  const result = await bags.sendTransaction(signedB58);
  if (!result?.success) throw new Error('Send failed: ' + JSON.stringify(result));

  return {
    signature:  result.response,
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
    const pair = d?.pairs?.[0];
    return pair ? parseFloat(pair.priceUsd) : null;
  } catch { return null; }
}

// ── SOL balance ────────────────────────────────────────────────────────────────

async function getSolBalance(userId) {
  try {
    const { PublicKey } = require('@solana/web3.js');
    const pubkey  = WalletManager.getPublicKey(userId);
    const lamports = await conn.getBalance(new PublicKey(pubkey));
    return lamports / LAMPORTS_PER_SOL;
  } catch { return 0; }
}

// ── Main agent tick ───────────────────────────────────────────────────────────

async function tick() {
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

      if (posCount >= settings.maxPositions) {
        // Monitor existing positions
        await monitorPositions(userId, userPositions, settings, positions);
      } else {
        // Scout for new entry
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

  // Check daily loss limit
  if (settings.dailyLossLimitPct > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const trades = load(TRADES_FILE, []);
    const todayTrades = trades.filter(t => t.userId === userId && t.timestamp?.startsWith(today));
    const todayPnl = todayTrades.reduce((s, t) => s + (t.pnlSol || 0), 0);
    const balance = await getSolBalance(userId);
    if (balance > 0 && todayPnl < 0 && Math.abs(todayPnl / balance) * 100 >= settings.dailyLossLimitPct) {
      console.log(`[Scout] ${userId}: daily loss limit hit (${todayPnl.toFixed(4)} SOL)`);
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
  const allCandidates = [...tokens, ...trending].filter(t => t.tokenMint || t.mint || t.address);

  // Deduplicate
  const seen = new Set();
  const candidates = allCandidates.filter(t => {
    const mint = t.tokenMint || t.mint || t.address;
    if (seen.has(mint)) return false;
    seen.add(mint); return true;
  });

  console.log(`[Scout] ${userId}: checking ${candidates.length} candidates`);

  for (const token of candidates.slice(0, 10)) {
    const mint   = token.tokenMint || token.mint || token.address;
    const symbol = token.symbol || token.ticker || mint.slice(0, 8);
    if (!mint) continue;

    // Blacklist check
    if (settings.blacklist?.includes(mint)) { continue; }

    // Token age + market cap filter via DexScreener
    try {
      const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
      const dexData = await dexRes.json();
      const pair = dexData?.pairs?.[0];
      if (pair) {
        // Age filter
        const pairCreated = pair.pairCreatedAt ? new Date(pair.pairCreatedAt).getTime() : 0;
        if (pairCreated > 0) {
          const ageMinutes = (Date.now() - pairCreated) / 60000;
          if (settings.minTokenAgeMinutes && ageMinutes < settings.minTokenAgeMinutes) {
            console.log(`[Scout] Skip ${symbol}: too young (${Math.round(ageMinutes)}m < ${settings.minTokenAgeMinutes}m)`);
            continue;
          }
          if (settings.maxTokenAgeHours && ageMinutes > settings.maxTokenAgeHours * 60) {
            continue; // silently skip old tokens
          }
        }
        // Market cap filter
        const mcap = pair.marketCap || pair.fdv || 0;
        if (settings.minMarketCapUsd && mcap > 0 && mcap < settings.minMarketCapUsd) {
          console.log(`[Scout] Skip ${symbol}: mcap $${mcap} < $${settings.minMarketCapUsd}`);
          continue;
        }
        if (settings.maxMarketCapUsd && mcap > settings.maxMarketCapUsd) {
          continue;
        }
      }
    } catch {}

    // Score token (intel.py + enrichment data)
    const [scoreResult, enrichment] = await Promise.all([
      intel.scoreToken(mint, symbol).catch(() => ({ score: 0 })),
      dataSources.enrichToken(mint, symbol).catch(() => ({ enrichmentScore: 0 }))
    ]);

    // Combined score: 60% intel + 40% enrichment
    const intelScore = scoreResult?.score || 0;
    const enrichScore = enrichment?.enrichmentScore || 0;
    const score = Math.round(intelScore * 0.6 + enrichScore * 0.4);

    if (score < settings.minIntelScore) {
      console.log(`[Scout] Skip ${symbol}: score ${score} (intel:${intelScore} enrich:${enrichScore}) < ${settings.minIntelScore}`);
      continue;
    }

    const solToSpend = tradeable * (settings.maxSolPerTrade / 100);
    const lamports   = Math.floor(solToSpend * LAMPORTS_PER_SOL);

    console.log(`[Scout] ${userId}: BUYING ${symbol} (score: ${score}) — ${solToSpend.toFixed(4)} SOL`);

    try {
      const result = await executeSwap(userId, SOL_MINT, mint, lamports, settings.slippageBps);
      const entryPrice = await getTokenPrice(mint);

      // Record position (accumulate if already holding same token)
      if (!positions[userId]) positions[userId] = {};
      const existing = positions[userId][mint];
      if (existing) {
        // Accumulate — average entry price, sum tokens + SOL spent
        const oldTokens = BigInt(existing.tokensReceived);
        const newTokens = BigInt(result.outAmount);
        const totalTokens = oldTokens + newTokens;
        const totalSol = existing.solSpent + solToSpend;
        // Weighted average entry price
        const avgEntry = existing.entryPrice && entryPrice
          ? (existing.entryPrice * existing.solSpent + entryPrice * solToSpend) / totalSol
          : entryPrice || existing.entryPrice;
        positions[userId][mint] = {
          ...existing,
          entryPrice: avgEntry,
          entryPriceSOL: totalSol,
          tokensReceived: totalTokens.toString(),
          solSpent: totalSol,
          score: Math.max(existing.score, score),
          signature: result.signature
        };
      } else {
        positions[userId][mint] = {
          symbol,
          mint,
          entryPrice,
          entryPriceSOL: solToSpend,
          tokensReceived: result.outAmount,
          solSpent: solToSpend,
          entryTime: new Date().toISOString(),
          score,
          partialExited: false,
          signature: result.signature
        };
      }

      // Generate AI explanation async
      explainer.queueExplanation({
        type: 'BUY', symbol, mint, score, solAmount: solToSpend,
        details: { safety: scoreResult.safety?.verdict, liquidity: scoreResult.liquidity?.verdict,
                   holders: scoreResult.holders?.verdict, social: scoreResult.social?.verdict,
                   momentum: scoreResult.momentum?.verdict, sentiment: scoreResult.market?.sentiment }
      }, (explanation) => {
        // Append explanation to trade record
        const trades = load(TRADES_FILE, []);
        const idx = trades.findLastIndex(t => t.signature === result.signature);
        if (idx >= 0) { trades[idx].explanation = explanation; save(TRADES_FILE, trades); }
      });

      logTrade(userId, { type: 'BUY', symbol, mint, solAmount: solToSpend, score, signature: result.signature, entryPrice, explanation: 'Generating...' });
      notifier.notifyBuy({ userId, symbol, score, solAmount: solToSpend, signature: result.signature });
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
    const currentPrice = await getTokenPrice(mint);
    if (!currentPrice || !pos.entryPrice) continue;

    const pricePct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
    console.log(`[Monitor] ${userId} ${pos.symbol}: ${pricePct >= 0 ? '+' : ''}${pricePct.toFixed(2)}%`);

    let shouldSell = false;
    let reason = '';

    // Stop loss
    if (pricePct <= -settings.stopLossPct) { shouldSell = true; reason = `stop loss (${pricePct.toFixed(1)}%)`; }

    // Take profit
    if (pricePct >= settings.takeProfitPct) { shouldSell = true; reason = `take profit (+${pricePct.toFixed(1)}%)`; }

    // Partial exit (30% at partialExitPct threshold)
    if (!pos.partialExited && pricePct >= settings.partialExitPct) {
      console.log(`[Monitor] Partial exit ${pos.symbol} at +${pricePct.toFixed(1)}%`);
      try {
        const partialLamports = Math.floor(BigInt(pos.tokensReceived) * 30n / 100n);
        await executeSwap(userId, mint, SOL_MINT, Number(partialLamports), settings.slippageBps);
        allPositions[userId][mint].partialExited = true;
        logTrade(userId, { type: 'PARTIAL_SELL', symbol: pos.symbol, mint, reason: 'partial_exit', pricePct });
      } catch (err) {
        console.error(`[Monitor] Partial exit failed:`, err.message);
      }
    }

    if (shouldSell) {
      console.log(`[Monitor] ${userId}: SELLING ${pos.symbol} — ${reason}`);
      try {
        const tokensToSell = pos.tokensReceived;
        const result = await executeSwap(userId, mint, SOL_MINT, Number(tokensToSell), settings.slippageBps);
        const pnlSol = parseFloat(result.outAmount) / LAMPORTS_PER_SOL - pos.solSpent;

        delete allPositions[userId][mint];

        const holdMs = new Date() - new Date(pos.entryTime);
        const holdDuration = holdMs < 3600000 ? `${Math.round(holdMs/60000)}m` : `${(holdMs/3600000).toFixed(1)}h`;

        explainer.queueExplanation({
          type: 'SELL', symbol: pos.symbol, mint, reason, pnlPct: pricePct,
          holdDuration, entryPrice: pos.entryPrice, currentPrice: null
        }, (explanation) => {
          const trades = load(TRADES_FILE, []);
          const idx = trades.findLastIndex(t => t.signature === result.signature);
          if (idx >= 0) { trades[idx].explanation = explanation; save(TRADES_FILE, trades); }
        });

        logTrade(userId, { type: 'SELL', symbol: pos.symbol, mint, reason, pricePct, pnlSol, signature: result.signature, explanation: 'Generating...' });
        notifier.notifySell({ userId, symbol: pos.symbol, reason, pnlSol, pnlPct: pricePct, signature: result.signature });
        console.log(`[Agent] ✅ SELL ${pos.symbol} — P&L: ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL`);
      } catch (err) {
        console.error(`[Agent] Sell failed for ${pos.symbol}:`, err.message);
      }
    }
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

function start(intervalMs = 60000) {
  console.log('🤖 AUTOBAGS Agent started — interval:', intervalMs / 1000 + 's');
  tick().catch(console.error);
  return setInterval(() => tick().catch(console.error), intervalMs);
}

module.exports = { start, tick, executeSwap };

if (require.main === module) {
  start(60000);
}
