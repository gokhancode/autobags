# 📓 AUTOBAGS Dev Log

*Building an AI trading agent on Bags.fm from scratch.*

---

## Day 1 — March 27, 2026

### 09:00 — Research & Planning
- Investigated Bags.fm hackathon: $1M prize pool, 100 winners, rolling Q1 2026
- Categories: AI Agents, Fee Sharing, Bags API — we're going for all three
- Audited VPS specs (2 CPU, 4GB RAM, 57GB disk) — sufficient for MVP
- Inventoried existing trading bot code (intel scorer, Jupiter swaps, trend scout)
- Named the project: **AUTOBAGS** — "Your bags, on autopilot"

### 10:00 — Architecture & Scaffolding
- Drafted 6-phase roadmap (MVP → Scale → Community → Mobile → Enterprise → DAO)
- Designed custodial wallet model: server-side key generation, AES-256-GCM encryption
- Chose auth model: bcrypt passwords + TOTP 2FA (no email infra needed)
- Scaffolded Node.js/Express project structure
- Initialized git, created GitHub repo (`gokhancode/autobags`)

### 11:00 — Bags API Integration
- Fetched and studied Bags API docs (`docs.bags.fm/llms.txt`)
- Cloned Bags SDK from GitHub for reference
- Built `bags-client.js` — full API wrapper with verified paths:
  - Token feed (`/token-launch/feed`) — discovered `limit` param causes 400
  - Trade quotes (`/trade/quote` GET)
  - Swap execution (`/trade/swap` POST)
  - Transaction submission (`/solana/send-transaction`)
  - Pool data (`/solana/bags/pools`)
  - Partner stats (`/fee-share/partner-config/stats`)
- Key learning: API uses `partner` param, not `partnerKey`

### 12:00 — Trading Engine
- Built `intel-bridge.js` — bridges to existing Python scorer (RugCheck, safety, social)
- Built `agent.js` — the core trading loop:
  - Scout: pulls 100+ tokens from Bags feed + DexScreener
  - Score: runs each through intel.py (safety, liquidity, social presence)
  - Buy: quotes → builds swap tx → signs → submits
  - Monitor: tracks open positions, checks SL/TP/trailing every 15s
- Integrated data enrichment: whale tracking, social signals, holder distribution, momentum analysis
- Combined scoring: 60% intel.py + 40% enrichment data

### 13:00 — Wallet System
- Built `wallet-manager.js`:
  - Generates Solana keypair per user on signup
  - Encrypts private keys with AES-256-GCM (master key from env)
  - Decrypt only when needed (trade execution, export)
  - Export gated behind 2FA verification

### 14:00 — Auth & API Layer
- `auth.js`: signup, login, verify-2fa, export, /me endpoints
- Rate limiting: 10 auth attempts per 15 min per IP
- Input validation: alphanumeric userId, max 32 chars
- JWT sessions (7-day expiry)
- `portfolio.js`: live on-chain SOL balance + token holdings with P&L
- `trades.js`: trade history with AI explanations
- `settings.js`: per-user trading config (basic presets + advanced sliders)
- `stats.js`: live platform stats (SOL price, Bags pools, Solana TPS)
- `subscribers.js`: user management (admin-only listing)

### 15:00 — Dashboard & Landing Page
- Split into two pages (landing + dashboard) — cleaner UX
- Landing page: hero section, feature cards, live stats bar, token ticker, sign up modal
- Dashboard: Total Worth (highlighted), SOL Balance, Holdings, P&L, Win Rate
  - Open Positions panel with live P&L per token
  - Canvas-based equity chart (1D/7D/30D)
  - Settings panel (basic/advanced mode)
  - Recent Trades table
  - Export wallet (2FA-gated)
- Light/dark mode toggle, localStorage persistence
- Auto-refresh every 30s

### 16:00 — Domain & Deployment
- Bought `autobags.io` on Namecheap
- DNS: A records → VPS IP (64.227.119.101)
- Caddy config: HTTPS via Let's Encrypt (cert valid until Jun 25)
- Systemd service for auto-start/restart
- Stripped server headers (X-Powered-By, Via, Server)

### 17:00 — AI Trade Explanations
- Tried Gemini Flash — quota issues on free tier
- Switched to Groq (Llama 3.3 70B) — ~200ms response, 30 RPM free
- Built async explanation queue — trade execution not blocked by AI calls
- Every trade gets a natural-language explanation: why it bought/sold, what signals triggered
- "🤖 Why?" expandable button on each trade in the dashboard

### 18:00 — Advanced Features
- Manual sell button on open positions
- Telegram trade notifications (BUY/SELL alerts with Solscan links)
- Admin panel: platform overview, user management, force sell, health checks
- Equity curve tracker with time-series data
- Position accumulation (same-token buys → weighted avg entry)
- Token-level filters: age, market cap, blacklist
- 23/23 test suite passing

### 19:00 — Deep Bags Integration
- Added 4 more Bags API endpoints (10 total):
  - Partner config initialization (`/fee-share/partner-config/creation-tx`)
  - Fee claiming (`/token-launch/claim-txs/v3`)
  - Token launching (`/token-launch/create-launch-transaction`)
  - Pool analytics (`/solana/bags/pools/:mint`)
- Fee management API: stats, init, claim, pool details
- Token launch API: create token info → launch on Bags
- Bags pool bonus in scoring: tokens on Bags get 20% weight boost
- Admin panel: Bags partner status, volume, fees earned, claim button

