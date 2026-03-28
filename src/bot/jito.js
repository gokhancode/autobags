/**
 * AUTOBAGS — Jito Bundle Integration
 * MEV-protected transactions via Jito block engine
 * Prevents sandwich attacks on our trades
 */

const { VersionedTransaction } = require('@solana/web3.js');

const JITO_ENDPOINTS = [
  'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
];

const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4bPuAGEN2P2kq7JoB8NbFey',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSLzPD4KKFD6GJKQnUk',
  'DfXygSm4jCyNCzbzYYKY44MvBo3TFjSWJPKTH2Nex8hD',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiDuNVU4oeKwB5SFnp2tUKVm6XZxVqGPHRo',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

/**
 * Send a transaction as a Jito bundle with tip
 * This protects against MEV (sandwich attacks)
 * 
 * @param {Buffer} signedTx - The signed transaction bytes
 * @param {number} tipLamports - Tip amount in lamports (default: 1000 = 0.000001 SOL)
 */
async function sendJitoBundle(signedTxBase64, tipLamports = 10000) {
  const endpoint = JITO_ENDPOINTS[Math.floor(Math.random() * JITO_ENDPOINTS.length)];
  
  try {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [[signedTxBase64]],
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Jito error ${res.status}: ${errText}`);
    }

    const data = await res.json();
    
    if (data.error) {
      throw new Error(`Jito RPC error: ${JSON.stringify(data.error)}`);
    }

    console.log(`[Jito] Bundle sent via ${endpoint.split('//')[1].split('.')[0]}: ${data.result}`);
    return {
      bundleId: data.result,
      endpoint,
      success: true,
    };
  } catch (err) {
    console.error(`[Jito] Bundle failed:`, err.message);
    // Fall back to regular RPC
    return { success: false, error: err.message };
  }
}

/**
 * Check bundle status
 */
async function getBundleStatus(bundleId) {
  const endpoint = JITO_ENDPOINTS[0].replace('/bundles', '/getBundleStatuses');
  
  try {
    const res = await fetch(JITO_ENDPOINTS[0].replace('bundles', 'getBundleStatuses'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBundleStatuses',
        params: [[bundleId]],
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data?.result?.value?.[0] || null;
  } catch {
    return null;
  }
}

/**
 * Get a random tip account
 */
function getTipAccount() {
  return JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)];
}

/**
 * Determine if we should use Jito based on trade size
 * Small trades (<0.1 SOL) don't need MEV protection
 */
function shouldUseJito(solAmount) {
  return solAmount >= 0.1; // Only use Jito for trades >= 0.1 SOL
}

module.exports = { sendJitoBundle, getBundleStatus, getTipAccount, shouldUseJito };
