/**
 * Tests for pay-what-you-want across the payment rails.
 *
 * The mint is mocked so each test can see exactly which amount reaches each
 * step: the Lightning invoice, minting, the swap, crash recovery, and every
 * balance a seller sees or withdraws. The rule under test throughout: a
 * payment credits the amount it was made for, never the stash price.
 *
 * Run with: npm test --workspace=server
 */

// Set env before any db-dependent imports
if (!process.env.TOKEN_ENCRYPTION_KEY) {
  const { randomBytes } = await import('node:crypto');
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
}
process.env.DB_PATH = ':memory:';

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import type { AuthVariables } from '../middleware/auth.js';

const SELLER = 'pwyw-seller-pubkey';
const MINT_MAX = 1_000_000;

// What each mocked mint call was asked for, in order.
const calls = {
  invoice: [] as number[],
  mint: [] as Array<{ amount: number; quote: string }>,
  swap: [] as Array<{ token: string; amount: number }>,
  resolveAddress: [] as number[],
};
let tokenValuation = { valueSats: 0, receivableSats: 0 };

mock.module('../lib/cashu.js', {
  namedExports: {
    createPaymentInvoice: async (amount: number) => {
      calls.invoice.push(amount);
      return {
        invoice: `lnbc${amount}mock`,
        quoteId: `quote-${calls.invoice.length}`,
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      };
    },
    checkPaymentStatus: async () => ({ paid: true, issued: false }),
    mintAfterPayment: async (amount: number, quote: string) => {
      calls.mint.push({ amount, quote });
      return `cashuMinted-${amount}`;
    },
    verifyAndSwapToken: async (token: string, amount: number) => {
      calls.swap.push({ token, amount });
      return { success: true, sellerToken: `cashuSeller-${amount}` };
    },
    getTokenValuation: async () => tokenValuation,
    getMaxMintAmount: async () => MINT_MAX,
    getTokenValue: () => 0,
    getMeltQuote: async () => ({ success: true, feeSats: 2, amountSats: 0 }),
    meltWithRecovery: async () => ({ success: false, error: 'not in this test' }),
    checkMeltQuoteStatus: async () => ({ state: 'UNPAID' }),
  },
});

// Auto-settlement resolves the seller's Lightning address for the full
// balance; recording that amount shows which balance it computed.
mock.module('../lib/lnaddress.js', {
  namedExports: {
    resolveAddress: async (_address: string, amountSats: number) => {
      calls.resolveAddress.push(amountSats);
      throw new Error('stop after recording the amount');
    },
  },
});

const db = (await import('../db/index.js')).default;
const { encrypt } = await import('../lib/encryption.js');
const { payRoutes } = await import('./pay.js');
const { unlockRoutes } = await import('./unlock.js');
const { dashboardRoutes } = await import('./dashboard.js');
const { earningsRoutes } = await import('./earnings.js');
const { withdrawRoutes } = await import('./withdraw.js');
const { recoverMintFailures } = await import('../lib/recovery.js');
const { tryAutoSettle } = await import('../lib/autosettle.js');

