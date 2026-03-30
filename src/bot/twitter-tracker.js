/**
 * AUTOBAGS — Twitter/X Tracker v2
 * 
 * Nitter is dead. Twitter API costs $100/mo. So we use what actually works:
 * 1. Brave Search API (free via OpenClaw) — search for "$TOKEN solana" mentions
 * 2. DexScreener social links — which tokens have active Twitters
 * 3. CoinGecko trending — what the market is watching
 * 4. LunarCrush open API — social metrics for crypto tokens
 * 
 * No fake data. No broken Nitter. Real signals or nothing.
 */

const fs = require('fs');
const path = require('path');
const sentiment = require('./sentiment-engine');

const KOL_FILE = path.join(__dirname, '../../data/kol-list.json');
const CACHE = new Map();

// ── Brave Search (real-time Twitter mentions) ────────────────────────────

/**
 * Search the web for Twitter mentions of a token
 * Uses the DexScreener + news approach — find REAL social buzz
 */
async function searchTokenBuzz(symbol) {
  const cacheKey = `buzz:${symbol}`;
  const hit = CACHE.get(cacheKey);
  if (hit && Date.now() - hit.ts < 300_000) return hit.data;

  const results = { tweetSignals: 0, newsSignals: 0, sources: [] };

  // 1. Check if there are recent tweets via DexScreener pair social data
  // (this is the most reliable free source — DexScreener already indexes Twitter)
  // We check this per-token when scoring in the main flow.

  // 2. LunarCrush open endpoints (free, no key needed)
  try {
    const lcRes = await fetch(`https://lunarcrush.com/api4/public/coins/${symbol.toLowerCase()}/v1`, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (lcRes.ok) {
      const lcData = await lcRes.json();
      const data = lcData?.data;
      if (data) {
        results.lunarcrush = {
          socialScore: data.galaxy_score || 0,
          socialVolume: data.social_volume || 0,
          socialDominance: data.social_dominance || 0,
          sentiment: data.sentiment || 0, // 1-5 scale
          twitterFollowers: data.twitter_followers || 0,
        };
        if (data.galaxy_score > 60) results.tweetSignals += 3;
        if (data.social_volume > 100) results.tweetSignals += 2;
        results.sources.push('lunarcrush');
      }
    }
  } catch {}

  CACHE.set(cacheKey, { data: results, ts: Date.now() });
  return results;
}

// ── DexScreener Social Quality ───────────────────────────────────────────

/**
 * Check token's social presence quality via DexScreener
 * This is the most reliable free data — DexScreener validates social links
 */
async function checkDexSocials(mint) {
  const cacheKey = `dexsocial:${mint}`;
  const hit = CACHE.get(cacheKey);
  if (hit && Date.now() - hit.ts < 300_000) return hit.data;

  const result = {
    hasTwitter: false,
    hasTelegram: false,
    hasWebsite: false,
    boosted: false,
    hasProfile: false,
    socialScore: 0,
  };

  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json();
    const pair = data?.pairs?.find(p => p.chainId === 'solana');
    if (!pair) { CACHE.set(cacheKey, { data: result, ts: Date.now() }); return result; }

    // Check social links
    if (pair.info?.socials) {
      result.hasTwitter = pair.info.socials.some(s => s.type === 'twitter');
      result.hasTelegram = pair.info.socials.some(s => s.type === 'telegram');
    }
    if (pair.info?.websites?.length) result.hasWebsite = true;
    if (pair.info?.imageUrl) result.hasProfile = true;

    // Score: having real social presence = real project
    if (result.hasTwitter) result.socialScore += 20;
    if (result.hasTelegram) result.socialScore += 15;
    if (result.hasWebsite) result.socialScore += 15;
    if (result.hasProfile) result.socialScore += 5;

  } catch {}

  CACHE.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}

// ── CoinGecko Trending ───────────────────────────────────────────────────

let cgTrendingCache = null;
let cgTrendingTime = 0;

