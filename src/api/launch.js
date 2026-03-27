/**
 * AUTOBAGS — Token Launch API
 * Let users launch tokens directly through Bags.fm
 * Deep platform integration for hackathon
 */
const router = require('express').Router();
const auth   = require('./auth');
const { VersionedTransaction, Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const bs58   = require('bs58');
const BagsClient    = require('../bot/bags-client');
const WalletManager = require('../bot/wallet-manager');

const bags = new BagsClient(process.env.BAGS_API_KEY);

// POST /api/launch/create-token — step 1: create token info + metadata
router.post('/create-token', auth.requireAuth, async (req, res) => {
  const { name, symbol, description, imageUrl } = req.body;
  if (!name || !symbol) return res.status(400).json({ error: 'name and symbol required' });

  try {
    const userId = req.user.userId;
    const wallet = WalletManager.getPublicKey(userId);

    // Create FormData for token info
    const formData = new FormData();
    formData.append('name', name);
    formData.append('symbol', symbol);
    formData.append('description', description || `Launched via AUTOBAGS`);
    formData.append('wallet', wallet);

    // If imageUrl provided, fetch and attach
    if (imageUrl) {
      try {
        const imgRes = await fetch(imageUrl);
        const blob = await imgRes.blob();
        formData.append('image', blob, 'token.png');
      } catch {
        // Image optional — continue without
      }
    }

    const result = await bags.createTokenInfo(formData);

    res.json({
      success: true,
      tokenInfo: result.response || result,
      message: 'Token info created. Use /api/launch/execute to launch.',
      nextStep: 'POST /api/launch/execute with tokenMint and initialBuyLamports'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/launch/execute — step 2: create and submit launch transaction
router.post('/execute', auth.requireAuth, async (req, res) => {
  const { ipfs, tokenMint, initialBuySol, configKey } = req.body;
  if (!ipfs || !tokenMint) return res.status(400).json({ error: 'ipfs and tokenMint required' });

  try {
    const userId = req.user.userId;
    const wallet = WalletManager.getPublicKey(userId);
    const initialBuyLamports = Math.floor((initialBuySol || 0.01) * LAMPORTS_PER_SOL);

    const result = await bags.createLaunchTransaction({
      ipfs,
      tokenMint,
      wallet,
      initialBuyLamports,
      configKey: configKey || undefined
    });

    if (!result?.success || !result?.response) {
      return res.status(500).json({ error: 'Failed to create launch tx', raw: result });
    }

    // Sign the transaction with user's keypair
    const txData = result.response.transaction || result.response;
    if (typeof txData === 'string') {
      const txBytes = bs58.decode(txData);
      const vtx = VersionedTransaction.deserialize(txBytes);
      const keypair = WalletManager.getKeypair(userId);
      vtx.sign([keypair]);
      const signedB58 = bs58.encode(vtx.serialize());

      // Submit
      const sendResult = await bags.sendTransaction(signedB58);

      res.json({
        success: true,
        message: `Token $${req.body.symbol || tokenMint.slice(0,6)} launched on Bags.fm!`,
        signature: sendResult.response,
        tokenMint,
        viewUrl: `https://bags.fm/token/${tokenMint}`
      });
    } else {
      res.json({ success: true, result: result.response });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/launch/pool/:mint — get pool info for a launched token
router.get('/pool/:mint', async (req, res) => {
  try {
    const pool = await bags.getPoolDetails(req.params.mint);
    res.json({ success: true, pool: pool.response || pool });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
