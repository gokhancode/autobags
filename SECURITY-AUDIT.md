# AUTOBAGS Security Audit — 2026-04-02

## Summary
**Risk level: HIGH** — Multiple critical issues found. The app is publicly accessible with unauthenticated API endpoints that expose user data and allow state manipulation.

---

## 🔴 CRITICAL

### 1. Unauthenticated API endpoints (PUBLIC INTERNET)
**Severity: CRITICAL**

The following endpoints are publicly accessible at `autobags.io` with NO authentication:

| Endpoint | Method | Risk |
|---|---|---|
| `/api/sim/reset` | POST | **Anyone can reset the simulator** — confirmed working |
| `/api/chat` | POST | **AI chat with trade data** — just needs a userId string |
| `/api/chat/history/:userId` | GET | **Leaks full chat history** for any userId |
| `/api/stats` | GET | Leaks pool data, recent tokens |
| `/api/narratives` | GET | Leaks narrative scanner data |
| `/api/social/trending` | GET | Open |
| `/api/social/sentiment/:mint` | GET | Open |
| `/api/social/feed` | GET | Open |
| `/api/social/kols` | GET/POST | Open — anyone can add KOL entries |
| `/api/social/alerts` | GET | Open |
| `/api/sim/*` | GET | Leaks sim state, trades, equity |
| `/api/status` | GET | Open |
| `/api/settings/presets` | GET | Open |

**Impact:** Anyone can reset your simulator, read chat history, inject social data, and enumerate user accounts.

**Fix:** Add `requireAuth` middleware to ALL non-public endpoints. At minimum: `/api/sim/reset`, `/api/chat`, `/api/chat/history`, `/api/social/kols` (POST), `/api/social/ingest`.

### 2. config/.env contains ALL secrets in plaintext
**Severity: CRITICAL**

Located at: `/root/.openclaw/workspace/autobags/config/.env`

Contains:
- `BAGS_API_KEY` — production Bags.fm API key
- `BAGS_PARTNER_KEY` — partner key
- `X_CONSUMER_KEY` / `X_CONSUMER_SECRET` — Twitter API credentials
- `X_BEARER_TOKEN` — Twitter bearer token
- `WALLET_MASTER_KEY` — AES-256-GCM master key for wallet encryption (THE key to all wallets)
- `TELEGRAM_BOT_TOKEN` — Telegram bot token
- `JWT_SECRET` — JWT signing secret
- `GROQ_API_KEY` — Groq LLM API key

**Mitigating factor:** `.env` is in `.gitignore` and was never committed to git history. ✅
**Risk:** Anyone with shell access (or a file-read vuln) gets everything.

**Fix:** 
- File permissions: `chmod 600 config/.env` (currently 644 — world-readable)
- Consider using a secrets manager or at least restricting the file

### 3. Port 8080 publicly serving ETH dashboard — no auth
**Severity: HIGH**

`:8080` serves the entire ETH dashboard directory as static files with no authentication. This was flagged in the previous audit too.

**Fix:** Either add basic_auth (like the `/dash` route on port 443) or block port 8080 in UFW.

---

## 🟡 WARNING

### 4. UFW firewall is NOT running
**Severity: HIGH**

`ufw status` returns nothing — the firewall we configured earlier today appears to be inactive or was reset.

**Fix:** Re-enable UFW:
```bash
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

### 5. OpenClaw gateway (port 18789) binding to 0.0.0.0
**Severity: MEDIUM**

Gateway is listening on all interfaces (`0.0.0.0:18789`). Without UFW, it's publicly accessible. The Caddy reverse proxy was removed but direct access is possible.

**Fix:** Change gateway bind to `127.0.0.1` or re-enable UFW to block 18789.

### 6. Port 3500 (autobags) publicly accessible
**Severity: MEDIUM**

Autobags Express server on port 3500 is listening on all interfaces (`*:3500`). Combined with unauthenticated endpoints, this is dangerous.

**Fix:** Bind to `127.0.0.1:3500` and only expose via Caddy reverse proxy with rate limiting.

### 7. data/ files are world-readable (644)
**Severity: LOW**

All JSON files in `data/` (paper-state, trades, quant-brain, etc.) are `644`. Should be `600`.

### 8. users.json exposes password hashes and TOTP secrets
**Severity: MEDIUM**

`data/users.json` contains bcrypt password hashes and TOTP secrets in plaintext. While bcrypt is fine, TOTP secrets allow anyone to generate valid 2FA codes.

**Fix:** Migrate fully to SQLite (which is already set up), delete `data/users.json`, ensure DB file has `600` permissions.

### 9. OpenClaw security audit findings
**Severity: MEDIUM**

- `tools.exec.security=full` — exec is fully trusted (intentional, but noted)
- Telegram group `-1002505674030` has open groupPolicy with exec access
- `gateway.nodes.denyCommands` has ineffective entries (wrong command names)

---

## ✅ GOOD

- Wallet private keys are AES-256-GCM encrypted at rest ✅
- `.env` never committed to git ✅
- `.gitignore` excludes `config/.env`, `data/`, logs ✅
- SSH is key-only auth ✅
- Social ingest endpoint has auth check ✅
- Settings endpoint uses `requireAuth` ✅
- node_modules in `.gitignore` ✅

---

## 🔧 Recommended Actions (Priority Order)

1. **[CRITICAL] Fix unauthenticated endpoints** — add auth to sim/reset, chat, chat/history, social/kols POST
2. **[CRITICAL] Re-enable UFW** — it seems to have been disabled
3. **[CRITICAL] chmod 600 config/.env** — restrict secrets file
4. **[HIGH] Block or auth port 8080** — ETH dashboard exposed
5. **[MEDIUM] Bind autobags to 127.0.0.1** — don't expose directly
6. **[MEDIUM] chmod 600 data/*.json** — restrict data files
7. **[LOW] Delete data/users.json** after confirming SQLite migration is complete
8. **[LOW] Fix OpenClaw denyCommands entries** — use correct command names

---

## Audit Metadata
- **Date:** 2026-04-02T15:49 UTC
- **Auditor:** Sura (OpenClaw agent)
- **Scope:** Autobags application + VPS host security
- **VPS:** DigitalOcean 64.227.119.101
- **Domain:** autobags.io
