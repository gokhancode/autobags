/**
 * AUTOBAGS — Quant Engine API
 * Brain stats, feature importance, regime detection
 */
const router = require('express').Router();
const quant = require('../bot/quant-engine');

// GET /api/quant — full quant brain report
router.get('/', (req, res) => {
  res.json({ success: true, ...quant.getReport() });
});

// GET /api/quant/features — ranked feature importance
router.get('/features', (req, res) => {
  res.json({ success: true, features: quant.getFeatureImportance() });
});

// GET /api/quant/regime — current market regime
router.get('/regime', async (req, res) => {
  const regime = await quant.detectRegime();
  const params = quant.getRegimeParams(regime);
  res.json({ success: true, regime, params, brain: quant.loadBrain().regimes });
});

module.exports = router;
