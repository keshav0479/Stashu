/**
 * Tests for Lightning payment routes (validation paths).
 *
 * These tests cover quote binding, anti-replay, and already-paid
 * paths without requiring a live Cashu mint connection.
 *
 * Run with: npm test --workspace=server
 */

// Set env before any db-dependent imports
if (!process.env.TOKEN_ENCRYPTION_KEY) {
  const { randomBytes } = await import('node:crypto');
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
}
process.env.DB_PATH = ':memory:';

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';

const db = (await import('../db/index.js')).default;
const { encrypt } = await import('../lib/encryption.js');
const { payRoutes } = await import('./pay.js');

const app = new Hono();
app.route('/api/pay', payRoutes);

const TEST_STASH_ID = 'stash-pay-001';

function insertStash(id = TEST_STASH_ID) {
  db.prepare(
    `INSERT INTO stashes (id, blob_url, secret_key, seller_pubkey, price_sats, title, file_name, file_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    'https://blossom.example.com/blob',
    encrypt('pay-secret-key'),
    'seller-pubkey',
    100,
    encrypt('Test'),
    encrypt('file.pdf'),
    1024
  );
}

beforeEach(() => {
  db.exec('DELETE FROM payments');
  db.exec('DELETE FROM stashes');
});

describe('POST /api/pay/:id/invoice', () => {
  it('returns 404 for non-existent stash', async () => {
    const res = await app.request('/api/pay/nonexistent/invoice', { method: 'POST' });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).success, false);
  });
});

describe('GET /api/pay/:id/status/:quoteId', () => {
  it('returns 404 for unknown quote', async () => {
    insertStash();
    const res = await app.request(`/api/pay/${TEST_STASH_ID}/status/unknown-quote`);
    assert.equal(res.status, 404);
    assert.match((await res.json()).error, /[Uu]nknown quote/);
  });

  it('rejects quote bound to different stash (anti-replay)', async () => {
    insertStash();
    // Insert a second stash so the FK constraint is satisfied
    insertStash('other-stash-id');
    db.prepare(
      `INSERT INTO payments (id, stash_id, status, token_hash) VALUES (?, ?, 'pending', ?)`
    ).run('ln-replay-quote', 'other-stash-id', 'replay-quote');

    const res = await app.request(`/api/pay/${TEST_STASH_ID}/status/replay-quote`);
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /does not match/i);
  });

  it('returns unlock data with claimToken when already paid', async () => {
    insertStash();
    db.prepare(
      `INSERT INTO payments (id, stash_id, status, token_hash, seller_token, paid_at)
       VALUES (?, ?, 'paid', ?, ?, ?)`
    ).run(
      'ln-paid-quote',
      TEST_STASH_ID,
      'paid-quote',
      encrypt('cashuSellerToken'),
      Math.floor(Date.now() / 1000)
    );

    const res = await app.request(`/api/pay/${TEST_STASH_ID}/status/paid-quote`);
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.equal(data.paid, true);
    assert.equal(data.secretKey, 'pay-secret-key');
    assert.equal(data.blobUrl, 'https://blossom.example.com/blob');
    assert.equal(data.fileName, 'file.pdf');
    assert.ok(data.claimToken, 'should return a claimToken');
    assert.equal(data.claimToken.length, 64, 'claimToken should be 64 hex chars');
  });
});
