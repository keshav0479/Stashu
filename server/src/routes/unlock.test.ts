/**
 * Tests for Cashu token unlock route (validation paths).
 *
 * These tests cover input validation and idempotency without
 * requiring a live Cashu mint connection.
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
import { createHash } from 'node:crypto';

const db = (await import('../db/index.js')).default;
const { encrypt } = await import('../lib/encryption.js');
const { unlockRoutes } = await import('./unlock.js');

const app = new Hono();
app.route('/api/unlock', unlockRoutes);

const TEST_STASH = {
  id: 'stash-unlock-001',
  blobUrl: 'https://blossom.example.com/encrypted-blob',
  secretKey: 'unlock-secret-key-abc',
  fileName: 'secret.pdf',
  priceSats: 100,
};

const PREVIEW_SECRET = { contentSalt: 'd'.repeat(64) };

function insertStash(id = TEST_STASH.id, previewSecret?: typeof PREVIEW_SECRET) {
  db.prepare(
    `INSERT INTO stashes (
       id, blob_url, secret_key, preview_secret, seller_pubkey, price_sats, title, file_name, file_size
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    encrypt(TEST_STASH.blobUrl),
    encrypt(TEST_STASH.secretKey),
    previewSecret ? encrypt(JSON.stringify(previewSecret)) : null,
    'seller-pubkey',
    TEST_STASH.priceSats,
    encrypt('Test Stash'),
    encrypt(TEST_STASH.fileName),
    1024
  );
}

function insertPayment(stashId: string, token: string, status: string, sellerToken?: string) {
  const hash = createHash('sha256').update(token).digest('hex');
  db.prepare(
    `INSERT INTO payments (id, stash_id, status, token_hash, seller_token, paid_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    `${stashId}-${hash}`,
    stashId,
    status,
    hash,
    sellerToken ? encrypt(sellerToken) : null,
    status === 'paid' ? Math.floor(Date.now() / 1000) : null
  );
}

beforeEach(() => {
  db.exec('DELETE FROM payments');
  db.exec('DELETE FROM stashes');
});

describe('POST /api/unlock/:id', () => {
  it('rejects missing token', async () => {
    const res = await app.request('/api/unlock/any-id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /[Tt]oken.*required/);
  });

  it('returns 404 for non-existent stash', async () => {
    const res = await app.request('/api/unlock/nonexistent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'cashuTestToken' }),
    });
    assert.equal(res.status, 404);
  });

  it('returns unlock data with claimToken for already-paid token (idempotent)', async () => {
    insertStash();
    insertPayment(TEST_STASH.id, 'cashuPaidToken', 'paid', 'cashuSellerToken');

    const res = await app.request(`/api/unlock/${TEST_STASH.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'cashuPaidToken' }),
    });
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.equal(data.secretKey, TEST_STASH.secretKey);
    assert.equal(data.blobUrl, TEST_STASH.blobUrl);
    assert.equal(data.fileName, TEST_STASH.fileName);
    assert.ok(data.claimToken, 'should return a claimToken');
    assert.equal(data.claimToken.length, 64, 'claimToken should be 64 hex chars');
  });

  it('returns preview secret after an already-paid unlock', async () => {
    insertStash(TEST_STASH.id, PREVIEW_SECRET);
    insertPayment(TEST_STASH.id, 'cashuPaidToken', 'paid', 'cashuSellerToken');

    const res = await app.request(`/api/unlock/${TEST_STASH.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'cashuPaidToken' }),
    });
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.deepEqual(data.previewSecret, PREVIEW_SECRET);
  });

  it('returns 409 for pending payment', async () => {
    insertStash();
    insertPayment(TEST_STASH.id, 'cashuPendingToken', 'pending');

    const res = await app.request(`/api/unlock/${TEST_STASH.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'cashuPendingToken' }),
    });
    assert.equal(res.status, 409);
  });

  it('returns 400 for previously failed payment', async () => {
    insertStash();
    insertPayment(TEST_STASH.id, 'cashuFailedToken', 'failed');

    const res = await app.request(`/api/unlock/${TEST_STASH.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'cashuFailedToken' }),
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /failed/i);
  });
});

describe('GET /api/unlock/:id/claim', () => {
  function insertPaidPaymentWithClaim(stashId: string, claimToken: string, claimExpiresAt: number) {
    db.prepare(
      `INSERT INTO payments (id, stash_id, status, token_hash, seller_token, claim_token, claim_expires_at, paid_at)
       VALUES (?, ?, 'paid', ?, ?, ?, ?, ?)`
    ).run(
      `${stashId}-claim-test`,
      stashId,
      'claim-hash',
      encrypt('cashuSellerToken'),
      claimToken,
      claimExpiresAt,
      Math.floor(Date.now() / 1000)
    );
  }

  it('returns unlock data for valid claim token', async () => {
    insertStash(TEST_STASH.id, PREVIEW_SECRET);
    const claimToken = 'a'.repeat(64);
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    insertPaidPaymentWithClaim(TEST_STASH.id, claimToken, expiresAt);

    const res = await app.request(`/api/unlock/${TEST_STASH.id}/claim?token=${claimToken}`);
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.equal(data.secretKey, TEST_STASH.secretKey);
    assert.equal(data.blobUrl, TEST_STASH.blobUrl);
    assert.equal(data.fileName, TEST_STASH.fileName);
    assert.deepEqual(data.previewSecret, PREVIEW_SECRET);
  });

  it('returns 400 when token query param is missing', async () => {
    const res = await app.request(`/api/unlock/${TEST_STASH.id}/claim`);
    assert.equal(res.status, 400);
  });

  it('returns 404 for invalid claim token', async () => {
    insertStash();
    const res = await app.request(`/api/unlock/${TEST_STASH.id}/claim?token=${'b'.repeat(64)}`);
    assert.equal(res.status, 404);
  });

  it('returns 410 for expired claim token', async () => {
    insertStash();
    const claimToken = 'c'.repeat(64);
    const expiredAt = Math.floor(Date.now() / 1000) - 100; // expired 100s ago
    insertPaidPaymentWithClaim(TEST_STASH.id, claimToken, expiredAt);

    const res = await app.request(`/api/unlock/${TEST_STASH.id}/claim?token=${claimToken}`);
    assert.equal(res.status, 410);
    assert.match((await res.json()).error, /expired/i);
  });

  it('returns 404 when claim token belongs to a different stash', async () => {
    insertStash();
    insertStash('other-stash');
    const claimToken = 'd'.repeat(64);
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;
    insertPaidPaymentWithClaim('other-stash', claimToken, expiresAt);

    const res = await app.request(`/api/unlock/${TEST_STASH.id}/claim?token=${claimToken}`);
    assert.equal(res.status, 404);
  });

  it('returns 404 for non-existent stash', async () => {
    const res = await app.request(`/api/unlock/nonexistent/claim?token=${'e'.repeat(64)}`);
    assert.equal(res.status, 404);
  });
});
