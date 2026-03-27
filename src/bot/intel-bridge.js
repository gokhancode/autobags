/**
 * AUTOBAGS — Intel Bridge
 * Calls the existing intel.py scorer and trend-scout.sh
 * Reuses your battle-tested token scoring logic
 */
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const TRADING_DIR = '/root/.openclaw/workspace/trading';
const TRENDING_FILE = path.join(TRADING_DIR, 'trending-tokens.json');

class IntelBridge {
  // Get currently trending tokens from trend-scout output
  getTrendingTokens() {
    try {
      if (!fs.existsSync(TRENDING_FILE)) return [];
      const data = JSON.parse(fs.readFileSync(TRENDING_FILE, 'utf8'));
      return Array.isArray(data) ? data : (data.tokens || []);
    } catch (e) {
      console.error('[IntelBridge] Failed to read trending tokens:', e.message);
      return [];
    }
  }

  // Score a token using intel.py
  async scoreToken(mint, symbol) {
    return new Promise((resolve) => {
      const proc = spawn('python3', [
        path.join(TRADING_DIR, 'intel.py'),
        '--mint', mint,
        '--symbol', symbol || 'UNKNOWN',
        '--json'
      ], { timeout: 30000 });

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => stdout += d);
      proc.stderr.on('data', d => stderr += d);

      proc.on('close', (code) => {
        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch {
          resolve({ score: 0, safe: false, error: stderr || 'parse failed' });
        }
      });

      proc.on('error', (err) => {
        resolve({ score: 0, safe: false, error: err.message });
      });
    });
  }

  // Quick safety check: minimum score to trade
  async isSafe(mint, symbol, minScore = 60) {
    const result = await this.scoreToken(mint, symbol);
    return result.score >= minScore && result.safe !== false;
  }
}

module.exports = new IntelBridge();
