# 🤖 How the Bot Works

The AUTOBAGS agent runs every 60 seconds and follows a strict pipeline before executing any trade.

***

## The trading loop

```
Every 60 seconds:
  
  1. SCOUT      → fetch trending tokens from Bags.fm + DexScreener
  2. SCORE      → run intel scoring on each candidate  
  3. FILTER     → drop anything below your minimum score
  4. QUOTE      → get live trade quote from Bags API
  5. BUY        → execute swap via Jupiter on Bags.fm
  6. MONITOR    → watch position every tick
  7. EXIT       → sell on stop loss, take profit, or momentum exit
```

***

## Token scouting

The bot discovers tokens from multiple sources simultaneously:

- **Bags.fm token feed** — 100 most recently launched tokens
- **DexScreener boosted** — tokens with active marketing spend
- **Trend scout** — cross-referencing volume spikes and new listings

***

## Intel scoring (0–100)

Every candidate is scored before a buy decision. The score combines:

| Signal | Weight | Description |
|---|---|---|
| Safety (RugCheck) | 30% | Contract safety, no freeze/mint authority |
| Liquidity depth | 20% | Min $10k liquidity to avoid slippage |
| Volume/liquidity ratio | 15% | Organic vs pumped volume |
| Holder distribution | 15% | No whale concentration >20% |
| Social presence | 10% | Twitter, website, CoinGecko listing |
| Momentum | 10% | 5m price action and buy pressure |

Tokens below your **minimum intel score** (default: 65) are skipped entirely.

***

## Entry

Once a token passes scoring:
1. A live quote is fetched from the Bags API (via Dynamic Bonding Curve)
2. The swap transaction is constructed with your **partner fee** embedded
3. The transaction is signed with your wallet's keypair and submitted

Only **one position** is held at a time by default (configurable in Advanced mode).

***

## Position management

After buying, the bot monitors the position every tick:

| Trigger | Action |
|---|---|
| Price up +10% | Secure 30% (partial exit) |
| Price up +25% | Full exit — take profit |
| Price down -8% | Full exit — stop loss |
| Volume collapses | Smart exit (momentum exit) |
| Whale dumping detected | Emergency exit |
| Liquidity trap detected | Blocked — never bought |

***

## Exit

Sells are executed the same way as buys — via Bags API swap, Jupiter routing. The P&L is recorded and visible on your dashboard.
