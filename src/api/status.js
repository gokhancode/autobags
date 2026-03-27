const router = require('express').Router();

router.get('/', (req, res) => {
  res.json({
    name: 'AUTOBAGS',
    version: '0.1.0',
    status: 'online',
    tagline: 'Your bags, on autopilot.',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
