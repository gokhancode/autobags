# 🏗️ Architecture

A technical overview of how AUTOBAGS is built.

***

## Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express |
| Blockchain | Solana (mainnet) |
| Swap routing | Bags.fm API + Jupiter Aggregator |
| Wallet auth | Privy-compatible custodial system |
| Encryption | AES-256-GCM (Node.js `crypto`) |
| 2FA | TOTP via `speakeasy` (RFC 6238) |
| Auth tokens | JWT (HS256, 7-day expiry) |
| Frontend | Vanilla HTML/CSS/JS (no framework) |
| Reverse proxy | Caddy (auto HTTPS) |
| Process manager | systemd |
| Hosting | DigitalOcean VPS |

***

## Data flow

```
User browser
    │
    ▼ HTTPS (TLS 1.3)
Caddy reverse proxy (autobags.io:443)
    │
    ▼
Express API (localhost:3500)
    │
    ├─► Bags.fm API (token feed, quotes, swaps)
    ├─► Solana RPC (balance, tx confirmation)
    ├─► DexScreener API (market data)
    ├─► CoinGecko API (sentiment)
    └─► RugCheck API (safety scoring)
```

***

## Bot architecture

```
Agent loop (60s interval)
    │
    ├─ 1. Scout
    │       └─► Bags token feed + trend-scout.sh
    │
    ├─ 2. Score (intel.py)
    │       ├─► RugCheck safety
    │       ├─► Volume/liquidity ratio
    │       ├─► Holder distribution
    │       └─► Social presence
    │
    ├─ 3. Filter (minIntelScore threshold)
    │
    ├─ 4. Quote (Bags API /trade/quote)
    │
    ├─ 5. Execute swap
    │       ├─► createSwapTransaction (partner key embedded)
    │       ├─► sign(userKeypair)
    │       └─► sendTransaction
    │
    └─ 6. Monitor position
            ├─► Stop loss trigger
            ├─► Take profit trigger
            ├─► Partial exit trigger
            └─► Momentum / smart exit
```

***

## Storage

All data is stored as JSON files on the server filesystem:

| File | Contents |
|---|---|
| `data/users.json` | Username, password hash, TOTP secret, wallet public key |
| `data/wallets.enc.json` | AES-256-GCM encrypted private keys |
| `data/settings.json` | Per-user trading configuration |
| `data/subscribers.json` | Subscriber metadata + P&L |
| `data/trades.json` | Trade history |

All sensitive files are excluded from git via `.gitignore`.

***

## API endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/signup` | None | Create account |
| POST | `/api/auth/verify-2fa` | None | Enable 2FA |
| POST | `/api/auth/login` | None | Login + JWT |
| GET | `/api/auth/me` | JWT | Session info |
| POST | `/api/auth/export` | JWT + 2FA | Export private key |
| GET | `/api/settings` | JWT | Get settings |
| POST | `/api/settings` | JWT | Save settings |
| GET | `/api/portfolio/:userId` | None | Balance + P&L |
| GET | `/api/trades` | None | Recent trades |
| GET | `/api/stats` | None | Live platform stats |
| GET | `/api/status` | None | Health check |
