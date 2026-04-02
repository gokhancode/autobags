/**
 * AUTOBAGS — CT (Crypto Twitter) Tracker
 * Real X API integration — monitors KOL tweets for cashtags & CAs
 * Feeds into scoring engine for convergence detection
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../config/.env') });

const fs = require('fs');
const path = require('path');
const notifier = require('./notifier');

const BEARER = process.env.X_BEARER_TOKEN || '';
const DATA_DIR = path.join(__dirname, '../../data');
const CT_STATE_FILE = path.join(DATA_DIR, 'ct-state.json');
const CT_SIGNALS_FILE = path.join(DATA_DIR, 'ct-signals.json');

// KOLs to track — add more as needed
const KOLS = [
  // Tier 1 — memecoin alpha callers
  { id: '973261472', handle: 'blknoiz06' },                  // 811K — SOL ecosystem king
  { id: '844304603336232960', handle: 'MustStopMurad' },     // 731K — memecoin alpha
  { id: '1585960998321770497', handle: 'marcellxmarcell' },  // 142K — Marcell (tracked KOL)
  { id: '1303447570203774980', handle: 'crashiusclay69' },   // 269K — degen calls
  { id: '1432635656161746947', handle: 'boldleonidas' },     // 103K — SOL memes
  { id: '1363005549382574080', handle: 'degenharambe' },     // 45K — degen plays
  
  // Tier 2 — big CT traders
  { id: '1138993163706753029', handle: 'pentosh1' },         // 895K — chart king
  { id: '906234475604037637', handle: 'CryptoKaleo' },       // 730K — swing calls
  { id: '944686196331966464', handle: 'hsakatrades' },       // 604K — trader
  { id: '4107711', handle: 'gainzy222' },                    // 327K — memecoin trader
  { id: '1343224146658914304', handle: 'crypto_bitlord7' },  // 433K — CT OG
  { id: '5705402', handle: 'runnerxbt' },                    // 94K — runner
  
  // Tier 3 — intel/whale watchers
  { id: '1462727797135216641', handle: 'lookonchain' },      // 687K — on-chain intel
  { id: '1295766451530293249', handle: 'spidercrypto0x' },   // 124K — crypto spider
  { id: '1404421873169993730', handle: 'solidintel_x' },     // 92K — solid intel
  { id: '1006655433031839744', handle: 'kolscan' },          // 55K — KOL scanner
];

// Solana CA pattern
const CA_REGEX = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
// Cashtag pattern
const CASHTAG_REGEX = /\$([A-Za-z]{2,12})/g;

function loadState() {
  try { return JSON.parse(fs.readFileSync(CT_STATE_FILE, 'utf8')); }
  catch { return { lastSearchId: null, lastKolCheck: {}, mentionMap: {} }; }
}

function saveState(state) {
  fs.writeFileSync(CT_STATE_FILE, JSON.stringify(state, null, 2));
}

function loadSignals() {
  try { return JSON.parse(fs.readFileSync(CT_SIGNALS_FILE, 'utf8')); }
  catch { return []; }
}

function saveSignals(signals) {
  // Keep last 500 signals
  const trimmed = signals.slice(-500);
  fs.writeFileSync(CT_SIGNALS_FILE, JSON.stringify(trimmed, null, 2));
}

async function xGet(endpoint, params = {}) {
  if (!BEARER) throw new Error('No X Bearer Token configured');
  
  const url = new URL(`https://api.x.com/2/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  
  const res = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${BEARER}` },
    signal: AbortSignal.timeout(10000),
  });
  
  if (res.status === 429) {
    const reset = res.headers.get('x-rate-limit-reset');
    const waitSec = reset ? Math.max(0, Number(reset) - Math.floor(Date.now() / 1000)) : 60;
    console.log(`[CT] Rate limited, waiting ${waitSec}s`);
    await new Promise(r => setTimeout(r, waitSec * 1000));
    return null;
  }
  
  if (!res.ok) {
    console.error(`[CT] X API error: ${res.status} ${res.statusText}`);
    return null;
  }
  
  return res.json();
}

/**
 * Search for recent Solana cashtag/CA tweets
 */
