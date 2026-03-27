const router = require('express').Router();
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../../data/subscribers.json');

function loadSubscribers() {
  if (!fs.existsSync(DATA_FILE)) return {};
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function saveSubscribers(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// GET /api/subscribers — list all (admin)
router.get('/', (req, res) => {
  const subs = loadSubscribers();
  res.json({ count: Object.keys(subs).length, subscribers: subs });
});

// POST /api/subscribers — register new subscriber
router.post('/', (req, res) => {
  const { wallet, depositSol } = req.body;
  if (!wallet) return res.status(400).json({ error: 'wallet required' });

  const subs = loadSubscribers();
  if (subs[wallet]) return res.status(409).json({ error: 'already subscribed' });

  subs[wallet] = {
    wallet,
    depositSol: depositSol || 0,
    joinedAt: new Date().toISOString(),
    active: true,
    pnlSol: 0,
    pnlPct: 0
  };
  saveSubscribers(subs);
  res.json({ success: true, subscriber: subs[wallet] });
});

// GET /api/subscribers/:wallet
router.get('/:wallet', (req, res) => {
  const subs = loadSubscribers();
  const sub = subs[req.params.wallet];
  if (!sub) return res.status(404).json({ error: 'not found' });
  res.json(sub);
});

module.exports = router;
