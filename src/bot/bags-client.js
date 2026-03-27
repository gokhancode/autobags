/**
 * AUTOBAGS — Bags.fm API client
 * All paths verified against docs.bags.fm OpenAPI specs
 */

const BAGS_API_BASE = 'https://public-api-v2.bags.fm/api/v1';

class BagsClient {
  constructor(apiKey, rpcUrl) {
    this.apiKey = apiKey;
    this.rpcUrl = rpcUrl;
    this.headers = {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    };
  }

  async get(path) {
    const res = await fetch(`${BAGS_API_BASE}${path}`, { headers: this.headers });
    if (!res.ok) throw new Error(`Bags API ${res.status}: ${path}`);
    return res.json();
  }

  async post(path, body) {
    const res = await fetch(`${BAGS_API_BASE}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Bags API ${res.status}: ${path}`);
    return res.json();
  }

  // ─── Token Discovery ───────────────────────────────────────────────────────

  /** GET /token-launch/feed — no limit param supported, returns 100 */
  async getTokenFeed() {
    return this.get('/token-launch/feed');
  }

  /** GET /solana/bags/pools */
  async getBagsPools(onlyMigrated = false) {
    return this.get(`/solana/bags/pools?onlyMigrated=${onlyMigrated}`);
  }

  /** GET /solana/bags/pools/:mint */
  async getPoolByMint(mint) {
    return this.get(`/solana/bags/pools/${mint}`);
  }

  // ─── Trading ───────────────────────────────────────────────────────────────

  /**
   * GET /trade/quote
   * amount = lamports (e.g. 0.1 SOL = 100_000_000)
   */
  async getTradeQuote({ inputMint, outputMint, amount, slippageBps = 100, slippageMode = 'manual' }) {
    const params = new URLSearchParams({ inputMint, outputMint, amount, slippageBps, slippageMode });
    return this.get(`/trade/quote?${params}`);
  }

  /** POST /trade/swap */
  async createSwapTransaction({ quoteResponse, walletPublicKey, partnerKey }) {
    return this.post('/trade/swap', {
      quoteResponse,
      userPublicKey: walletPublicKey,
      ...(partnerKey && { partnerKey })
    });
  }

  /** POST /transaction/send */
  async sendTransaction(serializedTx) {
    return this.post('/transaction/send', { transaction: serializedTx });
  }

  // ─── Fee Sharing / Partner ─────────────────────────────────────────────────

  /** GET /fee-share/partner-config/stats?partner=<pubkey> */
  async getPartnerStats(partnerWallet) {
    return this.get(`/fee-share/partner-config/stats?partner=${partnerWallet}`);
  }

  /** POST /fee-share/partner-config/claim */
  async claimPartnerFees(partnerWallet) {
    return this.post('/fee-share/partner-config/claim', { partner: partnerWallet });
  }

  // ─── Analytics ────────────────────────────────────────────────────────────

  /** GET /token/fees?mint=<mint> */
  async getTokenLifetimeFees(mint) {
    return this.get(`/token/fees?mint=${mint}`);
  }

  /** GET /token/creators?mint=<mint> */
  async getTokenCreators(mint) {
    return this.get(`/token/creators?mint=${mint}`);
  }
}

module.exports = BagsClient;
