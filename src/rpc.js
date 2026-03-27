/**
 * AUTOBAGS — RPC Connection Manager
 * Multiple RPC endpoints with automatic fallback
 * Prevents rate limiting from killing the bot
 */
const { Connection } = require('@solana/web3.js');

const RPC_ENDPOINTS = [
  process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  'https://api.mainnet-beta.solana.com',
  'https://solana-mainnet.g.alchemy.com/v2/demo', // public demo
].filter(Boolean);

// If user has Helius key, add it as primary
if (process.env.HELIUS_API_KEY) {
  RPC_ENDPOINTS.unshift(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`);
}

let currentIndex = 0;
let connections = RPC_ENDPOINTS.map(url => new Connection(url, 'confirmed'));
let failCounts = new Array(RPC_ENDPOINTS.length).fill(0);

/**
 * Get the best available RPC connection
 * Automatically rotates on failure
 */
function getConnection() {
  return connections[currentIndex];
}

/**
 * Report a failure — rotate to next RPC
 */
function reportFailure() {
  failCounts[currentIndex]++;
  if (failCounts[currentIndex] >= 3) {
    console.warn(`[RPC] Endpoint ${currentIndex} failed 3x, rotating...`);
    currentIndex = (currentIndex + 1) % connections.length;
    failCounts[currentIndex] = 0;
  }
}

/**
 * Report success — reset fail count
 */
function reportSuccess() {
  failCounts[currentIndex] = 0;
}

/**
 * Execute an RPC call with automatic retry/fallback
 */
async function withRetry(fn, maxRetries = 2) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      const result = await fn(getConnection());
      reportSuccess();
      return result;
    } catch (err) {
      reportFailure();
      if (i === maxRetries) throw err;
      // Small delay before retry
      await new Promise(r => setTimeout(r, 500));
    }
  }
}

function getStatus() {
  return {
    currentEndpoint: RPC_ENDPOINTS[currentIndex].replace(/api-key=.*/, 'api-key=***'),
    totalEndpoints: RPC_ENDPOINTS.length,
    failCounts: [...failCounts]
  };
}

module.exports = { getConnection, reportFailure, reportSuccess, withRetry, getStatus };
