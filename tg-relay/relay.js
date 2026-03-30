#!/usr/bin/env node
/**
 * AUTOBAGS TG Relay — Live Message Relay
 * 
 * Reads messages from your Telegram groups, filters for crypto-relevant content,
 * and sends them to the autobags VPS for sentiment analysis.
 * 
 * ⚠️ READ-ONLY — never sends messages, joins groups, or takes any action on your account.
 * 
 * Usage: node relay.js
 */

require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const fs = require('fs');
const path = require('path');

// ── Config ───────────────────────────────────────────────────────────────────

const API_ID = parseInt(process.env.TG_API_ID);
const API_HASH = process.env.TG_API_HASH;
const SESSION_FILE = path.join(__dirname, 'session.txt');
const AUTOBAGS_URL = process.env.AUTOBAGS_URL || 'https://autobags.io/api/social/ingest';
const AUTOBAGS_SECRET = process.env.AUTOBAGS_SECRET || '';
const STATS_FILE = path.join(__dirname, 'relay-stats.json');

// Groups to monitor (empty = all groups)
const MONITOR_GROUPS = (process.env.MONITOR_GROUPS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// ── Crypto Detection ─────────────────────────────────────────────────────────

// Solana address pattern (base58, 32-44 chars)
const SOL_ADDRESS_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

// Cashtag pattern ($TOKEN)
const CASHTAG_RE = /\$([A-Za-z][A-Za-z0-9]{1,10})\b/g;

// Common crypto keywords for relevance filtering
const CRYPTO_KEYWORDS = [
  'pump', 'moon', 'buy', 'call', 'gem', 'degen', 'sol', 'solana',
  'ape', 'send', 'bags', 'alpha', 'entry', 'snipe', 'launch',
  'bonding', 'curve', 'raydium', 'jupiter', 'jup', 'memecoin',
  'meme', 'coin', 'token', 'mint', 'ca:', 'contract:', 'dex',
  'chart', 'mcap', 'market cap', 'volume', 'vol', 'liquidity',
  'liq', 'rugpull', 'rug', 'scam', 'airdrop', 'presale',
  'whale', 'bag', 'hodl', 'fomo', 'dip', 'rip', 'short',
  'long', 'leverage', 'trade', 'pnl', 'profit', 'loss',
  '100x', '10x', '50x', '1000x', 'bullish', 'bearish',
  'narrative', 'sector', 'trend', 'trending', 'new pair',
  'just launched', 'stealth launch', 'fair launch',
  'bonk', 'wif', 'pepe', 'trump', 'ai agent', 'defi'
];

const KEYWORD_RE = new RegExp(CRYPTO_KEYWORDS.join('|'), 'i');

// Known Solana program addresses to EXCLUDE (not tokens)
const EXCLUDED_ADDRESSES = new Set([
  'So11111111111111111111111111111111111111112',  // Wrapped SOL
  '11111111111111111111111111111111',             // System program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token program
]);

/**
 * Analyze a message for crypto relevance
 * Returns null if not relevant, or extracted data if it is
 */
function analyzeMessage(text) {
  if (!text || text.length < 5) return null;

  // Extract Solana addresses
  const addresses = (text.match(SOL_ADDRESS_RE) || [])
    .filter(a => a.length >= 32 && a.length <= 44)
    .filter(a => !EXCLUDED_ADDRESSES.has(a));

  // Extract cashtags
  const cashtags = [];
  let match;
  const cashtagRe = new RegExp(CASHTAG_RE.source, 'g');
  while ((match = cashtagRe.exec(text)) !== null) {
    cashtags.push(match[1].toUpperCase());
  }

  // Check keyword relevance
  const hasKeywords = KEYWORD_RE.test(text);

  // Must have at least one signal
  if (!addresses.length && !cashtags.length && !hasKeywords) return null;

  // Compute confidence
  let confidence = 0;
  if (addresses.length > 0) confidence += 40;  // Has contract address = very relevant
  if (cashtags.length > 0) confidence += 30;   // Has $TICKER
  if (hasKeywords) confidence += 20;            // Has crypto keywords
  if (addresses.length > 0 && hasKeywords) confidence += 10; // Both = high confidence

  // Detect if this looks like an alpha call
  const callPatterns = [
    /\b(buy|ape|entry|snipe|get in|load|accumulate)\b/i,
    /\b(just launched|stealth|new gem|next \d+x)\b/i,
    /\bca\s*[:=]\s*/i,
    /\b(easy|free|guaranteed)\s+\d+x\b/i,
  ];
  const isAlphaCall = callPatterns.some(p => p.test(text));
  if (isAlphaCall) confidence += 20;

  return {
    addresses: [...new Set(addresses)],
    cashtags: [...new Set(cashtags)],
    isAlphaCall,
    hasKeywords,
    confidence: Math.min(100, confidence),
  };
}

// ── Stats Tracking ───────────────────────────────────────────────────────────

let stats = {
  startedAt: new Date().toISOString(),
  messagesReceived: 0,
  messagesRelayed: 0,
  messagesFailed: 0,
  lastRelayedAt: null,
  topGroups: {},    // groupId -> count
  topTokens: {},    // symbol -> count
};

function loadStats() {
  try { stats = { ...stats, ...JSON.parse(fs.readFileSync(STATS_FILE, 'utf8')) }; } catch {}
}

function saveStats() {
  try { fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2)); } catch {}
}

