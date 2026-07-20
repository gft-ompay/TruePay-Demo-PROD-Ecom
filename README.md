# TestMart — TruePay storefront (PRODUCTION)

A dummy third-party shop for testing a **real** TruePay integration end to end,
on a **public URL** (not localhost). Deliberately unbranded (it's meant to look
like any merchant's site). Zero npm dependencies.

> ⚠️ **This build targets PRODUCTION** (`https://api.truepay.ompay.om`) by
> default — real cards, real money, real settlement. The storefront header shows
> a red **LIVE · production** badge so it's never confused with the UAT store.
> For UAT testing use the sibling repo instead (`TruePay-Demo-Ecom`).

## What it does

1. Storefront with a few products and a **Buy Now** button.
2. Buy Now → your server creates a **bank-hosted** transaction against TruePay
   Core (`POST /api/v1/transactions/bank-hosted`) using your merchant API
   credentials, and redirects the customer to **TruePay's hosted pay-page**.
3. Customer enters card + 3-D Secure OTP on TruePay's page.
4. TruePay redirects back to `/order/return`, which confirms the **real** status
   **server-to-server** via `GET /api/v1/transactions/:id` (the redirect itself
   never carries a trustworthy status).

The card is only ever entered on TruePay's page — TestMart never sees or stores
card data. Your API secret stays on the server (never in the browser).

---

## Deploy to Render.com (free, public HTTPS URL)

**Prerequisites:** a Render account (free) and this code in a GitHub repo Render
can read.

### Steps

1. **Render → New → Web Service**, connect this repo.
2. Set:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
   - (Leave **Root Directory** blank — the app is at the repo root.)
3. Add **Environment variables**:
   | Key | Value |
   |-----|-------|
   | `TRUEPAY_API_KEY` | your sandbox merchant's API key |
   | `TRUEPAY_API_SECRET` | your sandbox merchant's API secret |
   | `TRUEPAY_BASE_URL` | `https://api.uat.truepay.ompay.om` (default; omit to use it) |
4. **Create Web Service.** Render builds and gives you a public URL like
   `https://truepay-teststore.onrender.com`.

That's it — the checkout **return URL is auto-detected** from Render's
`RENDER_EXTERNAL_URL`, so there's nothing else to configure.

> Prefer a Blueprint? This folder ships a `render.yaml` — Render → New →
> Blueprint → pick the repo. It sets everything above except the two secrets,
> which Render will prompt you for.

**Where to get the API key/secret:** Admin Portal → **Merchants** → your test
merchant → **API Credentials**. Use a throwaway/sandbox merchant for testing.

**Note (free tier):** the service sleeps after ~15 min idle and cold-starts on
the next visit (~30–50 s). Fine for testing; just expect the first hit to be slow.

---

## Run locally (optional)

```bash
cp .env.example .env      # then fill in TRUEPAY_API_KEY / SECRET
npm start                 # http://localhost:6012
```

Locally, point `TRUEPAY_BASE_URL` at UAT (the default) — a public HTTPS host
works with Node's built-in `fetch`. (Local `http://localhost:6000` does **not**
work with `fetch` — port 6000 is on the WHATWG "bad ports" list.)

---

## Files

| File | Purpose |
|------|---------|
| `server.js` | The storefront + checkout + return-page HTTP server |
| `truepay.js` | Vendored TruePay Node SDK (`createHostedPayment`, `getTransaction`, …) |
| `config.js` | `.env` loader + client factory (auto-detects Render's public URL) |
| `render.yaml` | Render Blueprint |
| `Dockerfile` | Optional container build |