### 19:30 — Narrative Scanner
- AI-powered social/trending scanner:
  - Scans Bags feed + DexScreener boosted + CoinGecko trending
  - Groq AI identifies 3-5 hot narratives with confidence scores
  - Suggests token names/tickers users could launch on Bags
- API: `/api/narratives` with 10min cache
- First scan found: AI Agents, Meme Culture, Political Commentary, Gaming, Celebrity tokens

### 20:00 — Infrastructure Upgrades
- **SQLite migration**: Replaced JSON files with better-sqlite3
  - WAL mode, indexed tables, prepared statements
  - Auto-migration from JSON on first startup
  - Scales to thousands of users (JSON maxed at ~100)
- **RPC fallback manager**: Multiple Solana RPC endpoints with auto-rotation
  - Helius support (add API key for dedicated RPC)
  - `withRetry()` — automatic retry with fallback

### 21:00 — Paper Trading Simulator
- Built full paper trading simulator ($1,000 virtual balance)
- High-frequency mode: 15s ticks, 3 max positions, $250 per position
- Fast scoring via DexScreener (momentum + volume + buy pressure + liquidity)
- Smart exits: 3% SL, 8% TP, partial exit at +4%, trailing stop 2%, 15min stale exit
- Portfolio circuit breaker: pauses trading if down 15%
- API: `/api/sim` for live stats

### 21:30 — Strategy Tournament
- 5 competing AI strategies running in parallel:
  1. 🚀 **Momentum Rider** — pure 5m/1h price momentum
  2. 🔄 **Mean Reversion** — buy oversold bounces with confirmation
  3. 🐋 **Whale Shadow** — follow concentrated buying patterns
  4. 🌍 **Session Trader** — timezone-aware (Asia/EU/US pump patterns)
  5. 🩸 **Contrarian** — buy heavy selling + rising volume (capitulation plays)
- $1,000 split evenly, each trades independently
- Hourly Darwinian rebalance: worst strategy loses 10% capital to the best
- API: `/api/tournament` for leaderboard

### 22:00 — Quant Engine
- Bayesian signal learning system (25 tracked signals)
  - Each signal has weight, win/loss count, total PnL
  - Weights update after every trade (learning rate 0.1)
  - Winning signals strengthen, losing signals weaken
- Kelly criterion position sizing
  - Calculates mathematically optimal bet size
  - Uses half-Kelly for conservative risk
- Volatility regime detection
  - Samples 10 tokens to measure market-wide 5m volatility
  - 4 regimes: low/medium/high/extreme
  - Each regime adjusts SL/TP/position size/score threshold
- Feature importance ranking — tracks which signals actually predict winners
- Cross-token correlation tracking
- Rolling Sharpe ratio
- API: `/api/quant` for brain report + feature analysis

### 22:30 — Self-Improving Tuner
- Cron job every 30 minutes for 24 hours
- Analyzes: win rate, profit factor, avg win/loss, exit breakdown, score buckets
- Auto-adjusts 9 parameters based on performance
- Cross-learns from tournament: if a strategy outperforms, adopts its params
- Logs every decision and adjustment
- Auto-removes after 24h

### 23:00 — Bug Fixes & Polish
- Fixed manual sell PnL calculation (was using raw `outAmount`, now uses price ratio)
- Fixed portfolio valuation (now uses Bags trade quote — actual swap value)
- Added Solscan transaction links on trade history
- Fixed sim drawdown calculation (equity-based, not cash-only)
- Fixed sim stop loss fill simulation (realistic execution at stop level)
- Improved sim scoring granularity (scores now differentiate: 55-88 range, not all 95)

---

### Day 1 Stats
- **30+ commits** pushed to GitHub
- **20 source files** (13 JS modules + 3 HTML pages + configs)
- **12 GitBook doc pages**
- **10 Bags API endpoints** integrated
- **25 trading signals** tracked by quant engine
- **5 competing strategies** in tournament
- **1 real trade** executed on mainnet
- **Full test suite**: 23/23 passing
- **Live at**: [autobags.io](https://autobags.io)

### Architecture
```
Landing (autobags.io) → Dashboard (/dashboard) → Admin (/admin)
     ↓
Express API (port 3500)
  ├── Auth (bcrypt + TOTP + JWT)
  ├── Portfolio (on-chain balance + Bags quote valuation)
  ├── Trading Agent (scout → score → buy → monitor → sell)
  ├── Simulator (paper trading + tournament)
  ├── Quant Engine (Bayesian learning + Kelly sizing)
  ├── Narrative Scanner (AI social analysis)
  ├── Fee Management (Bags partner config)
  └── Token Launch (deploy via Bags)
     ↓
Bags.fm API ←→ Solana RPC ←→ DexScreener ←→ Groq AI
```

### Tech Stack
- **Backend**: Node.js 22, Express
- **Database**: SQLite (better-sqlite3, WAL mode)
- **Blockchain**: @solana/web3.js, Jupiter, Bags SDK
- **AI**: Groq (Llama 3.3 70B) for explanations, custom Bayesian engine for signals
- **Scoring**: Python (intel.py) + Node.js (data sources + quant engine)
- **Frontend**: Vanilla HTML/CSS/JS (zero framework deps)
- **Infra**: Caddy (HTTPS), systemd, cron, DigitalOcean VPS
- **Auth**: bcrypt, speakeasy (TOTP), jsonwebtoken
- **Encryption**: AES-256-GCM (crypto module)

---

*More entries will be added as development continues.*
