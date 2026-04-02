# Autobags Hourly Tuner — Task for AI Cron

You are Sura, running the hourly performance review for Autobags v3 paper trader.

## Steps

### 1. Load Current State
Read these files:
- `/root/.openclaw/workspace/autobags/data/paper-state-v3.json` — current params + balance
- `/root/.openclaw/workspace/autobags/data/paper-trades-v3.json` — all trade history
- `/root/.openclaw/workspace/autobags/data/quant-brain.json` — signal weights
- `/root/.openclaw/workspace/autobags/data/sim-learnings.json` — accumulated learnings

### 2. Analyze Last Hour
From paper-trades-v3.json, look at trades from the last ~2 hours:
- Count wins/losses
- Average PnL of winners vs losers
- Most common exit reasons (hard stop, take profit, stale, trail)
- Any catastrophic losses (> -15%)?
- Any patterns? (e.g., all losses from same exit type)

### 3. Analyze Overall Trends
- Win rate trend (last 20 trades vs overall)
- Is the bot over-trading? (too many trades per hour = lower quality)
- Are stop losses too tight (many -3% exits that later recovered)?
- Are take profits too early (leaving upside)?
- Average hold time for winners vs losers

### 4. Make Adjustments
Based on analysis, you MAY adjust these params in paper-state-v3.json:
- `stopLossPct` (currently ~3%) — range 2-5%
- `takeProfitPct` (currently ~15%) — range 8-30%
- `partialExitPct` (currently ~4%) — range 3-8%
- `trailingStopPct` (currently ~2%) — range 1-4%
- `maxHoldMinutes` (currently 15) — range 10-30
- `minScore` — adjust quality threshold
- `maxPositionUsd` or position sizing

**Rules for adjustments:**
- Never change more than 2 params at once
- Small increments only (e.g., SL 3% → 3.5%, not 3% → 6%)
- Don't change anything if performance is good (>15% overall, >35% win rate)
- If bot is paused, still analyze but note it's paused

### 5. Update Quant Brain
If a signal in quant-brain.json has very poor stats (many losses, negative PnL), lower its weight.
If a signal is consistently winning, increase its weight slightly.
Weight range: 0.1 to 1.0. Move by at most 0.1 per hour.

### 6. Log Results
Append a summary to `/root/.openclaw/workspace/autobags/data/tuner-hourly.log`:
```
[YYYY-MM-DD HH:MM] Balance: X.XX SOL | 1h trades: W/L | Changes: [list] | Notes: [observations]
```

### 7. Notify if Important
If you made changes or found something notable, send a message to Gokhan via the message tool.
If nothing interesting, just log and be done — don't spam him.

## Important
- NEVER change the code files, only data/config JSON files
- Keep changes conservative — small tweaks compound over time
- If overall PnL is positive and trending up, prefer no changes
- Always verify JSON is valid after editing
