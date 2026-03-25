/**
 * Tests for claim token generation on fresh payment success paths.
 *
 * These tests mock the Cashu mint functions to verify that claim tokens
 * are generated and returned during fresh (non-idempotent) payments.
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

// Mock Cashu module before any route imports
mock.module('../lib/cashu.js', {
  namedExports: {
    verifyAndSwapToken: async () => ({
      success: true,
      sellerToken: 'cashuMockedSellerToken',
    }),
    checkPaymentStatus: async () => ({ paid: true }),
    mintAfterPayment: async () => 'cashuMintedToken',
    createPaymentInvoice: async () => ({
      invoice: 'lnbc1mock',
      quoteId: 'mock-quote',
      expiresAt: Math.floor(Date.now() / 1000) + 600,
    }),
    getWallet: async () => ({}),
    getTokenValue: () => 100,
    getMeltQuote: async () => ({ success: true }),
    meltWithRecovery: async () => ({}),
    checkMeltQuoteStatus: async () => ({}),
  },
});

const db = (await import('../db/index.js')).default;
const { encrypt } = await import('../lib/encryption.js');
const { unlockRoutes } = await import('./unlock.js');
const { payRoutes } = await import('./pay.js');

const unlockApp = new Hono();
unlockApp.route('/api/unlock', unlockRoutes);

const payApp = new Hono();
payApp.route('/api/pay', payRoutes);

const TEST_STASH = {
  id: 'stash-claim-fresh-001',
  blobUrl: 'https://blossom.example.com/encrypted-blob',
  secretKey: 'claim-test-secret-key',
  fileName: 'secret.pdf',
  priceSats: 100,
  sellerPubkey: 'seller-pubkey-abc',
};

function insertStash(id = TEST_STASH.id) {
  db.prepare(
    `INSERT INTO stashes (id, blob_url, secret_key, seller_pubkey, price_sats, title, file_name, file_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    TEST_STASH.blobUrl,
    encrypt(TEST_STASH.secretKey),
    TEST_STASH.sellerPubkey,
    TEST_STASH.priceSats,
    encrypt('Test Stash'),
    encrypt(TEST_STASH.fileName),
    1024
  );
}

beforeEach(() => {
  db.exec('DELETE FROM payments');
  db.exec('DELETE FROM stashes');
});

describe('Fresh Cashu payment returns claimToken', () => {
  it('includes claimToken in response after successful swap', async () => {
    insertStash();

    const res = await unlockApp.request(`/api/unlock/${TEST_STASH.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'cashuFreshToken123' }),
    });

    assert.equal(res.status, 200);
    const { success, data } = await res.json();
    assert.equal(success, true);
    assert.equal(data.secretKey, TEST_STASH.secretKey);
    assert.equal(data.blobUrl, TEST_STASH.blobUrl);
    assert.equal(data.fileName, TEST_STASH.fileName);
    assert.ok(data.claimToken, 'should return a claimToken');
    assert.equal(data.claimToken.length, 64, 'claimToken should be 64 hex chars');

    // Verify claim token is persisted in DB
    const payment = db
      .prepare('SELECT claim_token, claim_expires_at FROM payments WHERE stash_id = ?')
      .get(TEST_STASH.id) as { claim_token: string; claim_expires_at: number };
    assert.equal(payment.claim_token, data.claimToken);
    assert.ok(
      payment.claim_expires_at > Math.floor(Date.now() / 1000),
      'claim_expires_at should be in the future'
    );
  });
});

describe('Fresh Lightning payment returns claimToken', () => {
  it('includes claimToken in response after successful mint and swap', async () => {
    insertStash();

    // Insert a pending Lightning payment (simulates invoice creation)
    const quoteId = 'test-ln-quote';
    db.prepare(
      `INSERT INTO payments (id, stash_id, status, token_hash) VALUES (?, ?, 'pending', ?)`
    ).run(`ln-${quoteId}`, TEST_STASH.id, quoteId);

    // Poll the status — should trigger mint + swap + return claimToken
    const res = await payApp.request(`/api/pay/${TEST_STASH.id}/status/${quoteId}`);

    assert.equal(res.status, 200);
    const { success, data } = await res.json();
    assert.equal(success, true);
    assert.equal(data.paid, true);
    assert.equal(data.secretKey, TEST_STASH.secretKey);
    assert.ok(data.claimToken, 'should return a claimToken');
    assert.equal(data.claimToken.length, 64, 'claimToken should be 64 hex chars');

    // Verify claim token is persisted in DB
    const payment = db
      .prepare('SELECT claim_token, claim_expires_at FROM payments WHERE id = ?')
      .get(`ln-${quoteId}`) as { claim_token: string; claim_expires_at: number };
    assert.equal(payment.claim_token, data.claimToken);
    assert.ok(
      payment.claim_expires_at > Math.floor(Date.now() / 1000),
      'claim_expires_at should be in the future'
    );
  });
});
