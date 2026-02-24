import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from 'crypto';

/**
 * XChaCha20-Poly1305 encryption for Cashu seller tokens.
 *
 * Uses the same algorithm as the client-side Blossom file encryption.
 * Reads TOKEN_ENCRYPTION_KEY from env (64 hex chars = 32 bytes).
 * Encrypted format: nonce:ciphertext (both hex-encoded).
 *
 * Each encryption uses a random 24-byte nonce, so encrypting the same
 * token twice produces different ciphertexts — this prevents pattern analysis.
 */

const NONCE_LENGTH = 24; // XChaCha20 uses 24-byte nonces

function getEncryptionKey(): Uint8Array {
  const keyHex = process.env.TOKEN_ENCRYPTION_KEY;

  if (!keyHex) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY environment variable is not set. ' +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). ` +
        `Got ${keyHex.length} characters. Ensure it contains only 0-9 and a-f.`
    );
  }

  return hexToBytes(keyHex);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error('Invalid hex string');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Encrypt a plaintext string (e.g. a Cashu token) using XChaCha20-Poly1305.
 * @param plaintext The string to encrypt
 * @returns Encrypted string in format "nonce:ciphertext" (hex-encoded)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const nonce = new Uint8Array(randomBytes(NONCE_LENGTH));
  const cipher = xchacha20poly1305(key, nonce);
  const ciphertext = cipher.encrypt(new TextEncoder().encode(plaintext));

  return `${bytesToHex(nonce)}:${bytesToHex(ciphertext)}`;
}

/**
 * Decrypt an encrypted string back to plaintext.
 * Supports two formats for backward compatibility:
 *   1. Plaintext Cashu tokens (start with "cashu") — returned as-is
 *   2. XChaCha20-Poly1305 format: "nonce:ciphertext" (2 hex parts)
 *
 * @param encryptedString The encrypted (or plaintext) token string
 * @returns The original plaintext string
 */
export function decrypt(encryptedString: string): string {
  // Backward compat: plaintext Cashu tokens that were never encrypted
  if (encryptedString.startsWith('cashu')) {
    return encryptedString;
  }

  const parts = encryptedString.split(':');

  // XChaCha20-Poly1305 format: nonce:ciphertext
  if (parts.length === 2) {
    const [nonceHex, ciphertextHex] = parts;
    const key = getEncryptionKey();
    const nonce = hexToBytes(nonceHex);
    const ciphertext = hexToBytes(ciphertextHex);
    const cipher = xchacha20poly1305(key, nonce);
    const plaintext = cipher.decrypt(ciphertext);

    return new TextDecoder().decode(plaintext);
  }

  throw new Error('Invalid encrypted token format. Expected "nonce:ciphertext".');
}
