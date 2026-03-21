/**
 * Tests for client-side XChaCha20-Poly1305 file encryption.
 *
 * Run with: npm test --workspace=client
 */

import { describe, it, expect } from 'vitest';
import { generateKey, encryptFile, decryptFile, bytesToHex, hexToBytes, sha256 } from './crypto.js';

describe('generateKey', () => {
  it('returns 32 bytes', () => {
    const key = generateKey();
    expect(key).toBeInstanceOf(Uint8Array);
    expect(key.length).toBe(32);
  });

  it('generates different keys each call', () => {
    const k1 = bytesToHex(generateKey());
    const k2 = bytesToHex(generateKey());
    expect(k1).not.toBe(k2);
  });
});

describe('bytesToHex / hexToBytes', () => {
  it('roundtrip', () => {
    const bytes = new Uint8Array([0, 1, 127, 255]);
    expect(hexToBytes(bytesToHex(bytes))).toEqual(bytes);
  });

  it('throws on odd-length hex', () => {
    expect(() => hexToBytes('abc')).toThrow();
  });
});

describe('encryptFile / decryptFile', () => {
  it('roundtrip: encrypt then decrypt returns original', async () => {
    const data = new TextEncoder().encode('hello stashu');
    const { ciphertext, nonce, key } = await encryptFile(data.buffer as ArrayBuffer);
    const decrypted = await decryptFile(ciphertext, key, nonce);
    expect(new Uint8Array(decrypted)).toEqual(data);
  });

  it('uses provided key', async () => {
    const key = generateKey();
    const data = new TextEncoder().encode('test');
    const { key: returnedKey } = await encryptFile(data.buffer as ArrayBuffer, key);
    expect(returnedKey).toEqual(key);
  });

  it('same input produces different ciphertext each time (random nonce)', async () => {
    const data = new TextEncoder().encode('same content');
    const r1 = await encryptFile(data.buffer as ArrayBuffer);
    const r2 = await encryptFile(data.buffer as ArrayBuffer);
    expect(bytesToHex(r1.nonce)).not.toBe(bytesToHex(r2.nonce));
    expect(bytesToHex(r1.ciphertext)).not.toBe(bytesToHex(r2.ciphertext));
  });

  it('handles empty file', async () => {
    const data = new ArrayBuffer(0);
    const { ciphertext, nonce, key } = await encryptFile(data);
    const decrypted = await decryptFile(ciphertext, key, nonce);
    expect(new Uint8Array(decrypted).length).toBe(0);
  });

  it('handles large file (1 MB)', async () => {
    const data = new Uint8Array(1024 * 1024).fill(0xab);
    const { ciphertext, nonce, key } = await encryptFile(data.buffer as ArrayBuffer);
    const decrypted = await decryptFile(ciphertext, key, nonce);
    expect(new Uint8Array(decrypted)).toEqual(data);
  });

  it('wrong key fails to decrypt', async () => {
    const data = new TextEncoder().encode('secret');
    const { ciphertext, nonce } = await encryptFile(data.buffer as ArrayBuffer);
    const wrongKey = generateKey();
    await expect(decryptFile(ciphertext, wrongKey, nonce)).rejects.toThrow();
  });

  it('throws on wrong key length', async () => {
    const data = new TextEncoder().encode('test');
    const badKey = new Uint8Array(16);
    await expect(encryptFile(data.buffer as ArrayBuffer, badKey)).rejects.toThrow(/Key must be/);
  });
});

describe('sha256', () => {
  it('known hash for "hello"', () => {
    const data = new TextEncoder().encode('hello');
    expect(sha256(data)).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('different inputs produce different hashes', () => {
    const h1 = sha256(new TextEncoder().encode('a'));
    const h2 = sha256(new TextEncoder().encode('b'));
    expect(h1).not.toBe(h2);
  });
});
