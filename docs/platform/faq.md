# ❓ FAQ

## General

**Is AUTOBAGS free to use?**
There's no subscription fee. We charge 1.5% per trade, only when the bot executes. See [Fees](fees.md).

**Do I need crypto experience?**
No. You don't need an existing wallet or any blockchain knowledge. AUTOBAGS handles everything. Just sign up, deposit SOL, and pick a risk level.

**Which tokens does the bot trade?**
Only tokens listed on [Bags.fm](https://bags.fm) with sufficient liquidity. The bot avoids new tokens that fail safety checks.

***

## Trading

**Why hasn't the bot traded yet?**
A few reasons:
- No tokens passed the intel score threshold
- Your balance is below 0.05 SOL (minimum)
- The bot is set to inactive in settings
- Market conditions are unfavorable (nothing worth buying)

The bot is selective by design. Fewer trades is often better than bad trades.

**Can I lose all my money?**
Yes. Memecoin trading is high-risk. Stop losses protect against large losses but can't prevent all losses. Never deposit more than you can afford to lose.

**What's the difference between Basic and Advanced mode?**
Basic mode uses preset risk profiles (Low/Medium/High). Advanced mode lets you configure every parameter manually. See [Basic Mode](../trading/basic-mode.md) and [Advanced Mode](../trading/advanced-mode.md).

**Can I run the bot on multiple accounts?**
Yes — each account is independent with its own wallet, settings, and trade history.

***

## Security

**Who controls my funds?**
You do. AUTOBAGS holds your encrypted private key and trades on your behalf, but you can export your key and take full self-custody at any time.

**What if AUTOBAGS shuts down?**
Export your private key. Your funds are on the Solana blockchain — they exist regardless of whether AUTOBAGS is running.

**Is my password stored in plain text?**
No. Passwords are hashed with bcrypt (cost factor 12) and the hash is what's stored. The original password is never saved.

**Can AUTOBAGS staff access my funds?**
Technically, the server holds your encrypted key. However, the master encryption key is stored in environment variables and never shared. We have a strict no-access policy.

***

## Technical

**What blockchain does AUTOBAGS use?**
Solana mainnet only.

**Which DEX does the bot use?**
Bags.fm (Dynamic Bonding Curve pools) via the Bags API, with Jupiter as the swap aggregator.

**How do I check my transactions?**
Find your wallet address on the dashboard and look it up on [Solscan](https://solscan.io) or [Solana Explorer](https://explorer.solana.com).

**Is there an API?**
Yes. See [Architecture](architecture.md) for all endpoints. The API is public — authentication is JWT-based.

***

## Support

For help, reach out at **apps@autobags.io** or join the conversation on X: [@autobagsapp](https://x.com/autobagsapp).
