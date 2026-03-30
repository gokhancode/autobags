/**
 * AUTOBAGS — Sentiment Engine
 * Aggregates social signals from all sources into a unified sentiment score
 * Sources: TG Relay, Twitter/Nitter, DexScreener, CoinGecko
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../../data');
const MENTIONS_FILE = path.join(DATA_DIR, 'social-mentions.json');

// In-memory mention store (persisted to disk periodically)
let mentions = []; // { source, symbol, mint, author, content, confidence, timestamp, metadata }
let sentimentCache = new Map(); // mint -> { score, breakdown, computedAt }

const MAX_MENTIONS = 10000; // cap to avoid memory bloat
const CACHE_TTL = 60_000;   // 1 min cache for sentiment scores

// ── Mention Ingestion ────────────────────────────────────────────────────────

/**
 * Record a social mention from any source
 */
function recordMention({ source, symbol, mint, author, content, confidence, metadata }) {
  const mention = {
    source,       // 'telegram', 'twitter', 'dexscreener', 'coingecko'
    symbol: symbol?.toUpperCase(),
    mint: mint || null,
    author: author || 'unknown',
    content: (content || '').slice(0, 500),
    confidence: confidence || 50,
    metadata: metadata || {},
    timestamp: Date.now(),
  };

  mentions.push(mention);

  // Trim old mentions
  if (mentions.length > MAX_MENTIONS) {
    mentions = mentions.slice(-MAX_MENTIONS / 2);
  }

  // Invalidate cache for this token
  if (mint) sentimentCache.delete(mint);
  if (symbol) sentimentCache.delete(`sym:${symbol}`);

  return mention;
}

/**
 * Ingest a batch of messages from the TG relay
 */
function ingestTelegramBatch(messages) {
  let ingested = 0;
  for (const msg of messages) {
    if (!msg.analysis) continue;

    const { cashtags, addresses, isAlphaCall, confidence } = msg.analysis;

    // Record each cashtag mention
    for (const tag of (cashtags || [])) {
      recordMention({
        source: 'telegram',
        symbol: tag,
        mint: null, // will be resolved later via DexScreener lookup
        author: msg.senderName,
        content: msg.text,
        confidence: isAlphaCall ? Math.min(100, confidence + 20) : confidence,
        metadata: {
          chatId: msg.chatId,
          chatTitle: msg.chatTitle,
          isAlphaCall,
        },
      });
      ingested++;
    }

    // Record each contract address mention
    for (const addr of (addresses || [])) {
      recordMention({
        source: 'telegram',
        symbol: null,
        mint: addr,
        author: msg.senderName,
        content: msg.text,
        confidence: isAlphaCall ? Math.min(100, confidence + 20) : confidence,
        metadata: {
          chatId: msg.chatId,
          chatTitle: msg.chatTitle,
          isAlphaCall,
        },
      });
      ingested++;
    }
  }
  return ingested;
}

// ── Sentiment Computation ────────────────────────────────────────────────────

/**
 * Time-decay weight: recent mentions count more
 */
function timeDecay(timestamp) {
  const ageMs = Date.now() - timestamp;
  const ageHours = ageMs / 3_600_000;

  if (ageHours < 0.25) return 1.0;   // last 15 min = full weight
  if (ageHours < 1) return 0.8;      // last hour = 80%
  if (ageHours < 4) return 0.5;      // last 4h = 50%
  if (ageHours < 12) return 0.2;     // last 12h = 20%
  if (ageHours < 24) return 0.1;     // last 24h = 10%
  return 0.02;                        // older = nearly nothing
}

/**
 * Source weights for sentiment calculation
 */
const SOURCE_WEIGHTS = {
  telegram: 0.25,
  twitter: 0.30,
  dexscreener: 0.15,
  coingecko: 0.15,
  kol: 0.15,
};

/**
 * Get unified sentiment score for a token
 * Returns 0-100 with breakdown by source
 */
function getSentiment(mintOrSymbol) {
  // Check cache
  const cacheKey = mintOrSymbol.length > 20 ? mintOrSymbol : `sym:${mintOrSymbol.toUpperCase()}`;
  const cached = sentimentCache.get(cacheKey);
  if (cached && Date.now() - cached.computedAt < CACHE_TTL) return cached;

  const isMint = mintOrSymbol.length > 20;
  const symbol = isMint ? null : mintOrSymbol.toUpperCase();
  const mint = isMint ? mintOrSymbol : null;

  // Find all relevant mentions
  const relevant = mentions.filter(m => {
    if (mint && m.mint === mint) return true;
    if (symbol && m.symbol === symbol) return true;
    return false;
  });

  if (relevant.length === 0) {
    const result = { score: 0, mentions: 0, breakdown: {}, computedAt: Date.now() };
    sentimentCache.set(cacheKey, result);
    return result;
  }

  // Group by source and compute weighted scores
  const bySource = {};
  for (const m of relevant) {
    const src = m.metadata?.isAlphaCall ? 'kol' : m.source;
    if (!bySource[src]) bySource[src] = [];
    bySource[src].push(m);
  }

  const breakdown = {};
  let totalWeightedScore = 0;
  let totalWeight = 0;

  for (const [source, sourceMentions] of Object.entries(bySource)) {
    // Score per source = sum of (confidence × time_decay) / max_possible
    let sourceScore = 0;
    for (const m of sourceMentions) {
      sourceScore += (m.confidence / 100) * timeDecay(m.timestamp);
    }

    // Normalize: more mentions = higher score, with diminishing returns
    const mentionFactor = Math.min(1, Math.log2(sourceMentions.length + 1) / 5);
    const normalizedScore = Math.min(100, sourceScore * mentionFactor * 100);

    const weight = SOURCE_WEIGHTS[source] || 0.1;
    breakdown[source] = {
      score: Math.round(normalizedScore),
      mentions: sourceMentions.length,
      weight,
    };

    totalWeightedScore += normalizedScore * weight;
    totalWeight += weight;
  }

  const finalScore = totalWeight > 0 ? Math.round(totalWeightedScore / totalWeight) : 0;

  // Convergence bonus: appears across multiple sources
  const sourceCount = Object.keys(bySource).length;
  const convergenceBonus = sourceCount >= 3 ? 15 : sourceCount >= 2 ? 8 : 0;

  const result = {
    score: Math.min(100, finalScore + convergenceBonus),
    mentions: relevant.length,
    sources: sourceCount,
    convergence: sourceCount >= 2,
    breakdown,
    recentMentions: relevant
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10)
      .map(m => ({
        source: m.source,
        author: m.author,
        content: m.content.slice(0, 200),
        confidence: m.confidence,
        age: `${Math.round((Date.now() - m.timestamp) / 60000)}m ago`,
        isAlphaCall: m.metadata?.isAlphaCall || false,
      })),
    computedAt: Date.now(),
  };

  sentimentCache.set(cacheKey, result);
  return result;
}

