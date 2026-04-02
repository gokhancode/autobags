/**
 * KOL Wallet Watcher — Real-time Solana tx monitoring via WebSocket
 * Alerts instantly when tracked wallets make swaps/transfers
 */
const { Connection, PublicKey } = require('@solana/web3.js');

const WALLETS = {
  'FixmSpsBa7ew26gWdiqpoMAgKRFgbSXFbGAgfMZw67X': 'Marcell',
};

// WSS endpoint — mainnet public works for subscriptions
const WS_URL = process.env.SOLANA_WS_URL || 'wss://api.mainnet-beta.solana.com';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Telegram alert
const TG_BOT_TOKEN = process.env.TG_BOT_TOKEN;
const TG_CHAT_ID = process.env.TG_CHAT_ID || '1918005725';

const conn = new Connection(RPC_URL, {
  wsEndpoint: WS_URL,
  commitment: 'confirmed',
});

// Dedup: track recently seen signatures
const seenSigs = new Set();
const MAX_SEEN = 500;

async function sendTelegramAlert(msg) {
  if (!TG_BOT_TOKEN) {
    console.log('[ALERT]', msg);
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT_ID,
        text: msg,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
  } catch (e) {
    console.error('TG send failed:', e.message);
  }
}

async function parseTx(signature, walletName, walletAddr) {
  try {
    const tx = await conn.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
    
    if (!tx || !tx.meta) return null;
    
    const preBalances = tx.meta.preTokenBalances || [];
    const postBalances = tx.meta.postTokenBalances || [];
    
    // Find token changes for our wallet
    const walletIndex = tx.transaction.message.accountKeys.findIndex(
      k => k.pubkey.toString() === walletAddr
    );
    
    if (walletIndex === -1) return null;
    
    // SOL change
    const solChange = (tx.meta.postBalances[walletIndex] - tx.meta.preBalances[walletIndex]) / 1e9;
    
    // Token changes
    const tokenChanges = [];
    const preMap = {};
    const postMap = {};
    
    for (const b of preBalances) {
      if (b.owner === walletAddr) {
        preMap[b.mint] = b.uiTokenAmount.uiAmount || 0;
      }
    }
    for (const b of postBalances) {
      if (b.owner === walletAddr) {
        postMap[b.mint] = b.uiTokenAmount.uiAmount || 0;
      }
    }
    
    const allMints = new Set([...Object.keys(preMap), ...Object.keys(postMap)]);
    for (const mint of allMints) {
      const pre = preMap[mint] || 0;
      const post = postMap[mint] || 0;
      const diff = post - pre;
      if (Math.abs(diff) > 0.0001) {
        tokenChanges.push({ mint, pre, post, diff });
      }
    }
    
    if (tokenChanges.length === 0 && Math.abs(solChange) < 0.001) return null;
    
    return { solChange, tokenChanges, signature };
  } catch (e) {
    console.error('Parse error:', e.message);
    return null;
  }
}

async function resolveTokenName(mint) {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    const d = await r.json();
    if (d.pairs && d.pairs[0]) {
      const p = d.pairs[0];
      return {
        symbol: p.baseToken.symbol,
        name: p.baseToken.name,
        mc: p.marketCap || p.fdv || 0,
        price: p.priceUsd,
        url: p.url,
      };
    }
  } catch (e) {}
  return { symbol: mint.slice(0, 6) + '...', name: 'Unknown', mc: 0, price: '?', url: null };
}

async function handleTx(signature, walletName, walletAddr) {
  if (seenSigs.has(signature)) return;
  seenSigs.add(signature);
  if (seenSigs.size > MAX_SEEN) {
    const first = seenSigs.values().next().value;
    seenSigs.delete(first);
  }
  
  console.log(`[${new Date().toISOString()}] ${walletName} tx: ${signature}`);
  
  const parsed = await parseTx(signature, walletName, walletAddr);
  if (!parsed) return;
  
  const { solChange, tokenChanges } = parsed;
  
  // FAST ALERT — send immediately with full CA for copy-paste
  let fastLines = [`🔔 <b>${walletName} Trade</b>\n`];
  
  for (const tc of tokenChanges) {
    const action = tc.diff > 0 ? '🟢 BUY' : '🔴 SELL';
    const amount = Math.abs(tc.diff).toLocaleString('en-US', { maximumFractionDigits: 2 });
    fastLines.push(`${action} ${amount}`);
    fastLines.push(`<code>${tc.mint}</code>`);
  }
  
  if (Math.abs(solChange) > 0.001) {
    fastLines.push(`\nSOL: ${solChange > 0 ? '+' : ''}${solChange.toFixed(4)} SOL`);
  }
  fastLines.push(`<a href="https://solscan.io/tx/${parsed.signature}">TX</a>`);
  
  // Send fast alert FIRST
  await sendTelegramAlert(fastLines.join('\n'));
  
  // ENRICHED follow-up — resolve token names in background
  const enriched = [];
  for (const tc of tokenChanges) {
    const info = await resolveTokenName(tc.mint);
    if (info.symbol !== tc.mint.slice(0, 6) + '...') {
      const action = tc.diff > 0 ? '🟢 BUY' : '🔴 SELL';
      let line = `${action} <b>$${info.symbol}</b>`;
      if (info.mc) line += ` | MC: $${info.mc.toLocaleString()}`;
      if (info.price && info.price !== '?') line += ` | $${info.price}`;
      if (info.url) line += `\n<a href="${info.url}">Chart</a>`;
      enriched.push(line);
    }
  }
  
  if (enriched.length > 0) {
    await sendTelegramAlert(`📊 <b>${walletName}</b> details:\n\n${enriched.join('\n')}`);
  }
}

function startWatching() {
  console.log('🔍 KOL Watcher starting...');
  console.log(`Tracking ${Object.keys(WALLETS).length} wallet(s)`);
  
  for (const [addr, name] of Object.entries(WALLETS)) {
    const pubkey = new PublicKey(addr);
    
    // Subscribe to account logs (fires on any tx involving this account)
    conn.onLogs(pubkey, async (logs) => {
      if (logs.err) return; // skip failed txs
      await handleTx(logs.signature, name, addr);
    }, 'confirmed');
    
    console.log(`✅ Subscribed to ${name} (${addr.slice(0, 8)}...)`);
  }
  
  console.log('👁️ Watching for trades...\n');
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down watcher...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down watcher...');
  process.exit(0);
});

startWatching();
