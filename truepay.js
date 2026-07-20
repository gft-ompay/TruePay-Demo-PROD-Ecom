'use strict';

/**
 * TruePayClient — a tiny, dependency-free Node.js SDK for the TruePay Core API.
 *
 * Merchants integrate with the Core service ONLY. This client wraps the four
 * transaction endpoints and attaches your API key/secret to every request.
 *
 * Requires Node.js 18+ (uses the built-in global `fetch`).
 *
 *   const client = new TruePayClient({
 *     baseUrl:   'http://localhost:3000',
 *     apiKey:    process.env.TRUEPAY_API_KEY,
 *     apiSecret: process.env.TRUEPAY_API_SECRET,
 *     merchantId:process.env.TRUEPAY_MERCHANT_ID,
 *   });
 *   const tx = await client.createPayment({ amount: 12.5 });
 */
class TruePayError extends Error {
  constructor(message, { status, error, details } = {}) {
    super(message);
    this.name = 'TruePayError';
    this.status = status;
    this.error = error;
    this.details = details;
  }
}

class TruePayClient {
  constructor({ baseUrl, apiKey, apiSecret, merchantId, timeoutMs = 35000 } = {}) {
    if (!baseUrl) throw new Error('baseUrl is required');
    if (!apiKey || !apiSecret) throw new Error('apiKey and apiSecret are required');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.merchantId = merchantId;
    this.timeoutMs = timeoutMs;
  }

  /** @private */
  async _request(method, path, { body, query } = {}) {
    let url = `${this.baseUrl}${path}`;
    if (query) {
      const qs = new URLSearchParams(
        Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
      ).toString();
      if (qs) url += `?${qs}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'OMPAY-API-Key': this.apiKey,
          'OMPAY-API-Secret': this.apiSecret,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      throw new TruePayError(`Network error calling TruePay: ${err.message}`, { status: 0 });
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }

    if (!res.ok || payload.success === false) {
      throw new TruePayError(payload.message || `Request failed (HTTP ${res.status})`, {
        status: res.status,
        error: payload.error,
        details: payload.details,
      });
    }
    return payload;
  }

  /**
   * Create and process a payment. Resolves with the final transaction object.
   * The gateway picks the provider from the card's BIN — you do not send a
   * payment method or provider code.
   * @param {object} p
   * @param {number} p.amount
   * @param {string} [p.currency='OMR']
   * @param {string} [p.token]            stored-card token (pay by token)
   * @param {string} [p.referenceNumber]
   * @param {string} [p.description]
   * @param {object} [p.metadata]
   * @param {string} [p.merchantId]       defaults to the client's merchantId
   */
  async createPayment(p = {}) {
    const body = {
      amount: p.amount,
      currency: p.currency || 'OMR',
      merchant_id: p.merchantId || this.merchantId,
      token: p.token,
      reference_number: p.referenceNumber,
      description: p.description,
      metadata: p.metadata,
    };
    const { data } = await this._request('POST', '/api/v1/transactions', { body });
    return data;
  }

  /**
   * Start a BANK-HOSTED payment: the cardholder is redirected to TruePay's own
   * hosted pay-page (card entry + 3-D Secure OTP), then back to `returnUrl`.
   * Use this for a "Buy Now" style storefront checkout — you never touch card data.
   * @param {object} p
   * @param {number} p.amount
   * @param {string} [p.currency='OMR']
   * @param {string} p.returnUrl        where TruePay sends the customer back to (transaction_id + reference_number only — no status)
   * @param {string} [p.referenceNumber]
   * @param {string} [p.description]
   * @returns { transaction_id, reference_number, status, redirect_url }
   */
  async createHostedPayment(p = {}) {
    const body = {
      amount: p.amount,
      currency: p.currency || 'OMR',
      merchant_id: p.merchantId || this.merchantId,
      return_url: p.returnUrl,
      reference_number: p.referenceNumber,
      description: p.description,
    };
    const { data } = await this._request('POST', '/api/v1/transactions/bank-hosted', { body });
    return data;
  }

  /** List transactions. @param {object} [filters] page, limit, status, dateFrom, dateTo */
  async listTransactions(filters = {}) {
    return this._request('GET', '/api/v1/transactions', {
      query: {
        page: filters.page,
        limit: filters.limit,
        status: filters.status,
        date_from: filters.dateFrom,
        date_to: filters.dateTo,
        merchant_id: filters.merchantId || this.merchantId,
      },
    });
  }

  /** Fetch one transaction (includes status history `logs`). */
  async getTransaction(id) {
    const { data } = await this._request('GET', `/api/v1/transactions/${encodeURIComponent(id)}`);
    return data;
  }

  /**
   * Refund a SUCCESSFUL transaction (full or partial). Creates a **new**, linked
   * REFUND transaction via the provider — the original transaction is never
   * modified, it stays SUCCESSFUL. Refunds are capped at the amount not already
   * refunded. Can be called any day (not just the purchase date).
   * @param {string} id            the ORIGINAL (payment) transaction id
   * @param {number} [amount]      omit for a full refund of the remaining balance
   * @returns { refunded, refund_transaction_id, refund_status, refund_amount, provider_reference, error_message, refundable_remaining }
   */
  async refundTransaction(id, amount) {
    const { data } = await this._request('POST', `/api/v1/transactions/${encodeURIComponent(id)}/refund`, {
      body: amount != null ? { amount } : {},
    });
    return data;
  }

  /**
   * Reverse (void) a SUCCESSFUL transaction — the full amount, **same purchase day
   * only**. Some providers (e.g. OAB) reject a same-day refund and require a void
   * instead; from the next day, use `refundTransaction`. Creates a new, linked
   * REVERSAL transaction — the original is never modified.
   * @param {string} id            the ORIGINAL (payment) transaction id
   * @param {string} [reason]      optional free-text reason, recorded on the reversal
   * @returns { reversed, reversal_transaction_id, reversal_status, provider_reference, error_message }
   */
  async reverseTransaction(id, reason) {
    const { data } = await this._request('POST', `/api/v1/transactions/${encodeURIComponent(id)}/reverse`, {
      body: reason ? { reason } : {},
    });
    return data;
  }
}

module.exports = { TruePayClient, TruePayError };
