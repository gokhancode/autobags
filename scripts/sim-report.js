#!/usr/bin/env node
/**
 * AUTOBAGS — Hourly Sim Report
 * Reads sim-state.json and sends summary to Telegram via OpenClaw
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const simPath = path.join(DATA_DIR, 'sim-state.json');

function run() {
  if (!fs.existsSync(simPath)) {
    console.log('No sim-state.json found');
    process.exit(1);
  }

  const sim = JSON.parse(fs.readFileSync(simPath, 'utf8'));
  const bal = sim.balanceUsd || 0;
  const start = sim.startBalanceUsd || 1000;
  const pnlPct = ((bal - start) / start * 100).toFixed(1);
  const pnlEmoji = bal >= start ? '📈' : '📉';
  const positions = sim.positions || {};
  const openCount = Object.keys(positions).length;
  const winRate = sim.totalTrades > 0 ? (sim.wins / sim.totalTrades * 100).toFixed(1) : '0.0';
  const ddFromPeak = sim.peakBalance > 0 ? ((sim.peakBalance - bal) / sim.peakBalance * 100).toFixed(1) : '0.0';

  let posLines = '';
  for (const [mint, p] of Object.entries(positions)) {
    posLines += `  • $${p.symbol} — entry $${p.entryPrice}, $${p.usdAmount?.toFixed(0) || '?'}\n`;
  }
  if (!posLines) posLines = '  None\n';

  const uptime = sim.startedAt 
    ? `${((Date.now() - new Date(sim.startedAt).getTime()) / 3600000).toFixed(1)}h`
    : '?';

  const report = [
    `🤖 AUTOBAGS Sim Report`,
    ``,
    `${pnlEmoji} Balance: $${bal.toFixed(2)} (${pnlPct >= 0 ? '+' : ''}${pnlPct}%)`,
    `🏔️ Peak: $${sim.peakBalance?.toFixed(2) || '?'} (${ddFromPeak}% from peak)`,
    `📊 Trades: ${sim.totalTrades} | ${sim.wins}W/${sim.losses}L (${winRate}%)`,
    `📉 Max DD: ${sim.maxDrawdown?.toFixed(1) || '?'}%`,
    `⏱️ Uptime: ${uptime}`,
    ``,
    `Open positions (${openCount}):`,
    posLines.trimEnd(),
    ``,
    `Params: SL ${sim.stopLossPct}% | TP ${sim.takeProfitPct}% | partial ${sim.partialExitPct}%`,
  ].join('\n');

  console.log(report);
}

run();
