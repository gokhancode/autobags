# 💰 Fees

AUTOBAGS keeps fees simple and transparent. Everything is verifiable on-chain.

***

## Platform fee

**1.5% per trade**, charged on the input amount of each swap.

This fee is collected via the **Bags.fm fee-sharing mechanism** — embedded directly in the swap transaction using our registered partner key. It's deducted automatically; you never need to approve it separately.

```
Example:
  Trade size:    0.1 SOL
  Platform fee:  0.0015 SOL (1.5%)
  Net deployed:  0.0985 SOL
```

***

## Gas fees

Solana transaction fees are approximately **0.000005 SOL** (~$0.0004 at current prices) per transaction. These are negligible and paid from your wallet balance automatically.

***

## Bags.fm fees

Trades on Bags.fm (via the Dynamic Bonding Curve) include a small protocol fee set by Bags. This is separate from the AUTOBAGS platform fee and goes to the Bags protocol. See [Bags.fm docs](https://docs.bags.fm) for current rates.

***

## No subscription fee

AUTOBAGS has **no monthly subscription**. You only pay when the bot trades. If the bot is idle (no good tokens found), you pay nothing.

***

## Fee transparency

All fees are on-chain and verifiable:
- Every swap transaction is visible on [Solscan](https://solscan.io)
- Partner fee receipts are stored on-chain under our partner key: `6gHcmjabWroMi3vMaKEpKfWhG5uBZzgR958b1huMzhSp`
- Total fees collected are queryable via the Bags API at any time

***

## Summary

| Fee type | Amount | Who receives it |
|---|---|---|
| Platform fee | 1.5% per trade | AUTOBAGS (via Bags fee share) |
| Solana gas | ~0.000005 SOL | Solana validators |
| Bags protocol fee | Variable | Bags.fm protocol |
