/**
 * Tests for the DB startup logic: plaintext migration + key-rotation probe.
 *
 * These tests exercise the same logic that runs in db/index.ts on startup,
 * but in isolation using an in-memory SQLite database.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

// Ensure a valid key is set for tests
if (!process.env.TOKEN_ENCRYPTION_KEY) {
  const { randomBytes } = await import('node:crypto');
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
}

const { encrypt, decrypt } = await import('../lib/encryption.js');

/**
 * Re-implement the startup logic from db/index.ts as testable functions.
 * This mirrors the actual code paths without process.exit().
 */

function migrateAndProbe(db: InstanceType<typeof Database>): {
  migrated: number;
  probeErrors: string[];
} {
  const probeErrors: string[] = [];

  // 1. Key-rotation probe: try decrypting ALL encrypted rows
  const encryptedRows = db
    .prepare(
      `SELECT id, seller_token FROM payments
       WHERE seller_token IS NOT NULL AND seller_token NOT LIKE 'cashu%'`
    )
    .all() as Array<{ id: string; seller_token: string }>;

  for (const row of encryptedRows) {
    try {
      decrypt(row.seller_token);
    } catch {
      probeErrors.push(row.id);
    }
  }

  // 2. Plaintext migration: encrypt any cashu* tokens
  const plaintextRows = db
    .prepare(
      `SELECT id, seller_token FROM payments WHERE seller_token IS NOT NULL AND seller_token LIKE 'cashu%'`
    )
    .all() as Array<{ id: string; seller_token: string }>;

  if (plaintextRows.length > 0) {
    const update = db.prepare(`UPDATE payments SET seller_token = ? WHERE id = ?`);
    const tx = db.transaction(() => {
      for (const row of plaintextRows) {
        update.run(encrypt(row.seller_token), row.id);
      }
    });
    tx();
  }

  return { migrated: plaintextRows.length, probeErrors };
}

function createTestDb(): InstanceType<typeof Database> {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE stashes (
      id TEXT PRIMARY KEY,
      blob_url TEXT NOT NULL,
      secret_key TEXT NOT NULL,
      seller_pubkey TEXT NOT NULL,
      price_sats INTEGER NOT NULL,
      title TEXT NOT NULL,
      file_name TEXT NOT NULL DEFAULT 'file',
      file_size INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE payments (
      id TEXT PRIMARY KEY,
      stash_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      token_hash TEXT NOT NULL,
      seller_token TEXT,
      claimed INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      paid_at INTEGER
    );
  `);
  return db;
}

describe('DB migration: plaintext → encrypted', () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createTestDb();
  });

  it('migrates plaintext cashu tokens', () => {
    db.prepare(
      `INSERT INTO payments (id, stash_id, status, token_hash, seller_token)
                VALUES ('p1', 's1', 'paid', 'hash1', 'cashuAtoken123')`
    ).run();
    db.prepare(
      `INSERT INTO payments (id, stash_id, status, token_hash, seller_token)
                VALUES ('p2', 's1', 'paid', 'hash2', 'cashuBtoken456')`
    ).run();

    const result = migrateAndProbe(db);

    assert.equal(result.migrated, 2, 'should migrate 2 plaintext tokens');
    assert.equal(result.probeErrors.length, 0, 'no probe errors');

    // Verify tokens are now encrypted
    const rows = db.prepare(`SELECT seller_token FROM payments`).all() as Array<{
      seller_token: string;
    }>;
    for (const row of rows) {
      assert.ok(!row.seller_token.startsWith('cashu'), 'should no longer be plaintext');
      assert.ok(row.seller_token.includes(':'), 'should be in nonce:ciphertext format');
    }
  });

  it('skips rows without seller_token', () => {
    db.prepare(
      `INSERT INTO payments (id, stash_id, status, token_hash, seller_token)
                VALUES ('p1', 's1', 'pending', 'hash1', NULL)`
    ).run();

    const result = migrateAndProbe(db);

    assert.equal(result.migrated, 0);
    assert.equal(result.probeErrors.length, 0);
  });

  it('leaves already-encrypted tokens untouched', () => {
    const encrypted = encrypt('cashuOriginalToken');
    db.prepare(
      `INSERT INTO payments (id, stash_id, status, token_hash, seller_token)
                VALUES ('p1', 's1', 'paid', 'hash1', ?)`
    ).run(encrypted);

    const result = migrateAndProbe(db);

    assert.equal(result.migrated, 0, 'should not re-encrypt');
    assert.equal(result.probeErrors.length, 0, 'should decrypt fine');

    const row = db.prepare(`SELECT seller_token FROM payments WHERE id = 'p1'`).get() as {
      seller_token: string;
    };
    assert.equal(row.seller_token, encrypted, 'ciphertext should be unchanged');
  });
});

describe('DB startup probe: key-rotation detection', () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = createTestDb();
  });

  it('passes when all rows decrypt successfully', () => {
    db.prepare(
      `INSERT INTO payments (id, stash_id, status, token_hash, seller_token)
                VALUES ('p1', 's1', 'paid', 'hash1', ?)`
    ).run(encrypt('token1'));
    db.prepare(
      `INSERT INTO payments (id, stash_id, status, token_hash, seller_token)
                VALUES ('p2', 's1', 'paid', 'hash2', ?)`
    ).run(encrypt('token2'));

    const result = migrateAndProbe(db);
    assert.equal(result.probeErrors.length, 0);
  });

  it('detects wrong-key rows', () => {
    // Encrypt with current key
    db.prepare(
      `INSERT INTO payments (id, stash_id, status, token_hash, seller_token)
                VALUES ('p1', 's1', 'paid', 'hash1', ?)`
    ).run(encrypt('token1'));

    // Insert garbage that looks like encrypted data but uses wrong key
    db.prepare(
      `INSERT INTO payments (id, stash_id, status, token_hash, seller_token)
                VALUES ('p2', 's1', 'paid', 'hash2', ?)`
    ).run(
      'aabbccdd00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899aabb:deadbeef0011223344'
    );

    const result = migrateAndProbe(db);
    assert.equal(result.probeErrors.length, 1, 'should flag 1 bad row');
    assert.equal(result.probeErrors[0], 'p2', 'should identify the bad payment');
  });

  it('detects mixed DB (some good, some bad)', () => {
    db.prepare(
      `INSERT INTO payments (id, stash_id, status, token_hash, seller_token)
                VALUES ('good1', 's1', 'paid', 'h1', ?)`
    ).run(encrypt('token1'));
    db.prepare(
      `INSERT INTO payments (id, stash_id, status, token_hash, seller_token)
                VALUES ('good2', 's1', 'paid', 'h2', ?)`
    ).run(encrypt('token2'));
    db.prepare(
      `INSERT INTO payments (id, stash_id, status, token_hash, seller_token)
                VALUES ('bad1', 's1', 'paid', 'h3', ?)`
    ).run('ff'.repeat(24) + ':' + 'aa'.repeat(32));

    const result = migrateAndProbe(db);
    assert.equal(result.probeErrors.length, 1, 'should catch the bad row among good ones');
    assert.equal(result.probeErrors[0], 'bad1');
  });

  it('passes on empty DB', () => {
    const result = migrateAndProbe(db);
    assert.equal(result.probeErrors.length, 0);
    assert.equal(result.migrated, 0);
  });
});
