/**
 * Trade Explainer — Gemini Flash powered trade reasoning
 * Generates human-readable explanations for every buy/sell
 * Production: async queue, retries, graceful fallback
 */

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-flash-latest';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const MAX_RETRIES = 2;
const RETRY_DELAY = 2000;

// Queue for async processing
const queue = [];
let processing = false;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Generate a trade explanation via Gemini Flash
 * @param {Object} context - Trade context
 * @returns {string} Human-readable explanation
 */
async function explain(context) {
  if (!GEMINI_KEY) return 'AI explanation unavailable (no API key configured)';

  const prompt = buildPrompt(context);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-goog-api-key': GEMINI_KEY },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 200,
            temperature: 0.3,
          }
        })
      });

      if (res.status === 429) {
        // Rate limited — wait and retry
        console.warn(`[Explainer] Rate limited, retry ${attempt + 1}/${MAX_RETRIES}`);
        await sleep(RETRY_DELAY * (attempt + 1));
        continue;
      }

      if (!res.ok) {
        const err = await res.text();
        console.error(`[Explainer] API error ${res.status}:`, err);
        if (attempt < MAX_RETRIES) { await sleep(RETRY_DELAY); continue; }
        return fallbackExplanation(context);
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
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
    return `You are a crypto trading AI explaining your buy decision in 2-3 concise sentences. Be specific about the data.

Token: $${ctx.symbol} (${ctx.mint})
Intel Score: ${ctx.score}/100
Amount: ${ctx.solAmount?.toFixed(4)} SOL
Score Breakdown:
- Safety (RugCheck): ${ctx.details?.safety || 'passed'}
- Liquidity: ${ctx.details?.liquidity || 'adequate'}
- Volume/Liq Ratio: ${ctx.details?.volLiqRatio || 'normal'}
- Holder Distribution: ${ctx.details?.holders || 'ok'}
- Social Presence: ${ctx.details?.social || 'unknown'}
- Momentum: ${ctx.details?.momentum || 'positive'}
Market Sentiment: ${ctx.details?.sentiment || 'neutral'}

Explain why you bought this token. Be direct, no fluff.`;
  }

  if (ctx.type === 'SELL' || ctx.type === 'PARTIAL_SELL') {
    return `You are a crypto trading AI explaining your sell decision in 2-3 concise sentences. Be specific.

Token: $${ctx.symbol}
Sell Reason: ${ctx.reason}
P&L: ${ctx.pnlPct != null ? ctx.pnlPct.toFixed(1) + '%' : 'unknown'}
Hold Duration: ${ctx.holdDuration || 'unknown'}
Entry: ${ctx.entryPrice || 'unknown'} → Current: ${ctx.currentPrice || 'unknown'}

Explain why you sold. Be direct, reference the specific trigger.`;
  }

  return `Explain this ${ctx.type} trade for $${ctx.symbol} in 2 sentences. Reason: ${ctx.reason || 'standard strategy'}`;
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

/**
 * Queue an explanation (non-blocking)
 * Resolves immediately with a promise that fulfills when explanation is ready
 */
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
    // Respect rate limits — min 100ms between calls
    await sleep(100);
  }
  processing = false;
}

module.exports = { explain, queueExplanation, fallbackExplanation };
