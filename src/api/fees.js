/**
 * AUTOBAGS — Fee Management API
 * Partner config init, fee stats, claiming
 * Uses Bags.fm fee-share partner system
 */
const router = require('express').Router();
const auth   = require('./auth');
const { VersionedTransaction } = require('@solana/web3.js');
const bs58   = require('bs58');
const BagsClient    = require('../bot/bags-client');
const WalletManager = require('../bot/wallet-manager');

const bags = new BagsClient(process.env.BAGS_API_KEY);
const PARTNER_KEY = process.env.BAGS_PARTNER_KEY;

// Admin check (first user)
const fs   = require('fs');
const path = require('path');
function isAdmin(userId) {
  const subsFile = path.join(__dirname, '../../data/subscribers.json');
  try {
    const subs = JSON.parse(fs.readFileSync(subsFile, 'utf8'));
    return userId === Object.keys(subs)[0];
  } catch { return false; }
}

// GET /api/fees/stats — partner fee stats
router.get('/stats', auth.requireAuth, async (req, res) => {
  if (!isAdmin(req.user.userId)) return res.status(403).json({ error: 'Admin only' });

  try {
    const stats = await bags.getPartnerStats(PARTNER_KEY);
    res.json({ success: true, partnerKey: PARTNER_KEY, stats: stats.response || stats });
  } catch (err) {
    res.json({ success: true, partnerKey: PARTNER_KEY, stats: null, error: err.message,
      note: 'Partner config may not be initialized on-chain yet. Use POST /api/fees/init-partner to create it.' });
  }
});

// POST /api/fees/init-partner — initialize partner config on-chain
router.post('/init-partner', auth.requireAuth, async (req, res) => {
  if (!isAdmin(req.user.userId)) return res.status(403).json({ error: 'Admin only' });

  try {
    // Get creation tx from Bags
    const result = await bags.createPartnerConfig(PARTNER_KEY, 150); // 1.5%
    if (!result?.success || !result?.response) {
      return res.json({ success: false, error: 'Failed to get creation tx', raw: result });
    }

    // The response should contain a transaction to sign
    const txData = result.response.transaction || result.response;
    if (typeof txData === 'string') {
      // Sign and send the transaction
      // Need admin wallet to sign — for now return unsigned tx for manual signing
      res.json({
        success: true,
        message: 'Partner config creation transaction generated',
        transaction: txData,
        note: 'This transaction needs to be signed by the partner wallet and submitted to Solana'
      });
    } else {
      res.json({ success: true, result: result.response });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/fees/claimable — check claimable positions
router.get('/claimable', auth.requireAuth, async (req, res) => {
  if (!isAdmin(req.user.userId)) return res.status(403).json({ error: 'Admin only' });

  try {
    const positions = await bags.getClaimablePositions(PARTNER_KEY);
    res.json({ success: true, positions: positions.response || positions });
  } catch (err) {
    res.json({ success: true, positions: [], error: err.message });
  }
});

// POST /api/fees/claim — claim partner fees
router.post('/claim', auth.requireAuth, async (req, res) => {
  if (!isAdmin(req.user.userId)) return res.status(403).json({ error: 'Admin only' });

  try {
    const result = await bags.claimPartnerFees(PARTNER_KEY);
    res.json({ success: true, result: result.response || result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/fees/pool/:mint — detailed pool analytics
router.get('/pool/:mint', async (req, res) => {
  try {
    const pool = await bags.getPoolDetails(req.params.mint);
    const fees = await bags.getTokenLifetimeFees(req.params.mint).catch(() => null);
    const creators = await bags.getTokenCreators(req.params.mint).catch(() => null);

    res.json({
      success: true,
      pool: pool.response || pool,
      lifetimeFees: fees?.response || null,
      creators: creators?.response || null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
