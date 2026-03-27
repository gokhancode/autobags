const router  = require('express').Router();
const fs       = require('fs');
const path     = require('path');
const WalletManager = require('../bot/wallet-manager');

const DATA_FILE = path.join(__dirname, '../../data/subscribers.json');

function loadSubscribers() {
  if (!fs.existsSync(DATA_FILE)) return {};
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveSubscribers(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/**
 * POST /api/subscribers
 * Register a new user. Generates a custodial wallet for them.
 * Body: { userId: string, email?: string }
 */
router.post('/', (req, res) => {
  const { userId, email } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const subs = loadSubscribers();
  if (subs[userId]) {
    return res.status(409).json({ error: 'already registered', wallet: subs[userId].walletPublicKey });
  }

  try {
    // Generate encrypted custodial wallet
    const wallet = WalletManager.create(userId);

    subs[userId] = {
      userId,
      email: email || null,
      walletPublicKey: wallet.publicKey,
      depositedSol: 0,
      active: true,
      joinedAt: new Date().toISOString(),
      pnlSol: 0,
      pnlPct: 0
    };
    saveSubscribers(subs);

    res.json({
      success: true,
      userId,
      wallet: {
        publicKey: wallet.publicKey,
        message: 'Send SOL to this address to start trading'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/subscribers/:userId
 * Get subscriber info + deposit address
 */
router.get('/:userId', (req, res) => {
  const subs = loadSubscribers();
  const sub  = subs[req.params.userId];
  if (!sub) return res.status(404).json({ error: 'not found' });
  res.json(sub);
});

/**
 * GET /api/subscribers
 * List all subscribers (admin — add auth middleware later)
 */
router.get('/', (req, res) => {
  const subs = loadSubscribers();
  res.json({ count: Object.keys(subs).length, subscribers: Object.values(subs) });
});

module.exports = router;
