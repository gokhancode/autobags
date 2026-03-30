#!/usr/bin/env node
/**
 * AUTOBAGS TG Relay — List Your Groups
 * Shows all groups/channels you're in so you can pick which to monitor
 */

require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs');
const path = require('path');

const API_ID = parseInt(process.env.TG_API_ID);
const API_HASH = process.env.TG_API_HASH;
const SESSION_FILE = path.join(__dirname, 'session.txt');

if (!fs.existsSync(SESSION_FILE)) {
  console.error('❌ No session found. Run: node auth.js');
  process.exit(1);
}

const sessionStr = fs.readFileSync(SESSION_FILE, 'utf8').trim();

(async () => {
  const client = new TelegramClient(
    new StringSession(sessionStr),
    API_ID,
    API_HASH,
    { connectionRetries: 3 }
  );

  await client.connect();
  console.log('📋 Your Telegram Groups & Channels:\n');

  const dialogs = await client.getDialogs({ limit: 200 });
  const groups = dialogs.filter(d => d.isGroup || d.isChannel);

  groups.sort((a, b) => (b.unreadCount || 0) - (a.unreadCount || 0));

  console.log('ID                  | Members | Unread | Name');
  console.log('-'.repeat(80));

  for (const g of groups) {
    const id = String(g.id).padEnd(20);
    const members = String(g.entity?.participantsCount || '?').padEnd(8);
    const unread = String(g.unreadCount || 0).padEnd(7);
    console.log(`${id}| ${members}| ${unread}| ${g.title}`);
  }

  console.log(`\nTotal: ${groups.length} groups/channels`);
  console.log('\nCopy the IDs you want to monitor into .env → MONITOR_GROUPS');
  console.log('Example: MONITOR_GROUPS=-1001234567890,-1009876543210');

  await client.disconnect();
  process.exit(0);
})();
