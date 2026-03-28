# 🤖 AUTOBAGS — Your bags, on autopilot.

**AI-powered Solana memecoin trading agent built on [Bags.fm](https://bags.fm)**

> Every trade goes through Bags. Every fee benefits the ecosystem. Every decision is AI-driven.

🌐 **Live:** [autobags.io](https://autobags.io)

---

## 🎒 Bags.fm Integration (10/10 Endpoints)

AUTOBAGS is built **on top of** Bags.fm, not alongside it. Every core function uses the Bags API:

| Feature | Bags API Endpoint | Description |
|---|---|---|
| **Token Discovery** | `GET /token-launch/feed` | Discover trending tokens from Bags launches |
| **Trade Quotes** | `GET /trade/quote` | Get best swap prices via Bags routing |
| **Swap Execution** | `POST /trade/swap` | Build swap transactions through Bags |
| **Transaction Submit** | `POST /solana/send-transaction` | Submit signed txs via Bags RPC |
| **Fee Sharing** | Partner key in every swap | Fees go to Bags ecosystem |
| **Partner Config** | `POST /fee-share/partner-config/creation-tx` | On-chain partner setup |
| **Fee Claiming** | `POST /token-launch/claim-txs/v3` | Claim accumulated partner fees |
| **Pool Analytics** | `GET /solana/bags/pools/:mint` | Pool details for scoring |
| **Token Launch** | Bags SDK v2 (4-step flow) | Launch tokens directly via AUTOBAGS |
| **Pool Stats** | `GET /solana/bags/pools` | Live platform stats for landing page |

### Hackathon Categories
- ✅ **AI Agents** — Automated 8-source scoring + trading bot with ML pattern recognition
- ✅ **Fee Sharing** — On-chain partner key, fees on every trade
- ✅ **Bags API** — 10/10 endpoints deeply integrated

---

## 📊 By the Numbers

| Metric | Value |
|---|---|
| Lines of code | **~10,000** |
| Git commits | **71+** |
| API routes | **84** |
| Source files | **54** |
| Data sources | **8** (DexScreener, Birdeye, Helius, Jupiter, CoinGecko, whale wallets, social, Bags) |
| Bags endpoints | **10/10** |
| Trading tick | **10 seconds** |
| Token scoring signals | **25+** |

---

## ✨ Features

### Trading Intelligence
- 🧠 **8-Source Scoring** — DexScreener momentum + Birdeye wallets + social presence + whale tracking + holder growth + rug detection + pattern ML + session-aware timing
- 🛡️ **Rug Detection** — Helius DAS mint/freeze authority, holder concentration, DexScreener red flags
- 🐋 **Whale Tracker** — Monitors 5 smart money wallets via Helius/Solscan
- 📈 **Pattern Recognition ML** — Logistic regression on 14 features, auto-trains after 10 trades
- 📊 **Backtesting Engine** — Replay trades with parameter overrides, grid search optimizer
- 🔥 **Dynamic SL/TP** — Adapts to volatility regime, token volatility, session, and streak
- ⚡ **Jito MEV Protection** — MEV-protected transactions for trades ≥ 0.1 SOL
- 💬 **AI Strategy Chat** — Groq Llama 3.3 70B with full trade context

### Trading Modes
- **Standard** — AI scouts, scores, and exits automatically
- **Grid Trading** — Buy/sell at fixed price intervals for range-bound tokens
- **DCA** — Dollar cost average into positions over time
- **Portfolio Rebalancer** — Target allocations with drift-based rebalancing

### Token Launch
- 🚀 **One-click launch** on Bags.fm via official SDK v2
- Metadata upload → fee share config → launch tx → Jito bundle
- Auto-branding: "Launched using autobags.io 🤖"
- AI narrative suggestions for trending token ideas

### User Features
- 🔒 **Custodial wallets** — AES-256-GCM encrypted, exportable with 2FA
- ⚙️ **Basic + Advanced mode** — Risk presets or full parameter control
- 📊 **Live dashboard** — Portfolio, equity curve, positions, trade history, AI chat
- 🏆 **Leaderboard** — Public rankings, strategy sharing, referral program
- 🌓 **Light/Dark mode**
- 📱 **Telegram alerts** — Real-time buy/sell notifications

### Analytics
- Time-of-day profitability heatmap
- Per-token performance breakdown
- Profit factor, max drawdown, win rate, avg hold time
- Quant brain signals with Bayesian confidence

---

## 🏗️ Architecture

```
User → HTTPS (Caddy) → Express API ─┬→ Bags.fm API → Solana
                                     ├→ DexScreener + Birdeye + Jupiter (scoring)
                                     ├→ Helius DAS (rug detection)
                                     ├→ Whale Tracker (smart money)
                                     ├→ Groq AI (chat + analysis)
                                     ├→ Jito Block Engine (MEV protection)
                                     └→ Pattern Recognition ML (trade features)
```

**Stack:** Node.js 22, Express, @solana/web3.js, @bagsfm/bags-sdk, Caddy, systemd
**Data:** SQLite (WAL mode) + JSON files
**Auth:** bcrypt + TOTP 2FA + JWT (7-day sessions)
**Encryption:** AES-256-GCM for private keys
**AI:** Groq Llama 3.3 70B (chat), logistic regression (pattern ML)

---

## 🚀 Quick Start

```bash
git clone https://github.com/gokhancode/autobags.git
cd autobags
npm install
cp config/example.env config/.env
# Edit .env with your keys
npm start
```

**Required keys:**
- `BAGS_API_KEY` — from [dev.bags.fm](https://dev.bags.fm)
- `BAGS_PARTNER_KEY` — your Solana wallet pubkey
- `WALLET_MASTER_KEY` — AES encryption key
- `JWT_SECRET` — session signing key
- `GROQ_API_KEY` — from [console.groq.com](https://console.groq.com) (free tier)

**Optional:**
- `BIRDEYE_API_KEY` — for holder/wallet data
- `HELIUS_API_KEY` — for rug detection via DAS
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` — for trade alerts

---

## 📄 API Endpoints (84 routes)

### Core Trading
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/portfolio/:userId` | Balance + positions + P&L |
| GET | `/api/portfolio/:userId/equity` | Equity curve data |
| POST | `/api/sell` | Manual sell position |
| GET | `/api/trades` | Trade history |

### Auth & Settings
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/signup` | Create account + wallet |
| POST | `/api/auth/verify-2fa` | Enable 2FA |
| POST | `/api/auth/login` | Login (password + 2FA) |
| POST | `/api/auth/export` | Export private key (2FA required) |
| GET/POST | `/api/settings` | Get/save trading settings |

### AI & Analytics
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/chat` | AI strategy chat |
| GET | `/api/chat/analyze/:mint` | Token analysis |
| GET | `/api/analytics/summary/:userId` | Performance summary |
| GET | `/api/analytics/heatmap/:userId` | Time-of-day profitability |
| GET | `/api/analytics/tokens/:userId` | Per-token breakdown |

### Token Launch
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/launch/full` | One-click full launch (Bags SDK v2) |
| POST | `/api/launch/create-token` | Create metadata only |
| GET | `/api/launch/pool/:mint` | Pool info for launched token |

### Platform
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/stats` | Live platform stats |
| GET | `/api/leaderboard` | Public rankings |
| GET | `/api/leaderboard/strategies` | Shared strategies |
| POST | `/api/leaderboard/refer` | Referral tracking |
| GET | `/api/backtest/run` | Run backtests |
| GET | `/api/narratives` | AI narrative scanner |
| GET | `/api/admin/overview` | Admin dashboard |

### Fees
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/fees/stats` | Partner fee stats |
| POST | `/api/fees/init-partner` | Init partner config |
| POST | `/api/fees/claim` | Claim partner fees |

---

## 🔒 Security

- Private keys encrypted with AES-256-GCM (per-key random IV + auth tag)
- Passwords hashed with bcrypt (cost 12)
- 2FA (TOTP) required for auth + key export
- Rate limiting on auth endpoints
- Jito MEV protection for larger trades
- Rug detection before every buy
- HTTPS enforced (Caddy + Let's Encrypt)
- Daily loss limits (circuit breaker)

---

## 📜 License

MIT

---

*Built for the Bags.fm Hackathon 2026 by [CrownLabs](https://github.com/gokhancode)*
