'use strict';

/**
 * Minimal zero-dependency .env loader + client factory.
 * Self-contained so this folder can be deployed on its own (e.g. Render).
 */
const fs = require('fs');
const path = require('path');
const { TruePayClient } = require('./truepay');

(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2].replace(/^["']|["']$/g, '');
    if (process.env[key] === undefined) process.env[key] = val;
  }
})();

// Public base URL of THIS site (used to build the return_url TruePay sends the
// customer back to). Priority:
//   1. PUBLIC_URL           — explicit override
//   2. RENDER_EXTERNAL_URL  — injected automatically by Render.com
//   3. http://localhost:<port>  — local dev fallback
const port = parseInt(process.env.PORT, 10) || 6012;
const publicUrl = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/+$/, '');

const config = {
  // TruePay Core API base URL. This is the PRODUCTION store, so it defaults to
  // the live core host — real cards, real money. A public HTTPS host (unlike
  // localhost:6000) works with Node's built-in fetch — no proxy needed.
  baseUrl: (process.env.TRUEPAY_BASE_URL || 'https://api.truepay.ompay.om').replace(/\/+$/, ''),
  apiKey: process.env.TRUEPAY_API_KEY,
  apiSecret: process.env.TRUEPAY_API_SECRET,
  port,
  publicUrl,
};

function buildClient() {
  if (!config.apiKey || !config.apiSecret) {
    console.warn('\n⚠ No TRUEPAY_API_KEY/SECRET set. On Render add them as Environment variables; locally copy .env.example to .env and fill them in (Admin Portal → Merchants → your account → API key/secret).\n');
  }
  return new TruePayClient(config);
}

module.exports = { config, buildClient };
