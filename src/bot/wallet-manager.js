/**
 * AUTOBAGS — Wallet Manager
 * Generates custodial Solana wallets per user.
 * Private keys are AES-256-GCM encrypted at rest.
 * Master encryption key lives in .env — never in DB or git.
 */

const { Keypair } = require('@solana/web3.js');
const crypto = require('crypto');
const bs58  = require('bs58');
const fs    = require('fs');
const path  = require('path');

const WALLETS_FILE  = path.join(__dirname, '../../data/wallets.enc.json');
const ALGORITHM     = 'aes-256-gcm';
const KEY_LEN       = 32; // bytes

function getMasterKey() {
  const raw = process.env.WALLET_MASTER_KEY;
  if (!raw || raw.length < 32) throw new Error('WALLET_MASTER_KEY missing or too short (need 32+ chars)');
  return crypto.createHash('sha256').update(raw).digest(); // 32-byte key
}

function encrypt(plaintext) {
  const key   = getMasterKey();
  const iv    = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag   = cipher.getAuthTag();
  return {
    iv:  iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted.toString('hex')
  };
}

function decrypt(enc) {
  const key    = getMasterKey();
  const iv     = Buffer.from(enc.iv,   'hex');
  const tag    = Buffer.from(enc.tag,  'hex');
  const data   = Buffer.from(enc.data, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

function loadWallets() {
  if (!fs.existsSync(WALLETS_FILE)) return {};
  return JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8'));
}

function saveWallets(data) {
  fs.mkdirSync(path.dirname(WALLETS_FILE), { recursive: true });
  fs.writeFileSync(WALLETS_FILE, JSON.stringify(data, null, 2));
}

const WalletManager = {
  /**
   * Generate a new Solana wallet for a user.
   * Returns the public key. Private key is stored encrypted.
   */
  create(userId) {
    const wallets = loadWallets();
    if (wallets[userId]) throw new Error(`Wallet already exists for ${userId}`);

    const keypair   = Keypair.generate();
    const pubkey    = keypair.publicKey.toBase58();
    const privkeyB58 = bs58.encode(keypair.secretKey);

    wallets[userId] = {
      userId,
      publicKey: pubkey,
      encryptedKey: encrypt(privkeyB58),
      createdAt: new Date().toISOString()
    };
    saveWallets(wallets);

    return { userId, publicKey: pubkey }; // never return privkey
  },

  /**
   * Get the public key for a user (safe to expose).
   */
  getPublicKey(userId) {
    const wallets = loadWallets();
    if (!wallets[userId]) return null;
    return wallets[userId].publicKey;
  },

  /**
   * Load the Keypair for signing transactions (internal use only).
   */
  getKeypair(userId) {
    const wallets = loadWallets();
    if (!wallets[userId]) throw new Error(`No wallet for user ${userId}`);
    const privkeyB58 = decrypt(wallets[userId].encryptedKey);
    const secretKey  = bs58.decode(privkeyB58);
    return Keypair.fromSecretKey(secretKey);
  },

  /**
   * List all users with wallets (public keys only).
   */
  list() {
    const wallets = loadWallets();
    return Object.values(wallets).map(w => ({
      userId: w.userId,
      publicKey: w.publicKey,
      createdAt: w.createdAt
    }));
  },

  exists(userId) {
    return !!loadWallets()[userId];
  }
};

module.exports = WalletManager;