const app = new Hono<{ Variables: AuthVariables }>();
// Stand-in for NIP-98: the seller routes only read the authed pubkey.
app.use('/api/*', async (c, next) => {
  c.set('authedPubkey', SELLER);
  await next();
});
app.route('/api/pay', payRoutes);
app.route('/api/unlock', unlockRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/earnings', earningsRoutes);
app.route('/api/withdraw', withdrawRoutes);

const PWYW_STASH = 'stash-pwyw';
const FIXED_STASH = 'stash-fixed';

function insertStash(id: string, priceSats: number, payWhatYouWant: boolean) {
  db.prepare(
    `INSERT INTO stashes (id, blob_url, secret_key, seller_pubkey, price_sats, title,
                          file_name, file_size, pay_what_you_want)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    encrypt('https://blossom.example.com/blob'),
    encrypt(`secret-${id}`),
    SELLER,
    priceSats,
    encrypt(`Title ${id}`),
    encrypt('file.zip'),
    2048,
    payWhatYouWant ? 1 : 0
  );
}

function insertPaidPayment(id: string, stashId: string, amountSats: number | null) {
  db.prepare(
    `INSERT INTO payments (id, stash_id, status, token_hash, seller_token, amount_sats, paid_at)
     VALUES (?, ?, 'paid', ?, ?, ?, unixepoch())`
  ).run(id, stashId, `hash-${id}`, encrypt(`cashuSeller-${id}`), amountSats);
}

function paymentRow(id: string) {
  return db.prepare('SELECT status, amount_sats FROM payments WHERE id = ?').get(id) as
    | { status: string; amount_sats: number | null }
    | undefined;
}

function postJson(path: string, body?: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  db.exec('DELETE FROM settlement_log');
  db.exec('DELETE FROM seller_settings');
  db.exec('DELETE FROM payments');
  db.exec('DELETE FROM stashes');
  calls.invoice.length = 0;
  calls.mint.length = 0;
  calls.swap.length = 0;
  calls.resolveAddress.length = 0;
  insertStash(PWYW_STASH, 1_000, true);
  insertStash(FIXED_STASH, 100, false);
});

describe('Lightning: POST /api/pay/:id/invoice', () => {
  it('makes the invoice for the amount the buyer chose, and records it', async () => {
    const res = await postJson(`/api/pay/${PWYW_STASH}/invoice`, { amountSats: 5_000 });
    assert.equal(res.status, 200);

    const { data } = await res.json();
    assert.equal(data.amountSats, 5_000);
    assert.deepEqual(calls.invoice, [5_000]);
    assert.equal(paymentRow(`ln-${data.quoteId}`)?.amount_sats, 5_000);
  });

  it('defaults to the minimum when the buyer sends no amount', async () => {
    const res = await postJson(`/api/pay/${PWYW_STASH}/invoice`);
    assert.equal(res.status, 200);
    assert.deepEqual(calls.invoice, [1_000]);
  });

  it('refuses less than the minimum without creating an invoice', async () => {
    const res = await postJson(`/api/pay/${PWYW_STASH}/invoice`, { amountSats: 999 });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /minimum for this stash is 1000/);
    assert.deepEqual(calls.invoice, [], 'no invoice may be created');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM payments').get() as { n: number }).n, 0);
  });

  it('refuses more than the mint will issue in one payment', async () => {
    const res = await postJson(`/api/pay/${PWYW_STASH}/invoice`, { amountSats: MINT_MAX + 1 });
    assert.equal(res.status, 400);
    assert.deepEqual(calls.invoice, []);
  });

  it('still charges a fixed-price stash its price, with or without a body', async () => {
    // No body at all is what every pre-pay-what-you-want client sends.
    const bare = await app.request(`/api/pay/${FIXED_STASH}/invoice`, { method: 'POST' });
    assert.equal(bare.status, 200);
    const { data } = await bare.json();
    assert.equal(data.amountSats, 100);
    assert.equal(paymentRow(`ln-${data.quoteId}`)?.amount_sats, 100);

    const more = await postJson(`/api/pay/${FIXED_STASH}/invoice`, { amountSats: 5_000 });
    assert.equal(more.status, 400, 'a fixed price cannot be overridden');
    assert.deepEqual(calls.invoice, [100]);
  });

  it('rejects a body that is not a JSON object', async () => {
    for (const body of ['not json', '[5000]']) {
      const res = await app.request(`/api/pay/${PWYW_STASH}/invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      assert.equal(res.status, 400, `accepted ${body}`);
    }
  });
});

