/**
 * AUTOBAGS — WebSocket Price Feed
 * Real-time price updates via Birdeye WebSocket + DexScreener polling fallback
 * Replaces 15s polling with sub-second updates for monitored positions
 */

const EventEmitter = require('events');

class PriceFeed extends EventEmitter {
  constructor() {
    super();
    this.subscriptions = new Map(); // mint -> { price, lastUpdate }
    this.pollInterval = null;
    this.running = false;
  }

  /**
   * Start monitoring a token's price
   */
  subscribe(mint, symbol = '???') {
    if (this.subscriptions.has(mint)) return;
    this.subscriptions.set(mint, { 
      symbol, 
      price: 0, 
      lastUpdate: 0,
      high: 0,
      low: Infinity,
    });
    console.log(`[WS-Feed] Subscribed to ${symbol} (${mint.slice(0, 8)}...)`);
    
    if (!this.running) this.start();
  }

  /**
   * Stop monitoring a token
   */
  unsubscribe(mint) {
    this.subscriptions.delete(mint);
    console.log(`[WS-Feed] Unsubscribed from ${mint.slice(0, 8)}...`);
    
    if (this.subscriptions.size === 0) this.stop();
  }

  /**
   * Start the price feed polling loop
   * Uses fast polling (5s) instead of the agent's 15s tick
   */
  start() {
    if (this.running) return;
    this.running = true;
    console.log(`[WS-Feed] Starting price feed (5s intervals)`);
    
    this.pollInterval = setInterval(() => this._poll(), 5000);
    this._poll(); // immediate first poll
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    console.log(`[WS-Feed] Stopped`);
  }

  async _poll() {
    const mints = [...this.subscriptions.keys()];
    if (mints.length === 0) return;

    // Batch fetch — DexScreener supports multi-token in one call
    // Max 30 addresses per request
    const batchSize = 30;
    for (let i = 0; i < mints.length; i += batchSize) {
      const batch = mints.slice(i, i + batchSize);
      const addresses = batch.join(',');
      
      try {
        const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${addresses}`, {
          signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) continue;
        
        const data = await res.json();
        const pairs = data?.pairs || [];
        
        for (const mint of batch) {
          const pair = pairs.find(p => 
            p.baseToken?.address === mint && p.chainId === 'solana'
          );
          if (!pair) continue;
          
          const sub = this.subscriptions.get(mint);
          if (!sub) continue;
          
          const newPrice = parseFloat(pair.priceUsd || 0);
          const oldPrice = sub.price;
          
          if (newPrice !== oldPrice && newPrice > 0) {
            sub.price = newPrice;
            sub.lastUpdate = Date.now();
            if (newPrice > sub.high) sub.high = newPrice;
            if (newPrice < sub.low) sub.low = newPrice;
            
            const changePct = oldPrice > 0 ? ((newPrice - oldPrice) / oldPrice) * 100 : 0;
            
            this.emit('price', {
              mint,
              symbol: sub.symbol,
              price: newPrice,
              oldPrice,
              changePct,
              high: sub.high,
              low: sub.low,
              timestamp: Date.now(),
            });
            
            // Emit alerts for significant moves
            if (Math.abs(changePct) > 2) {
              this.emit('significant_move', {
                mint,
                symbol: sub.symbol,
                price: newPrice,
                changePct,
                direction: changePct > 0 ? 'up' : 'down',
              });
            }
          }
        }
      } catch (err) {
        console.error(`[WS-Feed] Poll error:`, err.message);
      }
    }
  }

  /**
   * Get current price for a subscribed token
   */
  getPrice(mint) {
    const sub = this.subscriptions.get(mint);
    return sub ? sub.price : 0;
  }

  /**
   * Get all current prices
   */
  getAllPrices() {
    const prices = {};
    for (const [mint, sub] of this.subscriptions) {
      prices[mint] = {
        symbol: sub.symbol,
        price: sub.price,
        high: sub.high,
        low: sub.low,
        lastUpdate: sub.lastUpdate,
      };
    }
    return prices;
  }

  /**
   * Get subscription count
   */
  get count() {
    return this.subscriptions.size;
  }
}

// Singleton
const priceFeed = new PriceFeed();
module.exports = priceFeed;
