/**
 * AUTOBAGS — User Settings API
 * Stores per-user trading config (basic or advanced mode)
 */
const router = require('express').Router();
const fs     = require('fs');
const path   = require('path');
const auth = require('./auth');
const requireAuth = auth.requireAuth;

const SETTINGS_FILE = path.join(__dirname, '../../data/settings.json');

const DEFAULTS = {
  mode: 'basic',          // 'basic' | 'advanced'
  active: true,           // bot trading on/off

  // Basic mode
  riskLevel: 'medium',    // 'low' | 'medium' | 'high'

  // Advanced mode
  stopLossPct:    8,      // % — sell if down this much
  takeProfitPct:  25,     // % — sell if up this much
  partialExitPct: 10,     // % gain at which to secure 30%
  maxSolPerTrade: 90,     // % of balance to deploy per trade
  minIntelScore:  65,     // 0-100 — minimum token score to buy
  maxPositions:   1,      // simultaneous positions
  slippageBps:    100,    // basis points slippage tolerance
  blacklist:      [],     // token mints to never trade
};

// Risk level presets (maps to advanced params)
const RISK_PRESETS = {
  low:    { stopLossPct: 5,  takeProfitPct: 15, minIntelScore: 75, maxSolPerTrade: 50 },
  medium: { stopLossPct: 8,  takeProfitPct: 25, minIntelScore: 65, maxSolPerTrade: 80 },
  high:   { stopLossPct: 12, takeProfitPct: 40, minIntelScore: 55, maxSolPerTrade: 95 },
};

function loadSettings() {
  if (!fs.existsSync(SETTINGS_FILE)) return {};
  return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
}
function saveSettings(data) {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
}

// GET /api/settings — get my settings
router.get('/', requireAuth, (req, res) => {
  const all      = loadSettings();
  const settings = { ...DEFAULTS, ...(all[req.user.userId] || {}) };
  // Merge risk preset if in basic mode
  if (settings.mode === 'basic') {
    Object.assign(settings, RISK_PRESETS[settings.riskLevel] || RISK_PRESETS.medium);
  }
  res.json({ success: true, settings });
});

// POST /api/settings — update settings
router.post('/', requireAuth, (req, res) => {
  const userId   = req.user.userId;
  const all      = loadSettings();
  const current  = { ...DEFAULTS, ...(all[userId] || {}) };
  const incoming = req.body;

  // Validate ranges
  const clamp = (v, min, max) => Math.min(max, Math.max(min, Number(v)));

  const updated = {
    ...current,
    ...(incoming.mode      !== undefined && { mode:      incoming.mode }),
    ...(incoming.active    !== undefined && { active:    !!incoming.active }),
    ...(incoming.riskLevel !== undefined && { riskLevel: incoming.riskLevel }),

    // Advanced params — validated
    ...(incoming.stopLossPct    !== undefined && { stopLossPct:    clamp(incoming.stopLossPct,    1, 50) }),
    ...(incoming.takeProfitPct  !== undefined && { takeProfitPct:  clamp(incoming.takeProfitPct,  5, 200) }),
    ...(incoming.partialExitPct !== undefined && { partialExitPct: clamp(incoming.partialExitPct, 5, 100) }),
    ...(incoming.maxSolPerTrade !== undefined && { maxSolPerTrade: clamp(incoming.maxSolPerTrade, 10, 100) }),
    ...(incoming.minIntelScore  !== undefined && { minIntelScore:  clamp(incoming.minIntelScore,  0, 100) }),
    ...(incoming.maxPositions   !== undefined && { maxPositions:   clamp(incoming.maxPositions,   1, 5) }),
    ...(incoming.slippageBps    !== undefined && { slippageBps:    clamp(incoming.slippageBps,    10, 1000) }),
    ...(Array.isArray(incoming.blacklist)      && { blacklist:      incoming.blacklist }),
  };

  all[userId] = updated;
  saveSettings(all);

  res.json({ success: true, settings: updated, message: 'Settings saved' });
});

// GET /api/settings/presets — return risk presets info
router.get('/presets', (req, res) => {
  res.json({ success: true, presets: RISK_PRESETS });
});

module.exports = router;
