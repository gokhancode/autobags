# 🔒 How Your Keys Are Protected

Security is built into AUTOBAGS at every layer. Here's exactly how your private keys are handled.

***

## Key generation

When you sign up, AUTOBAGS generates a fresh **Solana keypair** using cryptographically secure random bytes (`crypto.randomBytes`). The keypair is unique to your account and never reused.

***

## Encryption at rest

Your private key is **never stored in plain text**. It's encrypted using:

- **Algorithm:** AES-256-GCM (authenticated encryption)
- **Key derivation:** SHA-256 of the master encryption key
- **IV:** 12 random bytes, unique per encryption
- **Auth tag:** 16 bytes, prevents tampering

```
Encrypted key = { iv, authTag, encryptedData }
```

The **master encryption key** lives only in the server's environment variables — never in the database, never in git, never logged.

***

## What's stored where

| Data | Location | Encrypted? |
|---|---|---|
| Encrypted private key | Server filesystem | ✅ AES-256-GCM |
| Master encryption key | `.env` file only | N/A (env only) |
| Public key | Server + browser | Not sensitive |
| Password | Server | ✅ bcrypt (cost 12) |
| 2FA secret | Server | Stored (access-controlled) |
| JWT session | Browser localStorage | Signed HS256 |

***

## What we never do

- ❌ Store private keys in plain text
- ❌ Send private keys over the wire (except on explicit export with 2FA)
- ❌ Log private keys
- ❌ Commit keys to git (`.gitignore` enforced)
- ❌ Store keys in a database

***

## Transport security

All traffic to `autobags.io` uses **TLS 1.2/1.3** (enforced by Caddy). HTTP is automatically redirected to HTTPS. The SSL certificate is issued by Let's Encrypt and auto-renewed.

***

## 2FA protection

Sensitive actions require a fresh **TOTP code** from your authenticator app:
- Exporting your private key
- (Future: changing password, withdrawals above threshold)

This ensures that even if someone steals your session token, they can't extract your key without physical access to your phone.
