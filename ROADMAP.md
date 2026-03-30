# AUTOBAGS ROADMAP — The Path to Actually Being Good

> Written after 62 paper trades and -15.8% returns.
> Everything here is grounded in real data, not theory.

---

## What The Data Actually Says

### The Brutal Truth (62 trades, v2)

| Score Range | Trades | Win Rate | Avg P&L |
|-------------|--------|----------|---------|
| 70-80       | 4      | **100%** | **+9.9%** |
| 65-70       | 26     | 38%      | -1.2% |
| 60-65       | 20     | 50%      | +0.4% |
| 55-60       | 8      | 12%      | -4.9% |

The scoring system already knows who wins — we just ignored it.
Score 70+ = edge. Everything below = gambling.

### Time Of Day Is A Signal (UTC)

| Hour | Avg P&L | Verdict |
|------|---------|---------|
| 01   | +13.2%  | 🟢 Best |
| 08   | +12.8%  | 🟢 Best |
| 09   | +4.3%   | 🟢 Good |
| 13   | +5.9%   | 🟢 Good |
| 10   | -4.9%   | 🔴 Bad |
| 15   | -12.1%  | 🔴 Worst |
| 17   | -4.7%   | 🔴 Bad |
| 18   | -4.7%   | 🔴 Bad |

**Asia open (01-02 UTC) and EU pre-market (08-09 UTC) = the edge.**
US afternoon/evening (15-18 UTC) = where money goes to die.

### Volume Acceleration Is A Trap Alone
Winners averaged 4.7x vol acceleration. Losers averaged 4.7x.
Vol accel is necessary but NOT sufficient. It's a noise filter, not a signal.

### The Big Loss Problem
6 trades lost >10% each, costing -4.05 SOL — more than half of all losses.
SHARE was traded twice and lost -28.7% and -11.4%. Same token. Twice.
**The real enemy isn't bad entries — it's no memory and no blacklist.**

---

## The Roadmap

### PHASE 1 — Stop Bleeding (NOW)
*Goal: profitable or breakeven. Don't blow the account.*

**Already done in v3:**
- [x] Score threshold raised to 70+
- [x] Hard stop at -3%
- [x] Loser blacklist (never re-enter losing tokens)
- [x] Take profit raised to +15%
- [x] Max 3 positions

**Still needed:**
- [ ] **Time-gating**: Only trade 00-10 UTC and 13-14 UTC. Hard block 15-18 UTC.
  - Implement: check `new Date().getUTCHours()` before every buy
- [ ] **Slippage protection**: If a token gaps through -3% on entry, something is wrong. Check the last 5-min candle before buying — if m5 is already negative, don't enter.
- [ ] **Fix the false vol signal**: vol 🚀 6x AND big losses → add a vol/liq ratio check. If vol > 8x liquidity, that's a dump in progress, not a pump.

---

### PHASE 2 — Build Intelligence (1-2 weeks)
*Goal: learn from every trade, not just win/loss.*

The current system records trades but doesn't LEARN from them. It makes the same mistakes over and over. That changes here.

**2.1 — Feature Recording**
On every BUY, capture a full snapshot:
```
- All price signals: m5, h1, h6, h24
- Volume: vol1h, vol6h, vol24, vol/liq ratio
- Order flow: buys1h, sells1h, buys5m, sells5m
- Social: sentiment score, mention velocity, source count
- Token age, market cap, liquidity
- Time of day (UTC hour)
- Day of week
- Market regime: SOL trending up/down/flat at time of entry
```

On every SELL, record:
```
- Exit reason
- Hold duration
- PnL%
- What happened after exit (did it keep going? dump?)
- Was the stop loss a gap-down or gradual?
```

This goes into SQLite. Every single trade enriched.

**2.2 — Post-Trade Autopsy**
After each exit, run an automated analysis:
- Was this token in any social channels before the buy?
- Did the vol/liq ratio give warning?
- What was the order book like at entry?
- Was the market trending or choppy?
- Did similar setups in history win or lose?

Write findings to `data/autopsies/YYYY-MM-DD-SYMBOL.json`

