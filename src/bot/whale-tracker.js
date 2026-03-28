/**
 * AUTOBAGS — Whale Wallet Tracker
 * Monitors known profitable Solana wallets for buy signals
 * Uses Helius API (free: 100k req/day) + Solscan
 */

const HELIUS_KEY = process.env.HELIUS_API_KEY || '';
const HELIUS_RPC = HELIUS_KEY ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}` : null;

// Top smart money wallets — known profitable Solana memecoin traders
// Sources: Solscan leaderboards, on-chain analysis
const WHALE_WALLETS = [
  { address: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1', label: 'Wintermute' },
  { address: 'HN7cABqLq46Es1jh92dQQisAq662SmxELLLsHHe4YWrH', label: 'Alameda (legacy)' },
  { address: 'DNfuF1L62WWyW3pNakVkyGGFzVVhj4Yr52jSmdTyeBHm', label: 'Smart Money 1' },
  { address: '7Ppgch9d4nCBKAFVERCDDjMNSsKzRFHk68CcYS41E2pA', label: 'Smart Money 2' },
  { address: 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE', label: 'Smart Money 3' },
];

const recentBuys = new Map(); // mint -> { wallets, firstSeen, totalSol }
const CACHE_TTL = 300_000; // 5min

/**
 * Check recent transactions for a whale wallet using Helius Enhanced API
 */
async function getWalletRecentTxs(address, limit = 20) {
  if (!HELIUS_KEY) {
    // Fallback: use Solscan public API
    return getWalletTxsSolscan(address, limit);
  }

  try {
    const res = await fetch(`https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${HELIUS_KEY}&limit=${limit}`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const txs = await res.json();
    
    return txs.filter(tx => tx.type === 'SWAP').map(tx => ({
      signature: tx.signature,
      timestamp: tx.timestamp,
      type: tx.type,
      tokenTransfers: tx.tokenTransfers || [],
      nativeTransfers: tx.nativeTransfers || [],
      description: tx.description,
    }));
  } catch {
    return [];
  }
}

/**
 * Fallback: Solscan public API for wallet transactions
 */
async function getWalletTxsSolscan(address, limit = 20) {
  try {
    const res = await fetch(`https://api.solscan.io/v2/account/transaction?address=${address}&limit=${limit}`, {
      headers: { 'accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.data || []).map(tx => ({
      signature: tx.txHash,
      timestamp: tx.blockTime,
      type: tx.parsedInstruction?.[0]?.type || 'unknown',
    }));
  } catch {
    return [];
  }
}

/**
 * Scan all whale wallets for recent token buys
 * Returns tokens that whales bought in the last N minutes
 */
async function scanWhaleActivity(lookbackMinutes = 30) {
  const cacheKey = 'whale-scan';
  const cached = recentBuys.get(cacheKey);
  if (cached && Date.now() - cached.ts < 120_000) return cached.data; // 2min cache

  const whaleBuys = {};
  const cutoff = Math.floor(Date.now() / 1000) - (lookbackMinutes * 60);

  for (const wallet of WHALE_WALLETS) {
    try {
      const txs = await getWalletRecentTxs(wallet.address, 10);
      
      for (const tx of txs) {
        if (tx.timestamp && tx.timestamp < cutoff) continue;
        
        // Look for token transfers that indicate a buy (SOL out, token in)
        if (tx.tokenTransfers) {
          for (const transfer of tx.tokenTransfers) {
            if (transfer.toUserAccount === wallet.address && transfer.mint) {
              const mint = transfer.mint;
              if (!whaleBuys[mint]) {
                whaleBuys[mint] = { mint, wallets: [], totalAmount: 0, firstSeen: tx.timestamp };
              }
              whaleBuys[mint].wallets.push(wallet.label);
              whaleBuys[mint].totalAmount += parseFloat(transfer.tokenAmount || 0);
            }
          }
        }
      }

      // Rate limit: small delay between wallet checks
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.error(`[WhaleTracker] Error scanning ${wallet.label}:`, err.message);
    }
  }

  const result = Object.values(whaleBuys).sort((a, b) => b.wallets.length - a.wallets.length);
  recentBuys.set(cacheKey, { data: result, ts: Date.now() });
  return result;
}

/**
 * Check if a specific token has whale interest
 */
async function getWhaleSignal(mint) {
  const activity = await scanWhaleActivity();
  const tokenActivity = activity.find(a => a.mint === mint);
  
  if (!tokenActivity) return { score: 0, whales: [] };
  
  // More whale wallets buying = stronger signal
  const whaleCount = new Set(tokenActivity.wallets).size;
  let score = 0;
  if (whaleCount >= 3) score = 25; // 3+ whales = very strong
  else if (whaleCount >= 2) score = 15;
  else if (whaleCount >= 1) score = 8;

  return {
    score,
    whales: [...new Set(tokenActivity.wallets)],
    totalAmount: tokenActivity.totalAmount,
    firstSeen: tokenActivity.firstSeen,
  };
}

/**
 * Get whale-bought tokens as trading candidates
 */
async function getWhaleCandidates() {
  const activity = await scanWhaleActivity();
  return activity.map(a => ({
    mint: a.mint,
    symbol: `WHALE_${a.mint.slice(0, 6)}`,
    source: 'whale-tracker',
    whaleCount: new Set(a.wallets).size,
    wallets: [...new Set(a.wallets)],
  }));
}

module.exports = { 
  scanWhaleActivity, 
  getWhaleSignal, 
  getWhaleCandidates,
  WHALE_WALLETS 
};
