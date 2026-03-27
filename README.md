# AUTOBAGS 🤖💰

> **Your bags, on autopilot.**

An AI-powered Solana memecoin trading agent built on [Bags.fm](https://bags.fm).

Subscribe, deposit SOL, and let the agent trade for you — powered by real-time intel scoring, Jupiter swaps, and battle-tested entry/exit logic.

## How it works

1. Connect your wallet via the web app
2. Deposit SOL into the managed pool
3. The AI agent scouts trending tokens, scores them for safety and momentum, and executes swaps on your behalf
4. Earn proportional returns. Agent earns a fee share per trade.

## Stack

- **Backend:** Node.js + Express
- **Swaps:** Jupiter Aggregator
- **Wallet auth:** Privy
- **Chain:** Solana
- **Platform:** Bags.fm App Store
- **Intel:** DexScreener + RugCheck + CoinGecko + Birdeye

## Categories (Bags Hackathon)

- ✅ AI Agents
- ✅ Fee Sharing
- ✅ Bags API
- ✅ DeFi

## Roadmap

- [ ] Phase 1: Bags API integration + project token
- [ ] Phase 2: Core bot as a service (multi-wallet)
- [ ] Phase 3: Web dashboard (Privy auth, live P&L)
- [ ] Phase 4: Bags App Store listing
- [ ] Phase 5: Traction & growth

## Dev

```bash
npm install
cp config/example.env config/.env
npm run dev
```