// ── Message Queue (batch sends to avoid spamming VPS) ────────────────────────

const messageQueue = [];
let flushTimer = null;

function queueMessage(payload) {
  messageQueue.push(payload);
  if (!flushTimer) {
    flushTimer = setTimeout(flushQueue, 3000); // batch every 3s
  }
}

async function flushQueue() {
  flushTimer = null;
  if (!messageQueue.length) return;

  const batch = messageQueue.splice(0, 50); // max 50 per batch

  try {
    const res = await fetch(AUTOBAGS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTOBAGS_SECRET}`,
      },
      body: JSON.stringify({ messages: batch }),
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      stats.messagesRelayed += batch.length;
      stats.lastRelayedAt = new Date().toISOString();
    } else {
      console.error(`[Relay] VPS returned ${res.status}: ${await res.text().catch(() => '?')}`);
      stats.messagesFailed += batch.length;
    }
  } catch (err) {
    console.error(`[Relay] Send failed: ${err.message}`);
    stats.messagesFailed += batch.length;
    // Re-queue on network failure (once)
    if (!batch[0]._retried) {
      batch.forEach(m => { m._retried = true; });
      messageQueue.unshift(...batch);
    }
  }

  saveStats();
}

// ── Main ─────────────────────────────────────────────────────────────────────

if (!fs.existsSync(SESSION_FILE)) {
  console.error('❌ No session found. Run: node auth.js');
  process.exit(1);
}

const sessionStr = fs.readFileSync(SESSION_FILE, 'utf8').trim();

(async () => {
  const client = new TelegramClient(
    new StringSession(sessionStr),
    API_ID,
    API_HASH,
    {
      connectionRetries: 5,
      retryDelay: 2000,
    }
  );

  await client.connect();
  loadStats();

  const me = await client.getMe();
  console.log(`\n🔌 AUTOBAGS TG Relay — Connected as ${me.firstName} (@${me.username})`);
  console.log(`📡 Sending to: ${AUTOBAGS_URL}`);
  console.log(`👁️  Monitoring: ${MONITOR_GROUPS.length ? MONITOR_GROUPS.join(', ') : 'ALL groups'}`);
  console.log(`⚡ Mode: READ-ONLY (never sends messages)\n`);

  // Listen for new messages in groups/channels
  client.addEventHandler(async (event) => {
    try {
      const msg = event.message;
      if (!msg || !msg.text) return;

      // Only process group/channel messages
      const chatId = msg.chatId?.toString() || msg.peerId?.channelId?.toString();
      if (!chatId) return;

      // Filter to monitored groups (if configured)
      if (MONITOR_GROUPS.length > 0) {
        const match = MONITOR_GROUPS.some(gid =>
          chatId === gid || chatId === gid.replace('-100', '') || `-100${chatId}` === gid
        );
        if (!match) return;
      }

      stats.messagesReceived++;

      // Analyze for crypto content
      const analysis = analyzeMessage(msg.text);
      if (!analysis) return;

      // Get sender info
      let senderName = 'Unknown';
      let senderId = null;
      try {
        if (msg.senderId) {
          const sender = await msg.getSender();
          senderName = sender?.firstName || sender?.title || 'Unknown';
          senderId = sender?.id?.toString();
        }
      } catch {}

      // Get chat info
      let chatTitle = 'Unknown Group';
      try {
        const chat = await msg.getChat();
        chatTitle = chat?.title || 'Unknown Group';
      } catch {}

      // Build relay payload
      const payload = {
        source: 'telegram',
        chatId,
        chatTitle,
        senderId,
        senderName,
        text: msg.text.slice(0, 2000), // cap at 2KB
        timestamp: new Date(msg.date * 1000).toISOString(),
        analysis,
      };

      // Track stats
      stats.topGroups[chatTitle] = (stats.topGroups[chatTitle] || 0) + 1;
      for (const tag of analysis.cashtags) {
        stats.topTokens[tag] = (stats.topTokens[tag] || 0) + 1;
      }

      // Log
      const tags = analysis.cashtags.length ? ` [${analysis.cashtags.join(', ')}]` : '';
      const addrs = analysis.addresses.length ? ` 📋${analysis.addresses.length} addr` : '';
      const call = analysis.isAlphaCall ? ' 🚨ALPHA' : '';
      console.log(`[${chatTitle}] ${senderName}:${tags}${addrs}${call} (conf:${analysis.confidence})`);

      // Queue for sending to VPS
      queueMessage(payload);

    } catch (err) {
      // Never crash on a single message error
      if (err.message !== 'TIMEOUT') {
        console.error(`[Relay] Error processing message: ${err.message}`);
      }
    }
  }, new NewMessage({}));

  // Periodic stats log
  setInterval(() => {
    console.log(`\n📊 Stats: ${stats.messagesReceived} received, ${stats.messagesRelayed} relayed, ${stats.messagesFailed} failed`);
    const topTokens = Object.entries(stats.topTokens)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([t, c]) => `$${t}(${c})`)
      .join(' ');
    if (topTokens) console.log(`🔥 Hot: ${topTokens}`);
    saveStats();
  }, 60_000); // every minute

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n🛑 Shutting down relay...');
    await flushQueue();
    saveStats();
    await client.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('✅ Listening for messages... (Ctrl+C to stop)\n');
})();