describe('Lightning: GET /api/pay/:id/status/:quoteId', () => {
  it("mints the invoice's own amount, not the stash price", async () => {
    // If minting asked for the 1,000 price on a 5,000 invoice, NUT-04 would
    // issue 1,000 and strand the other 4,000 on the quote.
    const created = await (
      await postJson(`/api/pay/${PWYW_STASH}/invoice`, { amountSats: 5_000 })
    ).json();
    const quoteId = created.data.quoteId;

    const res = await app.request(`/api/pay/${PWYW_STASH}/status/${quoteId}`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).data.paid, true);

    assert.deepEqual(calls.mint, [{ amount: 5_000, quote: quoteId }]);
    assert.deepEqual(
      calls.swap.map((s) => s.amount),
      [5_000]
    );
    assert.deepEqual(paymentRow(`ln-${quoteId}`), { status: 'paid', amount_sats: 5_000 });
  });

  it('never mints twice for repeated polls (idempotency)', async () => {
    const created = await (
      await postJson(`/api/pay/${PWYW_STASH}/invoice`, { amountSats: 2_500 })
    ).json();
    const quoteId = created.data.quoteId;

    for (let i = 0; i < 3; i++) {
      const res = await app.request(`/api/pay/${PWYW_STASH}/status/${quoteId}`);
      assert.equal((await res.json()).data.paid, true);
    }

    assert.equal(calls.mint.length, 1, 'the paid quote must be minted exactly once');
    assert.equal(calls.swap.length, 1);
  });

  it('settles a pending payment from before the migration at the stash price', async () => {
    // A quote created by the old code has no amount_sats.
    db.prepare(
      `INSERT INTO payments (id, stash_id, status, token_hash) VALUES (?, ?, 'pending', ?)`
    ).run('ln-legacy-quote', FIXED_STASH, 'legacy-quote');

    const res = await app.request(`/api/pay/${FIXED_STASH}/status/legacy-quote`);
    assert.equal((await res.json()).data.paid, true);
    assert.deepEqual(calls.mint, [{ amount: 100, quote: 'legacy-quote' }]);
    assert.equal(paymentRow('ln-legacy-quote')?.amount_sats, 100, 'now recorded explicitly');
  });
});

