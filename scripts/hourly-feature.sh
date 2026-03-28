#!/bin/bash
# AUTOBAGS — Hourly Feature Check + Ideas
# Runs via cron every hour, checks trading performance and suggests improvements
# Uses openclaw cron run to spawn a sub-agent

export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Check if autobags is running
if ! systemctl is-active --quiet autobags; then
  echo "autobags not running, skipping"
  exit 0
fi

# Get current stats
cd /root/.openclaw/workspace/autobags
BALANCE=$(node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('data/positions.json','utf8'));
const t = JSON.parse(fs.readFileSync('data/trades.json','utf8'));
const recentTrades = t.filter(x => Date.now() - new Date(x.timestamp).getTime() < 3600000);
console.log(JSON.stringify({
  openPositions: Object.keys(p.testacc || {}).length,
  totalTrades: t.length,
  recentTrades: recentTrades.length,
  lastTrade: t[t.length-1]?.symbol || 'none',
}));
" 2>/dev/null)

# Log the check
echo "$(date -u): Hourly check — $BALANCE" >> /root/.openclaw/workspace/autobags/data/hourly-feature.log

# Every 4 hours, spawn a sub-agent to review and suggest features
HOUR=$(date -u +%H)
if [ $((HOUR % 4)) -eq 0 ]; then
  openclaw cron run --task "Review AUTOBAGS trading bot at /root/.openclaw/workspace/autobags. Check: 1) data/trades.json for recent performance, 2) data/quant-brain.json for signal quality, 3) ROADMAP.md for next features. Pick ONE small improvement from the roadmap, implement it in the codebase, test it works, commit to git, and update DEVLOG.md with a new entry. Keep changes small and safe — don't break trading." --model sonnet 2>/dev/null || true
fi
