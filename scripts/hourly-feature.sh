#!/bin/bash
# AUTOBAGS — Hourly Feature Check + Ideas
# Runs via cron every 30min, checks v3 trading performance
# Every 4 hours spawns a sub-agent to implement a small feature

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Check if autobags is running
if ! systemctl is-active --quiet autobags; then
  echo "$(date -u): autobags not running, skipping"
  exit 0
fi

cd /root/.openclaw/workspace/autobags

# Get v3 stats
STATS=$(node -e "
const fs = require('fs');
try {
  const s = JSON.parse(fs.readFileSync('data/paper-state-v3.json','utf8'));
  const t = JSON.parse(fs.readFileSync('data/paper-trades-v3.json','utf8'));
  const recent = t.filter(x => Date.now() - new Date(x.time).getTime() < 3600000);
  const pnl = ((s.balanceSol / s.startBalanceSol - 1) * 100).toFixed(1);
  console.log(JSON.stringify({
    balance: s.balanceSol.toFixed(2),
    start: s.startBalanceSol,
    pnl: pnl + '%',
    positions: Object.keys(s.positions || {}).length,
    wins: s.wins,
    losses: s.losses,
    recentTrades: recent.length,
    lastTrade: t[t.length-1]?.symbol || 'none',
  }));
} catch(e) { console.log(JSON.stringify({error: e.message})); }
" 2>/dev/null)

echo "$(date -u): Hourly check — $STATS" >> /root/.openclaw/workspace/autobags/data/hourly-feature.log

# Every 4 hours, spawn a sub-agent to review and suggest features
# Use 10# prefix to avoid bash octal interpretation of 08/09
HOUR=$(date -u +%H)
if [ $((10#$HOUR % 4)) -eq 0 ]; then
  openclaw cron run --task "Review AUTOBAGS trading bot at /root/.openclaw/workspace/autobags. Check: 1) data/paper-state-v3.json for current performance, 2) data/paper-trades-v3.json for recent trades, 3) data/quant-brain.json for signal quality, 4) ROADMAP.md for next features. Pick ONE small improvement from the roadmap, implement it in the codebase, test it compiles (node -c), commit to git, and update DEVLOG.md with a new entry. Keep changes small and safe — don't break trading. The main bot file is src/bot/paper-trader-v3.js." --model sonnet 2>/dev/null || true
fi
