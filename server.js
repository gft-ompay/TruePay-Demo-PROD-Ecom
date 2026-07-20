'use strict';

/**
 * TestMart — a dummy third-party storefront used to test a real TruePay
 * integration end to end: product page -> Buy Now -> TruePay-hosted checkout
 * -> return page. Deliberately styled as an unrelated shop (not OMPAY-branded)
 * since that's what a real merchant's site looks like.
 *
 * Dev-only sample: not registered in ecosystem.prod.config.js.
 * Run:  npm run web   then open http://localhost:6012
 */
process.env.TZ = process.env.TZ || 'Asia/Muscat';
const http = require('http');
const { config, buildClient } = require('./config');

const client = buildClient();

// Environment badge shown in the header, derived from the core host — so testers
// can instantly tell a LIVE (real-money) store from a UAT/local test one.
const ENV = /(^|\.)uat\./.test(config.baseUrl) ? { label: 'UAT · test', live: false }
  : /localhost|127\.0\.0\.1/.test(config.baseUrl) ? { label: 'Local · test', live: false }
  : { label: 'LIVE · production', live: true };

// ── Private access gate ─────────────────────────────────────────────────────
// Render web services are PUBLIC by default. To keep this store visible only to
// you, set a SITE_PASSWORD env var (and optionally SITE_USER, default "ompay").
// When SITE_PASSWORD is set, every page requires HTTP Basic Auth; the browser
// caches the login for the whole origin, so the checkout return page works too.
// When it's unset, the site is open (handy for a throwaway UAT box).
const GATE_USER = process.env.SITE_USER || 'ompay';
const GATE_PASS = process.env.SITE_PASSWORD || '';
// Constant-time-ish equality so the password check doesn't leak length via timing.
function safeEqual(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
// Returns true if the request is allowed through; otherwise writes a 401 and
// returns false (caller must stop). No-op (always allows) when no password set.
function passesGate(req, res) {
  if (!GATE_PASS) return true;
  const hdr = req.headers['authorization'] || '';
  const m = /^Basic\s+(.+)$/i.exec(hdr);
  if (m) {
    const [user, ...rest] = Buffer.from(m[1], 'base64').toString('utf8').split(':');
    if (safeEqual(user, GATE_USER) && safeEqual(rest.join(':'), GATE_PASS)) return true;
  }
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="TestMart private area", charset="UTF-8"',
    'Content-Type': 'text/html; charset=utf-8',
  });
  res.end('<h1>401 — Authentication required</h1><p>This store is private.</p>');
  return false;
}

// In-memory order log (id -> {product, qty, createdAt}) so the return page can
// show what was purchased. A real store would persist this in its own DB.
const orders = new Map();

const PRODUCTS = [
  { id: 'widget', name: 'Sample Widget', desc: 'A perfectly ordinary widget for testing checkout.', price: 5.000, emoji: '🧩' },
  { id: 'gadget', name: 'Demo Gadget', desc: 'Mid-tier gadget, mid-tier price, high-tier vibes.', price: 12.500, emoji: '🎛️' },
  { id: 'bundle', name: 'Trial Bundle', desc: 'The works — for testing a larger order amount.', price: 25.750, emoji: '📦' },
];

function htmlEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(n) {
  return Number(n).toFixed(3) + ' OMR';
}
function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json', ...headers });
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(Object.fromEntries(new URLSearchParams(raw))); } catch { resolve({}); }
    });
  });
}

