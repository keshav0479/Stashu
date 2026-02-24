/**
 * Unit tests for encryption.ts
 *
 * Run with:
 *   TOKEN_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") npx tsx --test server/src/lib/encryption.test.ts
 *
 * Or from the server workspace:
 *   npm test
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

// Ensure a valid key is set for tests
if (!process.env.TOKEN_ENCRYPTION_KEY) {
  const { randomBytes } = await import('node:crypto');
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
}

const { encrypt, decrypt } = await import('./encryption.js');

describe('encrypt/decrypt', () => {
  it('roundtrip: encrypt then decrypt returns original', () => {
    const original = 'cashuBpGhhdGlkWCDLZ2OlqLihRkNTaiDDXz2bVEuNKk6VKN';
    const encrypted = encrypt(original);
    assert.notEqual(encrypted, original, 'encrypted should differ from original');
    assert.ok(encrypted.includes(':'), 'should have nonce:ciphertext format');
    const decrypted = decrypt(encrypted);
    assert.equal(decrypted, original);
  });

  it('same input produces different ciphertexts (random nonce)', () => {
    const plaintext = 'some_token_value';
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    assert.notEqual(a, b, 'two encryptions of same input should differ');
    assert.equal(decrypt(a), plaintext);
    assert.equal(decrypt(b), plaintext);
  });

  it('handles empty string', () => {
    const encrypted = encrypt('');
    const decrypted = decrypt(encrypted);
    assert.equal(decrypted, '');
  });

  it('handles long tokens', () => {
    const longToken = 'x'.repeat(10_000);
    const encrypted = encrypt(longToken);
    assert.equal(decrypt(encrypted), longToken);
  });
});

describe('decrypt backward compat', () => {
  it('plaintext cashu tokens pass through unchanged', () => {
    const token = 'cashuABCD1234tokendata';
    const result = decrypt(token);
    assert.equal(result, token, 'plaintext cashu token should be returned as-is');
  });

  it('plaintext cashu with special chars passes through', () => {
    const token = 'cashuBpGhhdGlkWCDLZ2OlqL==+/';
    assert.equal(decrypt(token), token);
  });
});

describe('error handling', () => {
  it('corrupted ciphertext throws', () => {
    const encrypted = encrypt('test');
    const parts = encrypted.split(':');
    // Corrupt the ciphertext by flipping bytes
    const corrupted = `${parts[0]}:${'ff'.repeat(parts[1].length / 2)}`;
    assert.throws(() => decrypt(corrupted), 'should throw on corrupted data');
  });

  it('invalid format (too many parts) throws', () => {
    assert.throws(() => decrypt('aa:bb:cc'), 'should throw on 3-part format');
  });

  it('invalid format (no colon) throws', () => {
    assert.throws(() => decrypt('notencryptednotcashu'), 'should throw on non-cashu single part');
  });

  it('wrong key fails to decrypt', async () => {
    // Encrypt with current key
    const encrypted = encrypt('secret_token');

    // Swap to a different key
    const originalKey = process.env.TOKEN_ENCRYPTION_KEY;
    const { randomBytes } = await import('node:crypto');
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');

    try {
      assert.throws(() => decrypt(encrypted), 'wrong key should fail');
    } finally {
      // Restore original key
      process.env.TOKEN_ENCRYPTION_KEY = originalKey;
    }
  });
});
