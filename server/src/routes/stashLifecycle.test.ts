/**
 * Tests for a seller editing, unpublishing and deleting a stash.
 *
 * The mint is mocked so each test can see whether a payment ever reached it.
 * The rules under test: an edit never changes what past sales are worth; an
 * unpublished stash takes no new payments but honours every one already made;
 * a deleted stash keeps no key, is never deleted while a payment may still be
 * in flight, and never costs the seller their earnings.
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

// What each mocked mint call was asked for, in order.
const calls = {
  invoice: [] as number[],
  mint: [] as string[],
  swap: [] as string[],
};
// Runs while the mock mint is still answering, to model the seller acting in
// that window.
let whileMintAnswers: (() => void) | null = null;

mock.module('../lib/cashu.js', {
  namedExports: {
    createPaymentInvoice: async (amount: number) => {
      calls.invoice.push(amount);
      whileMintAnswers?.();
      return {
        invoice: `lnbc${amount}mock`,
        quoteId: `quote-${calls.invoice.length}`,
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      };
    },
    checkPaymentStatus: async () => ({ paid: true, issued: false }),
    mintAfterPayment: async (amount: number, quote: string) => {
      calls.mint.push(quote);
      return `cashuMinted-${amount}`;
    },
    verifyAndSwapToken: async (token: string, amount: number) => {
      calls.swap.push(token);
      return { success: true, sellerToken: `cashuSeller-${amount}` };
    },
    getTokenValuation: async () => {
      whileMintAnswers?.();
      return { valueSats: 100, receivableSats: 100 };
    },
    getMaxMintAmount: async () => 1_000_000,
    getTokenValue: () => 0,
    getMeltQuote: async () => ({ success: true, feeSats: 0, amountSats: 0 }),
    meltWithRecovery: async () => ({ success: false, error: 'not in this test' }),
    checkMeltQuoteStatus: async () => ({ state: 'UNPAID' }),
  },
});

const db = (await import('../db/index.js')).default;
const { encrypt, decrypt } = await import('../lib/encryption.js');
const { stashRoutes } = await import('./stash.js');
const { payRoutes } = await import('./pay.js');
const { unlockRoutes } = await import('./unlock.js');
const { sellerRoutes } = await import('./seller.js');
const { dashboardRoutes } = await import('./dashboard.js');
const { recoverMintFailures } = await import('../lib/recovery.js');
const { requireAuth } = await import('../middleware/auth.js');
const { createKeypair, makeNip98Header } = await import('../test/helpers.js');

const app = new Hono<{ Variables: AuthVariables }>();
app.patch('/api/stash/:id', requireAuth);
app.delete('/api/stash/:id', requireAuth);
app.use('/api/dashboard/*', requireAuth);
app.route('/api/stash', stashRoutes);
app.route('/api/pay', payRoutes);
app.route('/api/unlock', unlockRoutes);
app.route('/api/seller', sellerRoutes);
app.route('/api/dashboard', dashboardRoutes);

const seller = createKeypair();
const stranger = createKeypair();

const STASH = 'stash-lifecycle';
const FILE_KEY = 'file-key-that-must-not-survive';
const BLOB_URL = 'https://blossom.example.com/' + 'e'.repeat(64);
const BLOB_SHA = 'e'.repeat(64);

function insertStash(id = STASH) {
  db.prepare(
    `INSERT INTO stashes (id, blob_url, blob_sha256, secret_key, seller_pubkey, price_sats, title,
                          description, file_name, file_size, preview_url, generated_preview_payload,
                          preview_proof, preview_secret, show_in_storefront)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).run(
    id,
    encrypt(BLOB_URL),
    BLOB_SHA,
    encrypt(FILE_KEY),
    seller.pk,
    100,
    encrypt('Orignal title'),
    encrypt('First description'),
    encrypt('notes.pdf'),
    2048,
    'https://images.example.com/cover.png',
    encrypt(JSON.stringify({ preview: true })),
    encrypt(JSON.stringify({ proof: true })),
    encrypt(JSON.stringify({ contentSalt: 'f'.repeat(64) }))
  );
}

function insertPayment(
  id: string,
  status: string,
  opts: { amountSats?: number | null; ageSeconds?: number; claimToken?: string } = {}
) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO payments (id, stash_id, status, token_hash, seller_token, amount_sats, created_at,
                           paid_at, claim_token, claim_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    STASH,
    status,
    id.startsWith('ln-') ? id.slice(3) : `hash-${id}`,
    status === 'paid' ? encrypt(`cashuSeller-${id}`) : null,
    opts.amountSats === undefined ? 100 : opts.amountSats,
    now - (opts.ageSeconds ?? 0),
    status === 'paid' ? now : null,
    opts.claimToken ?? null,
    opts.claimToken ? now + 86_400 : null
  );
}

function stashRow() {
  return db.prepare('SELECT * FROM stashes WHERE id = ?').get(STASH) as Record<string, unknown>;
}

function paymentCount() {
  return (db.prepare('SELECT COUNT(*) AS n FROM payments').get() as { n: number }).n;
}

function signedRequest(method: string, path: string, body?: unknown, key = seller) {
  return app.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: makeNip98Header(method, `http://localhost${path}`, key.sk),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const editStash = (changes: unknown, key = seller) =>
  signedRequest('PATCH', `/api/stash/${STASH}`, changes, key);
const deleteStash = (key = seller, id = STASH) =>
  signedRequest('DELETE', `/api/stash/${id}`, undefined, key);
const getDashboard = async () =>
  (await (await signedRequest('GET', `/api/dashboard/${seller.pk}`)).json()).data;

function postJson(path: string, body?: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  db.exec('DELETE FROM payments');
  db.exec('DELETE FROM stashes');
  db.exec('DELETE FROM seller_settings');
  db.prepare('INSERT INTO seller_settings (pubkey, storefront_enabled) VALUES (?, 1)').run(
    seller.pk
  );
  calls.invoice.length = 0;
  calls.mint.length = 0;
  calls.swap.length = 0;
  whileMintAnswers = null;
  insertStash();
});

describe('PATCH /api/stash/:id: editing', () => {
  it('requires auth', async () => {
    const res = await app.request(`/api/stash/${STASH}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Hijacked' }),
    });
    assert.equal(res.status, 401);
  });

  it("refuses another seller's stash", async () => {
    const res = await editStash({ title: 'Hijacked' }, stranger);
    assert.equal(res.status, 403);
    assert.equal(decrypt(stashRow().title as string), 'Orignal title');
  });

  it('returns 404 for an unknown stash', async () => {
    const res = await signedRequest('PATCH', '/api/stash/no-such-stash', { title: 'x' });
    assert.equal(res.status, 404);
  });

  it('fixes a typo: stored encrypted, shown to buyers decrypted', async () => {
    const res = await editStash({ title: 'Original title', description: 'Better description' });
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.equal(data.title, 'Original title');
    assert.equal(data.description, 'Better description');

    const row = stashRow();
    assert.notEqual(row.title, 'Original title', 'title must be encrypted at rest');
    assert.equal(decrypt(row.title as string), 'Original title');
    assert.equal(decrypt(row.description as string), 'Better description');

    const publicInfo = (await (await app.request(`/api/stash/${STASH}`)).json()).data;
    assert.equal(publicInfo.title, 'Original title');
    assert.equal(publicInfo.description, 'Better description');
  });

  it('removes the description when sent an empty string', async () => {
    const { data } = await (await editStash({ description: '' })).json();
    assert.equal(data.description, undefined);
    assert.equal(stashRow().description, null);
  });

  it('rejects bad input and leaves the stash untouched', async () => {
    const bad: unknown[] = [
      {},
      [],
      { title: '   ' },
      { title: 'x'.repeat(201) },
      { description: 'x'.repeat(2001) },
      { description: null },
      { priceSats: 0 },
      { priceSats: 1.5 },
      { priceSats: '500' },
      { priceSats: 2 ** 60 },
      { payWhatYouWant: 'yes' },
      { published: 1 },
      // The file, its preview and its proofs are fixed at creation.
      { fileName: 'other.pdf' },
      { title: 'Fine', secretKey: 'swap-the-key' },
    ];
    for (const body of bad) {
      const res = await editStash(body);
      assert.equal(res.status, 400, `accepted ${JSON.stringify(body)}`);
    }
    const row = stashRow();
    assert.equal(decrypt(row.title as string), 'Orignal title');
    assert.equal(row.price_sats, 100);
    assert.equal(decrypt(row.secret_key as string), FILE_KEY);
  });

  it('a new price applies to new payments and never revalues past ones', async () => {
    // A sale from before pay-what-you-want recorded no amount, and is worth
    // whatever the stash price is; a later one recorded its own.
    insertPayment('legacy-sale', 'paid', { amountSats: null });
    insertPayment('tip-sale', 'paid', { amountSats: 250 });

    const res = await editStash({ priceSats: 500, payWhatYouWant: true });
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.equal(data.priceSats, 500);
    assert.equal(data.payWhatYouWant, true);

    const legacy = db.prepare('SELECT amount_sats FROM payments WHERE id = ?').get('legacy-sale');
    assert.deepEqual(legacy, { amount_sats: 100 }, 'pinned to the price it was paid at');

    const dashboard = await getDashboard();
    assert.equal(dashboard.stashes[0].totalEarned, 350);
    assert.equal(dashboard.earnings.totalSats, 350);
    assert.equal(dashboard.totalRevenueSats, 350);

    const invoice = await postJson(`/api/pay/${STASH}/invoice`);
    assert.equal(invoice.status, 200);
    assert.deepEqual(calls.invoice, [500]);
  });
});

describe('unpublishing', () => {
  it('stops new Lightning and Cashu payments before they reach the mint', async () => {
    const res = await editStash({ published: false });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).data.published, false);

    const invoice = await postJson(`/api/pay/${STASH}/invoice`);
    assert.equal(invoice.status, 409);
    assert.match((await invoice.json()).error, /not for sale/);

    const unlock = await postJson(`/api/unlock/${STASH}`, { token: 'cashuNewBuyer' });
    assert.equal(unlock.status, 409);

    assert.deepEqual(calls.invoice, []);
    assert.deepEqual(calls.swap, []);
    assert.equal(paymentCount(), 0);
  });

  it('keeps the page up, marked not for sale, but leaves it out of the storefront', async () => {
    await editStash({ published: false });

    const publicInfo = await app.request(`/api/stash/${STASH}`);
    assert.equal(publicInfo.status, 200);
    assert.equal((await publicInfo.json()).data.published, false);

    const manifest = (await (await app.request(`/api/stash/${STASH}/manifest`)).json()).data;
    assert.equal(manifest.published, false);

    const storefront = (await (await app.request(`/api/seller/${seller.pk}`)).json()).data;
    assert.deepEqual(storefront, []);
  });

  it('honours every payment made before it', async () => {
    // A buyer mid-way through a Lightning payment, and one who paid by Cashu.
    const { data: invoice } = await (await postJson(`/api/pay/${STASH}/invoice`)).json();
    insertPayment(`${STASH}-cashu`, 'paid', { claimToken: 'c'.repeat(64) });

    await editStash({ published: false });

    const status = await app.request(`/api/pay/${STASH}/status/${invoice.quoteId}`);
    assert.equal(status.status, 200);
    const statusData = (await status.json()).data;
    assert.equal(statusData.paid, true);
    assert.equal(statusData.secretKey, FILE_KEY, 'the invoice they paid still unlocks');
    assert.deepEqual(calls.mint, [invoice.quoteId]);

    const claim = await app.request(`/api/unlock/${STASH}/claim?token=${'c'.repeat(64)}`);
    assert.equal(claim.status, 200);
    assert.equal((await claim.json()).data.secretKey, FILE_KEY, 're-download still works');
  });

  it('still unlocks for a Cashu token that already paid', async () => {
    const token = 'cashuPaidBefore';
    const first = await postJson(`/api/unlock/${STASH}`, { token });
    assert.equal(first.status, 200);

    await editStash({ published: false });

    const again = await postJson(`/api/unlock/${STASH}`, { token });
    assert.equal(again.status, 200);
    assert.equal((await again.json()).data.secretKey, FILE_KEY);
    assert.equal(calls.swap.length, 1, 'the token is never swapped twice');
  });

  it('never shows an invoice made while the seller was unpublishing', async () => {
    whileMintAnswers = () => {
      db.prepare('UPDATE stashes SET published = 0 WHERE id = ?').run(STASH);
    };

    const res = await postJson(`/api/pay/${STASH}/invoice`);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).data, undefined, 'no invoice handed out');
    assert.equal(paymentCount(), 0);
  });

  it('never swaps a Cashu token valued while the seller was unpublishing', async () => {
    whileMintAnswers = () => {
      db.prepare('UPDATE stashes SET published = 0 WHERE id = ?').run(STASH);
    };

    const res = await postJson(`/api/unlock/${STASH}`, { token: 'cashuRacingBuyer' });
    assert.equal(res.status, 409);
    assert.deepEqual(calls.swap, []);
    assert.equal(paymentCount(), 0);
  });

  it('publishing again reopens sales', async () => {
    await editStash({ published: false });
    const res = await editStash({ published: true });
    assert.equal((await res.json()).data.published, true);

    const invoice = await postJson(`/api/pay/${STASH}/invoice`);
    assert.equal(invoice.status, 200);
  });
});

describe('DELETE /api/stash/:id', () => {
  it('requires auth and ownership', async () => {
    const anonymous = await app.request(`/api/stash/${STASH}`, { method: 'DELETE' });
    assert.equal(anonymous.status, 401);

    const notMine = await deleteStash(stranger);
    assert.equal(notMine.status, 403);

    const unknown = await deleteStash(seller, 'no-such-stash');
    assert.equal(unknown.status, 404);

    assert.equal(stashRow().deleted_at, null);
  });

  it('waits while someone may still be paying', async () => {
    // An open Lightning invoice, one being minted, and a Cashu swap mid-way.
    for (const [id, status] of [
      ['ln-open-invoice', 'pending'],
      ['ln-being-minted', 'processing'],
      [`${STASH}-swapping`, 'pending'],
    ]) {
      db.exec('DELETE FROM payments');
      insertPayment(id, status, { ageSeconds: 600 });

      const res = await deleteStash();
      assert.equal(res.status, 409, `deleted with a ${status} ${id}`);
      assert.match((await res.json()).error, /delete it in 50 minutes/);
    }

    const row = stashRow();
    assert.equal(row.deleted_at, null);
    assert.equal(decrypt(row.secret_key as string), FILE_KEY, 'the key must survive');
  });

  it('goes ahead once open invoices are more than an hour old', async () => {
    insertPayment('ln-expired-invoice', 'pending', { ageSeconds: 3601 });
    insertPayment(`${STASH}-failed`, 'failed');

    const res = await deleteStash();
    assert.equal(res.status, 200);
  });

  it('wipes the key and metadata, and says where the file is', async () => {
    const res = await deleteStash();
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).data, { blobUrl: BLOB_URL, blobSha256: BLOB_SHA });

    const row = stashRow();
    assert.equal(typeof row.deleted_at, 'number');
    assert.equal(row.published, 0);
    assert.equal(row.show_in_storefront, 0);
    for (const column of ['secret_key', 'title', 'file_name', 'blob_url']) {
      assert.equal(row[column], '', `${column} not wiped`);
    }
    for (const column of [
      'description',
      'blob_sha256',
      'preview_url',
      'generated_preview_payload',
      'preview_proof',
      'preview_secret',
      'key_backup',
    ]) {
      assert.equal(row[column], null, `${column} not wiped`);
    }
  });

  it('is gone for buyers, including those who paid before', async () => {
    insertPayment('ln-paid-quote', 'paid', { ageSeconds: 7200 });
    insertPayment(`${STASH}-cashu`, 'paid', { claimToken: 'c'.repeat(64), ageSeconds: 7200 });
    assert.equal((await deleteStash()).status, 200);

    const responses = {
      info: await app.request(`/api/stash/${STASH}`),
      manifest: await app.request(`/api/stash/${STASH}/manifest`),
      invoice: await postJson(`/api/pay/${STASH}/invoice`),
      newCashu: await postJson(`/api/unlock/${STASH}`, { token: 'cashuNewBuyer' }),
      paidQuote: await app.request(`/api/pay/${STASH}/status/paid-quote`),
      claim: await app.request(`/api/unlock/${STASH}/claim?token=${'c'.repeat(64)}`),
    };

    assert.equal(responses.info.status, 410);
    assert.equal(responses.manifest.status, 410);
    assert.equal(responses.invoice.status, 410);
    assert.equal(responses.newCashu.status, 410);
    assert.equal(responses.paidQuote.status, 410);
    assert.equal(responses.claim.status, 404);

    for (const [name, res] of Object.entries(responses)) {
      const body = await res.json();
      assert.equal(body.success, false, `${name} succeeded`);
      assert.ok(!JSON.stringify(body).includes(FILE_KEY), `${name} leaked the key`);
    }
    assert.deepEqual(calls.invoice, []);
    assert.deepEqual(calls.swap, []);

    const storefront = (await (await app.request(`/api/seller/${seller.pk}`)).json()).data;
    assert.deepEqual(storefront, []);
  });

  it("can't be edited or deleted again", async () => {
    await deleteStash();
    assert.equal((await editStash({ title: 'Back again' })).status, 404);
    assert.equal((await editStash({ published: true })).status, 404);
    assert.equal((await deleteStash()).status, 404);
  });

  it("keeps the seller's earnings", async () => {
    insertPayment('sale-1', 'paid', { amountSats: 100, ageSeconds: 7200 });
    insertPayment('sale-2', 'paid', { amountSats: 250, ageSeconds: 7200 });

    assert.equal((await deleteStash()).status, 200);

    const dashboard = await getDashboard();
    assert.deepEqual(dashboard.stashes, [], 'the stash itself is gone from the list');
    assert.equal(dashboard.earnings.totalSats, 350, 'unclaimed tokens are still withdrawable');
    assert.equal(dashboard.earnings.tokens.length, 2);
    assert.equal(dashboard.totalRevenueSats, 350);
  });

  it('crash recovery still credits a payment that was stuck minting', async () => {
    insertPayment('ln-stuck-quote', 'mint_failed', { amountSats: 300, ageSeconds: 7200 });

    assert.equal((await deleteStash()).status, 200);
    await recoverMintFailures();

    const row = db
      .prepare('SELECT status, amount_sats FROM payments WHERE id = ?')
      .get('ln-stuck-quote');
    assert.deepEqual(row, { status: 'paid', amount_sats: 300 });
    assert.equal((await getDashboard()).earnings.totalSats, 300);
  });

  it('mints an invoice paid after deletion rather than strand it, but hands out no key', async () => {
    // Only possible if the mint honours an invoice for longer than an hour.
    insertPayment('ln-late-quote', 'pending', { amountSats: 100, ageSeconds: 3700 });
    assert.equal((await deleteStash()).status, 200);

    const res = await app.request(`/api/pay/${STASH}/status/late-quote`);
    assert.equal(res.status, 410);
    assert.ok(!(await res.text()).includes(FILE_KEY));

    assert.deepEqual(calls.mint, ['late-quote']);
    const row = db.prepare('SELECT status FROM payments WHERE id = ?').get('ln-late-quote');
    assert.deepEqual(row, { status: 'paid' }, 'the seller is credited');
  });
});