function shell(title, inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${htmlEscape(title)}</title>
<style>
:root{--brand:#c2410c;--brand-dark:#9a3412;--ink:#231a14;--mut:#7a6f63;--line:#ecdfd2;--bg:#fdf8f2}
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--ink);min-height:100vh;min-height:100dvh}
header{background:#fff;border-bottom:1px solid var(--line);padding:16px 24px;display:flex;align-items:center;gap:10px;position:sticky;top:0;z-index:5}
header .logo{font-weight:800;font-size:1.25rem;letter-spacing:-.02em;color:var(--brand-dark);text-decoration:none;display:flex;align-items:center;gap:8px}
header .logo .ic{font-size:1.4rem}
header .tag{margin-left:auto;font-size:.78rem;color:var(--mut);background:#faf3ea;border:1px solid var(--line);padding:4px 10px;border-radius:20px}
header .tag.live{color:#fff;background:#dc2626;border-color:#dc2626;font-weight:700;letter-spacing:.02em}
main{max-width:960px;margin:0 auto;padding:28px 20px 60px}
h1{font-size:1.6rem;font-weight:800;letter-spacing:-.01em;margin:0 0 4px}
.sub{color:var(--mut);margin:0 0 26px;font-size:.98rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:18px}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px;display:flex;flex-direction:column;box-shadow:0 2px 10px rgba(120,80,40,.05)}
.card .ic{font-size:2.4rem;margin-bottom:10px}
.card h3{margin:0 0 4px;font-size:1.08rem}
.card p{margin:0 0 14px;color:var(--mut);font-size:.86rem;line-height:1.5;flex:1}
.card .price{font-weight:800;font-size:1.15rem;margin-bottom:12px}
.buy{display:block;width:100%;text-align:center;background:var(--brand);color:#fff;border:0;border-radius:10px;padding:12px;font-weight:700;font-size:.95rem;cursor:pointer;text-decoration:none}
.buy:hover{background:var(--brand-dark)}
.note{margin-top:30px;padding:14px 16px;background:#fff;border:1px solid var(--line);border-radius:12px;color:var(--mut);font-size:.82rem;line-height:1.6}
.note b{color:var(--ink)}
.result{max-width:480px;margin:60px auto;background:#fff;border:1px solid var(--line);border-radius:16px;padding:32px;text-align:center;box-shadow:0 8px 30px rgba(120,80,40,.08)}
.result .ic{font-size:3rem;margin-bottom:6px}
.result h1{font-size:1.4rem}
.kv{text-align:left;background:#faf3ea;border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:18px 0;font-size:.85rem}
.kv div{display:flex;justify-content:space-between;gap:12px;padding:3px 0}
.kv code{font-family:ui-monospace,Menlo,monospace;font-size:.82rem}
.pill{display:inline-block;padding:3px 11px;border-radius:20px;color:#fff;font-size:.78rem;font-weight:700}
.pill.ok{background:#16a34a}.pill.pending{background:#d97706}.pill.fail{background:#dc2626}
a.back{display:inline-block;margin-top:10px;color:var(--brand-dark);font-weight:600;text-decoration:none;font-size:.9rem}
</style></head>
<body>
<header><a class="logo" href="/"><span class="ic">🛍️</span>TestMart</a><span class="tag${ENV.live ? ' live' : ''}">${ENV.live ? '⚠ ' : ''}${ENV.label} — TruePay checkout</span></header>
<main>${inner}</main>
</body></html>`;
}

function storefrontPage() {
  const cards = PRODUCTS.map((p) => `
    <div class="card">
      <div class="ic">${p.emoji}</div>
      <h3>${htmlEscape(p.name)}</h3>
      <p>${htmlEscape(p.desc)}</p>
      <div class="price">${money(p.price)}</div>
      <form method="POST" action="/checkout">
        <input type="hidden" name="product_id" value="${p.id}">
        <button class="buy" type="submit">Buy Now</button>
      </form>
    </div>`).join('');
  return shell('TestMart', `
    <h1>TestMart</h1>
    <p class="sub">A dummy shop for exercising the full TruePay checkout flow end to end.</p>
    <div class="grid">${cards}</div>
    <div class="note">Clicking <b>Buy Now</b> creates a real bank-hosted transaction against <code>${htmlEscape(config.baseUrl)}</code> and redirects you to TruePay's hosted pay-page. TestMart never sees or stores card details.</div>
  `);
}

function resultPage({ icon, title, sub, rows, statusPill }) {
  return shell(title, `
    <div class="result">
      <div class="ic">${icon}</div>
      <h1>${htmlEscape(title)}${statusPill || ''}</h1>
      <p class="sub">${sub}</p>
      ${rows && rows.length ? `<div class="kv">${rows.join('')}</div>` : ''}
      <a class="back" href="/">&larr; Back to TestMart</a>
    </div>
  `);
}

function statusPill(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'SUCCESSFUL') return ` <span class="pill ok">SUCCESSFUL</span>`;
  if (s === 'FAILED' || s === 'REVERSED') return ` <span class="pill fail">${htmlEscape(s)}</span>`;
  return ` <span class="pill pending">${htmlEscape(s || 'PENDING')}</span>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Private-access gate (see passesGate). Stops here with a 401 unless the
  // request carries the right Basic-Auth login — when SITE_PASSWORD is set.
  if (!passesGate(req, res)) return;

  if (req.method === 'GET' && url.pathname === '/') {
    return send(res, 200, storefrontPage());
  }

  // Buy Now -> create a bank-hosted transaction -> redirect to TruePay's pay-page.
  if (req.method === 'POST' && url.pathname === '/checkout') {
    const body = await readBody(req);
    const product = PRODUCTS.find((p) => p.id === body.product_id);
    if (!product) return send(res, 404, resultPage({ icon: '🔍', title: 'Product not found', sub: 'That item is not in the TestMart catalog.' }));
    try {
      const referenceNumber = 'TESTMART-' + Date.now();
      const data = await client.createHostedPayment({
        amount: product.price,
        currency: 'OMR',
        referenceNumber,
        description: `TestMart order: ${product.name}`,
        returnUrl: `${config.publicUrl}/order/return`,
      });
      orders.set(data.transaction_id, { product: product.name, price: product.price, reference: referenceNumber });
      res.writeHead(302, { Location: data.redirect_url });
      return res.end();
    } catch (err) {
      return send(res, 502, resultPage({
        icon: '⚠️', title: 'Could not start checkout', sub: htmlEscape(err.message || 'Unknown error'),
        rows: [`<div><span>Base URL</span><code>${htmlEscape(config.baseUrl)}</code></div>`],
      }));
    }
  }

  // Return page — TruePay sends the customer here after the hosted checkout
  // finishes. The redirect only carries transaction_id + reference_number
  // (never a status, since a status in the URL is forgeable) — the real
  // outcome is confirmed here server-side via getTransaction.
  if (req.method === 'GET' && url.pathname === '/order/return') {
    const txnId = url.searchParams.get('transaction_id') || '';
    const reference = url.searchParams.get('reference_number') || '';
    const order = orders.get(txnId);
    if (!txnId) {
      return send(res, 400, resultPage({ icon: '🔍', title: 'Missing order', sub: 'No transaction was referenced in this link.' }));
    }
    try {
      const txn = await client.getTransaction(txnId);
      const rows = [
        `<div><span>Order</span><span>${htmlEscape(order ? order.product : '—')}</span></div>`,
        `<div><span>Amount</span><span>${money(txn.amount)}</span></div>`,
        `<div><span>Transaction</span><code>${htmlEscape(txnId)}</code></div>`,
        `<div><span>Reference</span><code>${htmlEscape(reference || txn.reference_number || '')}</code></div>`,
      ];
      const s = String(txn.status || '').toUpperCase();
      const icon = s === 'SUCCESSFUL' ? '✅' : (s === 'FAILED' || s === 'REVERSED') ? '❌' : '⏳';
      const title = s === 'SUCCESSFUL' ? 'Payment successful' : (s === 'FAILED' || s === 'REVERSED') ? 'Payment failed' : 'Payment pending';
      return send(res, 200, resultPage({
        icon, title, statusPill: statusPill(s),
        sub: 'Status confirmed server-to-server via <code>GET /api/v1/transactions/:id</code> — never trusted from the redirect itself.',
        rows,
      }));
    } catch (err) {
      return send(res, 502, resultPage({ icon: '⚠️', title: 'Could not confirm order status', sub: htmlEscape(err.message || 'Unknown error') }));
    }
  }

  if (req.method === 'GET') {
    return send(res, 404, resultPage({ icon: '🔍', title: 'Page not found', sub: 'This link may have expired.' }));
  }
  send(res, 404, { success: false, message: 'Not found' });
});

server.listen(config.port, () => {
  console.log(`\n🟢 TestMart demo running:`);
  console.log(`   Storefront:   http://localhost:${config.port}/`);
  console.log(`   Core API:     ${config.baseUrl}\n`);
});
