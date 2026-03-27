# ⚡ Advanced Mode

Advanced mode gives you full control over every trading parameter. Recommended for users who understand memecoin trading mechanics.

***

## Parameters

### Stop loss `%`
**Range:** 1–50% | **Default:** 8%

The maximum loss you're willing to take on a position before the bot exits. Set lower for tighter risk control, higher if you want to weather more volatility.

```
Example: 8% stop loss on a 0.1 SOL trade = exit if value drops to 0.092 SOL
```

***

### Take profit `%`
**Range:** 5–200% | **Default:** 25%

The gain at which the bot fully exits a position.

```
Example: 25% take profit on a 0.1 SOL trade = exit at 0.125 SOL
```

***

### Partial exit `%`
**Range:** 5–50% | **Default:** 10%

When the position reaches this gain, the bot sells 30% of your holdings — locking in profit while staying exposed to further upside.

```
Example: partial exit at +10% → sell 30% → remaining 70% runs to take profit
```

***

### Max deploy `%` of balance
**Range:** 10–100% | **Default:** 80%

The maximum percentage of your SOL balance used per trade. The rest stays as reserve.

{% hint style="warning" %}
Always keep at least 0.05 SOL in reserve for gas. The bot enforces this automatically.
{% endhint %}

***

### Min intel score `/ 100`
**Range:** 0–100 | **Default:** 65

The minimum token score required before the bot will buy. Higher = more selective = fewer but safer trades.

| Score range | Meaning |
|---|---|
| 80–100 | Very safe, high-confidence picks |
| 60–79 | Balanced — filters obvious rugs |
| 40–59 | Aggressive — more trades, more risk |
| 0–39 | Not recommended |

***

### Slippage `bps`
**Range:** 10–1000 bps | **Default:** 100 bps (1%)

Maximum price slippage accepted on swaps. Higher slippage = higher chance of trade filling, but worse execution price.

```
100 bps = 1% slippage tolerance
```

***

### Max positions
**Options:** 1, 2, 3 | **Default:** 1

How many tokens the bot can hold simultaneously. More positions = more diversification but more complexity.

{% hint style="info" %}
Starting with 1 position is strongly recommended until you're comfortable with the bot's behavior.
{% endhint %}

***

## Example config (aggressive)

```json
{
  "stopLossPct": 10,
  "takeProfitPct": 50,
  "partialExitPct": 15,
  "maxSolPerTrade": 90,
  "minIntelScore": 58,
  "slippageBps": 200,
  "maxPositions": 2
}
```
