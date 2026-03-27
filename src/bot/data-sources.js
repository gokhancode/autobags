/**
 * AUTOBAGS — Extended Data Sources
 * Whale tracking, social signals, on-chain analytics
 * All free-tier APIs
 */

// ── Whale / Smart Money Tracking ────────────────────────────────────────────

// Known smart money wallets (Solana memecoin whales)
const WHALE_WALLETS = [
  // Add known profitable trader wallets here
  // Format: { address, label }
];

/**
 * Check if whales have been buying a token recently
 * Uses Solscan or Helius (when available)
 */
async function checkWhaleActivity(mint) {
  try {
    // Use DexScreener for now — check if large txs exist
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await res.json();
    const pair = data?.pairs?.[0];
    if (!pair) return { whaleScore: 0 };

    const vol24h = parseFloat(pair.volume?.h24 || 0);
    const liq = parseFloat(pair.liquidity?.usd || 0);
    const txns = pair.txns?.h24 || {};
    const buys = txns.buys || 0;
    const sells = txns.sells || 0;
    const buyPressure = buys + sells > 0 ? buys / (buys + sells) : 0.5;

    // Large avg tx size suggests whale activity
    const avgTxSize = (buys + sells) > 0 ? vol24h / (buys + sells) : 0;
    const whaleIndicator = avgTxSize > 1000 ? 1 : avgTxSize > 500 ? 0.7 : avgTxSize > 100 ? 0.4 : 0.1;

    return {
      whaleScore: Math.round(whaleIndicator * buyPressure * 100),
      buyPressure: Math.round(buyPressure * 100),
      avgTxSizeUsd: Math.round(avgTxSize),
      vol24h,
      buys,
      sells
    };
  } catch {
    return { whaleScore: 0 };
  }
}

// ── Social Signal Detection ─────────────────────────────────────────────────

/**
 * Check social presence and buzz for a token
 * Uses multiple free sources
 */
async function checkSocialSignals(mint, symbol) {
  const signals = { socialScore: 0, twitterMentions: 0, hasWebsite: false, hasTelegram: false };

  try {
    // 1. DexScreener social links
    const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const dexData = await dexRes.json();
    const pair = dexData?.pairs?.[0];
    if (pair?.info?.websites?.length) signals.hasWebsite = true;
    if (pair?.info?.socials?.length) {
      const twitter = pair.info.socials.find(s => s.type === 'twitter');
      const telegram = pair.info.socials.find(s => s.type === 'telegram');
      if (twitter) signals.twitterMentions += 1; // has twitter = base signal
      if (telegram) signals.hasTelegram = true;
    }

    // 2. Check CoinGecko for listing (listed = more legit)
    try {
      const cgRes = await fetch(`https://api.coingecko.com/api/v3/search?query=${symbol}`, {
        headers: { 'Accept': 'application/json' }
      });
      const cgData = await cgRes.json();
      const match = cgData?.coins?.find(c =>
        c.symbol?.toLowerCase() === symbol?.toLowerCase()
      );
      if (match) signals.socialScore += 20; // CoinGecko listed
    } catch {}

    // 3. Compute social score
    let score = 0;
    if (signals.hasWebsite) score += 25;
    if (signals.twitterMentions > 0) score += 25;
    if (signals.hasTelegram) score += 15;
    score += signals.socialScore;
    signals.socialScore = Math.min(100, score);

  } catch {}

  return signals;
}

// ── Holder Analysis ─────────────────────────────────────────────────────────

/**
 * Analyze holder distribution
 * Concentrated holdings = risky
 */
async function analyzeHolders(mint) {
  try {
    // Use Birdeye-style analysis via DexScreener pair data
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await res.json();
    const pair = data?.pairs?.[0];
    if (!pair) return { holderScore: 50 };

    const liq = parseFloat(pair.liquidity?.usd || 0);
    const mcap = pair.marketCap || pair.fdv || 0;
    const liqRatio = mcap > 0 ? liq / mcap : 0;

    // Good liquidity ratio = better distribution
    let score = 50;
    if (liqRatio > 0.3) score += 20;  // very liquid
    if (liqRatio > 0.1) score += 10;  // decent
    if (liqRatio < 0.02) score -= 30; // rug risk

    return {
      holderScore: Math.max(0, Math.min(100, score)),
      liquidityUsd: liq,
      marketCapUsd: mcap,
      liqRatio: parseFloat(liqRatio.toFixed(4))
    };
  } catch {
    return { holderScore: 50 };
  }
}

// ── Momentum Analysis ───────────────────────────────────────────────────────

/**
 * Multi-timeframe momentum check
 */
async function checkMomentum(mint) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const data = await res.json();
    const pair = data?.pairs?.[0];
    if (!pair) return { momentumScore: 0 };

    const m5  = parseFloat(pair.priceChange?.m5  || 0);
    const h1  = parseFloat(pair.priceChange?.h1  || 0);
    const h6  = parseFloat(pair.priceChange?.h6  || 0);
    const h24 = parseFloat(pair.priceChange?.h24 || 0);

    // Positive across timeframes = strong momentum
    let score = 50;
    if (m5 > 0)  score += 15;
    if (h1 > 0)  score += 15;
    if (h6 > 0)  score += 10;
    if (h24 > 0) score += 10;

    // Accelerating momentum bonus
    if (m5 > h1 && h1 > 0) score += 10; // accelerating

    // Red flags
    if (m5 < -5)  score -= 20; // dumping
    if (h1 < -10) score -= 15;

    return {
      momentumScore: Math.max(0, Math.min(100, score)),
      priceChange: { m5, h1, h6, h24 }
    };
  } catch {
    return { momentumScore: 0 };
  }
}

// ── Combined Enrichment ─────────────────────────────────────────────────────

/**
 * Get all enriched data for a token
 * Returns combined score and all signals
 */
async function enrichToken(mint, symbol) {
  const [whale, social, holders, momentum] = await Promise.allSettled([
    checkWhaleActivity(mint),
    checkSocialSignals(mint, symbol),
    analyzeHolders(mint),
    checkMomentum(mint)
  ]);

  const w = whale.status === 'fulfilled' ? whale.value : { whaleScore: 0 };
  const s = social.status === 'fulfilled' ? social.value : { socialScore: 0 };
  const h = holders.status === 'fulfilled' ? holders.value : { holderScore: 50 };
  const m = momentum.status === 'fulfilled' ? momentum.value : { momentumScore: 0 };

  // Weighted enrichment score
  const enrichmentScore = Math.round(
    w.whaleScore * 0.2 +
    s.socialScore * 0.2 +
    h.holderScore * 0.3 +
    m.momentumScore * 0.3
  );

  return {
    enrichmentScore,
    whale: w,
    social: s,
    holders: h,
    momentum: m
  };
}

module.exports = {
  checkWhaleActivity,
  checkSocialSignals,
  analyzeHolders,
  checkMomentum,
  enrichToken,
  WHALE_WALLETS
};
