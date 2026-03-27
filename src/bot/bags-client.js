/**
 * AUTOBAGS — Bags.fm API client
 * Wraps the official Bags SDK for trading + fee sharing
 */
const { Connection, PublicKey, Keypair } = require('@solana/web3.js');
const bs58 = require('bs58');

const BAGS_API_BASE = 'https://public-api-v2.bags.fm/api/v1';

class BagsClient {
  constructor(apiKey, rpcUrl) {
    this.apiKey = apiKey;
    this.connection = new Connection(rpcUrl || process.env.SOLANA_RPC_URL, 'processed');
    this.headers = {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    };
  }

  async get(path) {
    const res = await fetch(`${BAGS_API_BASE}${path}`, { headers: this.headers });
    return res.json();
  }

  async post(path, body) {
    const res = await fetch(`${BAGS_API_BASE}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body)
    });
    return res.json();
  }

  // ─── Token Discovery ───────────────────────────────────────────────────────

  async getTokenFeed(limit = 20) {
    return this.get(`/token-launch/feed?limit=${limit}`);
  }

  async getBagsPools(onlyMigrated = false) {
    return this.get(`/solana/bags/pools?onlyMigrated=${onlyMigrated}`);
  }

  async getPoolByMint(mint) {
    return this.get(`/solana/bags/pools/${mint}`);
  }

  // ─── Trading ───────────────────────────────────────────────────────────────

  async getTradeQuote({ inputMint, outputMint, amount, slippage = 0.5 }) {
    return this.post('/trade/quote', {
      inputMint,
      outputMint,
      amount,
      slippageBps: Math.round(slippage * 100)
    });
  }

  async createSwapTransaction({ quoteResponse, walletPublicKey, partnerKey }) {
    return this.post('/trade/swap', {
      quoteResponse,
      userPublicKey: walletPublicKey,
      ...(partnerKey && { partnerKey }) // inject our fee-sharing partner key
    });
  }

  async sendTransaction(serializedTx) {
    return this.post('/transaction/send', {
      transaction: serializedTx
    });
  }

  // ─── Fee Sharing ───────────────────────────────────────────────────────────

  async createPartnerConfig(walletPublicKey) {
    return this.post('/partner/config', {
      walletPublicKey
    });
  }

  async getPartnerStats(partnerKey) {
    return this.get(`/partner/stats?partnerKey=${partnerKey}`);
  }

  async claimPartnerFees(partnerKey, walletPublicKey) {
    return this.post('/partner/claim', {
      partnerKey,
      walletPublicKey
    });
  }

  // ─── Token Lifetime Stats ──────────────────────────────────────────────────

  async getTokenLifetimeFees(mint) {
    return this.get(`/token/fees?mint=${mint}`);
  }

  async getTokenCreators(mint) {
    return this.get(`/token/creators?mint=${mint}`);
  }
}

module.exports = BagsClient;
