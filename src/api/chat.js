/**
 * AUTOBAGS — AI Strategy Chat
 * Users can discuss trading strategies, ask for analysis, get recommendations
 * Uses Groq (Llama 3.3 70B) for fast responses
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const GROQ_KEY = process.env.GROQ_API_KEY;
const TRADES_FILE = path.join(__dirname, '../../data/trades.json');
const POSITIONS_FILE = path.join(__dirname, '../../data/positions.json');
const SETTINGS_FILE = path.join(__dirname, '../../data/settings.json');
const QUANT_FILE = path.join(__dirname, '../../data/quant-brain.json');

function load(f, def) {
  try { return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : def; }
  catch { return def; }
}

// Chat history per user (in memory, last 20 messages)
const chatHistory = {};

function getContext(userId) {
  const trades = load(TRADES_FILE, []).filter(t => t.userId === userId);
  const positions = load(POSITIONS_FILE, {})[userId] || {};
  const settings = load(SETTINGS_FILE, {})[userId] || {};
  const brain = load(QUANT_FILE, {});

  const recentTrades = trades.slice(-10);
  const wins = recentTrades.filter(t => (t.pnlSol || 0) > 0).length;
  const losses = recentTrades.filter(t => (t.pnlSol || 0) < 0).length;
  const openPositions = Object.entries(positions).map(([mint, p]) => 
    `${p.symbol}: ${p.solSpent?.toFixed(4)} SOL, entry ${new Date(p.entryTime).toISOString()}`
  ).join('\n');

  const topSignals = brain?.signals ? 
    Object.entries(brain.signals)
      .filter(([_, s]) => (s.wins + s.losses) > 10)
      .sort((a, b) => (b[1].wins / (b[1].wins + b[1].losses)) - (a[1].wins / (a[1].wins + a[1].losses)))
      .slice(0, 5)
      .map(([name, s]) => `${name}: ${(s.wins/(s.wins+s.losses)*100).toFixed(0)}% WR (${s.wins+s.losses} trades)`)
      .join('\n') : 'No signal data yet';

  return `You are the AUTOBAGS AI Trading Assistant. You help users optimize their Solana memecoin trading strategies.

Current user: ${userId}
Settings: SL=${settings.stopLossPct || 3}%, TP=${settings.takeProfitPct || 8}%, Position=${settings.maxSolPerTrade || 35}%

Open positions:
${openPositions || 'None'}

Recent trades (last 10): ${wins}W/${losses}L
${recentTrades.map(t => `${t.type} ${t.symbol} ${t.pnlSol ? (t.pnlSol > 0 ? '+' : '') + t.pnlSol.toFixed(4) + ' SOL' : ''}`).join('\n')}

Top performing signals:
${topSignals}

Market regime: ${brain?.regimes?.current || 'unknown'}
Volatility: ${brain?.regimes?.avgVol?.toFixed(1) || '?'}%

Be concise but insightful. Give specific, actionable advice based on the data above. If the user asks about a specific token, analyze it. If they want strategy changes, explain the tradeoffs.`;
}

// POST /api/chat
router.post('/', async (req, res) => {
  const { userId, message } = req.body;
  if (!userId || !message) return res.status(400).json({ error: 'userId and message required' });
  if (!GROQ_KEY) return res.status(500).json({ error: 'AI not configured' });

  if (!chatHistory[userId]) chatHistory[userId] = [];
  chatHistory[userId].push({ role: 'user', content: message });
  
  // Keep last 20 messages
  if (chatHistory[userId].length > 20) {
    chatHistory[userId] = chatHistory[userId].slice(-20);
  }

  try {
    const systemPrompt = getContext(userId);
    
    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          ...chatHistory[userId],
        ],
        max_tokens: 500,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!groqRes.ok) {
      const err = await groqRes.text();
      throw new Error(`Groq error: ${err}`);
    }

    const data = await groqRes.json();
    const reply = data.choices?.[0]?.message?.content || 'No response from AI';

    chatHistory[userId].push({ role: 'assistant', content: reply });

    res.json({ 
      success: true, 
      reply,
      model: 'llama-3.3-70b',
      tokens: data.usage?.total_tokens || 0,
    });
  } catch (err) {
    console.error('[Chat] Error:', err.message);
    res.status(500).json({ error: 'AI chat failed', message: err.message });
  }
});

// GET /api/chat/history/:userId
router.get('/history/:userId', (req, res) => {
  const history = chatHistory[req.params.userId] || [];
  res.json({ success: true, messages: history });
});

// POST /api/chat/analyze — Quick token analysis
router.post('/analyze', async (req, res) => {
  const { mint, userId } = req.body;
  if (!mint) return res.status(400).json({ error: 'mint required' });
  if (!GROQ_KEY) return res.status(500).json({ error: 'AI not configured' });

  try {
    // Fetch token data
    const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const dexData = await dexRes.json();
    const pair = dexData?.pairs?.find(p => p.chainId === 'solana');
    if (!pair) return res.json({ success: false, error: 'Token not found on DexScreener' });

    const { assessRisk } = require('../bot/rug-detector');
    const risk = await assessRisk(mint);

    const tokenInfo = `
Token: ${pair.baseToken?.name} (${pair.baseToken?.symbol})
Price: $${pair.priceUsd}
Market Cap: $${pair.marketCap || pair.fdv || '?'}
Liquidity: $${pair.liquidity?.usd || '?'}
Volume 24h: $${pair.volume?.h24 || '?'}
5m change: ${pair.priceChange?.m5 || '?'}%
1h change: ${pair.priceChange?.h1 || '?'}%
24h change: ${pair.priceChange?.h24 || '?'}%
Buys/Sells 1h: ${pair.txns?.h1?.buys || '?'}/${pair.txns?.h1?.sells || '?'}
Rug risk score: ${risk.riskScore}/100 ${risk.safe ? '✅ SAFE' : '🚨 RISKY'}
${risk.flags.length > 0 ? 'Flags:\n' + risk.flags.join('\n') : 'No red flags detected'}
`;

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: 'You are a Solana memecoin analyst. Give a brief buy/hold/avoid recommendation with reasoning. Be direct, max 3 sentences.' },
          { role: 'user', content: `Analyze this token:\n${tokenInfo}` },
        ],
        max_tokens: 200,
        temperature: 0.5,
      }),
      signal: AbortSignal.timeout(10000),
    });

    const data = await groqRes.json();
    const analysis = data.choices?.[0]?.message?.content || 'Analysis unavailable';

    res.json({
      success: true,
      token: pair.baseToken?.symbol,
      price: pair.priceUsd,
      risk: risk.riskScore,
      safe: risk.safe,
      flags: risk.flags,
      analysis,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
