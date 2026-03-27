# 🔐 Account & 2FA

## Account basics

Your AUTOBAGS account consists of:
- A **username** — your login identifier
- A **password** — hashed with bcrypt (never stored in plain text)
- A **custodial Solana wallet** — generated and encrypted on your behalf
- A **TOTP 2FA secret** — used for login and sensitive actions

***

## Why 2FA is required

AUTOBAGS uses 2FA (Time-based One-Time Passwords) for two reasons:

1. **Login security** — prevents unauthorized access even if your password is compromised
2. **Key export** — every private key export requires a fresh 2FA code

We use **TOTP** (the same standard as Google Authenticator), which works offline and doesn't require your phone number.

***

## Setting up 2FA

When you sign up, you'll see a QR code. Scan it with any TOTP app:

| App | Platform |
|---|---|
| Google Authenticator | iOS / Android |
| Authy | iOS / Android / Desktop |
| 1Password | All platforms |
| Bitwarden | All platforms |

After scanning, enter the 6-digit code to confirm. Your account is now active.

***

## Logging in

1. Enter username + password
2. If 2FA is enabled, you'll be prompted for your 6-digit code
3. Sessions last 7 days — you won't need to log in again unless you clear your browser

***

## Lost 2FA access?

Currently, 2FA recovery requires contacting support at **apps@autobags.io**. We'll verify your identity before resetting access.

{% hint style="danger" %}
**Export your private key as a backup.** If you export your key to Phantom or another wallet, you retain access to your funds even without AUTOBAGS account access.
{% endhint %}
