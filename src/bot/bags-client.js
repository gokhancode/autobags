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

  /** POST /solana/send-transaction — base58 encoded signed VersionedTransaction */
  async sendTransaction(base58SignedTx) {
    return this.post('/solana/send-transaction', { transaction: base58SignedTx });
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

  // ─── Partner Config ─────────────────────────────────────────────────────

  /** POST /fee-share/partner-config/creation-tx — create partner config on-chain */
  async createPartnerConfig(walletPublicKey, feeBps = 150) {
    return this.post('/fee-share/partner-config/creation-tx', {
      wallet: walletPublicKey,
      feeBps  // 150 = 1.5%
    });
  }

  /** GET /fee-share/partner-config/stats?partner=<pubkey> */
  async getPartnerStats(partnerWallet) {
    return this.get(`/fee-share/partner-config/stats?partner=${partnerWallet}`);
  }

  /** POST /fee-share/partner-config/claim */
  async claimPartnerFees(partnerWallet) {
    return this.post('/fee-share/partner-config/claim', { partner: partnerWallet });
  }

  // ─── Fee Claiming ──────────────────────────────────────────────────────

  /** GET /token-launch/claimable-positions?wallet=<pubkey> */
  async getClaimablePositions(walletPublicKey) {
    return this.get(`/token-launch/claimable-positions?wallet=${walletPublicKey}`);
  }

  /** POST /token-launch/claim-txs/v3 — generate claim transactions */
  async getClaimTransactions(tokenMint, walletPublicKey) {
    return this.post('/token-launch/claim-txs/v3', {
      tokenMint,
      wallet: walletPublicKey
    });
  }

  // ─── Token Launch ──────────────────────────────────────────────────────

  /** POST /token-launch/create-token-info — create token metadata + mint */
  async createTokenInfo(formData) {
    // This endpoint expects multipart/form-data with image
    const res = await fetch(`${BAGS_API_BASE}/token-launch/create-token-info`, {
      method: 'POST',
      headers: { 'x-api-key': this.apiKey },
      body: formData
    });
    if (!res.ok) throw new Error(`Bags API ${res.status}: /token-launch/create-token-info`);
    return res.json();
  }

  /** POST /token-launch/create-launch-transaction */
  async createLaunchTransaction({ ipfs, tokenMint, wallet, initialBuyLamports, configKey }) {
    return this.post('/token-launch/create-launch-transaction', {
      ipfs, tokenMint, wallet, initialBuyLamports, configKey
    });
  }

  // ─── Agent Auth ────────────────────────────────────────────────────────

  /** POST /agent/auth/init — start agent auth flow */
  async agentAuthInit(agentUsername) {
    return this.post('/agent/auth/init', { agentUsername });
  }

  /** POST /agent/auth/login — complete agent auth */
  async agentAuthLogin(agentUsername, postId) {
    return this.post('/agent/auth/login', { agentUsername, postId });
  }

  /** GET /agent/wallets — list agent wallets */
  async listAgentWallets(agentToken) {
    const res = await fetch(`${BAGS_API_BASE}/agent/wallets`, {
      headers: { ...this.headers, 'Authorization': `Bearer ${agentToken}` }
    });
    if (!res.ok) throw new Error(`Bags API ${res.status}: /agent/wallets`);
    return res.json();
  }

  /** POST /agent/dev-keys — create dev key */
  async createAgentDevKey(agentToken, name) {
    const res = await fetch(`${BAGS_API_BASE}/agent/dev-keys`, {
      method: 'POST',
      headers: { ...this.headers, 'Authorization': `Bearer ${agentToken}` },
      body: JSON.stringify({ name })
    });
    if (!res.ok) throw new Error(`Bags API ${res.status}: /agent/dev-keys`);
    return res.json();
  }

  // ─── Pool Analytics ────────────────────────────────────────────────────

  /** GET /solana/bags/pools/:mint — detailed pool info */
  async getPoolDetails(mint) {
    return this.get(`/solana/bags/pools/${mint}`);
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
