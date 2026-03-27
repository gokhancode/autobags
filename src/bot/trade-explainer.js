/**
 * Trade Explainer — Groq (Llama 3.3 70B) powered trade reasoning
 * Generates human-readable explanations for every buy/sell
 * Production: async queue, retries, graceful fallback
 */

const GROQ_KEY = process.env.GROQ_API_KEY;
const MODEL = 'llama-3.3-70b-versatile';
const API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const MAX_RETRIES = 2;
const RETRY_DELAY = 2000;

const queue = [];
let processing = false;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function explain(context) {
  if (!GROQ_KEY) return 'AI explanation unavailable (no API key configured)';

  const prompt = buildPrompt(context);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_KEY}`
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: 'system', content: 'You are a crypto trading AI. Explain trade decisions in 2-3 concise sentences. Be specific about data. No fluff.' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 150,
          temperature: 0.3,
        })
      });

      if (res.status === 429) {
        console.warn(`[Explainer] Rate limited, retry ${attempt + 1}/${MAX_RETRIES}`);
        await sleep(RETRY_DELAY * (attempt + 1));
        continue;
      }

      if (!res.ok) {
        const err = await res.text();
        console.error(`[Explainer] API error ${res.status}:`, err.slice(0, 200));
        if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY); continue; }
        return fallbackExplanation(context);
      }

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;
      return text?.trim() || fallbackExplanation(context);

    } catch (err) {
      console.error(`[Explainer] Fetch error:`, err.message);
      if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY); continue; }
      return fallbackExplanation(context);
    }
  }

  return fallbackExplanation(context);
}

function buildPrompt(ctx) {
  if (ctx.type === 'BUY') {
    return `Explain why I bought this token:

Token: $${ctx.symbol} (${ctx.mint})
Intel Score: ${ctx.score}/100
Amount: ${ctx.solAmount?.toFixed(4)} SOL
Safety (RugCheck): ${ctx.details?.safety || 'passed'}
Liquidity: ${ctx.details?.liquidity || 'adequate'}
Volume/Liq Ratio: ${ctx.details?.volLiqRatio || 'normal'}
Holder Distribution: ${ctx.details?.holders || 'ok'}
Social Presence: ${ctx.details?.social || 'unknown'}
Momentum: ${ctx.details?.momentum || 'positive'}
Market Sentiment: ${ctx.details?.sentiment || 'neutral'}`;
  }

  if (ctx.type === 'SELL' || ctx.type === 'PARTIAL_SELL') {
    return `Explain why I sold this token:

Token: $${ctx.symbol}
Sell Reason: ${ctx.reason}
P&L: ${ctx.pnlPct != null ? ctx.pnlPct.toFixed(1) + '%' : 'unknown'}
Hold Duration: ${ctx.holdDuration || 'unknown'}
Type: ${ctx.type === 'PARTIAL_SELL' ? 'Partial exit (30% of position)' : 'Full exit'}`;
  }

  return `Explain this ${ctx.type} trade for $${ctx.symbol}. Reason: ${ctx.reason || 'standard strategy'}`;
}

function fallbackExplanation(ctx) {
  if (ctx.type === 'BUY') {
    return `Bought $${ctx.symbol} — intel score ${ctx.score}/100 passed the minimum threshold. Token showed acceptable safety metrics and liquidity depth.`;
  }
  if (ctx.type === 'SELL') {
    return `Sold $${ctx.symbol} — triggered by ${ctx.reason || 'exit condition'}. ${ctx.pnlPct != null ? (ctx.pnlPct >= 0 ? 'Closed with +' : 'Closed at ') + ctx.pnlPct.toFixed(1) + '% P&L.' : ''}`;
  }
  if (ctx.type === 'PARTIAL_SELL') {
    return `Partial exit on $${ctx.symbol} — secured 30% of position at +${ctx.pnlPct?.toFixed(1) || '?'}%. Remaining 70% continues running.`;
  }
  return `Trade executed for $${ctx.symbol}.`;
}

function queueExplanation(context, callback) {
  queue.push({ context, callback });
  if (!processing) processQueue();
}

async function processQueue() {
  processing = true;
  while (queue.length > 0) {
    const { context, callback } = queue.shift();
    try {
      const explanation = await explain(context);
      if (callback) callback(explanation);
    } catch (err) {
      console.error('[Explainer] Queue error:', err.message);
      if (callback) callback(fallbackExplanation(context));
    }
    await sleep(100);
  }
  processing = false;
}

module.exports = { explain, queueExplanation, fallbackExplanation };