/**
 * Get all tokens ranked by sentiment (trending)
 */
function getTrendingBySentiment(timeWindowMs = 3_600_000) {
  const cutoff = Date.now() - timeWindowMs;
  const recent = mentions.filter(m => m.timestamp > cutoff);

  // Group by symbol/mint
  const tokenMap = new Map();
  for (const m of recent) {
    const key = m.mint || m.symbol;
    if (!key) continue;
    if (!tokenMap.has(key)) {
      tokenMap.set(key, { symbol: m.symbol, mint: m.mint, mentions: [] });
    }
    tokenMap.get(key).mentions.push(m);
  }

  // Score each
  const ranked = [];
  for (const [key, data] of tokenMap) {
    const sentiment = getSentiment(key);
    ranked.push({
      symbol: data.symbol,
      mint: data.mint,
      score: sentiment.score,
      mentions: data.mentions.length,
      sources: sentiment.sources,
      convergence: sentiment.convergence,
      hasAlphaCalls: data.mentions.some(m => m.metadata?.isAlphaCall),
    });
  }

  return ranked.sort((a, b) => b.score - a.score).slice(0, 50);
}

/**
 * Get high-confidence alpha alerts
 */
function getAlphaAlerts() {
  const oneHourAgo = Date.now() - 3_600_000;

  return mentions
    .filter(m => m.timestamp > oneHourAgo && m.metadata?.isAlphaCall && m.confidence >= 60)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 20)
    .map(m => ({
      symbol: m.symbol,
      mint: m.mint,
      author: m.author,
      content: m.content.slice(0, 300),
      confidence: m.confidence,
      source: m.source,
      chatTitle: m.metadata?.chatTitle,
      timestamp: new Date(m.timestamp).toISOString(),
    }));
}

/**
 * Get mention velocity (mentions per hour) for a token
 */
function getMentionVelocity(mintOrSymbol, windowMinutes = 60) {
  const cutoff = Date.now() - (windowMinutes * 60_000);
  const isMint = mintOrSymbol.length > 20;

  const recent = mentions.filter(m => {
    if (m.timestamp < cutoff) return false;
    if (isMint) return m.mint === mintOrSymbol;
    return m.symbol === mintOrSymbol.toUpperCase();
  });

  const perHour = (recent.length / windowMinutes) * 60;

  // Check for velocity spike (compare to previous window)
  const prevCutoff = cutoff - (windowMinutes * 60_000);
  const previous = mentions.filter(m => {
    if (m.timestamp < prevCutoff || m.timestamp > cutoff) return false;
    if (isMint) return m.mint === mintOrSymbol;
    return m.symbol === mintOrSymbol.toUpperCase();
  });
  const prevPerHour = (previous.length / windowMinutes) * 60;
  const velocityChange = prevPerHour > 0 ? ((perHour - prevPerHour) / prevPerHour) * 100 : perHour > 0 ? 999 : 0;

  return {
    mentionsPerHour: Math.round(perHour * 10) / 10,
    totalMentions: recent.length,
    velocityChange: Math.round(velocityChange), // % change vs previous window
    isSurging: velocityChange > 100,            // 2x increase = surge
  };
}

// ── Persistence ──────────────────────────────────────────────────────────────

function saveMentions() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Only save last 24h of mentions
    const cutoff = Date.now() - 86_400_000;
    const toSave = mentions.filter(m => m.timestamp > cutoff);
    fs.writeFileSync(MENTIONS_FILE, JSON.stringify(toSave));
  } catch (err) {
    console.error('[Sentiment] Save error:', err.message);
  }
}

function loadMentions() {
  try {
    if (fs.existsSync(MENTIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(MENTIONS_FILE, 'utf8'));
      mentions = Array.isArray(data) ? data : [];
      console.log(`[Sentiment] Loaded ${mentions.length} mentions from disk`);
    }
  } catch {
    mentions = [];
  }
}

// Auto-save every 2 minutes
setInterval(saveMentions, 120_000);

// Load on require
loadMentions();

module.exports = {
  recordMention,
  ingestTelegramBatch,
  getSentiment,
  getTrendingBySentiment,
  getAlphaAlerts,
  getMentionVelocity,
  saveMentions,
};
