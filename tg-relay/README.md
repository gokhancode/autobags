# 🔌 AUTOBAGS TG Relay

Local Telegram relay that reads your groups and pipes crypto mentions to the autobags VPS.

**Your Telegram session stays on YOUR machine. The VPS never sees your credentials.**

## Setup (2 minutes)

### 1. Get Telegram API credentials
Go to https://my.telegram.org/apps → create an app → note `api_id` and `api_hash`.

### 2. Configure
```bash
cp .env.example .env
# Edit .env with your api_id, api_hash, and autobags secret
```

### 3. Install & authenticate
```bash
npm install
node auth.js
# Enter your phone number, paste the code from Telegram
```

### 4. Pick groups to monitor
```bash
node list-groups.js
# Copy group IDs into .env → MONITOR_GROUPS
```

### 5. Run the relay
```bash
node relay.js
```

## What it does

- ✅ Reads messages from your Telegram groups
- ✅ Filters for crypto-relevant content (contract addresses, $tickers, keywords)
- ✅ Detects alpha calls (buy signals, new launches)
- ✅ Batches and sends to autobags VPS over HTTPS
- ✅ Tracks stats (top tokens, top groups)
- ❌ Never sends messages as you
- ❌ Never joins/leaves groups
- ❌ Never reads DMs (groups only)

## Security

- Session token stored in `session.txt` — **keep this file safe**
- Add `session.txt` to `.gitignore` (already done)
- The relay is **100% read-only** — no write operations on your account
- VPS receives only filtered message content, not your auth tokens
- Kill it anytime with Ctrl+C

## Running in background

```bash
# With PM2
npm install -g pm2
pm2 start relay.js --name tg-relay
pm2 save

# Or just screen/tmux
screen -S tg-relay
node relay.js
# Ctrl+A, D to detach
```
