/**
 * AUTOBAGS — Multi-Token Portfolio Rebalancer
 * Manages multiple positions with target allocations
 * Auto-rebalances when positions drift from targets
 */

const fs = require('fs');
const path = require('path');

const REBAL_FILE = path.join(__dirname, '../../data/rebalance-config.json');

function load(f, def) {
  try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : def; }
  catch { return def; }
}
function save(f, d) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

/**
 * Set portfolio allocation targets
 * @param {string} userId
 * @param {object} allocations - { mintAddress: targetPct, ... }
 * @param {number} rebalanceThreshold - % drift before rebalancing (default 5%)
 */
function setAllocations(userId, allocations, rebalanceThreshold = 5) {
  const totalPct = Object.values(allocations).reduce((s, v) => s + v, 0);
  if (totalPct > 100) throw new Error('Allocations exceed 100%');
  
  const config = {
    userId,
    allocations, // { mint: targetPct }
    rebalanceThreshold,
    cashTarget: 100 - totalPct, // remainder stays in SOL
    active: true,
    lastRebalance: null,
    createdAt: new Date().toISOString(),
  };
  
  const state = load(REBAL_FILE, {});
  state[userId] = config;
  save(REBAL_FILE, state);
  
  return config;
}

/**
 * Check if rebalancing is needed
 * @param {string} userId
 * @param {object} currentValues - { mint: currentValueSol, ... }
 * @param {number} totalWorth - total portfolio value in SOL
 * @returns {Array} - trades needed to rebalance
 */
function checkRebalance(userId, currentValues, totalWorth) {
  const state = load(REBAL_FILE, {});
  const config = state?.[userId];
  if (!config || !config.active) return [];
  
  const trades = [];
  
  for (const [mint, targetPct] of Object.entries(config.allocations)) {
    const currentValue = currentValues[mint] || 0;
    const currentPct = totalWorth > 0 ? (currentValue / totalWorth * 100) : 0;
    const drift = currentPct - targetPct;
    
    if (Math.abs(drift) > config.rebalanceThreshold) {
      const targetValue = totalWorth * (targetPct / 100);
      const diff = targetValue - currentValue;
      
      trades.push({
        mint,
        action: diff > 0 ? 'BUY' : 'SELL',
        solAmount: Math.abs(diff),
        currentPct: parseFloat(currentPct.toFixed(1)),
        targetPct,
        drift: parseFloat(drift.toFixed(1)),
      });
    }
  }
  
  return trades;
}

/**
 * Record a rebalance event
 */
function recordRebalance(userId) {
  const state = load(REBAL_FILE, {});
  if (state[userId]) {
    state[userId].lastRebalance = new Date().toISOString();
    save(REBAL_FILE, state);
  }
}

/**
 * Get rebalance config
 */
function getConfig(userId) {
  const state = load(REBAL_FILE, {});
  return state?.[userId] || null;
}

module.exports = { setAllocations, checkRebalance, recordRebalance, getConfig };
