require('dotenv').config({ path: './config/.env' });
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const app     = express();

app.use(cors());
app.use(express.json());

// Serve web UI
app.use(express.static(path.join(__dirname, 'web')));

// API routes
app.use('/api/subscribers', require('./api/subscribers'));
app.use('/api/portfolio',   require('./api/portfolio'));
app.use('/api/trades',      require('./api/trades'));
app.use('/api/status',      require('./api/status'));

// Fallback to index.html for SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'web', 'index.html'));
});

const PORT = process.env.PORT || 3500;
app.listen(PORT, () => {
  console.log(`🤖 AUTOBAGS running on http://localhost:${PORT}`);
});