describe('Cashu: POST /api/unlock/:id', () => {
  it('accepts a token worth exactly the chosen amount, and records it', async () => {
    tokenValuation = { valueSats: 3_000, receivableSats: 3_000 };

    const res = await postJson(`/api/unlock/${PWYW_STASH}`, {
      token: 'cashuBuyerToken3000',
      amountSats: 3_000,
    });
    assert.equal(res.status, 200);

    assert.deepEqual(calls.swap, [{ token: 'cashuBuyerToken3000', amount: 3_000 }]);
    const row = db
      .prepare('SELECT status, amount_sats FROM payments WHERE stash_id = ?')
      .get(PWYW_STASH);
    assert.deepEqual(row, { status: 'paid', amount_sats: 3_000 });
  });

  it('refuses a token worth more than the buyer chose — the wrong-token guard', async () => {
    // The buyer meant to pay 3,000 but pasted their whole 1,000,000-sat wallet.
    // Accepting "anything above the minimum" would sweep it all to the seller.
    tokenValuation = { valueSats: 1_000_000, receivableSats: 1_000_000 };

    const res = await postJson(`/api/unlock/${PWYW_STASH}`, {
      token: 'cashuWholeWallet',
      amountSats: 3_000,
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /worth 1000000 sats but you chose to pay 3000/);
    assert.deepEqual(calls.swap, [], 'the token must never be touched');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM payments').get() as { n: number }).n, 0);
  });

  it('refuses a chosen amount below the minimum before looking at the token', async () => {
    tokenValuation = { valueSats: 500, receivableSats: 500 };

    const res = await postJson(`/api/unlock/${PWYW_STASH}`, {
      token: 'cashuToken500',
      amountSats: 500,
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /minimum for this stash is 1000/);
    assert.deepEqual(calls.swap, []);
  });

  it('treats a missing amount as the minimum', async () => {
    tokenValuation = { valueSats: 1_000, receivableSats: 1_000 };

    const res = await postJson(`/api/unlock/${PWYW_STASH}`, { token: 'cashuToken1000' });
    assert.equal(res.status, 200);
    assert.deepEqual(
      calls.swap.map((s) => s.amount),
      [1_000]
    );
  });

  it('keeps the fixed-price wording and behaviour unchanged', async () => {
    tokenValuation = { valueSats: 5_000, receivableSats: 5_000 };

    const res = await postJson(`/api/unlock/${FIXED_STASH}`, { token: 'cashuOverpaid' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /worth 5000 sats but the price is 100/);
  });

  it('returns the unlock again for a resubmitted token without swapping twice', async () => {
    tokenValuation = { valueSats: 4_000, receivableSats: 4_000 };
    const body = { token: 'cashuToken4000', amountSats: 4_000 };

    assert.equal((await postJson(`/api/unlock/${PWYW_STASH}`, body)).status, 200);
    const again = await postJson(`/api/unlock/${PWYW_STASH}`, body);

    assert.equal(again.status, 200);
    assert.equal(calls.swap.length, 1, 'a spent token must not be swapped again');
  });
});

describe('crash recovery: recoverMintFailures', () => {
  it('re-mints a crashed payment for its own amount', async () => {
    db.prepare(
      `INSERT INTO payments (id, stash_id, status, token_hash, amount_sats)
       VALUES (?, ?, 'mint_failed', ?, ?)`
    ).run('ln-crashed', PWYW_STASH, 'crashed-quote', 7_500);

    await recoverMintFailures();

    assert.deepEqual(calls.mint, [{ amount: 7_500, quote: 'crashed-quote' }]);
    assert.deepEqual(paymentRow('ln-crashed'), { status: 'paid', amount_sats: 7_500 });
  });

  it('re-mints a crash from before the migration at the stash price', async () => {
    db.prepare(
      `INSERT INTO payments (id, stash_id, status, token_hash) VALUES (?, ?, 'mint_failed', ?)`
    ).run('ln-old-crash', FIXED_STASH, 'old-crash-quote');

    await recoverMintFailures();

    assert.deepEqual(calls.mint, [{ amount: 100, quote: 'old-crash-quote' }]);
    assert.deepEqual(paymentRow('ln-old-crash'), { status: 'paid', amount_sats: 100 });
  });
});

describe('balances count what was actually paid', () => {
  // 5,000 on the 1,000-minimum stash, plus one old 100-sat payment with no
  // recorded amount: the true balance is 5,100. Counting the price would say 1,100.
  beforeEach(() => {
    insertPaidPayment('paid-pwyw', PWYW_STASH, 5_000);
    insertPaidPayment('paid-legacy', FIXED_STASH, null);
  });

  it('dashboard: per-stash earnings and the withdrawable total', async () => {
    const { data } = await (await app.request(`/api/dashboard/${SELLER}`)).json();

    const earned = Object.fromEntries(
      data.stashes.map((s: { id: string; totalEarned: number }) => [s.id, s.totalEarned])
    );
    assert.equal(earned[PWYW_STASH], 5_000);
    assert.equal(earned[FIXED_STASH], 100);
    assert.equal(data.earnings.totalSats, 5_100);

    const pwyw = data.stashes.find((s: { id: string }) => s.id === PWYW_STASH);
    assert.equal(pwyw.payWhatYouWant, true);
  });

  it('earnings route total', async () => {
    const { data } = await (await app.request(`/api/earnings/${SELLER}`)).json();
    assert.equal(data.totalSats, 5_100);
  });

  it('withdrawal quote total', async () => {
    const res = await postJson('/api/withdraw/quote', { invoice: 'lnbc5000test' });
    const { data } = await res.json();
    assert.equal(data.totalSats, 5_100);
    assert.equal(data.netSats, 5_098, 'total minus the mocked 2-sat fee');
  });

  it('auto-settlement compares the real balance with the threshold', async () => {
    // Counting prices (1,100) would sit below a 3,000 threshold and never
    // settle; the real 5,100 crosses it.
    db.prepare(
      `INSERT INTO seller_settings (pubkey, ln_address, auto_withdraw_threshold) VALUES (?, ?, ?)`
    ).run(SELLER, encrypt('seller@wallet.example'), 3_000);

    await tryAutoSettle(SELLER);

    assert.deepEqual(calls.resolveAddress, [5_100]);
  });
});
