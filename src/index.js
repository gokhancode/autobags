require('dotenv').config({ path: './config/.env' });
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const app     = express();

// Initialize SQLite database (migrates from JSON on first run)
require('./db');

app.disable('x-powered-by');
app.use(cors());
app.use(express.json());

// Serve web UI — both at root and /autobags prefix
app.use('/autobags', express.static(path.join(__dirname, 'web')));
app.use(express.static(path.join(__dirname, 'web')));

// API routes — both prefixed and non-prefixed
['', '/autobags'].forEach(prefix => {
  app.use(`${prefix}/api/auth`,        require('./api/auth'));
  app.use(`${prefix}/api/settings`,    require('./api/settings'));
  app.use(`${prefix}/api/subscribers`, require('./api/subscribers'));
  app.use(`${prefix}/api/portfolio`,   require('./api/portfolio'));
  app.use(`${prefix}/api/trades`,      require('./api/trades'));
  app.use(`${prefix}/api/status`,      require('./api/status'));
  app.use(`${prefix}/api/stats`,       require('./api/stats'));
  app.use(`${prefix}/api/sell`,        require('./api/sell'));
  app.use(`${prefix}/api/admin`,       require('./api/admin'));
  app.use(`${prefix}/api/fees`,        require('./api/fees'));
  app.use(`${prefix}/api/launch`,      require('./api/launch'));
  app.use(`${prefix}/api/narratives`,  require('./api/narratives'));
  app.use(`${prefix}/api/sim`,         require('./api/sim'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Dashboard route
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'dashboard.html'));
});
app.get('/autobags/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'dashboard.html'));
});

// Admin panel
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'admin.html'));
});
app.get('/autobags/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'admin.html'));
});

// Fallback to index.html (landing page)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'index.html'));
});

const PORT = process.env.PORT || 3500;
app.listen(PORT, () => {
  console.log(`🤖 AUTOBAGS running on http://localhost:${PORT}`);

  // Start trading agent (15s interval)
  const { start } = require('./bot/agent');
  start(15000);

  // Start paper trading simulator ($1000 high-freq)
  const sim = require('./bot/simulator');
  sim.start(15000);
});
