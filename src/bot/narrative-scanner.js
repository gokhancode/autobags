/**
 * AUTOBAGS — Narrative Scanner
 * AI scans social/trending data to identify hot narratives
 * Suggests token launch ideas to users
 */

const GROQ_KEY = process.env.GROQ_API_KEY;

/**
 * Scan trending tokens + social data to identify narratives
 * Returns AI-generated narrative ideas with launch suggestions
 */
async function scanNarratives() {
  // 1. Gather trending data
  const [dexTrending, bagsFeed] = await Promise.allSettled([
    fetch('https://api.dexscreener.com/token-boosts/top/v1').then(r => r.json()).catch(() => []),
    fetch('https://public-api-v2.bags.fm/api/v1/token-launch/feed', {
      headers: { 'x-api-key': process.env.BAGS_API_KEY }
    }).then(r => r.json()).catch(() => ({ response: [] }))
  ]);

  const boosted = (dexTrending.status === 'fulfilled' ? dexTrending.value : [])
    .filter(t => t.chainId === 'solana')
    .slice(0, 20)
    .map(t => t.description || t.tokenAddress?.slice(0, 8))
    .filter(Boolean);

  const bagsTokens = (bagsFeed.status === 'fulfilled' ? bagsFeed.value?.response : [])
    ?.slice(0, 30)
    .map(t => `${t.symbol}: ${t.name}`)
    .filter(Boolean) || [];

  // 2. Get CoinGecko trending for broader market context
  let cgTrending = [];
  try {
    const cgRes = await fetch('https://api.coingecko.com/api/v3/search/trending');
    const cgData = await cgRes.json();
    cgTrending = (cgData?.coins || []).slice(0, 10).map(c => `${c.item.symbol}: ${c.item.name}`);
  } catch {}

  // 3. Ask AI to identify narratives
  if (!GROQ_KEY) return { narratives: [], error: 'No GROQ_API_KEY' };

  const prompt = `You are a crypto narrative analyst. Analyze these trending tokens and identify the TOP 3-5 hot narratives right now.

TRENDING ON BAGS.FM (new launches):
${bagsTokens.join('\n') || 'No data'}

BOOSTED ON DEXSCREENER (Solana):
${boosted.join('\n') || 'No data'}

TRENDING ON COINGECKO:
${cgTrending.join('\n') || 'No data'}

For each narrative, provide:
1. Narrative name (e.g., "AI Agents", "Political Memes", "Celebrity Tokens")
2. Why it's trending (1 sentence)
3. Token launch idea — a catchy name + ticker that would ride this narrative on Bags.fm
4. Confidence (1-10)

Return ONLY valid JSON array:
[{"narrative":"...","why":"...","tokenIdea":{"name":"...","ticker":"...","description":"..."},"confidence":8}]`;

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
        temperature: 0.7,
      })
    });
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';

    // Parse JSON from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const narratives = JSON.parse(jsonMatch[0]);
      return {
        narratives,
        sources: { bagsTokens: bagsTokens.length, dexBoosted: boosted.length, cgTrending: cgTrending.length },
        scannedAt: new Date().toISOString()
      };
    }
    return { narratives: [], raw: text, error: 'Could not parse AI response' };
  } catch (err) {
    return { narratives: [], error: err.message };
  }
}

module.exports = { scanNarratives };
