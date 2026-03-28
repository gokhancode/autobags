/**
 * AUTOBAGS — Birdeye API Integration
 * Free tier: 1000 req/day, rate limit 10/min
 * Provides: real-time price, OHLCV, trader count, token overview
 */

const BIRDEYE_BASE = 'https://public-api.birdeye.so';
// Free tier — no API key needed for public endpoints
// For higher limits, add BIRDEYE_API_KEY to .env

const cache = new Map();
const CACHE_TTL = 30_000; // 30s cache

function cached(key, ttl = CACHE_TTL) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttl) return entry.data;
  return null;
}

/**
 * Get token price + metadata from Birdeye
 */
async function getTokenOverview(mint) {
  const cacheKey = `overview:${mint}`;
  const hit = cached(cacheKey);
  if (hit) return hit;

  try {
    const headers = { 'accept': 'application/json' };
    if (process.env.BIRDEYE_API_KEY) {
      headers['X-API-KEY'] = process.env.BIRDEYE_API_KEY;
    }
    
    const res = await fetch(`${BIRDEYE_BASE}/defi/token_overview?address=${mint}`, { 
      headers, 
      signal: AbortSignal.timeout(5000) 
    });
    
    if (!res.ok) return null;
    const data = await res.json();
    const d = data?.data;
    if (!d) return null;

    const result = {
      price: d.price,
      priceChange24h: d.priceChange24hPercent,
      priceChange1h: d.priceChange1hPercent,
      priceChange5m: d.priceChange5mPercent,
      volume24h: d.v24hUSD,
      volume1h: d.v1hUSD,
      liquidity: d.liquidity,
      mc: d.mc,
      holder: d.holder,
      trade24h: d.trade24h,
      buy24h: d.buy24h,
      sell24h: d.sell24h,
      uniqueWallet24h: d.uniqueWallet24h,
      uniqueWallet1h: d.uniqueWallet1hChangePercent,
      lastTradeUnixTime: d.lastTradeUnixTime,
      supply: d.supply,
      symbol: d.symbol,
      name: d.name,
    };

    cache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  } catch (err) {
    console.error(`[Birdeye] Error fetching ${mint}:`, err.message);
    return null;
  }
}

/**
 * Get OHLCV candles for a token
 * @param {string} mint
 * @param {string} type - 1m, 5m, 15m, 1H, 4H, 1D
 * @param {number} timeFrom - unix timestamp
 * @param {number} timeTo - unix timestamp
 */
async function getOHLCV(mint, type = '5m', timeFrom, timeTo) {
  const cacheKey = `ohlcv:${mint}:${type}`;
  const hit = cached(cacheKey, 60_000);
  if (hit) return hit;

  try {
    if (!timeFrom) timeFrom = Math.floor(Date.now() / 1000) - 3600; // last hour
    if (!timeTo) timeTo = Math.floor(Date.now() / 1000);
    
    const headers = { 'accept': 'application/json' };
    if (process.env.BIRDEYE_API_KEY) headers['X-API-KEY'] = process.env.BIRDEYE_API_KEY;

    const url = `${BIRDEYE_BASE}/defi/ohlcv?address=${mint}&type=${type}&time_from=${timeFrom}&time_to=${timeTo}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;

    const data = await res.json();
    const items = data?.data?.items || [];
    
    cache.set(cacheKey, { data: items, ts: Date.now() });
    return items;
  } catch (err) {
    console.error(`[Birdeye] OHLCV error for ${mint}:`, err.message);
    return null;
  }
}

/**
 * Get trending tokens on Birdeye
 */
async function getTrending() {
  const cacheKey = 'trending';
  const hit = cached(cacheKey, 120_000); // 2min cache
  if (hit) return hit;

  try {
    const headers = { 'accept': 'application/json' };
    if (process.env.BIRDEYE_API_KEY) headers['X-API-KEY'] = process.env.BIRDEYE_API_KEY;

    const res = await fetch(`${BIRDEYE_BASE}/defi/token_trending?sort_by=rank&sort_type=asc&offset=0&limit=20`, {
      headers, signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return [];

    const data = await res.json();
    const tokens = (data?.data?.tokens || []).map(t => ({
      mint: t.address,
      symbol: t.symbol,
      name: t.name,
      price: t.price,
      priceChange24h: t.priceChange24hPercent,
      volume24h: t.v24hUSD,
      liquidity: t.liquidity,
      mc: t.mc,
      source: 'birdeye-trending'
    }));

    cache.set(cacheKey, { data: tokens, ts: Date.now() });
    return tokens;
  } catch {
    return [];
  }
}

/**
 * Score token using Birdeye data (supplement DexScreener scoring)
 */
async function scoreBirdeye(mint) {
  const overview = await getTokenOverview(mint);
  if (!overview) return { score: 0, data: null };

  let score = 0;

  // Unique wallet growth (more unique wallets = real interest, not wash trading)
  if (overview.uniqueWallet24h > 500) score += 10;
  else if (overview.uniqueWallet24h > 100) score += 5;

  // Holder count (higher = more distributed = healthier)
  if (overview.holder > 1000) score += 10;
  else if (overview.holder > 500) score += 5;

  // Buy/sell ratio from Birdeye (more granular than DexScreener)
  if (overview.buy24h && overview.sell24h) {
    const ratio = overview.buy24h / (overview.buy24h + overview.sell24h);
    if (ratio > 0.65) score += 10;
    else if (ratio > 0.55) score += 5;
  }

  // Volume relative to market cap (healthy = 0.1-2x)
  if (overview.mc > 0 && overview.volume24h > 0) {
    const volMcRatio = overview.volume24h / overview.mc;
    if (volMcRatio > 0.1 && volMcRatio < 2) score += 5;
    if (volMcRatio > 5) score -= 5; // wash trading flag
  }

  return { score, data: overview };
}

module.exports = { getTokenOverview, getOHLCV, getTrending, scoreBirdeye };
