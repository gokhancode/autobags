# 📊 Reading Your Dashboard

Your dashboard shows a real-time view of your account, trades, and bot status.

***

## Cards

### Balance (SOL)
Your current on-chain SOL balance, fetched live from the Solana blockchain. Updates every page load.

### Total P&L
Cumulative profit/loss across all closed trades, denominated in SOL.
- 🟢 Green = net positive
- 🔴 Red = net negative

### Total trades
Number of completed round-trips (buy + sell pairs) executed by the bot.

### Win rate
Percentage of trades that closed with a positive P&L.

***

## Deposit address

Your unique Solana wallet address. Send SOL here to fund your trading account. The address never changes.

Use the **Copy** button to copy it to your clipboard.

***

## Bot settings

Toggle the bot on/off and configure your trading mode. Changes take effect on the next tick (within 60 seconds).

***

## Recent trades

A table showing your last 10 trades with:
- Token symbol
- Trade type (BUY / SELL)
- SOL amount
- P&L (if closed)
- Timestamp

***

## Export private key

Located at the bottom of the dashboard. Requires a fresh **2FA code** every time — the key is never cached or stored in your browser.

See [Exporting Your Wallet](../security/export-wallet.md) for details.