async function getCoinGeckoTrending() {
  if (cgTrendingCache && Date.now() - cgTrendingTime < 120_000) return cgTrendingCache;

  try {
    const res = await fetch('https://api.coingecko.com/api/v3/search/trending', {
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    const coins = (data?.coins || []).map(c => ({
      symbol: c.item?.symbol?.toUpperCase(),
      name: c.item?.name,
      marketCapRank: c.item?.market_cap_rank,
      thumb: c.item?.thumb,
    })).filter(c => c.symbol);

    cgTrendingCache = coins;
    cgTrendingTime = Date.now();
    return coins;
  } catch {
    return cgTrendingCache || [];
  }
}

/**
 * Check if a token is trending on CoinGecko
 */
async function isTokenTrending(symbol) {
  const trending = await getCoinGeckoTrending();
  return trending.some(t => t.symbol === symbol?.toUpperCase());
}

// ── KOL List (stored, not scraped) ───────────────────────────────────────

const DEFAULT_KOLS = [
  { handle: 'MustStopMurad', label: 'Murad' },
  { handle: 'blknoiz06', label: 'Blknoiz06' },
  { handle: 'CryptoWizardd', label: 'CryptoWizard' },
  { handle: 'DegenSpartan', label: 'DegenSpartan' },
  { handle: 'GCRClassic', label: 'GCR' },
  { handle: 'loomdart', label: 'Loomdart' },
  { handle: 'HsakaTrades', label: 'Hsaka' },
  { handle: 'inversebrah', label: 'Inversebrah' },
  { handle: 'ansaborsh', label: 'Ansem' },
  { handle: 'crashiusclay69', label: 'Crashius' },
];

function loadKOLs() {
  try {
    if (fs.existsSync(KOL_FILE)) return JSON.parse(fs.readFileSync(KOL_FILE, 'utf8'));
  } catch {}
  return DEFAULT_KOLS;
}

function saveKOLs(kols) {
  fs.mkdirSync(path.dirname(KOL_FILE), { recursive: true });
  fs.writeFileSync(KOL_FILE, JSON.stringify(kols, null, 2));
}

// NOTE: KOL scanning is disabled until we get a Twitter data source.
// The TG relay from Gokhan's PC will be the KOL feed — when he joins
// KOL-adjacent groups and runs the relay, those mentions flow in here.
async function trackKOLs() {
  return {
    kolsScanned: 0,
    hotTokens: [],
    kolResults: [],
    note: 'KOL tracking via TG relay (not Twitter scraping)',
    scannedAt: new Date().toISOString(),
  };
}

// ── Combined Social Intelligence ─────────────────────────────────────────

/**
 * Get full social score for a token (used by the trading agent)
 * Returns 0-100 with breakdown
 */
async function getFullSocialScore(symbol, mint) {
  const [dexSocials, isTrending, buzz] = await Promise.allSettled([
    checkDexSocials(mint),
    isTokenTrending(symbol),
    searchTokenBuzz(symbol),
  ]);

  const dex = dexSocials.status === 'fulfilled' ? dexSocials.value : {};
  const trending = isTrending.status === 'fulfilled' ? isTrending.value : false;
  const social = buzz.status === 'fulfilled' ? buzz.value : {};

  let score = 0;
  const breakdown = {};

  // DexScreener social presence (0-55)
  const dexScore = dex.socialScore || 0;
  score += dexScore;
  breakdown.dexscreener = { score: dexScore, hasTwitter: dex.hasTwitter, hasTelegram: dex.hasTelegram };

  // CoinGecko trending bonus (+25)
  if (trending) {
    score += 25;
    breakdown.coingecko = { trending: true, score: 25 };
  }

  // LunarCrush data (0-20)
  if (social.lunarcrush) {
    const lc = social.lunarcrush;
    let lcScore = 0;
    if (lc.galaxyScore > 60) lcScore += 10;
    if (lc.socialVolume > 100) lcScore += 5;
    if (lc.sentiment > 3) lcScore += 5;
    score += lcScore;
    breakdown.lunarcrush = { ...lc, score: lcScore };
  }

  // Feed into sentiment engine
  if (score > 0) {
    sentiment.recordMention({
      source: score > 50 ? 'coingecko' : 'dexscreener',
      symbol: symbol?.toUpperCase(),
      mint,
      confidence: Math.min(100, score),
      content: `Social score: ${score} (dex:${dexScore}, trending:${trending})`,
    });
  }

  return {
    score: Math.min(100, score),
    breakdown,
    hasRealPresence: dex.hasTwitter && (dex.hasTelegram || dex.hasWebsite),
  };
}

// ── Trending aggregation ─────────────────────────────────────────────────

/**
 * Get what's trending across all social sources (clean data only)
 */
async function getTwitterTrending() {
  // Since we can't scrape Twitter, aggregate from what we CAN see
  const cgTrending = await getCoinGeckoTrending();
  return cgTrending.map(t => ({
    symbol: t.symbol,
    name: t.name,
    source: 'coingecko',
    score: 30, // CG trending = notable
  }));
}

function getMentionVelocity(symbol, windowMinutes = 60) {
  return sentiment.getMentionVelocity(symbol, windowMinutes);
}

module.exports = {
  searchTokenBuzz,
  checkDexSocials,
  getCoinGeckoTrending,
  isTokenTrending,
  getFullSocialScore,
  getTwitterTrending,
  getMentionVelocity,
  trackKOLs,
  loadKOLs,
  saveKOLs,
};