async function searchCashtags() {
  const state = loadState();
  const signals = loadSignals();
  
  // Search for Solana memecoin chatter
  const queries = [
    '$SOL pump.fun -is:retweet',
    'solana memecoin buy -is:retweet',
  ];
  
  for (const query of queries) {
    const params = {
      query,
      max_results: '10',
      'tweet.fields': 'created_at,author_id,public_metrics',
      sort_order: 'recency',
    };
    
    if (state.lastSearchId) {
      params.since_id = state.lastSearchId;
    }
    
    const data = await xGet('tweets/search/recent', params);
    if (!data || !data.data) continue;
    
    for (const tweet of data.data) {
      // Extract cashtags
      const cashtags = [...tweet.text.matchAll(CASHTAG_REGEX)].map(m => m[1].toUpperCase());
      // Extract potential CAs
      const cas = [...tweet.text.matchAll(CA_REGEX)].filter(m => m[0].length >= 32 && m[0].length <= 44).map(m => m[0]);
      
      if (cashtags.length > 0 || cas.length > 0) {
        const signal = {
          source: 'search',
          authorId: tweet.author_id,
          text: tweet.text.slice(0, 200),
          cashtags,
          cas,
          metrics: tweet.public_metrics,
          timestamp: new Date(tweet.created_at).getTime(),
          tweetId: tweet.id,
        };
        signals.push(signal);
      }
      
      if (!state.lastSearchId || BigInt(tweet.id) > BigInt(state.lastSearchId)) {
        state.lastSearchId = tweet.id;
      }
    }
  }
  
  saveState(state);
  saveSignals(signals);
  return signals;
}

/**
 * Check KOL tweets for new mentions
 */
async function checkKolTweets() {
  const state = loadState();
  const signals = loadSignals();
  let newSignals = [];
  
  for (const kol of KOLS) {
    const sinceId = state.lastKolCheck[kol.id] || null;
    
    const params = {
      max_results: '5',
      'tweet.fields': 'created_at,public_metrics',
      exclude: 'retweets',
    };
    if (sinceId) params.since_id = sinceId;
    
    const data = await xGet(`users/${kol.id}/tweets`, params);
    if (!data || !data.data) continue;
    
    for (const tweet of data.data) {
      const cashtags = [...tweet.text.matchAll(CASHTAG_REGEX)].map(m => m[1].toUpperCase());
      const cas = [...tweet.text.matchAll(CA_REGEX)].filter(m => m[0].length >= 32 && m[0].length <= 44).map(m => m[0]);
      
      if (cashtags.length > 0 || cas.length > 0) {
        const signal = {
          source: 'kol',
          kol: kol.handle,
          authorId: kol.id,
          text: tweet.text.slice(0, 200),
          cashtags,
          cas,
          metrics: tweet.public_metrics,
          timestamp: new Date(tweet.created_at).getTime(),
          tweetId: tweet.id,
        };
        signals.push(signal);
        newSignals.push(signal);
      }
      
      if (!state.lastKolCheck[kol.id] || BigInt(tweet.id) > BigInt(state.lastKolCheck[kol.id])) {
        state.lastKolCheck[kol.id] = tweet.id;
      }
    }
    
    // Small delay between KOL checks to respect rate limits
    await new Promise(r => setTimeout(r, 500));
  }
  
  saveState(state);
  saveSignals(signals);
  return newSignals;
}

/**
 * Detect convergence — multiple KOLs mentioning same token
 */
