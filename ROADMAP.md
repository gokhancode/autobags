# AUTOBAGS Roadmap

> **Mission:** Give every user an unfair advantage over manual traders through speed, data, and AI.

---

## Phase 1 — Edge Expansion (Week 1-2)
*More data sources = better decisions than any human can make in 60 seconds*

### 🔍 Data Sources to Add
| Source | What it gives us | Edge |
|---|---|---|
| **Birdeye API** | Real-time price, volume, OHLCV, trader count | Sub-second price data vs DexScreener's delay |
| **Helius DAS API** | Token metadata, holder snapshots, mint authority | Detect rugs before they happen |
| **Jupiter Price API** | Aggregated best price across all DEXs | Better execution than single-DEX routing |
| **Twitter/X API** | Mentions, sentiment, influencer callouts | Catch narratives before they pump |
| **Telegram group scanner** | Alpha group mentions, bot callout tracking | Front-run retail by minutes |
| **On-chain whale tracker** | Large wallet movements, smart money follows | Copy what whales buy before price moves |
| **Pump.fun API** | New token launches, bonding curve progress | Snipe tokens at birth |
| **GeckoTerminal** | Multi-chain trending, hot pairs | Cross-reference trends |
| **Solscan token API** | Transfer history, holder growth rate | Growing holder count = bullish signal |

### 🧠 New Scoring Signals (intel.py v2)
| Signal | Weight | Description |
|---|---|---|
| **Whale accumulation** | 15% | Smart money buying in last 1h |
| **Holder growth velocity** | 10% | New holders/hour — accelerating = buy |
| **Twitter mention spike** | 10% | Sudden increase in mentions |
| **Influencer detection** | 10% | Known CT accounts mentioning token |
| **Bonding curve position** | 5% | How far along the curve (early = more upside) |
| **Cross-DEX spread** | 5% | Arbitrage opportunity indicator |
| **Time-of-day factor** | 5% | US/EU/Asia session overlap = more volume |

### ⚙️ New User Settings
- **Trading hours** — only trade during specific sessions (US open, EU open, etc.)
- **Token age filter** — min/max age (e.g., only tokens 1-24h old)
- **Market cap range** — min $10k, max $1M
- **Narrative filter** — AI, meme, gaming, DeFi categories
- **Auto-compound** — reinvest profits automatically
- **Cooldown period** — wait X minutes after a loss before next trade
- **Daily loss limit** — stop trading if down X% for the day
- **Whitelist mode** — only trade tokens from a curated list

---

## Phase 2 — Speed Advantage (Week 2-3)
*Humans take 30-60 seconds to analyze and execute. We do it in <1 second.*

### ⚡ Execution Improvements
- **Jito bundles** — MEV-protected transactions, land in same block as opportunity
- **Priority fee optimization** — dynamic priority fees based on network congestion
- **Pre-signed transactions** — have sell txs ready before we even need them
- **Parallel quote fetching** — query Jupiter + Bags + Raydium simultaneously
- **WebSocket price feeds** — real-time price updates vs polling every 60s
- **Reduce tick to 10s** — scan every 10 seconds instead of 60

### 🏗️ Infrastructure
- **Helius RPC** (dedicated) — no rate limits, faster than public RPC
- **Redis cache** — cache token data, avoid redundant API calls
- **Worker threads** — score multiple tokens simultaneously
- **Geographic optimization** — VPS closer to Solana validators (NYC/Amsterdam)

---

## Phase 3 — AI Brain (Week 3-4)
*Not just rules — actual learning from past trades*

### 🤖 ML/AI Features
- **Pattern recognition** — train on successful vs failed trades to improve scoring
- **Sentiment classifier** — fine-tuned model that classifies Twitter posts as bullish/bearish/neutral
- **Chart pattern detection** — CNN on 5m candles to detect breakouts, head-and-shoulders, etc.
- **Optimal exit timing** — ML model that predicts best exit point based on historical patterns
- **Token similarity** — "tokens similar to X that pumped also pumped" — embeddings-based
- **Narrative clustering** — auto-detect trending narratives (AI, political, celebrity) and weight accordingly
- **Dynamic parameter tuning** — auto-adjust SL/TP based on market conditions (tight in choppy, wide in trending)

