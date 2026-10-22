/**
 * Tests for the share card routes, mounted the way index.ts mounts them.
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
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';

const db = (await import('../db/index.js')).default;
const { encrypt } = await import('../lib/encryption.js');
const { registerShareRoutes } = await import('./share.js');
const { isCardRendererAvailable } = await import('../lib/shareCard.js');

const app = new Hono();
registerShareRoutes(app);

function insertStash(id: string, title = encrypt('Blender Donut Tutorial')) {
  db.prepare(
    `INSERT INTO stashes (id, blob_url, secret_key, seller_pubkey, price_sats,
                          title, file_name, file_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    encrypt('https://blossom.example.com/blob'),
    encrypt('secret-key'),
    'a'.repeat(64),
    2_000,
    title,
    encrypt('donut.mp4'),
    47_395_635
  );
}

beforeEach(() => {
  db.exec('DELETE FROM stashes');
});

describe('GET /s/:id/card.png', () => {
  it('serves a cacheable PNG for a stash', async (t) => {
    if (!(await isCardRendererAvailable())) {
      return t.skip('card renderer unavailable on this platform');
    }

    const id = randomUUID();
    insertStash(id);

    const res = await app.request(`/s/${id}/card.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.match(res.headers.get('cache-control') ?? '', /max-age=86400/);

    const png = Buffer.from(await res.arrayBuffer());
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  });

  it('redirects to the icon for a stash that does not exist', async () => {
    const res = await app.request(`/s/${randomUUID()}/card.png`);

    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/apple-touch-icon.png');
  });

  it('redirects to the icon instead of erroring when a row will not decrypt', async () => {
    // A real ciphertext with its last byte flipped fails Poly1305 authentication.
    const sealed = encrypt('Blender Donut Tutorial');
    const tampered = sealed.slice(0, -1) + (sealed.endsWith('0') ? '1' : '0');
    const id = randomUUID();
    insertStash(id, tampered);

    const res = await app.request(`/s/${id}/card.png`);

    assert.equal(res.status, 302, 'a corrupt row must not surface as a 500');
    assert.equal(res.headers.get('location'), '/apple-touch-icon.png');
  });
});

// Last on purpose: it exhausts the shared card bucket for the rest of the file.
describe('card route rate limiting', () => {
  it('shares one bucket across stash ids', async () => {
    // The limiter keys on the first two path segments, which here would be
    // /s/<id>. Keyed that way, every random id gets a fresh bucket — and a
    // fresh entry in the limiter's shared, size-capped store, which a client
    // could flood to evict the unlock and pay buckets. A 429 within 61
    // distinct ids proves they all draw from one bucket instead.
    let limited = false;
    for (let i = 0; i < 61 && !limited; i++) {
      const res = await app.request(`/s/${randomUUID()}/card.png`);
      limited = res.status === 429;
    }

    assert.ok(limited, 'each stash id got its own rate-limit bucket');
  });
});
