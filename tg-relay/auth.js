#!/usr/bin/env node
/**
 * AUTOBAGS TG Relay — One-Time Auth
 * Run this first: node auth.js
 * Saves session to ./session.txt (stays on YOUR machine)
 */

require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const fs = require('fs');
const path = require('path');

const API_ID = parseInt(process.env.TG_API_ID);
const API_HASH = process.env.TG_API_HASH;
const SESSION_FILE = path.join(__dirname, 'session.txt');

if (!API_ID || !API_HASH) {
  console.error('❌ Set TG_API_ID and TG_API_HASH in .env');
  console.error('   Get them from: https://my.telegram.org/apps');
  process.exit(1);
}

(async () => {
  console.log('🔐 AUTOBAGS TG Relay — Authentication\n');
  console.log('This logs into YOUR Telegram account (read-only).');
  console.log('Your session token stays on this machine only.\n');

  const client = new TelegramClient(
    new StringSession(''),
    API_ID,
    API_HASH,
    { connectionRetries: 3 }
  );

  await client.start({
    phoneNumber: async () => await input.text('📱 Phone number (with country code): '),
    password: async () => await input.text('🔑 2FA password (if set): '),
    phoneCode: async () => await input.text('📨 Code from Telegram: '),
    onError: (err) => console.error('Error:', err.message),
  });

  // Save session
  const sessionStr = client.session.save();
  fs.writeFileSync(SESSION_FILE, sessionStr);

  console.log('\n✅ Authenticated! Session saved to session.txt');
  console.log('⚠️  Keep session.txt safe — it grants access to your account.');
  console.log('\nNext steps:');
  console.log('  1. Run: node list-groups.js   — see your groups');
  console.log('  2. Run: node relay.js          — start the relay');

  await client.disconnect();
  process.exit(0);
})();
