/**
 * AUTOBAGS — Rug Detection via Helius DAS API
 * Checks token metadata, mint authority, freeze authority, holder distribution
 * Free tier: 100k req/day
 */

const HELIUS_KEY = process.env.HELIUS_API_KEY || '';
const HELIUS_RPC = HELIUS_KEY 
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}` 
  : 'https://api.mainnet-beta.solana.com';

const cache = new Map();

/**
 * Get token metadata via Helius DAS (Digital Asset Standard)
 */
async function getTokenMetadata(mint) {
  const cacheKey = `meta:${mint}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < 300_000) return hit.data;

  try {
    const res = await fetch(HELIUS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getAsset',
        params: { id: mint }
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const asset = data?.result;
    if (!asset) return null;

    const result = {
      name: asset.content?.metadata?.name,
      symbol: asset.content?.metadata?.symbol,
      supply: asset.token_info?.supply,
      decimals: asset.token_info?.decimals,
      mintAuthority: asset.authorities?.find(a => a.scopes?.includes('mint'))?.address,
      freezeAuthority: asset.authorities?.find(a => a.scopes?.includes('freeze'))?.address,
      mutable: asset.mutable,
      burnt: asset.burnt,
      owner: asset.ownership?.owner,
    };

    cache.set(cacheKey, { data: result, ts: Date.now() });
    return result;
  } catch (err) {
    console.error(`[RugDetect] Metadata error for ${mint}:`, err.message);
    return null;
  }
}

/**
 * Get top holders for a token
 */
async function getTopHolders(mint, limit = 20) {
  const cacheKey = `holders:${mint}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < 120_000) return hit.data;

  try {
    // Use Helius getTokenLargestAccounts
    const res = await fetch(HELIUS_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTokenLargestAccounts',
        params: [mint]
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const accounts = data?.result?.value || [];

    const holders = accounts.slice(0, limit).map(a => ({
      address: a.address,
      amount: parseFloat(a.uiAmount || a.amount),
      decimals: a.decimals,
    }));

    cache.set(cacheKey, { data: holders, ts: Date.now() });
    return holders;
  } catch (err) {
    console.error(`[RugDetect] Holders error for ${mint}:`, err.message);
    return null;
  }
}

/**
 * Full rug risk assessment
 * Returns { safe: bool, score: 0-100, flags: string[] }
 * Higher score = MORE risky
 */
async function assessRisk(mint) {
  const cacheKey = `risk:${mint}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < 120_000) return hit.data;

  let riskScore = 0;
  const flags = [];

  // 1. Check metadata
  const meta = await getTokenMetadata(mint);
  if (meta) {
    // Mint authority still active = can mint unlimited tokens
    if (meta.mintAuthority) {
      riskScore += 30;
      flags.push('⚠️ Mint authority active — dev can inflate supply');
    }
    // Freeze authority = can freeze your tokens
    if (meta.freezeAuthority) {
      riskScore += 25;
      flags.push('🚨 Freeze authority active — tokens can be frozen');
    }
    // Mutable metadata = can change token name/symbol
    if (meta.mutable) {
      riskScore += 10;
      flags.push('⚠️ Mutable metadata');
    }
  }

  // 2. Check holder concentration
  const holders = await getTopHolders(mint);
  if (holders && holders.length > 0) {
    const totalFromTop = holders.reduce((s, h) => s + h.amount, 0);
    const top1Pct = holders[0] ? (holders[0].amount / totalFromTop * 100) : 0;
    const top5Pct = holders.slice(0, 5).reduce((s, h) => s + h.amount, 0) / totalFromTop * 100;

    if (top1Pct > 50) {
      riskScore += 30;
      flags.push(`🚨 Top holder owns ${top1Pct.toFixed(0)}% of supply`);
    } else if (top1Pct > 20) {
      riskScore += 15;
      flags.push(`⚠️ Top holder owns ${top1Pct.toFixed(0)}%`);
    }

    if (top5Pct > 80) {
      riskScore += 20;
      flags.push(`🚨 Top 5 holders own ${top5Pct.toFixed(0)}%`);
    }

    // Few holders = easy to manipulate
    if (holders.length < 10) {
      riskScore += 15;
      flags.push(`⚠️ Only ${holders.length} significant holders`);
    }
  }

  // 3. Check DexScreener for liquidity/volume red flags
  try {
    const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      signal: AbortSignal.timeout(5000)
    });
    const dexData = await dexRes.json();
    const pair = dexData?.pairs?.find(p => p.chainId === 'solana');
    if (pair) {
      const liq = parseFloat(pair.liquidity?.usd || 0);
      const vol = parseFloat(pair.volume?.h24 || 0);
      
      // Volume/liquidity ratio > 10 = likely wash trading
      if (liq > 0 && vol / liq > 10) {
        riskScore += 20;
        flags.push(`🚨 Vol/Liq ratio ${(vol/liq).toFixed(1)}x — wash trading likely`);
      }

      // Very low liquidity
      if (liq < 5000) {
        riskScore += 15;
        flags.push(`⚠️ Low liquidity: $${liq.toFixed(0)}`);
      }

      // Token age < 1 hour
      if (pair.pairCreatedAt) {
        const ageMin = (Date.now() - new Date(pair.pairCreatedAt).getTime()) / 60000;
        if (ageMin < 60) {
          riskScore += 10;
          flags.push(`⚠️ Very new: ${Math.round(ageMin)}min old`);
        }
      }
    }
  } catch {}

  riskScore = Math.min(100, riskScore);
  const safe = riskScore < 40;

  const result = { safe, riskScore, flags, mint };
  cache.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}

/**
 * Quick safety check — returns true if token passes minimum safety
 */
async function isSafe(mint, maxRisk = 50) {
  const risk = await assessRisk(mint);
  return risk.riskScore <= maxRisk;
}

module.exports = { assessRisk, isSafe, getTokenMetadata, getTopHolders };
