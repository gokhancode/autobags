/**
 * AUTOBAGS — Auth API
 * Password + TOTP 2FA + JWT sessions + wallet export
 */
const router      = require('express').Router();
const bcrypt      = require('bcryptjs');
const speakeasy   = require('speakeasy');
const QRCode      = require('qrcode');
const jwt         = require('jsonwebtoken');
const fs          = require('fs');
const path        = require('path');
const WalletManager = require('../bot/wallet-manager');

const USERS_FILE = path.join(__dirname, '../../data/users.json');
const JWT_SECRET = process.env.JWT_SECRET || process.env.WALLET_MASTER_KEY;
const JWT_EXPIRY = '7d';

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}
function saveUsers(data) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
}

// ── Auth middleware ────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
module.exports.requireAuth = requireAuth;

// ── POST /api/auth/signup ──────────────────────────────────────────────────
// Body: { userId, password, email? }
router.post('/signup', async (req, res) => {
  const { userId, password, email } = req.body;
  if (!userId || !password) return res.status(400).json({ error: 'userId and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be 8+ characters' });

  const users = loadUsers();
  if (users[userId]) return res.status(409).json({ error: 'Username taken' });

  // Generate TOTP secret
  const secret = speakeasy.generateSecret({ name: `AUTOBAGS (${userId})`, issuer: 'AUTOBAGS' });

  // Hash password
  const hash = await bcrypt.hash(password, 12);

  // Generate wallet
  let wallet;
  try {
    wallet = WalletManager.create(userId);
  } catch (e) {
    // Wallet might already exist
    wallet = { publicKey: WalletManager.getPublicKey(userId) };
  }

  users[userId] = {
    userId,
    email:        email || null,
    passwordHash: hash,
    totpSecret:   secret.base32,
    totpEnabled:  false, // enabled after first verification
    walletPublicKey: wallet.publicKey,
    createdAt:    new Date().toISOString()
  };
  saveUsers(users);

  // Also create subscriber entry
  const subsFile = path.join(__dirname, '../../data/subscribers.json');
  const subs = fs.existsSync(subsFile) ? JSON.parse(fs.readFileSync(subsFile, 'utf8')) : {};
  if (!subs[userId]) {
    subs[userId] = { userId, email: email||null, walletPublicKey: wallet.publicKey, depositedSol: 0, active: true, joinedAt: new Date().toISOString(), pnlSol: 0, pnlPct: 0 };
    fs.writeFileSync(subsFile, JSON.stringify(subs, null, 2));
  }

  // Generate QR code for authenticator app
  const otpAuthUrl = secret.otpauth_url;
  const qrDataUrl  = await QRCode.toDataURL(otpAuthUrl);

  res.json({
    success: true,
    userId,
    wallet: { publicKey: wallet.publicKey, message: 'Send SOL to this address to start trading' },
    twoFactor: {
      secret:  secret.base32,
      qrCode:  qrDataUrl,
      message: 'Scan this QR code with Google Authenticator or Authy. You must verify a code to enable 2FA.'
    }
  });
});

// ── POST /api/auth/verify-2fa ─────────────────────────────────────────────
// Enables 2FA after scanning QR. Body: { userId, token }
router.post('/verify-2fa', (req, res) => {
  const { userId, token } = req.body;
  if (!userId || !token) return res.status(400).json({ error: 'userId and token required' });

  const users = loadUsers();
  const user  = users[userId];
  if (!user) return res.status(404).json({ error: 'User not found' });

  const valid = speakeasy.totp.verify({
    secret:   user.totpSecret,
    encoding: 'base32',
    token,
    window: 1
  });

  if (!valid) return res.status(401).json({ error: 'Invalid 2FA code' });

  users[userId].totpEnabled = true;
  saveUsers(users);

  // Issue JWT
  const jwt_token = jwt.sign({ userId, wallet: user.walletPublicKey }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  res.json({ success: true, message: '2FA enabled', token: jwt_token, userId, wallet: user.walletPublicKey });
});

// ── POST /api/auth/login ──────────────────────────────────────────────────
// Body: { userId, password, totpToken }
router.post('/login', async (req, res) => {
  const { userId, password, totpToken } = req.body;
  if (!userId || !password) return res.status(400).json({ error: 'userId and password required' });

  const users = loadUsers();
  const user  = users[userId];
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const passOk = await bcrypt.compare(password, user.passwordHash);
  if (!passOk) return res.status(401).json({ error: 'Invalid credentials' });

  // If 2FA enabled, require TOTP token
  if (user.totpEnabled) {
    if (!totpToken) return res.status(200).json({ success: false, requires2FA: true });
    const valid = speakeasy.totp.verify({
      secret: user.totpSecret, encoding: 'base32', token: totpToken, window: 1
    });
    if (!valid) return res.status(401).json({ error: 'Invalid 2FA code' });
  }

  const token = jwt.sign({ userId, wallet: user.walletPublicKey }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  res.json({ success: true, token, userId, wallet: user.walletPublicKey });
});

// ── POST /api/auth/export ─────────────────────────────────────────────────
// Export private key. Requires valid JWT + fresh 2FA code.
// Body: { totpToken }
router.post('/export', requireAuth, (req, res) => {
  const { totpToken } = req.body;
  const { userId }    = req.user;

  if (!totpToken) return res.status(400).json({ error: '2FA token required to export key' });

  const users = loadUsers();
  const user  = users[userId];
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (!user.totpEnabled) return res.status(403).json({ error: 'Enable 2FA before exporting' });

  const valid = speakeasy.totp.verify({
    secret: user.totpSecret, encoding: 'base32', token: totpToken, window: 1
  });
  if (!valid) return res.status(401).json({ error: 'Invalid 2FA code' });

  try {
    const bs58   = require('bs58');
    const keypair = WalletManager.getKeypair(userId);
    const privkey = bs58.encode(keypair.secretKey);

    res.json({
      success: true,
      warning: 'Keep this key secret. Anyone with it controls your wallet. Store it safely.',
      privateKey: privkey,
      publicKey:  keypair.publicKey.toBase58(),
      format:     'base58 — importable in Phantom, Solflare, etc.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const users = loadUsers();
  const user  = users[req.user.userId];
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({
    success: true,
    userId:      user.userId,
    wallet:      user.walletPublicKey,
    totpEnabled: user.totpEnabled,
    joinedAt:    user.createdAt
  });
});

router.requireAuth = requireAuth;
module.exports = router;
