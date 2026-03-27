# 📤 Exporting Your Wallet

AUTOBAGS is non-custodial in spirit — you can take full self-custody of your wallet at any time.

***

## How to export

1. Log in to [autobags.io](https://autobags.io)
2. Scroll to the bottom of your dashboard
3. In the **"Export private key"** section, enter your current **2FA code**
4. Click **"Export key"**
5. Your **base58-encoded private key** is shown on screen

{% hint style="danger" %}
**This is your full private key.** Anyone who has it controls your wallet and all funds in it. Do not share it, screenshot it in a shared environment, or store it in plain text.
{% endhint %}

***

## Importing into a wallet

Your exported key is in **base58 format**, which is directly compatible with:

### Phantom
1. Open Phantom → Settings → Add/Connect Wallet
2. Select "Import Private Key"
3. Paste your key

### Solflare
1. Open Solflare → Add Wallet
2. Select "Access by Private Key"
3. Paste your key

### Backpack
1. Open Backpack → Settings → Wallets → Add Wallet
2. Select "Import wallet" → "Private key"
3. Paste your key

***

## What happens after export?

Nothing changes on the AUTOBAGS side. The bot continues trading with your wallet as normal — you just now also have the key in your own wallet app. You can:

- Watch your balance in Phantom/Solflare
- Send funds out manually
- Stop the bot and withdraw at any time

***

## Security during export

- The key is **never stored in your browser** — it appears on screen only, never in localStorage or cookies
- Each export requires a **fresh 2FA code** — old codes are rejected
- The key is transmitted over TLS (HTTPS only)
- Server logs never record the exported key value

{% hint style="info" %}
**Best practice:** export your key once when you first sign up, store it in a password manager (1Password, Bitwarden), and use it as a backup in case you ever lose 2FA access.
{% endhint %}
