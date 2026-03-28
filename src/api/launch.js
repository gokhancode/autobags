/**
 * AUTOBAGS — Token Launch API (Bags SDK v2)
 * Full launch flow: metadata → fee share config → launch tx → Jito bundle
 */
const router = require('express').Router();
const auth = require('./auth');
const { 
  BagsSDK, 
  signAndSendTransaction, 
  createTipTransaction, 
  sendBundleAndConfirm,
  waitForSlotsToPass,
  BAGS_FEE_SHARE_V2_MAX_CLAIMERS_NON_LUT 
} = require('@bagsfm/bags-sdk');
const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, VersionedTransaction } = require('@solana/web3.js');
const bs58 = require('bs58');
const WalletManager = require('../bot/wallet-manager');

const BAGS_KEY = process.env.BAGS_API_KEY;
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(RPC_URL);
const sdk = new BagsSDK(BAGS_KEY, connection, 'processed');

const JITO_TIP_SOL = 0.015;

/**
 * POST /api/launch/full — One-click full token launch
 * Steps: 1) Create metadata 2) Fee share config 3) Launch tx 4) Jito bundle
 */
router.post('/full', auth.requireAuth, async (req, res) => {
  const { name, symbol, description, imageUrl, twitter, telegram, website, initialBuySol } = req.body;
  if (!name || !symbol) return res.status(400).json({ error: 'name and symbol required' });

  const userId = req.user.userId;
  
  try {
    const keypair = WalletManager.getKeypair(userId);
    const wallet = keypair.publicKey;
    console.log(`[Launch] Starting full launch for ${symbol} by ${userId}`);

    // Step 1: Create token metadata + get mint
    console.log('[Launch] Step 1: Creating token metadata...');
    const tokenInfo = await sdk.tokenLaunch.createTokenInfoAndMetadata({
      name,
      symbol: symbol.toUpperCase(),
      description: description || `Launched via AUTOBAGS`,
      imageUrl: imageUrl || undefined,
      twitter: twitter || undefined,
      telegram: telegram || undefined,
      website: website || undefined,
    });

    if (!tokenInfo?.ipfsUrl || !tokenInfo?.tokenMint) {
      return res.status(500).json({ error: 'Failed to create token metadata', raw: tokenInfo });
    }

    console.log(`[Launch] Metadata created: mint=${tokenInfo.tokenMint}, ipfs=${tokenInfo.ipfsUrl}`);
    const tokenMint = new PublicKey(tokenInfo.tokenMint);

    // Step 2: Create fee share config (creator gets 100% of fees)
    console.log('[Launch] Step 2: Creating fee share config...');
    const feeClaimers = [
      { user: wallet, userBps: 10000 } // 100% to creator
    ];

    const configResult = await sdk.config.createBagsFeeShareConfig({
      payer: wallet,
      baseMint: tokenMint,
      feeClaimers,
    });

    // Sign and send config transaction(s)
    const commitment = sdk.state.getCommitment();
    
    if (configResult.bundles && configResult.bundles.length > 0) {
      console.log(`[Launch] Sending ${configResult.bundles.length} config bundle(s)...`);
      for (const bundle of configResult.bundles) {
        const tipTx = await createTipTransaction(
          connection, commitment, wallet, 
          Math.floor(JITO_TIP_SOL * LAMPORTS_PER_SOL),
          { blockhash: bundle[0].message.recentBlockhash }
        );
        const signedTxs = [tipTx, ...bundle].map(tx => { tx.sign([keypair]); return tx; });
        await sendBundleAndConfirm(signedTxs, sdk);
      }
    } else if (configResult.transaction) {
      await signAndSendTransaction(connection, commitment, configResult.transaction, keypair);
    }

    console.log('[Launch] Fee share config created');

    // Step 3: Create launch transaction
    console.log('[Launch] Step 3: Creating launch transaction...');
    const initialBuyLamports = Math.floor((initialBuySol || 0.01) * LAMPORTS_PER_SOL);
    
    const launchResult = await sdk.tokenLaunch.createLaunchTransaction({
      ipfs: tokenInfo.ipfsUrl,
      tokenMint: tokenInfo.tokenMint,
      wallet: wallet.toBase58(),
      initialBuyLamports,
    });

    if (!launchResult?.transaction) {
      return res.status(500).json({ error: 'Failed to create launch transaction', raw: launchResult });
    }

    // Step 4: Sign and send via Jito
    console.log('[Launch] Step 4: Sending launch via Jito...');
    const launchTx = VersionedTransaction.deserialize(bs58.decode(launchResult.transaction));
    
    const tipTx = await createTipTransaction(
      connection, commitment, wallet,
      Math.floor(JITO_TIP_SOL * LAMPORTS_PER_SOL),
      { blockhash: launchTx.message.recentBlockhash }
    );
    
    const signedTxs = [tipTx, launchTx].map(tx => { tx.sign([keypair]); return tx; });
    const bundleId = await sendBundleAndConfirm(signedTxs, sdk);

    console.log(`[Launch] ✅ Token launched! Bundle: ${bundleId}`);

    res.json({
      success: true,
      message: `🚀 $${symbol.toUpperCase()} launched on Bags.fm!`,
      tokenMint: tokenInfo.tokenMint,
      ipfsUrl: tokenInfo.ipfsUrl,
      bundleId,
      viewUrl: `https://bags.fm/token/${tokenInfo.tokenMint}`,
      initialBuySol: initialBuySol || 0.01,
    });
  } catch (err) {
    console.error('[Launch] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/launch/create-token — Step 1 only: create metadata
router.post('/create-token', auth.requireAuth, async (req, res) => {
  const { name, symbol, description, imageUrl } = req.body;
  if (!name || !symbol) return res.status(400).json({ error: 'name and symbol required' });

  try {
    const tokenInfo = await sdk.tokenLaunch.createTokenInfoAndMetadata({
      name,
      symbol: symbol.toUpperCase(),
      description: description || `Launched via AUTOBAGS`,
      imageUrl: imageUrl || undefined,
    });

    res.json({ success: true, tokenInfo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/launch/pool/:mint — get pool info for a launched token
router.get('/pool/:mint', async (req, res) => {
  try {
    const BagsClient = require('../bot/bags-client');
    const bags = new BagsClient(BAGS_KEY);
    const pool = await bags.getPoolDetails(req.params.mint);
    res.json({ success: true, pool: pool.response || pool });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
