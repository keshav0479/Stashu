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

function insertStash(id = TEST_STASH.id) {
  db.prepare(
    `INSERT INTO stashes (id, blob_url, secret_key, seller_pubkey, price_sats, title, file_name, file_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    TEST_STASH.blobUrl,
    encrypt(TEST_STASH.secretKey),
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

  it('returns unlock data for already-paid token (idempotent)', async () => {
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
