/**
 * Tests for seller storefront public endpoint.
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
const { sellerRoutes } = await import('./seller.js');
const { stashRoutes } = await import('./stash.js');
const { requireAuth } = await import('../middleware/auth.js');
const { encrypt } = await import('../lib/encryption.js');
const { createKeypair, makeNip98Header } = await import('../test/helpers.js');

type AuthVars = { authedPubkey: string };
const app = new Hono<{ Variables: AuthVars }>();
app.post('/api/stash', requireAuth);
app.post('/api/stash/:id/visibility', requireAuth);
app.route('/api/stash', stashRoutes);
app.route('/api/seller', sellerRoutes);

const { sk, pk } = createKeypair();
const { pk: otherPk } = createKeypair();

function auth(method: string, path: string) {
  return makeNip98Header(method, `http://localhost${path}`, sk);
}

const PREVIEW_BUNDLE = {
  generatedPreview: {
    version: 'stashu-generated-preview-v1',
    kind: 'file-summary',
    fileName: 'file.pdf',
    fileType: 'application/pdf',
    fileSize: 1024,
    contentType: 'application/octet-stream',
    options: {},
    metadata: { reason: 'unsupported-type' },
    bytes: '',
  },
  previewProof: {
    version: 'stashu-preview-v1',
    root: 'a'.repeat(64),
    previewHash: 'b'.repeat(64),
    contentMerkleRoot: 'c'.repeat(64),
    contentLength: 1024,
    chunkSize: 65_536,
  },
};

function insertStash(
  opts: { showInStorefront?: number; sellerPubkey?: string; withPreviewProof?: boolean } = {}
) {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO stashes (
       id, blob_url, secret_key, seller_pubkey, price_sats, title, file_name,
       file_size, generated_preview_payload, preview_proof, show_in_storefront, created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`
  ).run(
    id,
    'https://blossom.example.com/abc',
    encrypt('secret-key'),
    opts.sellerPubkey ?? pk,
    100,
    encrypt('Test Stash'),
    encrypt('file.pdf'),
    1024,
    opts.withPreviewProof ? encrypt(JSON.stringify(PREVIEW_BUNDLE.generatedPreview)) : null,
    opts.withPreviewProof ? encrypt(JSON.stringify(PREVIEW_BUNDLE.previewProof)) : null,
    opts.showInStorefront ?? 0
  );
  return id;
}

function enableStorefront(pubkey: string) {
  db.prepare(
    `INSERT INTO seller_settings (pubkey, storefront_enabled, updated_at)
     VALUES (?, 1, unixepoch())
     ON CONFLICT(pubkey) DO UPDATE SET storefront_enabled = 1, updated_at = unixepoch()`
  ).run(pubkey);
}

beforeEach(() => {
  db.exec('DELETE FROM payments');
  db.exec('DELETE FROM stashes');
  db.exec('DELETE FROM seller_settings');
});

describe('GET /api/seller/:pubkey', () => {
  it('returns 400 for invalid pubkey format', async () => {
    const res = await app.request('/api/seller/not-a-hex-pubkey');
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
    assert.match(body.error, /pubkey/i);
  });

  it('returns 404 for unknown seller', async () => {
    const fakePk = 'a'.repeat(64);
    const res = await app.request(`/api/seller/${fakePk}`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Seller not found');
  });

  it('returns 404 when storefront is not enabled', async () => {
    insertStash({ showInStorefront: 1 });
    // No seller_settings row → storefront not enabled
    const res = await app.request(`/api/seller/${pk}`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Storefront is not enabled');
  });

  it('returns 404 when storefront is explicitly disabled', async () => {
    insertStash({ showInStorefront: 1 });
    db.prepare(
      `INSERT INTO seller_settings (pubkey, storefront_enabled, updated_at) VALUES (?, 0, unixepoch())`
    ).run(pk);
    const res = await app.request(`/api/seller/${pk}`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.error, 'Storefront is not enabled');
  });

  it('returns empty array when storefront enabled but no visible stashes', async () => {
    insertStash({ showInStorefront: 0 }); // hidden
    enableStorefront(pk);
    const res = await app.request(`/api/seller/${pk}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.length, 0);
  });

  it('returns only visible stashes with decrypted metadata', async () => {
    const visibleId = insertStash({ showInStorefront: 1 });
    insertStash({ showInStorefront: 0 }); // hidden
    enableStorefront(pk);

    const res = await app.request(`/api/seller/${pk}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].id, visibleId);
    assert.equal(body.data[0].title, 'Test Stash');
    assert.equal(body.data[0].fileName, 'file.pdf');
    assert.equal(body.data[0].priceSats, 100);
  });

  it('returns generated preview proof fields for visible stashes', async () => {
    insertStash({ showInStorefront: 1, withPreviewProof: true });
    enableStorefront(pk);

    const res = await app.request(`/api/seller/${pk}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.data[0].generatedPreview, PREVIEW_BUNDLE.generatedPreview);
    assert.deepEqual(body.data[0].previewProof, PREVIEW_BUNDLE.previewProof);
    assert.equal(body.data[0].previewSecret, undefined);
  });

  it('does not return stashes from other sellers', async () => {
    insertStash({ showInStorefront: 1, sellerPubkey: otherPk });
    insertStash({ showInStorefront: 1 });
    enableStorefront(pk);

    const res = await app.request(`/api/seller/${pk}`);
    const body = await res.json();
    assert.equal(body.data.length, 1);
  });
});

describe('POST /api/stash/:id/visibility', () => {
  it('returns 404 for non-existent stash', async () => {
    const path = '/api/stash/nonexistent/visibility';
    const res = await app.request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth('POST', path),
      },
      body: JSON.stringify({ showInStorefront: true }),
    });
    assert.equal(res.status, 404);
  });

  it('returns 400 for malformed JSON body', async () => {
    const id = insertStash();
    const path = `/api/stash/${id}/visibility`;
    const res = await app.request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth('POST', path),
      },
      body: 'not json',
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /json/i);
  });

  it('returns 400 for non-boolean showInStorefront', async () => {
    const id = insertStash();
    const path = `/api/stash/${id}/visibility`;
    const res = await app.request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth('POST', path),
      },
      body: JSON.stringify({ showInStorefront: 'yes' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /boolean/i);
  });

  it('returns 403 when toggling another sellers stash', async () => {
    const id = insertStash({ sellerPubkey: otherPk });
    const path = `/api/stash/${id}/visibility`;
    const res = await app.request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth('POST', path),
      },
      body: JSON.stringify({ showInStorefront: true }),
    });
    assert.equal(res.status, 403);
  });

  it('toggles visibility on', async () => {
    const id = insertStash({ showInStorefront: 0 });
    const path = `/api/stash/${id}/visibility`;
    const res = await app.request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth('POST', path),
      },
      body: JSON.stringify({ showInStorefront: true }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.data.showInStorefront, true);

    // Verify in DB
    const row = db.prepare('SELECT show_in_storefront FROM stashes WHERE id = ?').get(id) as {
      show_in_storefront: number;
    };
    assert.equal(row.show_in_storefront, 1);
  });

  it('toggles visibility off', async () => {
    const id = insertStash({ showInStorefront: 1 });
    const path = `/api/stash/${id}/visibility`;
    const res = await app.request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth('POST', path),
      },
      body: JSON.stringify({ showInStorefront: false }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.showInStorefront, false);

    const row = db.prepare('SELECT show_in_storefront FROM stashes WHERE id = ?').get(id) as {
      show_in_storefront: number;
    };
    assert.equal(row.show_in_storefront, 0);
  });
});