function detectConvergence(signals, windowMs = 3600000) {
  const now = Date.now();
  const recent = signals.filter(s => now - s.timestamp < windowMs);
  
  // Count mentions per cashtag
  const tagCounts = {};
  const tagKols = {};
  
  for (const sig of recent) {
    for (const tag of (sig.cashtags || [])) {
      if (['SOL', 'BTC', 'ETH', 'USDC', 'USDT'].includes(tag)) continue;
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      if (!tagKols[tag]) tagKols[tag] = new Set();
      if (sig.kol) tagKols[tag].add(sig.kol);
      tagKols[tag].add(sig.authorId);
    }
    
    for (const ca of (sig.cas || [])) {
      tagCounts[ca] = (tagCounts[ca] || 0) + 1;
      if (!tagKols[ca]) tagKols[ca] = new Set();
      if (sig.kol) tagKols[ca].add(sig.kol);
      tagKols[ca].add(sig.authorId);
    }
  }
  
  // Silver: 3+ mentions, Gold: 8+ mentions
  const convergences = [];
  for (const [tag, count] of Object.entries(tagCounts)) {
    const uniqueSources = tagKols[tag].size;
    if (uniqueSources >= 3) {
      const tier = uniqueSources >= 8 ? 'gold' : 'silver';
      convergences.push({ tag, mentions: count, uniqueSources, tier });
    }
  }
  
  return convergences.sort((a, b) => b.uniqueSources - a.uniqueSources);
}

/**
 * Run a full CT scan cycle
 */
async function runCycle() {
  console.log(`[CT] ${new Date().toISOString()} — Running scan cycle`);
  
  try {
    // 1. Search cashtags
    await searchCashtags();
    
    // 2. Check KOL tweets
    const newKolSignals = await checkKolTweets();
    
    // 3. Alert on new KOL mentions
    for (const sig of newKolSignals) {
      const tags = sig.cashtags.length > 0 ? sig.cashtags.map(t => `$${t}`).join(' ') : '';
      const cas = sig.cas.length > 0 ? `\n<code>${sig.cas[0]}</code>` : '';
      const msg = `🐦 <b>KOL Alert: @${sig.kol}</b>\n${tags}${cas}\n\n"${sig.text.slice(0, 150)}"\n\nhttps://x.com/${sig.kol}/status/${sig.tweetId}`;
      notifier.sendTelegram(msg);
    }
    
    // 4. Narrative detection (big accounts) — feeds scoring engine silently
    const newNarratives = await detectNarratives();
    // No TG alerts for narratives — they influence the bot's scoring, not Gokhan's inbox
    
    // 5. Check convergence
    const signals = loadSignals();
    const convergences = detectConvergence(signals);
    
    for (const conv of convergences) {
      if (conv.tag.length <= 10) { // cashtag, not CA
        console.log(`[CT] ${conv.tier.toUpperCase()} convergence: $${conv.tag} — ${conv.uniqueSources} sources, ${conv.mentions} mentions`);
      }
    }
    
    console.log(`[CT] Cycle complete. ${newKolSignals.length} KOL, ${newNarratives.length} narrative signals.`);
  } catch (e) {
    console.error('[CT] Cycle error:', e.message);
  }
}

// ── Full Account List (narrative detection) ──────────────────────────
const CT_ACCOUNTS_FILE = path.join(DATA_DIR, 'ct-accounts-full.json');
const NARRATIVE_STATE_FILE = path.join(DATA_DIR, 'ct-narrative-state.json');

function loadAccountList() {
  try {
    const data = JSON.parse(fs.readFileSync(CT_ACCOUNTS_FILE, 'utf8'));
    return Object.keys(data.accounts).filter(h => h.length > 2 && !h.includes(' ') && !h.includes('\\'));
  } catch { return []; }
}

function loadNarrativeState() {
  try { return JSON.parse(fs.readFileSync(NARRATIVE_STATE_FILE, 'utf8')); }
  catch { return { lastSinceId: null, alertedNarratives: {} }; }
}

