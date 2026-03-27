/**
 * AUTOBAGS — Narrative Ideas API
 * AI-powered narrative scanning → token launch suggestions
 */
const router = require('express').Router();
const auth   = require('./auth');
const { scanNarratives } = require('../bot/narrative-scanner');

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 min cache

// GET /api/narratives — get current hot narratives + launch ideas
router.get('/', auth.requireAuth, async (req, res) => {
  try {
    const now = Date.now();
    const forceRefresh = req.query.refresh === 'true';

    if (!cache || now - cacheTime > CACHE_TTL || forceRefresh) {
      cache = await scanNarratives();
      cacheTime = now;
    }

    res.json({ success: true, ...cache });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