### 📊 Backtesting Engine
- Feed historical data through the scoring pipeline
- Test strategies before deploying real money
- Show users: "This strategy would have returned X% over the last 30 days"
- A/B test different scoring weights

---

## Phase 4 — Social & Community (Week 4-6)
*Network effects = moat*

### 👥 Social Features
- **Leaderboard** — top traders by P&L (opt-in, anonymized)
- **Strategy sharing** — users can publish and share their settings presets
- **Copy trading** — follow top performers' strategies (auto-mirror their settings)
- **Referral program** — 10% fee reduction for referrer + referred
- **Discord bot** — trade notifications, portfolio check, quick commands
- **Telegram mini-app** — full dashboard inside Telegram

### 📈 Analytics Dashboard
- Equity curve chart (portfolio value over time)
- Per-token performance breakdown
- Best/worst trades with AI analysis
- Heatmap: time of day vs profitability
- Risk metrics: Sharpe ratio, max drawdown, win streak

---

## Phase 5 — Advanced Strategies (Week 6-8)
*Beyond basic buy/sell*

### 🎯 Strategy Types
| Strategy | Description |
|---|---|
| **Momentum** | Buy tokens with accelerating volume + price (current default) |
| **Mean reversion** | Buy oversold tokens showing reversal signals |
| **Narrative sniper** | Detect new narratives and buy first movers |
| **Whale mirror** | Copy smart money wallets with 1-block delay |
| **Launch sniper** | Buy tokens within seconds of Pump.fun graduation |
| **DCA mode** | Dollar-cost average into selected tokens over time |
| **Grid trading** | Set buy/sell grid for range-bound tokens |
| **Arbitrage** | Cross-DEX price differences (needs speed) |

### 🔧 Portfolio Management
- **Multi-token portfolio** — hold 3-5 tokens with rebalancing
- **Sector allocation** — 40% memes, 30% AI, 30% DeFi
- **Correlation tracking** — don't hold tokens that move together
- **Auto-rebalance** — sell winners, buy losers to maintain allocation

---

## Phase 6 — Scale & Monetization (Week 8-12)
*From hackathon project to business*

### 💰 Revenue Model
| Tier | Fee | Features |
|---|---|---|
| **Free** | 2% per trade | Basic mode only, 1 position, community scoring |
| **Pro** ($29/mo) | 1% per trade | Advanced mode, 3 positions, all data sources, backtesting |
| **Elite** ($99/mo) | 0.5% per trade | ML strategies, whale mirror, launch sniper, priority execution |

### 🏢 Infrastructure Scale
- SQLite → PostgreSQL (when >1000 users)
- Add load balancer + multiple worker nodes
- Dedicated Helius/Triton RPC with SLA
- Monitoring: Grafana + Prometheus for uptime/latency
- SOC 2 compliance preparation

### 📱 Multi-Platform
- iOS app (React Native or PWA)
- Chrome extension — "Buy with AUTOBAGS" button on Birdeye/DexScreener
- API for developers — let others build on AUTOBAGS

---

## Implementation Priority (Next 2 Weeks)

### This Week
1. ☐ Add Birdeye API for real-time prices (replace DexScreener polling)
2. ☐ Add whale wallet tracking (top 10 smart money wallets)
3. ☐ Add Twitter mention detection (free tier: scrape, or Socialdata API)
4. ☐ Reduce tick to 15s
5. ☐ Add daily loss limit setting
6. ☐ Add trading hours setting
7. ☐ Add token age + market cap filters
8. ☐ WebSocket price feed for position monitoring
9. ☐ Telegram trade alerts (buy/sell notifications to your phone)
10. ☐ Equity curve on dashboard

### Next Week
1. ☐ Jito bundle integration for MEV protection
2. ☐ Helius RPC (free tier: 100k req/day)
3. ☐ Backtesting engine (replay last 7 days of data)
4. ☐ Pattern recognition v1 (logistic regression on trade features)
5. ☐ Leaderboard + strategy sharing
6. ☐ Pump.fun integration (graduation sniper)
7. ☐ Copy trading v1
8. ☐ SQLite migration
9. ☐ Discord bot
10. ☐ Referral system

---

*Last updated: March 27, 2026*
