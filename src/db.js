/**
 * AUTOBAGS — SQLite Database
 * Replaces JSON files for scalability (handles 1000s of users)
 * Falls back to JSON if SQLite unavailable
 */
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_PATH = path.join(__dirname, '../data/autobags.db');
const DATA_DIR = path.join(__dirname, '../data');

// Ensure data directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH, { verbose: process.env.NODE_ENV === 'development' ? console.log : null });

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

// ── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    userId TEXT PRIMARY KEY,
    email TEXT,
    passwordHash TEXT NOT NULL,
    totpSecret TEXT,
    totpEnabled INTEGER DEFAULT 0,
    walletPublicKey TEXT,
    createdAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    userId TEXT PRIMARY KEY,
    settings TEXT NOT NULL DEFAULT '{}',
    updatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (userId) REFERENCES users(userId)
  );

  CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    type TEXT NOT NULL,
    symbol TEXT,
    mint TEXT,
    solAmount REAL,
    pnlSol REAL,
    pricePct REAL,
    reason TEXT,
    score INTEGER,
    signature TEXT,
    explanation TEXT,
    entryPrice REAL,
    timestamp TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (userId) REFERENCES users(userId)
  );

  CREATE TABLE IF NOT EXISTS positions (
    userId TEXT NOT NULL,
    mint TEXT NOT NULL,
    symbol TEXT,
    entryPrice REAL,
    solSpent REAL,
    tokensReceived TEXT,
    entryTime TEXT,
    score INTEGER,
    partialExited INTEGER DEFAULT 0,
    signature TEXT,
    PRIMARY KEY (userId, mint),
    FOREIGN KEY (userId) REFERENCES users(userId)
  );

  CREATE TABLE IF NOT EXISTS equity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    worthSol REAL NOT NULL,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (userId) REFERENCES users(userId)
  );

  CREATE TABLE IF NOT EXISTS subscribers (
    userId TEXT PRIMARY KEY,
    email TEXT,
    walletPublicKey TEXT,
    depositedSol REAL DEFAULT 0,
    active INTEGER DEFAULT 1,
    pnlSol REAL DEFAULT 0,
    pnlPct REAL DEFAULT 0,
    joinedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_trades_userId ON trades(userId);
  CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
  CREATE INDEX IF NOT EXISTS idx_equity_userId ON equity(userId);
  CREATE INDEX IF NOT EXISTS idx_equity_timestamp ON equity(timestamp);
  CREATE INDEX IF NOT EXISTS idx_positions_userId ON positions(userId);
`);

// ── Migration: Import existing JSON data ────────────────────────────────────

function migrateFromJson() {
  const migrated = db.prepare("SELECT COUNT(*) as c FROM users").get().c;
  if (migrated > 0) return; // already migrated

  console.log('[DB] Migrating from JSON files to SQLite...');

  // Users
  const usersFile = path.join(DATA_DIR, 'users.json');
  if (fs.existsSync(usersFile)) {
    const users = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    const insert = db.prepare('INSERT OR IGNORE INTO users (userId, email, passwordHash, totpSecret, totpEnabled, walletPublicKey, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const [uid, u] of Object.entries(users)) {
      insert.run(uid, u.email, u.passwordHash, u.totpSecret, u.totpEnabled ? 1 : 0, u.walletPublicKey, u.createdAt);
    }
    console.log(`[DB] Migrated ${Object.keys(users).length} users`);
  }

  // Subscribers
  const subsFile = path.join(DATA_DIR, 'subscribers.json');
  if (fs.existsSync(subsFile)) {
    const subs = JSON.parse(fs.readFileSync(subsFile, 'utf8'));
    const insert = db.prepare('INSERT OR IGNORE INTO subscribers (userId, email, walletPublicKey, depositedSol, active, pnlSol, pnlPct, joinedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const [uid, s] of Object.entries(subs)) {
      insert.run(uid, s.email, s.walletPublicKey, s.depositedSol || 0, s.active ? 1 : 0, s.pnlSol || 0, s.pnlPct || 0, s.joinedAt);
    }
    console.log(`[DB] Migrated ${Object.keys(subs).length} subscribers`);
  }

  // Settings
  const settingsFile = path.join(DATA_DIR, 'settings.json');
  if (fs.existsSync(settingsFile)) {
    const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    const insert = db.prepare('INSERT OR IGNORE INTO settings (userId, settings) VALUES (?, ?)');
    for (const [uid, s] of Object.entries(settings)) {
      insert.run(uid, JSON.stringify(s));
    }
    console.log(`[DB] Migrated settings`);
  }

  // Trades
  const tradesFile = path.join(DATA_DIR, 'trades.json');
  if (fs.existsSync(tradesFile)) {
    const trades = JSON.parse(fs.readFileSync(tradesFile, 'utf8'));
    const insert = db.prepare('INSERT INTO trades (userId, type, symbol, mint, solAmount, pnlSol, pricePct, reason, score, signature, explanation, entryPrice, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const t of trades) {
      insert.run(t.userId, t.type, t.symbol, t.mint, t.solAmount, t.pnlSol, t.pricePct, t.reason, t.score, t.signature, t.explanation, t.entryPrice, t.timestamp);
    }
    console.log(`[DB] Migrated ${trades.length} trades`);
  }

  // Positions
  const posFile = path.join(DATA_DIR, 'positions.json');
  if (fs.existsSync(posFile)) {
    const positions = JSON.parse(fs.readFileSync(posFile, 'utf8'));
    const insert = db.prepare('INSERT OR IGNORE INTO positions (userId, mint, symbol, entryPrice, solSpent, tokensReceived, entryTime, score, partialExited, signature) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const [uid, userPos] of Object.entries(positions)) {
      for (const [mint, p] of Object.entries(userPos)) {
        insert.run(uid, mint, p.symbol, p.entryPrice, p.solSpent, p.tokensReceived, p.entryTime, p.score, p.partialExited ? 1 : 0, p.signature);
      }
    }
    console.log(`[DB] Migrated positions`);
  }

  console.log('[DB] Migration complete!');
}

// Run migration on startup
try { migrateFromJson(); } catch (e) { console.error('[DB] Migration error:', e.message); }

// ── Prepared statements ─────────────────────────────────────────────────────

const stmts = {
  // Users
  getUser: db.prepare('SELECT * FROM users WHERE userId = ?'),
  insertUser: db.prepare('INSERT INTO users (userId, email, passwordHash, totpSecret, totpEnabled, walletPublicKey, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  updateUser: db.prepare('UPDATE users SET totpEnabled = ? WHERE userId = ?'),
  getAllUsers: db.prepare('SELECT * FROM users'),

  // Subscribers
  getSub: db.prepare('SELECT * FROM subscribers WHERE userId = ?'),
  insertSub: db.prepare('INSERT OR REPLACE INTO subscribers (userId, email, walletPublicKey, depositedSol, active, pnlSol, pnlPct, joinedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  getAllSubs: db.prepare('SELECT * FROM subscribers'),
  countSubs: db.prepare('SELECT COUNT(*) as count FROM subscribers'),
  getFirstSub: db.prepare('SELECT userId FROM subscribers ORDER BY rowid LIMIT 1'),

  // Settings
  getSettings: db.prepare('SELECT settings FROM settings WHERE userId = ?'),
  upsertSettings: db.prepare("INSERT OR REPLACE INTO settings (userId, settings, updatedAt) VALUES (?, ?, datetime('now'))"),

  // Trades
  insertTrade: db.prepare('INSERT INTO trades (userId, type, symbol, mint, solAmount, pnlSol, pricePct, reason, score, signature, explanation, entryPrice, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  getRecentTrades: db.prepare('SELECT * FROM trades ORDER BY id DESC LIMIT ?'),
  getUserTrades: db.prepare('SELECT * FROM trades WHERE userId = ? ORDER BY id DESC'),
  getTradeBySignature: db.prepare('SELECT id FROM trades WHERE signature = ? ORDER BY id DESC LIMIT 1'),
  updateTradeExplanation: db.prepare('UPDATE trades SET explanation = ? WHERE id = ?'),
  countTrades: db.prepare('SELECT COUNT(*) as count FROM trades'),
  getTodayTrades: db.prepare("SELECT * FROM trades WHERE userId = ? AND timestamp >= ? ORDER BY id"),
  sumPnl: db.prepare('SELECT COALESCE(SUM(pnlSol), 0) as total FROM trades WHERE userId = ?'),
  getWins: db.prepare("SELECT COUNT(*) as count FROM trades WHERE pnlSol > 0"),
  getAllTrades: db.prepare('SELECT * FROM trades ORDER BY id'),

  // Positions
  getPosition: db.prepare('SELECT * FROM positions WHERE userId = ? AND mint = ?'),
  getUserPositions: db.prepare('SELECT * FROM positions WHERE userId = ?'),
  upsertPosition: db.prepare('INSERT OR REPLACE INTO positions (userId, mint, symbol, entryPrice, solSpent, tokensReceived, entryTime, score, partialExited, signature) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  deletePosition: db.prepare('DELETE FROM positions WHERE userId = ? AND mint = ?'),
  getAllPositions: db.prepare('SELECT * FROM positions'),
  countPositions: db.prepare('SELECT COUNT(*) as count FROM positions'),

  // Equity
  insertEquity: db.prepare('INSERT INTO equity (userId, worthSol, timestamp) VALUES (?, ?, ?)'),
  getEquity: db.prepare('SELECT timestamp, worthSol FROM equity WHERE userId = ? AND timestamp >= ? ORDER BY timestamp'),
  getLastEquity: db.prepare('SELECT timestamp FROM equity WHERE userId = ? ORDER BY id DESC LIMIT 1'),
};

module.exports = { db, stmts };
