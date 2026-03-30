/**
 * AUTOBAGS — Social Intelligence API
 * Endpoints for social sentiment, trending, KOLs, and alpha alerts
 */

const { Router } = require('express');
const sentiment = require('../bot/sentiment-engine');
const twitter = require('../bot/twitter-tracker');

const router = Router();

// ── Ingest endpoint (receives messages from TG relay) ────────────────────────

const SOCIAL_SECRET = process.env.SOCIAL_INGEST_SECRET || process.env.JWT_SECRET || '';

router.post('/ingest', (req, res) => {
  // Auth check
  const auth = req.headers.authorization?.replace('Bearer ', '');
  if (SOCIAL_SECRET && auth !== SOCIAL_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { messages } = req.body;
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'Expected { messages: [...] }' });
  }

  const ingested = sentiment.ingestTelegramBatch(messages);
  res.json({ ok: true, ingested });
});

// ── Trending by social buzz ──────────────────────────────────────────────────

router.get('/trending', (req, res) => {
  const window = parseInt(req.query.window) || 60; // minutes
  const trending = sentiment.getTrendingBySentiment(window * 60_000);

  res.json({
    window: `${window}m`,
    tokens: trending,
    count: trending.length,
  });
});

// ── Sentiment for a specific token ───────────────────────────────────────────

router.get('/sentiment/:mintOrSymbol', (req, res) => {
  const result = sentiment.getSentiment(req.params.mintOrSymbol);
  res.json(result);
});

// ── Real-time social feed ────────────────────────────────────────────────────

router.get('/feed', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const source = req.query.source; // optional filter
  const window = parseInt(req.query.window) || 60; // minutes

  const cutoff = Date.now() - (window * 60_000);
  // Access mentions directly (not ideal but works for MVP)
  const trending = sentiment.getTrendingBySentiment(window * 60_000);

  res.json({
    trending: trending.slice(0, limit),
    alerts: sentiment.getAlphaAlerts().slice(0, 10),
    window: `${window}m`,
  });
});

// ── KOL activity ─────────────────────────────────────────────────────────────

router.get('/kols', async (req, res) => {
  try {
    const result = await twitter.trackKOLs();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/kols', (req, res) => {
  const { action, handle, label } = req.body;
  const kols = twitter.loadKOLs();

  if (action === 'add' && handle) {
    if (kols.find(k => k.handle === handle)) {
      return res.status(400).json({ error: 'Already tracked' });
    }
    kols.push({ handle, label: label || handle });
    twitter.saveKOLs(kols);
    return res.json({ ok: true, kols });
  }

  if (action === 'remove' && handle) {
    const filtered = kols.filter(k => k.handle !== handle);
    twitter.saveKOLs(filtered);
    return res.json({ ok: true, kols: filtered });
  }

  res.status(400).json({ error: 'Invalid action. Use add/remove with handle.' });
});

// ── Alpha alerts ─────────────────────────────────────────────────────────────

router.get('/alerts', (req, res) => {
  const alerts = sentiment.getAlphaAlerts();
  res.json({ alerts, count: alerts.length });
});

// ── Mention velocity ─────────────────────────────────────────────────────────

router.get('/velocity/:symbol', (req, res) => {
  const window = parseInt(req.query.window) || 60;
  const velocity = sentiment.getMentionVelocity(req.params.symbol, window);
  res.json(velocity);
});

// ── Twitter trending ─────────────────────────────────────────────────────────

router.get('/twitter/trending', async (req, res) => {
  try {
    const trending = await twitter.getTwitterTrending();
    res.json({ trending });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Twitter cashtag search ───────────────────────────────────────────────────

router.get('/twitter/:symbol', async (req, res) => {
  try {
    const result = await twitter.trackCashtag(req.params.symbol);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
