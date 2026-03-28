/**
 * AUTOBAGS — Jupiter Price API Integration
 * Aggregated best price across all Solana DEXs
 * Free, no API key needed, no rate limits
 */

const cache = new Map();

const JUPITER_PRICE_API = 'https://price.jup.ag/v6';
const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6';

/**
 * Get token price from Jupiter (aggregated across all DEXs)
 */
async function getPrice(mint) {
  const cacheKey = `price:${mint}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < 10_000) return hit.data; // 10s cache

  try {
    const res = await fetch(`${JUPITER_PRICE_API}/price?ids=${mint}`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    const price = data?.data?.[mint]?.price;
    
    if (price) {
      cache.set(cacheKey, { data: parseFloat(price), ts: Date.now() });
      return parseFloat(price);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get prices for multiple tokens in one call (batch)
 */
async function getPrices(mints) {
  try {
    const ids = mints.join(',');
    const res = await fetch(`${JUPITER_PRICE_API}/price?ids=${ids}`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return {};
    const data = await res.json();
    
    const prices = {};
    for (const [mint, info] of Object.entries(data?.data || {})) {
      prices[mint] = parseFloat(info.price);
    }
    return prices;
  } catch {
    return {};
  }
}

/**
 * Get best swap quote from Jupiter
 * Shows the best execution price across all DEXs
 */
async function getQuote(inputMint, outputMint, amount, slippageBps = 100) {
  try {
    const res = await fetch(
      `${JUPITER_QUOTE_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Compare Jupiter price vs DexScreener price
 * Returns the better one
 */
async function getBestPrice(mint) {
  const jupPrice = await getPrice(mint);
  
  let dexPrice = null;
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json();
    const pair = data?.pairs?.find(p => p.chainId === 'solana');
    if (pair) dexPrice = parseFloat(pair.priceUsd);
  } catch {}
  
  return {
    jupiter: jupPrice,
    dexscreener: dexPrice,
    best: jupPrice || dexPrice,
    source: jupPrice ? 'jupiter' : 'dexscreener',
    spread: jupPrice && dexPrice ? Math.abs(jupPrice - dexPrice) / Math.max(jupPrice, dexPrice) * 100 : null,
  };
}

module.exports = { getPrice, getPrices, getQuote, getBestPrice };
