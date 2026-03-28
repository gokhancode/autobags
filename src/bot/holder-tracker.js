/**
 * AUTOBAGS — Solscan Holder Growth Rate Tracking
 * Monitors how fast a token's holder count is growing
 * Fast holder growth = increasing interest = bullish signal
 */

const cache = new Map();

/**
 * Get holder count and estimate growth from Birdeye or on-chain
 */
async function getHolderStats(mint) {
  const cacheKey = `holders:${mint}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < 120_000) return hit.data;

  let stats = { holders: 0, growth: 'unknown' };

  // Method 1: Birdeye (has holder count)
  try {
    const headers = { 'accept': 'application/json' };
    if (process.env.BIRDEYE_API_KEY) headers['X-API-KEY'] = process.env.BIRDEYE_API_KEY;
    
    const res = await fetch(`https://public-api.birdeye.so/defi/token_overview?address=${mint}`, {
      headers, signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const data = await res.json();
      const d = data?.data;
      if (d) {
        stats.holders = d.holder || 0;
        stats.uniqueWallet24h = d.uniqueWallet24h || 0;
        stats.uniqueWallet1hChange = d.uniqueWallet1hChangePercent || 0;
        
        // Estimate growth rate
        if (stats.uniqueWallet1hChange > 20) stats.growth = 'explosive';
        else if (stats.uniqueWallet1hChange > 5) stats.growth = 'fast';
        else if (stats.uniqueWallet1hChange > 0) stats.growth = 'growing';
        else if (stats.uniqueWallet1hChange < -5) stats.growth = 'declining';
        else stats.growth = 'stable';
      }
    }
  } catch {}

  // Method 2: On-chain (fallback — count token accounts)
  if (stats.holders === 0) {
    try {
      const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1,
          method: 'getTokenLargestAccounts',
          params: [mint]
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        stats.holders = data?.result?.value?.length || 0;
        stats.topHolders = (data?.result?.value || []).slice(0, 5).map(a => ({
          amount: parseFloat(a.uiAmount || 0),
        }));
      }
    } catch {}
  }

  cache.set(cacheKey, { data: stats, ts: Date.now() });
  return stats;
}

/**
 * Score holder growth (0-15 bonus points)
 */
async function scoreHolderGrowth(mint) {
  const stats = await getHolderStats(mint);
  
  let score = 0;
  if (stats.growth === 'explosive') score = 15;
  else if (stats.growth === 'fast') score = 10;
  else if (stats.growth === 'growing') score = 5;
  else if (stats.growth === 'declining') score = -5;
  
  // High holder count = more distributed = healthier
  if (stats.holders > 5000) score += 5;
  else if (stats.holders > 1000) score += 3;
  
  return { score: Math.max(-10, Math.min(15, score)), ...stats };
}

module.exports = { getHolderStats, scoreHolderGrowth };
