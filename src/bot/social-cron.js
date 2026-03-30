/**
 * AUTOBAGS — Social Intelligence Cron v2
 * Background loops that continuously scan social signals
 * Fixed: no more garbage symbols, real data only
 */

const twitter = require('./twitter-tracker');
const sentiment = require('./sentiment-engine');

let running = false;

// Garbage symbol filter — common English words that aren't real tokens
const GARBAGE_SYMBOLS = new Set([
  'THE', 'WE', 'IT', 'AN', 'A', 'IS', 'IN', 'ON', 'TO', 'OF', 'AND',
  'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER', 'WAS', 'ONE',
  'OUR', 'OUT', 'DAY', 'HAD', 'HAS', 'HIS', 'HOW', 'MAN', 'NEW', 'NOW',
  'OLD', 'SEE', 'WAY', 'WHO', 'DID', 'GET', 'LET', 'SAY', 'SHE', 'TOO',
  'USE', 'MEET', 'LOST', 'TODAY', 'I\'VE', 'JUST', 'THAT', 'THIS', 'WITH',
  'YOUR', 'BEEN', 'CALL', 'COME', 'EACH', 'FIND', 'FROM', 'GIVE', 'GOOD',
  'HAVE', 'HERE', 'KEEP', 'KNOW', 'LAST', 'LONG', 'LOOK', 'MAKE', 'MANY',
  'MOST', 'MUCH', 'MUST', 'NAME', 'NEXT', 'ONLY', 'OVER', 'SAME', 'SOME',
  'SUCH', 'TAKE', 'TELL', 'THEM', 'THEN', 'VERY', 'WANT', 'WELL', 'WHAT',
  'WHEN', 'WILL', 'YEAH', 'BEST', 'LIKE', 'LOVE', 'LIVE', 'REAL', 'FREE',
  'BACK', 'JUST', 'ABOUT', 'AFTER', 'FIRST', 'STILL', 'EVERY', 'OTHER',
  'NEVER', 'THINK', 'WHERE', 'BEING', 'THEIR', 'THOSE', 'THERE', 'THESE',
  // Stablecoins / majors (not useful for memecoin trading)
  'USDT', 'USDC', 'BUSD', 'DAI', 'BTC', 'ETH', 'BNB', 'XRP',
]);

function isValidSymbol(sym) {
  if (!sym || sym.length < 2 || sym.length > 12) return false;
  if (GARBAGE_SYMBOLS.has(sym.toUpperCase())) return false;
  if (/[^A-Za-z0-9]/.test(sym)) return false; // no special chars
  if (/^\d+$/.test(sym)) return false; // not pure numbers
  return true;
}

function startSocialCron() {
  if (running) return;
  running = true;
  console.log('[Social] Starting social intelligence cron v2...');

  // CoinGecko trending — every 5 min (most reliable free source)
  runLoop('CoinGecko trending', 5 * 60_000, async () => {
    const trending = await twitter.getCoinGeckoTrending();
    let ingested = 0;
    for (const t of trending) {
      if (!isValidSymbol(t.symbol)) continue;
      sentiment.recordMention({
        source: 'coingecko',
        symbol: t.symbol,
        confidence: 60, // CG trending = real signal
        content: `CoinGecko trending: ${t.name} (${t.symbol})`,
      });
      ingested++;
    }
    console.log(`[Social] CoinGecko: ${ingested} trending tokens ingested`);
  });

  // DexScreener boosted tokens — every 5 min
  // Only ingest tokens with VALID mints, skip garbage symbols
  runLoop('DexScreener boosted', 5 * 60_000, async () => {
    let ingested = 0;
    try {
      const res = await fetch('https://api.dexscreener.com/token-boosts/top/v1', {
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const boosts = await res.json();
        const solBoosts = (boosts || []).filter(b => b.chainId === 'solana').slice(0, 30);
        for (const b of solBoosts) {
          if (!b.tokenAddress || b.tokenAddress.length < 30) continue; // must have real mint
          sentiment.recordMention({
            source: 'dexscreener',
            symbol: null, // don't trust description-derived symbols
            mint: b.tokenAddress,
            confidence: 30, // boosted = paid promotion, moderate signal
            content: `DexScreener boosted: ${b.tokenAddress.slice(0, 8)}...`,
          });
          ingested++;
        }
      }
    } catch {}
    console.log(`[Social] DexScreener: ${ingested} boosted tokens ingested`);
  });

  // Sentiment persistence — every 2 min
  runLoop('Sentiment save', 2 * 60_000, () => {
    sentiment.saveMentions();
  });

  // Stats log — every 5 min
  runLoop('Social stats', 5 * 60_000, () => {
    const trending = sentiment.getTrendingBySentiment(3_600_000);
    const valid = trending.filter(t => isValidSymbol(t.symbol));
    if (valid.length > 0) {
      const top3 = valid.slice(0, 3).map(t => `$${t.symbol}(${t.score})`).join(' ');
      console.log(`[Social] Top trending: ${top3}`);
    }
  });

  console.log('[Social] All cron loops started ✅');
}

function runLoop(name, intervalMs, fn) {
  const run = async () => {
    try { await fn(); } catch (err) {
      console.error(`[Social] ${name} error: ${err.message}`);
    }
  };
  setTimeout(run, 3000 + Math.random() * 5000);
  setInterval(run, intervalMs);
}

function stopSocialCron() { running = false; }

module.exports = { startSocialCron, stopSocialCron, isValidSymbol };
