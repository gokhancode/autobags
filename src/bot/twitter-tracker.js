/**
 * AUTOBAGS — Twitter/X Tracker
 * Monitors crypto Twitter WITHOUT an API key
 * Uses Nitter RSS, DexScreener socials, CoinGecko trending
 */

const fs = require('fs');
const path = require('path');
const sentiment = require('./sentiment-engine');

const KOL_FILE = path.join(__dirname, '../../data/kol-list.json');
const CACHE = new Map();
const CACHE_TTL = 300_000; // 5 min

// ── Nitter RSS Scraping ──────────────────────────────────────────────────────

// Nitter instances (try in order, some may be down)
const NITTER_INSTANCES = [
  'https://nitter.privacydev.net',
  'https://nitter.poast.org',
  'https://nitter.net',
  'https://nitter.cz',
  'https://nitter.1d4.us',
];

/**
 * Try to fetch a Nitter RSS feed, cycling through instances
 */
async function fetchNitterRSS(path) {
  for (const instance of NITTER_INSTANCES) {
    try {
      const url = `${instance}${path}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSS reader)' },
      });
      if (!res.ok) continue;
      return await res.text();
    } catch {
      continue; // try next instance
    }
  }
  return null;
}

/**
 * Parse RSS XML for tweet items (simple regex parsing, no XML lib needed)
 */
function parseRSSItems(xml) {
  if (!xml) return [];
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]>/)?.[1]
      || block.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '';
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || '';
    const creator = block.match(/<dc:creator>([\s\S]*?)<\/dc:creator>/)?.[1] || '';
    const link = block.match(/<link>([\s\S]*?)<\/link>/)?.[1] || '';
    const description = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/)?.[1]
      || block.match(/<description>([\s\S]*?)<\/description>/)?.[1] || '';

    items.push({
      text: title || description.replace(/<[^>]+>/g, '').slice(0, 500),
      author: creator,
      date: pubDate ? new Date(pubDate).getTime() : Date.now(),
      link,
    });
  }

  return items;
}

// ── Cashtag Tracking ─────────────────────────────────────────────────────────

/**
 * Search Twitter for mentions of $SYMBOL via Nitter
 */
async function trackCashtag(symbol) {
  const cacheKey = `cashtag:${symbol}`;
  const hit = CACHE.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;

  const query = encodeURIComponent(`$${symbol} solana OR sol OR memecoin`);
  const xml = await fetchNitterRSS(`/search/rss?f=tweets&q=${query}`);
  const items = parseRSSItems(xml);

  const result = {
    symbol,
    tweetCount: items.length,
    authors: [...new Set(items.map(i => i.author).filter(Boolean))],
    latestTweets: items.slice(0, 5).map(i => ({
      text: i.text.slice(0, 300),
      author: i.author,
      age: `${Math.round((Date.now() - i.date) / 60000)}m ago`,
    })),
    scannedAt: Date.now(),
  };

  // Feed into sentiment engine
  for (const item of items) {
    sentiment.recordMention({
      source: 'twitter',
      symbol: symbol.toUpperCase(),
      author: item.author,
      content: item.text,
      confidence: 50 + Math.min(30, items.length), // more tweets = higher confidence
    });
  }

  CACHE.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}

// ── KOL Monitoring ───────────────────────────────────────────────────────────

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
    if (fs.existsSync(KOL_FILE)) {
      return JSON.parse(fs.readFileSync(KOL_FILE, 'utf8'));
    }
  } catch {}
  return DEFAULT_KOLS;
}

function saveKOLs(kols) {
  fs.mkdirSync(path.dirname(KOL_FILE), { recursive: true });
  fs.writeFileSync(KOL_FILE, JSON.stringify(kols, null, 2));
}

/**
 * Scan a specific KOL's recent tweets for token mentions
 */
async function scanKOL(handle) {
  const cacheKey = `kol:${handle}`;
  const hit = CACHE.get(cacheKey);
  if (hit && Date.now() - hit.ts < 900_000) return hit.data; // 15 min cache for KOLs

  const xml = await fetchNitterRSS(`/${handle}/rss`);
  const items = parseRSSItems(xml);

  // Extract token mentions from tweets
  const cashtagRe = /\$([A-Za-z][A-Za-z0-9]{1,10})\b/g;
  const tokenMentions = [];

  for (const item of items.slice(0, 20)) { // last 20 tweets
    let match;
    const re = new RegExp(cashtagRe.source, 'g');
    while ((match = re.exec(item.text)) !== null) {
      tokenMentions.push({
        symbol: match[1].toUpperCase(),
        text: item.text.slice(0, 300),
        date: item.date,
      });

      // Feed into sentiment as KOL mention (high weight)
      sentiment.recordMention({
        source: 'twitter',
        symbol: match[1].toUpperCase(),
        author: handle,
        content: item.text,
        confidence: 80, // KOL mentions = high confidence
        metadata: { isKOL: true, kolHandle: handle },
      });
    }
  }

  const result = {
    handle,
    totalTweets: items.length,
    tokenMentions,
    lastScanned: Date.now(),
  };

  CACHE.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}

/**
 * Scan all KOLs and return aggregated token mentions
 */
async function trackKOLs() {
  const kols = loadKOLs();
  const results = [];

  // Scan in batches of 3 (don't hammer Nitter)
  for (let i = 0; i < kols.length; i += 3) {
    const batch = kols.slice(i, i + 3);
    const batchResults = await Promise.allSettled(
      batch.map(k => scanKOL(k.handle))
    );
    for (const r of batchResults) {
      if (r.status === 'fulfilled' && r.value) {
        results.push(r.value);
      }
    }
    // Small delay between batches
    if (i + 3 < kols.length) await new Promise(r => setTimeout(r, 2000));
  }

  // Aggregate: which tokens are multiple KOLs talking about?
  const tokenCounts = {};
  for (const r of results) {
    for (const m of r.tokenMentions) {
      if (!tokenCounts[m.symbol]) tokenCounts[m.symbol] = { symbol: m.symbol, kols: [], mentions: 0 };
      if (!tokenCounts[m.symbol].kols.includes(r.handle)) {
        tokenCounts[m.symbol].kols.push(r.handle);
      }
      tokenCounts[m.symbol].mentions++;
    }
  }

  const hotTokens = Object.values(tokenCounts)
    .filter(t => t.kols.length >= 2 || t.mentions >= 3)
    .sort((a, b) => b.kols.length - a.kols.length || b.mentions - a.mentions);

  return {
    kolsScanned: results.length,
    hotTokens,
    kolResults: results.map(r => ({
      handle: r.handle,
      tokenMentions: r.tokenMentions.length,
      tokens: [...new Set(r.tokenMentions.map(m => m.symbol))],
    })),
    scannedAt: new Date().toISOString(),
  };
}

// ── Twitter Trending ─────────────────────────────────────────────────────────

/**
 * Get what's trending on crypto Twitter right now
 * Combines: Nitter search for common crypto terms + DexScreener + CoinGecko
 */
async function getTwitterTrending() {
  const cacheKey = 'twitter-trending';
  const hit = CACHE.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data;

  const queries = ['solana memecoin', 'sol gem', '$SOL alpha', 'solana 100x'];
  const allMentions = new Map();

  // Search Nitter for trending crypto terms
  for (const q of queries) {
    try {
      const xml = await fetchNitterRSS(`/search/rss?f=tweets&q=${encodeURIComponent(q)}`);
      const items = parseRSSItems(xml);

      for (const item of items) {
        const cashtagRe = /\$([A-Za-z][A-Za-z0-9]{1,10})\b/g;
        let match;
        while ((match = cashtagRe.exec(item.text)) !== null) {
          const sym = match[1].toUpperCase();
          if (['SOL', 'BTC', 'ETH', 'USDC', 'USDT'].includes(sym)) continue; // skip majors
          if (!allMentions.has(sym)) allMentions.set(sym, { count: 0, authors: new Set() });
          allMentions.get(sym).count++;
          if (item.author) allMentions.get(sym).authors.add(item.author);
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 1000)); // rate limit
  }

  const trending = [...allMentions.entries()]
    .map(([symbol, data]) => ({
      symbol,
      mentions: data.count,
      uniqueAuthors: data.authors.size,
      score: data.count * 2 + data.authors.size * 5,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  CACHE.set(cacheKey, { data: trending, ts: Date.now() });
  return trending;
}

// ── Mention Velocity ─────────────────────────────────────────────────────────

/**
 * Get mention velocity for a symbol (mentions per hour)
 */
function getMentionVelocity(symbol, windowMinutes = 60) {
  return sentiment.getMentionVelocity(symbol, windowMinutes);
}

module.exports = {
  trackCashtag,
  scanKOL,
  trackKOLs,
  getTwitterTrending,
  getMentionVelocity,
  loadKOLs,
  saveKOLs,
};
