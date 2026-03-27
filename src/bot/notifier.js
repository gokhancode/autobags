/**
 * AUTOBAGS — Trade Notifier
 * Sends trade alerts to Telegram
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

async function sendTelegram(text) {
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' })
    });
  } catch (err) {
    console.error('[Notifier] Telegram send failed:', err.message);
  }
}

function notifyBuy({ userId, symbol, score, solAmount, signature }) {
  const msg = `🟢 <b>BUY</b> $${symbol}\n` +
    `👤 ${userId}\n` +
    `💰 ${solAmount?.toFixed(4)} SOL\n` +
    `📊 Score: ${score}/100\n` +
    `🔗 <a href="https://solscan.io/tx/${signature}">View tx</a>`;
  sendTelegram(msg);
}

function notifySell({ userId, symbol, reason, pnlSol, pnlPct, signature }) {
  const emoji = (pnlSol || 0) >= 0 ? '🟢' : '🔴';
  const msg = `${emoji} <b>SELL</b> $${symbol}\n` +
    `👤 ${userId}\n` +
    `📈 P&L: ${(pnlSol||0) >= 0 ? '+' : ''}${pnlSol?.toFixed(4) || '?'} SOL (${pnlPct?.toFixed(1) || '?'}%)\n` +
    `📋 Reason: ${reason}\n` +
    `🔗 <a href="https://solscan.io/tx/${signature}">View tx</a>`;
  sendTelegram(msg);
}

function notifyAlert(text) {
  sendTelegram(`⚠️ <b>AUTOBAGS Alert</b>\n${text}`);
}

module.exports = { sendTelegram, notifyBuy, notifySell, notifyAlert };
