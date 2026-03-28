/**
 * AUTOBAGS — Pattern Recognition
 * Learns from past trades to predict winners
 * Uses logistic regression on trade features
 */

const fs = require('fs');
const path = require('path');

const TRADES_FILE = path.join(__dirname, '../../data/trades.json');
const MODEL_FILE = path.join(__dirname, '../../data/pattern-model.json');

function load(f, def) {
  try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : def; }
  catch { return def; }
}
function save(f, d) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2)); }

/**
 * Extract features from a trade's market data at entry time
 */
function extractFeatures(dexData) {
  if (!dexData) return null;
  const p = dexData;
  return {
    m5: parseFloat(p.priceChange?.m5) || 0,
    h1: parseFloat(p.priceChange?.h1) || 0,
    h6: parseFloat(p.priceChange?.h6) || 0,
    h24: parseFloat(p.priceChange?.h24) || 0,
    liq: Math.log10(Math.max(1, parseFloat(p.liquidity?.usd) || 1)),
    vol24: Math.log10(Math.max(1, parseFloat(p.volume?.h24) || 1)),
    buys1h: (p.txns?.h1?.buys || 0),
    sells1h: (p.txns?.h1?.sells || 0),
    buyRatio: (() => {
      const b = p.txns?.h1?.buys || 0, s = p.txns?.h1?.sells || 0;
      return b + s > 0 ? b / (b + s) : 0.5;
    })(),
    mcap: Math.log10(Math.max(1, parseFloat(p.marketCap || p.fdv) || 1)),
    volLiqRatio: (() => {
      const v = parseFloat(p.volume?.h24) || 0, l = parseFloat(p.liquidity?.usd) || 1;
      return v / l;
    })(),
    age: (() => {
      const created = p.pairCreatedAt ? new Date(p.pairCreatedAt).getTime() : 0;
      return created > 0 ? (Date.now() - created) / 3600000 : 24;
    })(),
    hour: new Date().getUTCHours(),
    dayOfWeek: new Date().getUTCDay(),
  };
}

/**
 * Sigmoid function
 */
function sigmoid(x) { return 1 / (1 + Math.exp(-Math.max(-500, Math.min(500, x)))); }

/**
 * Load or initialize model weights
 */
function loadModel() {
  const model = load(MODEL_FILE, null);
  if (model && model.weights) return model;
  
  const featureNames = ['m5','h1','h6','h24','liq','vol24','buys1h','sells1h','buyRatio','mcap','volLiqRatio','age','hour','dayOfWeek'];
  const weights = {};
  featureNames.forEach(f => weights[f] = 0);
  weights._bias = 0;
  
  return { weights, trainedOn: 0, accuracy: 0, lastTrained: null };
}

/**
 * Predict win probability for a set of features
 * @returns {number} 0-1 probability of being a winning trade
 */
function predict(features) {
  const model = loadModel();
  const w = model.weights;
  
  let z = w._bias || 0;
  for (const [key, val] of Object.entries(features)) {
    if (w[key] !== undefined) z += w[key] * val;
  }
  
  return sigmoid(z);
}

/**
 * Train the model on historical trades
 * Uses stochastic gradient descent on logistic regression
 */
function train() {
  const trades = load(TRADES_FILE, []);
  const sells = trades.filter(t => t.type === 'SELL' && t.features);
  
  if (sells.length < 10) {
    console.log(`[Pattern] Not enough labeled trades (${sells.length}/10 needed)`);
    return null;
  }
  
  const model = loadModel();
  const w = model.weights;
  const lr = 0.01; // learning rate
  const epochs = 50;
  
  // Prepare training data
  const data = sells.map(t => ({
    features: t.features,
    label: (t.pnlSol || 0) > 0 ? 1 : 0,
  }));
  
  // SGD training
  for (let epoch = 0; epoch < epochs; epoch++) {
    // Shuffle
    for (let i = data.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [data[i], data[j]] = [data[j], data[i]];
    }
    
    for (const sample of data) {
      const pred = predict(sample.features);
      const error = sample.label - pred;
      
      // Update weights
      for (const [key, val] of Object.entries(sample.features)) {
        if (w[key] !== undefined) w[key] += lr * error * val;
      }
      w._bias += lr * error;
    }
  }
  
  // Calculate accuracy
  let correct = 0;
  for (const sample of data) {
    const pred = predict(sample.features) > 0.5 ? 1 : 0;
    if (pred === sample.label) correct++;
  }
  
  model.accuracy = correct / data.length;
  model.trainedOn = data.length;
  model.lastTrained = new Date().toISOString();
  model.weights = w;
  
  // Feature importance (absolute weight magnitude)
  model.featureImportance = Object.entries(w)
    .filter(([k]) => k !== '_bias')
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([name, weight]) => ({ name, weight: parseFloat(weight.toFixed(4)), direction: weight > 0 ? 'bullish' : 'bearish' }));
  
  save(MODEL_FILE, model);
  console.log(`[Pattern] Trained on ${data.length} trades — accuracy: ${(model.accuracy * 100).toFixed(1)}%`);
  console.log(`[Pattern] Top features:`, model.featureImportance.slice(0, 5).map(f => `${f.name}(${f.direction})`).join(', '));
  
  return model;
}

/**
 * Score a token using the trained model
 * Returns bonus points (0-15) based on win probability
 */
function scorePattern(dexPairData) {
  const features = extractFeatures(dexPairData);
  if (!features) return { score: 0, probability: 0.5 };
  
  const model = loadModel();
  if (model.trainedOn < 10) return { score: 0, probability: 0.5 };
  
  const prob = predict(features);
  
  let score = 0;
  if (prob > 0.7) score = 15;
  else if (prob > 0.6) score = 10;
  else if (prob > 0.55) score = 5;
  else if (prob < 0.3) score = -10; // strong bearish signal
  else if (prob < 0.4) score = -5;
  
  return { score, probability: parseFloat(prob.toFixed(3)), features };
}

module.exports = { extractFeatures, predict, train, scorePattern, loadModel };
