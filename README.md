# 🤖 AUTOBAGS — Your bags, on autopilot.

**AI-powered Solana memecoin trading agent built on [Bags.fm](https://bags.fm)**

> Every trade goes through Bags. Every fee benefits the ecosystem. Every decision is AI-driven.

🌐 **Live:** [autobags.io](https://autobags.io)
📖 **Docs:** [GitBook](https://docs.autobags.io) (via `/docs`)

---

## 🎒 Bags.fm Integration (Deep)

AUTOBAGS is built **on top of** Bags.fm, not just alongside it. Every core function uses the Bags API:

| Feature | Bags API Endpoint | Description |
|---|---|---|
| **Token Discovery** | `GET /token-launch/feed` | Discover trending tokens from Bags launches |
| **Trade Quotes** | `GET /trade/quote` | Get best swap prices via Bags routing |
| **Swap Execution** | `POST /trade/swap` | Build swap transactions through Bags |
| **Transaction Submit** | `POST /solana/send-transaction` | Submit signed txs via Bags RPC |
| **Fee Sharing** | Partner key in every swap | 1.5% fee on every trade goes to Bags ecosystem |
| **Partner Config** | `POST /fee-share/partner-config/creation-tx` | On-chain partner setup |
| **Fee Claiming** | `POST /token-launch/claim-txs/v3` | Claim accumulated partner fees |
| **Pool Analytics** | `GET /solana/bags/pools/:mint` | Pool details for scoring (Bags pool = bonus) |
| **Token Launch** | `POST /token-launch/create-launch-transaction` | Launch tokens directly via Bags |
| **Pool Stats** | `GET /solana/bags/pools` | Live platform stats |

### Hackathon Categories
- ✅ **AI Agents** — Automated scoring + trading bot with 10+ data signals
- ✅ **Fee Sharing** — 1.5% per trade via on-chain partner key
- ✅ **Bags API** — 10+ endpoints used across the entire platform

---

## ✨ Features

### Trading Engine
- 🧠 **AI Intel Scoring** — 10-signal scoring engine (RugCheck, liquidity, whale activity, social, momentum, holder distribution, Bags pool presence)
- ⚡ **15-second tick** — Scans 150+ tokens every 15 seconds
- 🎯 **Smart exits** — Stop loss, take profit, partial exits, momentum detection
- 🤖 **AI Trade Explanations** — Every trade gets a Groq-powered (Llama 3.3 70B) explanation

### User Features
- 🔒 **Custodial wallets** — AES-256-GCM encrypted, exportable with 2FA
- ⚙️ **Basic + Advanced mode** — Risk presets or full parameter control
- 📊 **Live dashboard** — Portfolio value, equity curve, open positions, trade history
- 🌓 **Light/Dark mode**
- 📱 **Telegram alerts** — Real-time buy/sell notifications
- 🔑 **Wallet export** — Take self-custody anytime (2FA-gated)

### Advanced Settings
- Daily loss limit
- Trading hours (UTC)
- Cooldown after loss
- Token age filter (min/max)
- Market cap filter
- Blacklist
- Auto-compound
- Slippage control
- Max positions (1-3)

### Admin Panel
- Platform-wide overview (users, AUM, P&L, win rate)
- Fee revenue dashboard (Bags partner stats)
- User management (pause/resume bots)
- Force sell positions
- System health monitoring

---

## 🏗️ Architecture

```
User → HTTPS (Caddy) → Express API → Bags.fm API → Solana
                                    ↘ Intel Scorer (Python)
                                    ↘ Data Sources (DexScreener, CoinGecko)
                                    ↘ Groq AI (Trade Explanations)
```

**Stack:** Node.js, Express, Solana web3.js, Python (intel scorer), Caddy, systemd
**Data:** JSON files (production: SQLite migration planned)
**Auth:** bcrypt + TOTP 2FA + JWT (7-day sessions)
**Encryption:** AES-256-GCM for private keys

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
- `WALLET_MASTER_KEY` — AES encryption key (generate: `python3 -c "import secrets; print(secrets.token_hex(32))"`)
- `JWT_SECRET` — session signing key
- `GROQ_API_KEY` — from [console.groq.com](https://console.groq.com) (free)

---

## 📄 API Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/signup` | — | Create account + wallet |
| POST | `/api/auth/verify-2fa` | — | Enable 2FA |
| POST | `/api/auth/login` | — | Login (password + 2FA) |
| GET | `/api/auth/me` | JWT | Session info |
| POST | `/api/auth/export` | JWT+2FA | Export private key |
| GET | `/api/settings` | JWT | Get settings |
| POST | `/api/settings` | JWT | Save settings |
| GET | `/api/portfolio/:userId` | — | Balance + P&L |
| GET | `/api/portfolio/:userId/equity` | — | Equity curve data |
| POST | `/api/sell` | JWT | Manual sell position |
| GET | `/api/trades` | — | Trade history |
| GET | `/api/stats` | — | Live platform stats |
| GET | `/api/fees/stats` | JWT | Partner fee stats |
| POST | `/api/fees/init-partner` | JWT | Init partner config |
| POST | `/api/fees/claim` | JWT | Claim partner fees |
| POST | `/api/launch/create-token` | JWT | Create token info |
| POST | `/api/launch/execute` | JWT | Launch token on Bags |
| GET | `/api/admin/overview` | JWT | Admin dashboard data |

---

## 📊 Fee Model

| Fee | Amount | Recipient |
|---|---|---|
| Platform fee | 1.5% per trade | AUTOBAGS (via Bags partner key) |
| Solana gas | ~0.000005 SOL | Validators |
| Bags protocol | Variable | Bags.fm |

No subscription. No setup cost. Pay only when the bot trades.

---

## 🔒 Security

- Private keys encrypted with AES-256-GCM
- Passwords hashed with bcrypt (cost 12)
- 2FA (TOTP) for auth + key export
- Rate limiting on auth endpoints
- Input validation + sanitization
- No X-Powered-By or server headers exposed
- HTTPS enforced (Caddy + Let's Encrypt)

---

## 📜 License

MIT

---

*Built for the Bags.fm Hackathon Q1 2026 by [CrownLabs](https://github.com/gokhancode)*
