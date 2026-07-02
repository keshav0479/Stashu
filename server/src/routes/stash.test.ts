/**
 * Tests for stash creation and retrieval routes.
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
import { DEFAULT_DOWNLOAD_WINDOW_SECONDS } from '../../../shared/types.js';

const db = (await import('../db/index.js')).default;
const { decrypt } = await import('../lib/encryption.js');
const { stashRoutes } = await import('./stash.js');
const { requireAuth } = await import('../middleware/auth.js');
const { createKeypair, makeNip98Header } = await import('../test/helpers.js');

type AuthVars = { authedPubkey: string };
const app = new Hono<{ Variables: AuthVars }>();
app.post('/api/stash', requireAuth);
app.route('/api/stash', stashRoutes);

const { sk, pk } = createKeypair();

function auth(method: string, path: string) {
  return makeNip98Header(method, `http://localhost${path}`, sk);
}

function validBody() {
  return {
    blobUrl: 'https://blossom.example.com/abc123',
    secretKey: 'test-secret-key-xyz',
    title: 'Test File',
    fileName: 'document.pdf',
    priceSats: 100,
    fileSize: 1024,
  };
}

function validPreviewBundle(body = validBody()) {
  return {
    generatedPreview: {
      version: 'stashu-generated-preview-v1',
      kind: 'file-summary',
      fileName: body.fileName,
      fileType: 'application/pdf',
      fileSize: body.fileSize,
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
      contentLength: body.fileSize,
      chunkSize: 65_536,
    },
    previewSecret: {
      contentSalt: 'd'.repeat(64),
    },
  };
}

function validSealedPreviewBundle(body = validBody()) {
  const bundle = validPreviewBundle(body);
  const blobSha256 = 'e'.repeat(64);
  return {
    blobFormat: 'stashu-selective-v1',
    blobSha256,
    secretKey: `stashu-selective-v1:${'A'.repeat(43)}=`,
    ...bundle,
    previewProof: {
      ...bundle.previewProof,
      version: 'stashu-preview-v2',
      sealedBlobSha256: blobSha256,
    },
  };
}

function base64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

async function createStash(body: Record<string, unknown> = validBody()) {
  return app.request('/api/stash', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: auth('POST', '/api/stash'),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  db.exec('DELETE FROM payments');
  db.exec('DELETE FROM stashes');
});

describe('POST /api/stash', () => {
  it('requires auth', async () => {
    const res = await app.request('/api/stash', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody()),
    });
    assert.equal(res.status, 401);
  });

  it('rejects missing required fields', async () => {
    const res = await createStash({ priceSats: 100 });
    assert.equal(res.status, 400);
  });

  it('rejects invalid blobUrl', async () => {
    const res = await createStash({ ...validBody(), blobUrl: 'not-a-url' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /blobUrl/i);
  });

  it('rejects zero price', async () => {
    const res = await createStash({ ...validBody(), priceSats: 0 });
    assert.equal(res.status, 400);
  });

  it('rejects negative price', async () => {
    const res = await createStash({ ...validBody(), priceSats: -5 });
    assert.equal(res.status, 400);
  });

  it('rejects float price', async () => {
    const res = await createStash({ ...validBody(), priceSats: 10.5 });
    assert.equal(res.status, 400);
  });

  it('rejects title over 200 chars', async () => {
    const res = await createStash({ ...validBody(), title: 'x'.repeat(201) });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /title/i);
  });

  it('rejects description over 2000 chars', async () => {
    const res = await createStash({ ...validBody(), description: 'x'.repeat(2001) });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /description/i);
  });

  it('rejects file size over 100MB', async () => {
    const res = await createStash({ ...validBody(), fileSize: 100 * 1024 * 1024 + 1 });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /fileSize/i);
  });

  it('rejects zero file size', async () => {
    const res = await createStash({ ...validBody(), fileSize: 0 });
    assert.equal(res.status, 400);
  });

  it('creates stash with valid data', async () => {
    const res = await createStash();
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.id);
    assert.ok(body.data.shareUrl.startsWith('/s/'));
  });

  it('rejects a downloadWindowSeconds outside the allowed set', async () => {
    const res = await createStash({ ...validBody(), downloadWindowSeconds: 12_345 });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /downloadWindowSeconds/i);
  });

  it('stores a valid downloadWindowSeconds', async () => {
    const res = await createStash({ ...validBody(), downloadWindowSeconds: 86_400 });
    assert.equal(res.status, 201);
    const { data } = await res.json();
    const row = db
      .prepare('SELECT download_window_seconds FROM stashes WHERE id = ?')
      .get(data.id) as { download_window_seconds: number };
    assert.equal(row.download_window_seconds, 86_400);
  });

  it('stores generated preview proof fields when provided', async () => {
    const input = { ...validBody(), ...validPreviewBundle() };
    const res = await createStash(input);
    assert.equal(res.status, 201);
    const { data } = await res.json();

    const row = db
      .prepare(
        `SELECT generated_preview_payload, preview_proof, preview_secret
         FROM stashes WHERE id = ?`
      )
      .get(data.id) as {
      generated_preview_payload: string;
      preview_proof: string;
      preview_secret: string;
    };

    assert.notEqual(row.generated_preview_payload, JSON.stringify(input.generatedPreview));
    assert.notEqual(row.preview_proof, JSON.stringify(input.previewProof));
    assert.deepEqual(JSON.parse(decrypt(row.generated_preview_payload)), input.generatedPreview);
    assert.deepEqual(JSON.parse(decrypt(row.preview_proof)), input.previewProof);
    assert.notEqual(row.preview_secret, JSON.stringify(input.previewSecret));
    assert.deepEqual(JSON.parse(decrypt(row.preview_secret)), input.previewSecret);
  });

  it('stores a sealed package only when its v2 proof binds the blob hash', async () => {
    const input = { ...validBody(), ...validSealedPreviewBundle() };
    const res = await createStash(input);
    assert.equal(res.status, 201);
    const { data } = await res.json();

    const row = db.prepare('SELECT blob_format FROM stashes WHERE id = ?').get(data.id) as {
      blob_format: string;
    };
    assert.equal(row.blob_format, 'stashu-selective-v1');
  });

  it('rejects a sealed package whose v2 proof binds a different blob hash', async () => {
    const bundle = validSealedPreviewBundle();
    const res = await createStash({
      ...validBody(),
      ...bundle,
      blobSha256: 'f'.repeat(64),
    });

    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /hash/i);
  });

  it('rejects a sealed package without generated preview proof fields', async () => {
    const res = await createStash({
      ...validBody(),
      blobFormat: 'stashu-selective-v1',
      blobSha256: 'e'.repeat(64),
      secretKey: `stashu-selective-v1:${'A'.repeat(43)}=`,
    });

    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /proof/i);
  });

  it('rejects a sealed package with a malformed package key', async () => {
    const res = await createStash({
      ...validBody(),
      ...validSealedPreviewBundle(),
      secretKey: 'not-a-sealed-key',
    });

    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /secretKey/i);
  });

  it('rejects a sealed package URL that could trigger a local-network fetch', async () => {
    const res = await createStash({
      ...validBody(),
      ...validSealedPreviewBundle(),
      blobUrl: 'http://127.0.0.1/private-service',
    });

    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /public HTTPS/i);
  });

  it('allows local sealed package URLs only with an explicit development opt-in', async () => {
    const original = process.env.ALLOW_INSECURE_BLOSSOM_URLS;
    process.env.ALLOW_INSECURE_BLOSSOM_URLS = '1';

    try {
      const res = await createStash({
        ...validBody(),
        ...validSealedPreviewBundle(),
        blobUrl: 'http://127.0.0.1:3001/local-blob',
      });

      assert.equal(res.status, 201);
    } finally {
      if (original === undefined) {
        delete process.env.ALLOW_INSECURE_BLOSSOM_URLS;
      } else {
        process.env.ALLOW_INSECURE_BLOSSOM_URLS = original;
      }
    }
  });

  it('rejects partial preview bundles', async () => {
    const res = await createStash({
      ...validBody(),
      generatedPreview: validPreviewBundle().generatedPreview,
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /provided together/i);
  });

  it('rejects invalid preview proof hashes', async () => {
    const bundle = validPreviewBundle();
    const res = await createStash({
      ...validBody(),
      ...bundle,
      previewProof: { ...bundle.previewProof, contentMerkleRoot: 'bad' },
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /previewProof/i);
  });

  it('requires inclusion proof for text previews', async () => {
    const body = validBody();
    const bundle = validSealedPreviewBundle(body);
    const res = await createStash({
      ...body,
      ...bundle,
      generatedPreview: {
        version: 'stashu-generated-preview-v1',
        kind: 'text-peek',
        fileName: body.fileName,
        fileType: 'text/plain',
        fileSize: body.fileSize,
        contentType: 'text/plain; charset=utf-8',
        options: {
          mode: 'auto',
          lineLimit: 10,
          maxBytes: 16_384,
          maxChars: 4_000,
          maxPreviewRatio: 0.15,
        },
        metadata: {
          offset: 0,
          lineLimit: 10,
          linesIncluded: 1,
          bytesRead: 7,
          previewBytes: 7,
          truncated: true,
        },
        bytes: 'cHJldmlldw',
      },
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /inclusion/i);
  });

  it('rejects text preview metadata that does not match preview bytes', async () => {
    const body = validBody();
    const bundle = validSealedPreviewBundle(body);
    const res = await createStash({
      ...body,
      ...bundle,
      generatedPreview: {
        version: 'stashu-generated-preview-v1',
        kind: 'text-peek',
        fileName: body.fileName,
        fileType: 'text/plain',
        fileSize: body.fileSize,
        contentType: 'text/plain; charset=utf-8',
        options: {
          mode: 'auto',
          lineLimit: 10,
          maxBytes: 16_384,
          maxChars: 4_000,
          maxPreviewRatio: 0.15,
        },
        metadata: {
          offset: 0,
          lineLimit: 10,
          linesIncluded: 1,
          bytesRead: 7,
          previewBytes: 8,
          truncated: true,
        },
        bytes: 'cHJldmlldw',
      },
      previewProof: {
        ...bundle.previewProof,
        previewInclusion: {
          offset: 0,
          length: 8,
          leafHash: 'e'.repeat(64),
          path: [],
        },
      },
    });

    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /generatedPreview/i);
  });

  it('rejects text previews above the declared preview ratio', async () => {
    const body = validBody();
    const bundle = validSealedPreviewBundle(body);
    const res = await createStash({
      ...body,
      ...bundle,
      generatedPreview: {
        version: 'stashu-generated-preview-v1',
        kind: 'text-peek',
        fileName: body.fileName,
        fileType: 'text/plain',
        fileSize: body.fileSize,
        contentType: 'text/plain; charset=utf-8',
        options: {
          mode: 'auto',
          lineLimit: 10,
          maxBytes: 16_384,
          maxChars: 4_000,
          maxPreviewRatio: 0.05,
        },
        metadata: {
          offset: 0,
          lineLimit: 10,
          linesIncluded: 1,
          bytesRead: 60,
          previewBytes: 60,
          truncated: true,
        },
        bytes: 'a'.repeat(80),
      },
      previewProof: {
        ...bundle.previewProof,
        previewInclusion: {
          offset: 0,
          length: 60,
          leafHash: 'e'.repeat(64),
          path: [],
        },
      },
    });

    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /generatedPreview/i);
  });

  it('rejects text preview ratios above the server cap', async () => {
    const body = validBody();
    const bundle = validSealedPreviewBundle(body);
    const res = await createStash({
      ...body,
      ...bundle,
      generatedPreview: {
        version: 'stashu-generated-preview-v1',
        kind: 'text-peek',
        fileName: body.fileName,
        fileType: 'text/plain',
        fileSize: body.fileSize,
        contentType: 'text/plain; charset=utf-8',
        options: {
          mode: 'auto',
          lineLimit: 10,
          maxBytes: 16_384,
          maxChars: 4_000,
          maxPreviewRatio: 0.75,
        },
        metadata: {
          offset: 0,
          lineLimit: 10,
          linesIncluded: 1,
          bytesRead: 7,
          previewBytes: 7,
          truncated: true,
        },
        bytes: 'cHJldmlldw',
      },
      previewProof: {
        ...bundle.previewProof,
        previewInclusion: {
          offset: 0,
          length: 7,
          leafHash: 'e'.repeat(64),
          path: [],
        },
      },
    });

    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /generatedPreview/i);
  });

  it('accepts text previews with matching inclusion proof metadata', async () => {
    const body = validBody();
    const bundle = validSealedPreviewBundle(body);
    const res = await createStash({
      ...body,
      ...bundle,
      generatedPreview: {
        version: 'stashu-generated-preview-v1',
        kind: 'text-peek',
        fileName: body.fileName,
        fileType: 'text/plain',
        fileSize: body.fileSize,
        contentType: 'text/plain; charset=utf-8',
        options: {
          mode: 'auto',
          lineLimit: 10,
          maxBytes: 16_384,
          maxChars: 4_000,
          maxPreviewRatio: 0.15,
        },
        metadata: {
          offset: 0,
          lineLimit: 10,
          linesIncluded: 1,
          bytesRead: 7,
          previewBytes: 7,
          truncated: true,
        },
        bytes: 'cHJldmlldw',
      },
      previewProof: {
        ...bundle.previewProof,
        previewInclusion: {
          offset: 0,
          length: 7,
          leafHash: 'e'.repeat(64),
          path: [],
        },
      },
    });

    assert.equal(res.status, 201);
  });

  it('rejects fresh legacy v1 text previews that bypass sealed prepayment verification', async () => {
    const body = validBody();
    const bundle = validPreviewBundle(body);
    const res = await createStash({
      ...body,
      ...bundle,
      generatedPreview: {
        version: 'stashu-generated-preview-v1',
        kind: 'text-peek',
        fileName: body.fileName,
        fileType: 'text/plain',
        fileSize: body.fileSize,
        contentType: 'text/plain; charset=utf-8',
        options: {
          mode: 'auto',
          lineLimit: 10,
          maxBytes: 16_384,
          maxChars: 4_000,
          maxPreviewRatio: 0.15,
        },
        metadata: {
          offset: 0,
          lineLimit: 10,
          linesIncluded: 1,
          bytesRead: 7,
          previewBytes: 7,
          truncated: true,
        },
        bytes: 'cHJldmlldw',
      },
      previewProof: {
        ...bundle.previewProof,
        previewInclusion: {
          offset: 0,
          length: 7,
          leafHash: 'e'.repeat(64),
          path: [],
        },
      },
    });

    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /sealed stash package/i);
  });

  it('rejects text previews whose bytes exceed the declared line limit', async () => {
    const body = { ...validBody(), fileName: 'notes.md', fileSize: 1024 };
    const bundle = validSealedPreviewBundle(body);
    const previewText = Array.from({ length: 11 }, (_, index) => `line ${index + 1}`).join('\n');
    const previewBytes = Buffer.byteLength(previewText, 'utf8');
    const res = await createStash({
      ...body,
      ...bundle,
      generatedPreview: {
        version: 'stashu-generated-preview-v1',
        kind: 'text-peek',
        fileName: body.fileName,
        fileType: 'text/markdown',
        fileSize: body.fileSize,
        contentType: 'text/plain; charset=utf-8',
        options: {
          mode: 'excerpt',
          lineLimit: 10,
          maxBytes: 16_384,
          maxChars: 4_000,
          maxPreviewRatio: 0.5,
        },
        metadata: {
          offset: 0,
          lineLimit: 10,
          linesIncluded: 1,
          bytesRead: previewBytes,
          previewBytes,
          truncated: true,
        },
        bytes: base64Url(previewText),
      },
      previewProof: {
        ...bundle.previewProof,
        previewInclusion: {
          offset: 0,
          length: previewBytes,
          leafHash: 'e'.repeat(64),
          path: [],
        },
      },
    });

    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /generatedPreview/i);
  });

  it('accepts seller-picked excerpt previews with a non-zero offset', async () => {
    const body = validBody();
    const bundle = validSealedPreviewBundle(body);
    const res = await createStash({
      ...body,
      ...bundle,
      generatedPreview: {
        version: 'stashu-generated-preview-v1',
        kind: 'text-peek',
        fileName: body.fileName,
        fileType: 'text/plain',
        fileSize: body.fileSize,
        contentType: 'text/plain; charset=utf-8',
        options: {
          mode: 'excerpt',
          lineLimit: 10,
          maxBytes: 16_384,
          maxChars: 4_000,
          maxPreviewRatio: 0.15,
        },
        metadata: {
          offset: 50,
          lineLimit: 10,
          linesIncluded: 1,
          bytesRead: 7,
          previewBytes: 7,
          truncated: true,
        },
        bytes: 'cHJldmlldw',
      },
      previewProof: {
        ...bundle.previewProof,
        previewInclusion: {
          offset: 50,
          length: 7,
          leafHash: 'e'.repeat(64),
          path: [],
        },
      },
    });

    assert.equal(res.status, 201);
  });

  it('rejects preview proof offsets that do not match generated preview metadata', async () => {
    const body = validBody();
    const bundle = validSealedPreviewBundle(body);
    const res = await createStash({
      ...body,
      ...bundle,
      generatedPreview: {
        version: 'stashu-generated-preview-v1',
        kind: 'text-peek',
        fileName: body.fileName,
        fileType: 'text/plain',
        fileSize: body.fileSize,
        contentType: 'text/plain; charset=utf-8',
        options: {
          mode: 'excerpt',
          lineLimit: 10,
          maxBytes: 16_384,
          maxChars: 4_000,
          maxPreviewRatio: 0.15,
        },
        metadata: {
          offset: 50,
          lineLimit: 10,
          linesIncluded: 1,
          bytesRead: 7,
          previewBytes: 7,
          truncated: true,
        },
        bytes: 'cHJldmlldw',
      },
      previewProof: {
        ...bundle.previewProof,
        previewInclusion: {
          offset: 0,
          length: 7,
          leafHash: 'e'.repeat(64),
          path: [],
        },
      },
    });

    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /offset/i);
  });

  it('rejects oversized preview inclusion paths', async () => {
    const body = validBody();
    const bundle = validSealedPreviewBundle(body);
    const res = await createStash({
      ...body,
      ...bundle,
      generatedPreview: {
        version: 'stashu-generated-preview-v1',
        kind: 'text-peek',
        fileName: body.fileName,
        fileType: 'text/plain',
        fileSize: body.fileSize,
        contentType: 'text/plain; charset=utf-8',
        options: {
          mode: 'auto',
          lineLimit: 10,
          maxBytes: 16_384,
          maxChars: 4_000,
          maxPreviewRatio: 0.15,
        },
        metadata: {
          offset: 0,
          lineLimit: 10,
          linesIncluded: 1,
          bytesRead: 7,
          previewBytes: 7,
          truncated: true,
        },
        bytes: 'cHJldmlldw',
      },
      previewProof: {
        ...bundle.previewProof,
        previewInclusion: {
          offset: 0,
          length: 7,
          leafHash: 'e'.repeat(64),
          path: Array.from({ length: 65 }, () => ({
            side: 'right',
            hash: 'f'.repeat(64),
          })),
        },
      },
    });

    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /previewProof/i);
  });

  it('rejects generated preview metadata for a different file', async () => {
    const bundle = validPreviewBundle();
    const res = await createStash({
      ...validBody(),
      ...bundle,
      generatedPreview: { ...bundle.generatedPreview, fileName: 'other.pdf' },
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /generatedPreview/i);
  });

  it('encrypts sensitive fields in DB', async () => {
    const input = validBody();
    const res = await createStash(input);
    const { data } = await res.json();

    const row = db.prepare('SELECT * FROM stashes WHERE id = ?').get(data.id) as Record<
      string,
      string
    >;
    assert.notEqual(row.title, input.title);
    assert.notEqual(row.blob_url, input.blobUrl);
    assert.notEqual(row.secret_key, input.secretKey);
    assert.notEqual(row.file_name, input.fileName);
    assert.equal(decrypt(row.blob_url), input.blobUrl);
    assert.ok(row.title.includes(':'), 'encrypted format is nonce:ciphertext');
  });

  it('uses authed pubkey, ignores body pubkey', async () => {
    const res = await createStash({ ...validBody(), sellerPubkey: 'spoofed-pubkey' });
    const { data } = await res.json();

    const row = db.prepare('SELECT seller_pubkey FROM stashes WHERE id = ?').get(data.id) as {
      seller_pubkey: string;
    };
    assert.equal(row.seller_pubkey, pk);
  });
});

describe('GET /api/stash/:id', () => {
  it('returns 404 for non-existent stash', async () => {
    const res = await app.request('/api/stash/nonexistent');
    assert.equal(res.status, 404);
    assert.equal((await res.json()).success, false);
  });

  it('returns decrypted metadata', async () => {
    const input = validBody();
    const createRes = await createStash(input);
    const { data: created } = await createRes.json();

    const res = await app.request(`/api/stash/${created.id}`);
    assert.equal(res.status, 200);
    const { data } = await res.json();
    assert.equal(data.title, input.title);
    assert.equal(data.fileName, input.fileName);
    assert.equal(data.priceSats, input.priceSats);
    assert.equal(data.fileSize, input.fileSize);
  });

  it('omits description when not provided', async () => {
    const createRes = await createStash();
    const { data: created } = await createRes.json();

    const res = await app.request(`/api/stash/${created.id}`);
    const { data } = await res.json();
    assert.equal(data.description, undefined);
  });

  it('returns description when provided', async () => {
    const createRes = await createStash({ ...validBody(), description: 'A test description' });
    const { data: created } = await createRes.json();

    const res = await app.request(`/api/stash/${created.id}`);
    const { data } = await res.json();
    assert.equal(data.description, 'A test description');
  });

  it('defaults downloadWindowSeconds when the seller did not set one', async () => {
    const createRes = await createStash();
    const { data: created } = await createRes.json();

    const res = await app.request(`/api/stash/${created.id}`);
    const { data } = await res.json();
    assert.equal(data.downloadWindowSeconds, DEFAULT_DOWNLOAD_WINDOW_SECONDS);
  });

  it('returns the seller-chosen downloadWindowSeconds', async () => {
    const createRes = await createStash({ ...validBody(), downloadWindowSeconds: 2_592_000 });
    const { data: created } = await createRes.json();

    const res = await app.request(`/api/stash/${created.id}`);
    const { data } = await res.json();
    assert.equal(data.downloadWindowSeconds, 2_592_000);
  });

  it('returns public generated preview proof but not preview secret', async () => {
    const input = { ...validBody(), ...validPreviewBundle() };
    const createRes = await createStash(input);
    const { data: created } = await createRes.json();

    const res = await app.request(`/api/stash/${created.id}`);
    assert.equal(res.status, 200);
    const { data } = await res.json();

    assert.deepEqual(data.generatedPreview, input.generatedPreview);
    assert.deepEqual(data.previewProof, input.previewProof);
    assert.equal(data.previewSecret, undefined);
  });

  it('returns the public sealed package locator for prepayment verification', async () => {
    const input = { ...validBody(), ...validSealedPreviewBundle() };
    const createRes = await createStash(input);
    const { data: created } = await createRes.json();

    const res = await app.request(`/api/stash/${created.id}`);
    assert.equal(res.status, 200);
    const { data } = await res.json();

    assert.equal(data.blobFormat, 'stashu-selective-v1');
    assert.equal(data.sealedBlobUrl, input.blobUrl);
    assert.equal(data.blobSha256, input.blobSha256);
  });
});

describe('GET /api/stash/:id/manifest', () => {
  it('returns 404 for non-existent stash', async () => {
    const res = await app.request('/api/stash/nonexistent/manifest');
    assert.equal(res.status, 404);
    assert.equal((await res.json()).success, false);
  });

  it('returns a versioned manifest for a legacy stash', async () => {
    const input = validBody();
    const createRes = await createStash(input);
    const { data: created } = await createRes.json();

    const res = await app.request(`/api/stash/${created.id}/manifest`);
    assert.equal(res.status, 200);
    const { data } = await res.json();

    assert.equal(data.version, 'stashu-manifest-v1');
    assert.equal(data.id, created.id);
    assert.equal(data.title, input.title);
    assert.deepEqual(data.file, { name: input.fileName, size: input.fileSize });
    assert.equal(data.priceSats, input.priceSats);
    assert.deepEqual(data.payment.methods, ['lightning', 'cashu']);
    assert.deepEqual(data.payment.endpoints, {
      invoice: { method: 'POST', path: `/api/pay/${created.id}/invoice` },
      status: { method: 'GET', path: `/api/pay/${created.id}/status/{quoteId}` },
      unlock: { method: 'POST', path: `/api/unlock/${created.id}` },
      claim: { method: 'GET', path: `/api/unlock/${created.id}/claim?token={claimToken}` },
    });
    assert.equal(data.blob, undefined);
    assert.deepEqual(data.preview, { kind: 'none' });
    assert.equal(data.legacy, true);
    assert.equal(res.headers.get('Cache-Control'), 'public, max-age=60');
  });

  it('returns the legacy image preview when present', async () => {
    const previewUrl = 'https://blossom.example.com/preview.png';
    const createRes = await createStash({ ...validBody(), previewUrl });
    const { data: created } = await createRes.json();

    const res = await app.request(`/api/stash/${created.id}/manifest`);
    const { data } = await res.json();
    assert.deepEqual(data.preview, { kind: 'image', imageUrl: previewUrl });
  });

  it('returns sealed package and verified preview details', async () => {
    const input = { ...validBody(), ...validSealedPreviewBundle() };
    const createRes = await createStash(input);
    const { data: created } = await createRes.json();

    const res = await app.request(`/api/stash/${created.id}/manifest`);
    assert.equal(res.status, 200);
    const { data } = await res.json();

    assert.deepEqual(data.blob, {
      format: 'stashu-selective-v1',
      url: input.blobUrl,
      sha256: input.blobSha256,
    });
    assert.equal(data.legacy, false);
    assert.equal(data.preview.kind, 'generated');
    assert.deepEqual(data.preview.generated, input.generatedPreview);
    assert.deepEqual(data.preview.proof, input.previewProof);
  });

  it('never exposes secrets anywhere in the manifest', async () => {
    const input = { ...validBody(), ...validSealedPreviewBundle() };
    const createRes = await createStash(input);
    const { data: created } = await createRes.json();

    const res = await app.request(`/api/stash/${created.id}/manifest`);
    const raw = await res.text();

    assert.ok(!raw.includes(input.secretKey), 'decrypt key leaked');
    assert.ok(!raw.includes(input.previewSecret.contentSalt), 'proof secret leaked');
    assert.ok(!raw.includes(pk), 'seller pubkey leaked');

    const { data } = JSON.parse(raw);
    const allowed = new Set([
      'version',
      'id',
      'title',
      'description',
      'file',
      'priceSats',
      'payment',
      'blob',
      'preview',
      'legacy',
      'downloadWindowSeconds',
    ]);
    for (const key of Object.keys(data)) {
      assert.ok(allowed.has(key), `unexpected manifest field: ${key}`);
    }
  });
});
