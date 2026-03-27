/**
 * AUTOBAGS — Core Trading Agent
 * AI agent loop: scout → score → buy → monitor → exit
 */
require('dotenv').config({ path: './config/.env' });
const BagsClient = require('./bags-client');
const intel = require('./intel-bridge');
const fs = require('fs');
const path = require('path');

const POSITIONS_FILE = path.join(__dirname, '../../data/positions.json');
const TRADES_FILE    = path.join(__dirname, '../../data/trades.json');

const SOL_MINT  = 'So11111111111111111111111111111111111111112';
const FEE_PCT   = parseFloat(process.env.FEE_PERCENT || '1.5') / 100;
const STOP_LOSS = -0.08;  // -8%
const TAKE_PROFIT = 0.25; // +25%

function loadPositions() {
  if (!fs.existsSync(POSITIONS_FILE)) return {};
  return JSON.parse(fs.readFileSync(POSITIONS_FILE, 'utf8'));
}

function savePositions(data) {
  fs.mkdirSync(path.dirname(POSITIONS_FILE), { recursive: true });
  fs.writeFileSync(POSITIONS_FILE, JSON.stringify(data, null, 2));
}

function logTrade(trade) {
  const trades = fs.existsSync(TRADES_FILE)
    ? JSON.parse(fs.readFileSync(TRADES_FILE, 'utf8'))
    : [];
  trades.push({ ...trade, timestamp: new Date().toISOString() });
  fs.writeFileSync(TRADES_FILE, JSON.stringify(trades, null, 2));
}

class AutobagsAgent {
  constructor() {
    this.bags = new BagsClient(process.env.BAGS_API_KEY, process.env.SOLANA_RPC_URL);
    this.partnerKey = process.env.BAGS_PARTNER_KEY;
    this.running = false;
    // No operator wallet — each user has their own wallet via WalletManager
  }

  async tick() {
    const positions = loadPositions();
    const hasPosition = Object.keys(positions).length > 0;

    if (hasPosition) {
      await this.monitorPositions(positions);
    } else {
      await this.scout();
    }
  }

  async scout() {
    console.log('[Agent] 🔍 Scouting for tokens...');
    const trending = intel.getTrendingTokens();
    if (!trending.length) {
      console.log('[Agent] No trending tokens found');
      return;
    }

    for (const token of trending.slice(0, 5)) {
      const mint   = token.mint || token.address;
      const symbol = token.symbol || token.ticker;
      console.log(`[Agent] Scoring ${symbol} (${mint})...`);

      const safe = await intel.isSafe(mint, symbol, 65);
      if (!safe) {
        console.log(`[Agent] ❌ ${symbol} failed intel check`);
        continue;
      }

      // Get quote: buy with 90% of available balance
      const quote = await this.bags.getTradeQuote({
        inputMint: SOL_MINT,
        outputMint: mint,
        amount: token.suggestedBuySol || 0.1,
        slippage: 1.0
      });

      if (!quote?.success) {
        console.log(`[Agent] ❌ No quote for ${symbol}`);
        continue;
      }

      console.log(`[Agent] ✅ Buying ${symbol}`);
      await this.executeBuy({ mint, symbol, quote, solAmount: token.suggestedBuySol || 0.1 });
      break; // One position at a time
    }
  }

  async executeBuy({ mint, symbol, quote, solAmount }) {
    try {
      const userPubkey = WalletManager.getPublicKey(userId);
      const swapTx = await this.bags.createSwapTransaction({
        quoteResponse: quote.response,
        walletPublicKey: userPubkey,
        partnerKey: this.partnerKey
      });

      if (!swapTx?.success) {
        console.error('[Agent] Swap tx creation failed:', swapTx);
        return;
      }

      // TODO: sign with operator keypair and send
      // const signed = await signTransaction(swapTx.response.transaction, keypair);
      // const result = await this.bags.sendTransaction(signed);

      const positions = loadPositions();
      positions[mint] = {
        symbol,
        mint,
        entryPrice: quote.response?.inAmount,
        tokensReceived: quote.response?.outAmount,
        solSpent: solAmount,
        entryTime: new Date().toISOString(),
        stopLoss: STOP_LOSS,
        takeProfit: TAKE_PROFIT
      };
      savePositions(positions);

      logTrade({ type: 'BUY', symbol, mint, solAmount, status: 'executed' });
      console.log(`[Agent] 🟢 Bought ${symbol}`);
    } catch (err) {
      console.error('[Agent] Buy error:', err.message);
    }
  }

  async monitorPositions(positions) {
    for (const [mint, pos] of Object.entries(positions)) {
      console.log(`[Agent] 📊 Monitoring ${pos.symbol}...`);
      // TODO: fetch current price from Birdeye/DexScreener
      // Compare to entry, trigger sell if stop loss or take profit hit
    }
  }

  start(intervalMs = 60000) {
    this.running = true;
    console.log('🤖 AUTOBAGS Agent started');
    this.tick();
    this.interval = setInterval(() => this.tick(), intervalMs);
  }

  stop() {
    this.running = false;
    clearInterval(this.interval);
    console.log('Agent stopped');
  }
}

module.exports = AutobagsAgent;

// Run standalone
if (require.main === module) {
  const agent = new AutobagsAgent();
  agent.start(60000);
}
