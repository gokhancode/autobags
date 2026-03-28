/**
 * AUTOBAGS — DCA (Dollar Cost Average) Mode
 * Automatically buys into a position over time
 * Reduces impact of entry timing
 */

const fs = require('fs');
const path = require('path');

const DCA_FILE = path.join(__dirname, '../../data/dca-state.json');

function load(f, def) {
  try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : def; }
  catch { return def; }
}
function save(f, d) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

/**
 * Create a DCA plan
 * @param {string} userId
 * @param {string} mint
 * @param {object} config - { totalSol, intervals, intervalMinutes }
 */
function createDCA(userId, mint, symbol, config) {
  const { totalSol, intervals = 5, intervalMinutes = 5 } = config;
  const solPerBuy = totalSol / intervals;
  
  const plan = {
    userId, mint, symbol,
    totalSol, intervals, intervalMinutes, solPerBuy,
    completedBuys: 0,
    totalSpent: 0,
    avgEntryPrice: 0,
    entries: [],
    active: true,
    createdAt: new Date().toISOString(),
    nextBuyAt: new Date().toISOString(),
  };
  
  const state = load(DCA_FILE, {});
  if (!state[userId]) state[userId] = {};
  state[userId][mint] = plan;
  save(DCA_FILE, state);
  
  console.log(`[DCA] Created plan for ${symbol}: ${totalSol} SOL over ${intervals} buys, ${intervalMinutes}min apart`);
  return plan;
}

/**
 * Check if any DCA buys are due
 * Called by agent on each tick
 * Returns list of pending buys
 */
function checkDCA(userId) {
  const state = load(DCA_FILE, {});
  const plans = state?.[userId] || {};
  const pendingBuys = [];
  
  for (const [mint, plan] of Object.entries(plans)) {
    if (!plan.active) continue;
    if (plan.completedBuys >= plan.intervals) {
      plan.active = false;
      continue;
    }
    
    const now = new Date();
    const nextBuy = new Date(plan.nextBuyAt);
    
    if (now >= nextBuy) {
      pendingBuys.push({
        mint,
        symbol: plan.symbol,
        solAmount: plan.solPerBuy,
        buyNumber: plan.completedBuys + 1,
        totalBuys: plan.intervals,
      });
    }
  }
  
  if (pendingBuys.length > 0) save(DCA_FILE, state);
  return pendingBuys;
}

/**
 * Record a completed DCA buy
 */
function recordBuy(userId, mint, solSpent, price) {
  const state = load(DCA_FILE, {});
  const plan = state?.[userId]?.[mint];
  if (!plan) return;
  
  plan.completedBuys++;
  plan.totalSpent += solSpent;
  plan.entries.push({ sol: solSpent, price, time: new Date().toISOString() });
  plan.avgEntryPrice = plan.entries.reduce((s, e) => s + e.price, 0) / plan.entries.length;
  plan.nextBuyAt = new Date(Date.now() + plan.intervalMinutes * 60000).toISOString();
  
  if (plan.completedBuys >= plan.intervals) {
    plan.active = false;
    console.log(`[DCA] ${plan.symbol} complete: ${plan.totalSpent.toFixed(4)} SOL over ${plan.completedBuys} buys, avg price $${plan.avgEntryPrice.toFixed(8)}`);
  }
  
  save(DCA_FILE, state);
}

/**
 * Get DCA status for a user
 */
function getDCAStatus(userId) {
  const state = load(DCA_FILE, {});
  return state?.[userId] || {};
}

/**
 * Cancel a DCA plan
 */
function cancelDCA(userId, mint) {
  const state = load(DCA_FILE, {});
  if (state?.[userId]?.[mint]) {
    state[userId][mint].active = false;
    save(DCA_FILE, state);
    return true;
  }
  return false;
}

module.exports = { createDCA, checkDCA, recordBuy, getDCAStatus, cancelDCA };
