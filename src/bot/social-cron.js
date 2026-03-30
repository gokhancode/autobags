/**
 * AUTOBAGS — Social Intelligence Cron
 * Background loops that continuously scan social media
 * Started from index.js
 */

const twitter = require('./twitter-tracker');
const sentiment = require('./sentiment-engine');
const social = require('./social-scanner');

let running = false;

/**
 * Start all social scanning loops
 */
function startSocialCron() {
  if (running) return;
  running = true;
  console.log('[Social] Starting social intelligence cron...');

  // Twitter trending scan — every 5 min
  runLoop('Twitter trending', 5 * 60_000, async () => {
    const trending = await twitter.getTwitterTrending();
    console.log(`[Social] Twitter: ${trending.length} trending tokens found`);
  });

  // KOL scan — every 10 min
  runLoop('KOL scan', 10 * 60_000, async () => {
    const result = await twitter.trackKOLs();
    console.log(`[Social] KOLs: scanned ${result.kolsScanned}, ${result.hotTokens.length} hot tokens`);
    if (result.hotTokens.length > 0) {
      console.log(`[Social] 🔥 KOL hot: ${result.hotTokens.slice(0, 3).map(t => `$${t.symbol}(${t.kols.length} KOLs)`).join(', ')}`);
    }
  });

  // DexScreener social refresh — every 5 min
  runLoop('DexScreener social', 5 * 60_000, async () => {
    const trending = await social.getSocialTrending();
    // Feed DexScreener data into sentiment
    for (const t of trending) {
      sentiment.recordMention({
        source: 'dexscreener',
        symbol: t.symbol,
        mint: t.mint,
        confidence: t.socialScore * 3,
        content: `DexScreener ${t.source}: ${t.symbol}`,
      });
    }
    console.log(`[Social] DexScreener: ${trending.length} trending tokens`);
  });

  // Sentiment persistence — every 2 min
  runLoop('Sentiment save', 2 * 60_000, () => {
    sentiment.saveMentions();
  });

  console.log('[Social] All cron loops started ✅');
}

/**
 * Simple loop runner with error isolation
 */
function runLoop(name, intervalMs, fn) {
  const run = async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[Social] ${name} error: ${err.message}`);
    }
  };

  // Run immediately, then on interval
  setTimeout(run, 5000 + Math.random() * 5000); // stagger start
  setInterval(run, intervalMs);
}

function stopSocialCron() {
  running = false;
  // Note: intervals will keep running until process exits
  // In production, store interval refs and clearInterval them
}

module.exports = { startSocialCron, stopSocialCron };
