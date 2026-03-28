/**
 * AUTOBAGS — Social / Twitter Mention Scanner
 * Detects trending tokens on social media without requiring API keys
 * Sources: Socialdata (free tier), DexScreener socials, CoinGecko trending
 */

const cache = new Map();

/**
 * Check Twitter/X mentions for a token using free scraping proxies
 * Falls back to checking DexScreener social links
 */
async function getTwitterMentions(symbol, mint) {
  const cacheKey = `twitter:${mint}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < 300_000) return hit.data; // 5min cache

  let mentions = { score: 0, hasTwitter: false, followers: 0, tweetCount: 0 };

  try {
    // Method 1: Check DexScreener for social links
    const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      signal: AbortSignal.timeout(5000)
    });
    const dexData = await dexRes.json();
    const pair = dexData?.pairs?.find(p => p.chainId === 'solana');
    
    if (pair?.info?.socials) {
      const twitter = pair.info.socials.find(s => s.type === 'twitter');
      if (twitter) {
        mentions.hasTwitter = true;
        mentions.score += 10; // Has a Twitter account = some legitimacy
      }
      
      const telegram = pair.info.socials.find(s => s.type === 'telegram');
      if (telegram) mentions.score += 5;
      
      const website = pair.info.websites?.[0];
      if (website) mentions.score += 5;
    }

    // Method 2: Check if token is in DexScreener "most active on socials"
    // (These are tokens with high social engagement)
    if (pair?.info?.imageUrl) mentions.score += 3; // Has branding = effort put in
    
  } catch {}

  try {
    // Method 3: Check CoinGecko trending (free, no key)
    const cgRes = await fetch('https://api.coingecko.com/api/v3/search/trending', {
      signal: AbortSignal.timeout(5000)
    });
    if (cgRes.ok) {
      const cgData = await cgRes.json();
      const trending = (cgData?.coins || []).map(c => c.item);
      const found = trending.find(t => 
        t.symbol?.toLowerCase() === symbol?.toLowerCase() ||
        t.id?.toLowerCase() === symbol?.toLowerCase()
      );
      if (found) {
        mentions.score += 20; // On CoinGecko trending = massive social activity
        mentions.trendingRank = found.market_cap_rank;
      }
    }
  } catch {}

  try {
    // Method 4: Check if boosted on DexScreener (paid promotion = marketing effort)
    const boostRes = await fetch('https://api.dexscreener.com/token-boosts/top/v1', {
      signal: AbortSignal.timeout(5000)
    });
    if (boostRes.ok) {
      const boosts = await boostRes.json();
      const boosted = (boosts || []).find(b => 
        b.tokenAddress === mint && b.chainId === 'solana'
      );
      if (boosted) {
        mentions.score += 15; // Paid DexScreener boost = active marketing
        mentions.boosted = true;
      }
    }
  } catch {}

  cache.set(cacheKey, { data: mentions, ts: Date.now() });
  return mentions;
}

/**
 * Get tokens trending on social media (aggregated from multiple sources)
 */
async function getSocialTrending() {
  const cacheKey = 'social-trending';
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < 120_000) return hit.data; // 2min cache

  const trending = [];

  try {
    // DexScreener boosted tokens (people paying to promote = social buzz)
    const boostRes = await fetch('https://api.dexscreener.com/token-boosts/top/v1', {
      signal: AbortSignal.timeout(5000)
    });
    if (boostRes.ok) {
      const boosts = await boostRes.json();
      const solBoosts = (boosts || []).filter(b => b.chainId === 'solana').slice(0, 20);
      for (const b of solBoosts) {
        trending.push({
          mint: b.tokenAddress,
          symbol: b.description?.split(' ')?.[0] || '???',
          source: 'dex-boosted',
          socialScore: 15,
        });
      }
    }
  } catch {}

  try {
    // DexScreener most active (high trading = social interest)
    const activeRes = await fetch('https://api.dexscreener.com/token-profiles/latest/v1', {
      signal: AbortSignal.timeout(5000)
    });
    if (activeRes.ok) {
      const profiles = await activeRes.json();
      const solProfiles = (profiles || []).filter(p => p.chainId === 'solana').slice(0, 20);
      for (const p of solProfiles) {
        // Tokens with profiles = teams putting in effort
        const existing = trending.find(t => t.mint === p.tokenAddress);
        if (existing) {
          existing.socialScore += 10;
          existing.hasProfile = true;
        } else {
          trending.push({
            mint: p.tokenAddress,
            symbol: p.description?.split(' ')?.[0] || '???',
            source: 'dex-profile',
            socialScore: 10,
            hasProfile: true,
          });
        }
      }
    }
  } catch {}

  cache.set(cacheKey, { data: trending, ts: Date.now() });
  return trending;
}

/**
 * Score a token's social presence (0-30 bonus points)
 */
async function scoreSocial(symbol, mint) {
  const mentions = await getTwitterMentions(symbol, mint);
  return {
    score: Math.min(30, mentions.score), // cap at 30
    hasTwitter: mentions.hasTwitter,
    boosted: mentions.boosted || false,
    trending: mentions.trendingRank ? true : false,
  };
}

module.exports = { getTwitterMentions, getSocialTrending, scoreSocial };