function saveNarrativeState(state) {
  fs.writeFileSync(NARRATIVE_STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Narrative detection — search for viral tweets from tracked accounts
 * that could spawn memecoins (animals, memes, events, cultural moments)
 */
async function detectNarratives() {
  const accounts = loadAccountList();
  if (accounts.length === 0) return [];

  const narState = loadNarrativeState();
  const signals = loadSignals();
  const newNarratives = [];

  // High-impact accounts that move markets when they tweet
  const narrativeAccounts = accounts.filter(h => [
    'elonmusk', 'trump', 'realdonaldtrump', 'potus', 'whitehouse',
    'nasa', 'spacex', 'neuralink', 'tesla',
    'mrbeast', 'kanyewest', 'drake', 'snoopdogg', 'joerogan',
    'vitalikbuterin', 'cz_binance', 'saylor', 'aeyakovenko', 'toly',
    'rajgokal', 'brian_armstrong', 'justinsuntron',
    'gamestop', 'theroaringkitty',
    'cobratate', 'martinshkreli', 'floydmayweather',
    'truth_terminal', 'andyayrey',
    'dafuqboom_legit', 'souljaboy', 'kaicenat', 'adinross',
    'pokemon', 'minecraft', 'fortnite', 'rockstargames',
  ].includes(h));

  // Build search queries in batches of 5 (X API limit per OR query)
  // Focus on accounts most likely to create narratives
  const topAccounts = narrativeAccounts.slice(0, 20);
  
  for (let i = 0; i < topAccounts.length; i += 5) {
    const batch = topAccounts.slice(i, i + 5);
    const fromQuery = batch.map(h => `from:${h}`).join(' OR ');
    
    const params = {
      query: `(${fromQuery}) -is:retweet -is:reply`,
      max_results: '10',
      'tweet.fields': 'created_at,author_id,public_metrics',
      sort_order: 'recency',
    };
    
    if (narState.lastSinceId) {
      params.since_id = narState.lastSinceId;
    }
    
    const data = await xGet('tweets/search/recent', params);
    if (!data || !data.data) continue;
    
    for (const tweet of data.data) {
      // Track newest ID
      if (!narState.lastSinceId || BigInt(tweet.id) > BigInt(narState.lastSinceId)) {
        narState.lastSinceId = tweet.id;
      }
      
      // Check if this tweet is viral enough to matter
      const metrics = tweet.public_metrics || {};
      const engagement = (metrics.like_count || 0) + (metrics.retweet_count || 0) * 3;
      
      // Only alert on high-engagement tweets (1000+ engagement)
      if (engagement < 1000) continue;
      
      // Extract potential narrative keywords
      const text = tweet.text.toLowerCase();
      const cashtags = [...tweet.text.matchAll(CASHTAG_REGEX)].map(m => m[1].toUpperCase());
      const cas = [...tweet.text.matchAll(CA_REGEX)].filter(m => m[0].length >= 32 && m[0].length <= 44).map(m => m[0]);
      
      // Find which account posted this
      const account = batch.find(h => {
        // We don't have username->id mapping for all, so use author_id
        return true; // Will be attributed by the search query
      });
      
      const signal = {
        source: 'narrative',
        authorId: tweet.author_id,
        text: tweet.text.slice(0, 280),
        cashtags,
        cas,
        engagement,
        metrics: tweet.public_metrics,
        timestamp: new Date(tweet.created_at).getTime(),
        tweetId: tweet.id,
      };
      
      signals.push(signal);
      newNarratives.push(signal);
    }
    
    await new Promise(r => setTimeout(r, 500));
  }
  
  saveNarrativeState(narState);
  saveSignals(signals);
  return newNarratives;
}

// Export for use by other modules
module.exports = {
  searchCashtags,
  checkKolTweets,
  detectConvergence,
  detectNarratives,
  loadSignals,
  loadAccountList,
  runCycle,
  KOLS,
};

// Run standalone
if (require.main === module) {
  const INTERVAL = 5 * 60 * 1000; // 5 min between cycles
  
  console.log('🐦 CT Tracker starting...');
  console.log(`Tracking ${KOLS.length} KOLs`);
  console.log(`Cycle interval: ${INTERVAL / 1000}s\n`);
  
  runCycle();
  setInterval(runCycle, INTERVAL);
}