**2.3 — Rolling Signal Tracker**
Every 24h, compute which signals are currently predictive:
- Rank all signals by (wins_when_true / total_when_true)
- Update signal weights in quant brain automatically
- Flag signals that have degraded (used to work, now don't)
- Surface new correlations that weren't there before

**2.4 — Market Regime Detection**
Add `regime-detector.js`:
- Check SOL price trend (DexScreener SOL/USDC pair)
- Check BTC trend (CoinGecko)
- Classify: bull, bear, choppy, breakout
- Different thresholds per regime:
  - Bull: lower score threshold (more opportunities)
  - Bear: higher threshold, smaller size, tighter SL
  - Choppy: pause trading or paper-only

---

### PHASE 3 — Pattern Mastery (2-4 weeks)
*Goal: identify winning setups BEFORE they move, not after.*

Right now we react to price. The edge is anticipating price.

**3.1 — Pre-Breakout Detection**
The best trades show:
- Volume just starting to spike (1.5-2x, not already 6x)
- Buy pressure building but not extreme yet (60-65%)
- Token age 30min-4h (new enough to still have room)
- Low h1 change (<5%) but positive m5 (early mover)

Build a `pre-breakout-detector.js` that identifies tokens in this state.
Backtesting shows tokens with these signals before the breakout > chasing after.

**3.2 — Token DNA Fingerprinting**
Analyze our winning tokens and extract their characteristics:
- Which DexScreener pairs do winners come from?
- Which token launchers (Bags.fm vs Pump.fun)?
- Which market cap ranges actually produce our TP% targets?
- Are winners boosted, profiled, or organic?

Build a `token-dna.js` that scores token origin quality.

**3.3 — Social Leading Indicators**
From the data: social signals are not integrated into scoring yet.
But the real insight is: social PRECEDES price by 5-15 minutes on memecoins.

Build a watch-list system:
1. Telegram relay mentions a token → goes to WATCHLIST
2. Bot watches it for 15 min
3. If price AND volume start moving → now score it → buy if 70+
4. If nothing happens → drop it

This is the workflow that beats humans.
They see a call in a group. They go check the chart. By the time they buy, it's up 20%.
We see the call, set a CONDITIONAL BUY: "buy this if it meets criteria in next 15 min."

**3.4 — Momentum Timing**
The question isn't "is this token moving?" — it's "where in the move are we?"

Classify every token by move phase:
- **Early** (0-15min into breakout, m5>2%, h1<5%) → high probability
- **Mid** (15-60min in, h1 5-25%) → medium probability
- **Late** (h1 > 25%, h6 > 50%) → low probability, don't touch
- **Recovery** (h1 negative, m5 turning positive) → contrarian setup, risky

Only buy Early phase entries.

---

### PHASE 4 — Compound the Edge (1-2 months)
*Goal: consistent profitability, then scale to real money.*

**4.1 — Real Backtester**
Build a proper backtester using 30 days of historical DexScreener data:
- Test every strategy tweak before deploying it live
- Never change live params without backtest proof
- Track: Sharpe ratio, max drawdown, win rate, avg hold time

Currently we "test" by risking real-ish money. That's backwards.

**4.2 — Strategy Tournament (already started)**
Keep multiple scoring variants running in parallel simulation.
Every week: kill the worst performer, mutate the best, spawn variants.
Let evolution find the edge instead of guessing.

**4.3 — Adaptive Position Sizing**
Stop using flat 15% per trade. Use Kelly criterion properly:
```
f = (WR × AvgWin - (1-WR) × AvgLoss) / AvgWin
```
Update after every 10 trades. More edge = larger bets. Less edge = smaller bets.
Currently we bet the same whether we're hot or cold. That's wrong.

**4.4 — The Compound Rule**
Once consistent profitability for 2 weeks on paper:
- Move 20% of profits to real trading (small size)
- Keep 80% paper trading to continue learning
- Scale real size only when paper AND real agree on strategy

Target: paper profitable for 14 consecutive days before touching real money at scale.

---

### PHASE 5 — Become Unkillable (ongoing)
*Goal: a system that survives market regime changes and keeps learning forever.*

**5.1 — Continuous Learning Loop**
Every trade → feature recorded → model updated → strategy adjusted.
No human intervention needed. The system evolves itself.

**5.2 — Dead Token Graveyard**
Maintain a graveyard of every token we ever lost money on:
- Symbol, mint, reasons, date
- Pattern analysis: why did we enter? what happened?
- Over time: patterns emerge in what to AVOID

**5.3 — Market Memory**
Some tokens/patterns repeat. SHARE kept showing up with 6x vol and dumping.
Build historical pattern matching: "this setup looks like X which failed 3 times before."

**5.4 — Narrative Awareness**
Memecoins run on narratives. What's the active narrative right now?
AI agents, political memes, celebrity tokens, chain-specific...
Tokens that fit the current narrative pump harder and recover faster.
Build narrative momentum tracking — is this token riding a hot narrative?

---

## The KPIs That Actually Matter

Forget P&L for now. Track these:

| KPI | Now | Phase 1 | Phase 2 | Phase 3 |
|-----|-----|---------|---------|---------|
| Win Rate | 42% | >50% | >58% | >65% |
| Avg Win | +7.9% | +10% | +12% | +15% |
| Avg Loss | -7.0% | -3.5% | -2.5% | -2.0% |
| Score Threshold | 55 | 70 | Dynamic | Predictive |
| Max Single Loss | -29.6% | -5% | -4% | -3% |
| Trades/Day | 6-10 | 2-4 | 2-5 | 3-6 |
| Profit Factor | <1 | >1.2 | >1.5 | >2.0 |

**Profit Factor = (Avg Win × Win Rate) / (Avg Loss × Loss Rate)**
Currently: (7.9 × 0.42) / (7.0 × 0.58) = 0.82 — losing money every trade on average.
Target: > 1.5 = for every $1 lost, make $1.50.

---

## What I'm Watching Every Day

1. **Win rate rolling 20 trades** — if drops below 40%, pause and review
2. **Avg loss creeping up** — single biggest killer, must stay < -4%
3. **Hour performance** — which hours are profitable THIS week?
4. **Token source quality** — are Bags.fm tokens better than DexScreener boosted?
5. **Signal decay** — are my scoring signals still working or has the market changed?

---

## The North Star

A trading bot that:
1. **Never takes a loss > -5%** (the SHARE -29% can never happen again)
2. **Wins more than it loses** (60%+ win rate)
3. **Lets winners run** (average win > 12%)
4. **Knows when NOT to trade** (time-gated, regime-aware)
5. **Learns from every single trade** (no repeated mistakes)

Not get-rich-quick. Get-smarter-every-day until the edge compounds.

---

*Last updated: 2026-03-30*
*Based on: 62 paper trades, -15.8% raw return*
*Current version: v3*
