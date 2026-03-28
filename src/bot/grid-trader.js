/**
 * AUTOBAGS — Grid Trading Mode
 * Sets buy/sell orders at fixed price intervals for range-bound tokens
 * Profits from oscillation without predicting direction
 */

const fs = require('fs');
const path = require('path');

const GRID_FILE = path.join(__dirname, '../../data/grid-state.json');

function load(f, def) {
  try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : def; }
  catch { return def; }
}
function save(f, d) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

/**
 * Create a grid for a token
 * @param {string} userId
 * @param {string} mint
 * @param {object} config - { lowerPrice, upperPrice, gridCount, totalSol }
 */
function createGrid(userId, mint, symbol, config) {
  const { lowerPrice, upperPrice, gridCount = 10, totalSol } = config;
  
  const step = (upperPrice - lowerPrice) / gridCount;
  const solPerGrid = totalSol / gridCount;
  
  const levels = [];
  for (let i = 0; i <= gridCount; i++) {
    const price = lowerPrice + (step * i);
    levels.push({
      price: parseFloat(price.toFixed(10)),
      type: 'pending', // pending, bought, sold
      solAmount: solPerGrid,
      filledAt: null,
    });
  }
  
  const grid = {
    userId,
    mint,
    symbol,
    lowerPrice,
    upperPrice,
    gridCount,
    totalSol,
    solPerGrid,
    levels,
    active: true,
    createdAt: new Date().toISOString(),
    totalProfit: 0,
    fills: 0,
  };
  
  const state = load(GRID_FILE, {});
  if (!state[userId]) state[userId] = {};
  state[userId][mint] = grid;
  save(GRID_FILE, state);
  
  console.log(`[Grid] Created ${gridCount}-level grid for ${symbol}: $${lowerPrice} - $${upperPrice}`);
  return grid;
}

/**
 * Check grid levels against current price and execute trades
 * Called by the agent on each tick
 */
function checkGrid(userId, mint, currentPrice) {
  const state = load(GRID_FILE, {});
  const grid = state?.[userId]?.[mint];
  if (!grid || !grid.active) return [];
  
  const actions = [];
  
  for (let i = 0; i < grid.levels.length; i++) {
    const level = grid.levels[i];
    
    // Buy at lower levels when price drops to them
    if (level.type === 'pending' && currentPrice <= level.price) {
      level.type = 'bought';
      level.filledAt = currentPrice;
      level.filledTime = new Date().toISOString();
      actions.push({ action: 'BUY', price: level.price, solAmount: level.solAmount, gridLevel: i });
      grid.fills++;
    }
    
    // Sell at upper levels when price rises to them (if we bought at a lower level)
    if (level.type === 'bought' && currentPrice >= grid.levels[Math.min(i + 1, grid.levels.length - 1)]?.price) {
      const profit = (currentPrice - level.filledAt) / level.filledAt * level.solAmount;
      level.type = 'sold';
      level.soldAt = currentPrice;
      level.profit = profit;
      grid.totalProfit += profit;
      actions.push({ action: 'SELL', price: currentPrice, profit, gridLevel: i });
      
      // Reset level for next cycle
      level.type = 'pending';
      level.filledAt = null;
    }
  }
  
  if (actions.length > 0) {
    state[userId][mint] = grid;
    save(GRID_FILE, state);
  }
  
  return actions;
}

/**
 * Get grid status
 */
function getGridStatus(userId) {
  const state = load(GRID_FILE, {});
  return state?.[userId] || {};
}

/**
 * Cancel a grid
 */
function cancelGrid(userId, mint) {
  const state = load(GRID_FILE, {});
  if (state?.[userId]?.[mint]) {
    state[userId][mint].active = false;
    save(GRID_FILE, state);
    return true;
  }
  return false;
}

module.exports = { createGrid, checkGrid, getGridStatus, cancelGrid };
