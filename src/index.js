require('dotenv').config({ path: './config/.env' });
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/subscribers', require('./api/subscribers'));
app.use('/api/portfolio',   require('./api/portfolio'));
app.use('/api/trades',      require('./api/trades'));
app.use('/api/status',      require('./api/status'));

const PORT = process.env.PORT || 3500;
app.listen(PORT, () => {
  console.log(`🤖 AUTOBAGS API running on port ${PORT}`);
});
