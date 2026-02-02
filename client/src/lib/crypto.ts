/*
 * XChaCha20-Poly1305 for file encryption
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';

const KEY_LENGTH = 32;
const NONCE_LENGTH = 24;

/**
 * Generate random bytes
 */
function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Generate a random 32-byte encryption key
 */
export function generateKey(): Uint8Array {
  return randomBytes(KEY_LENGTH);
}

/**
 * Convert bytes to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to bytes
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Hex must have even length');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Convert bytes to base64 string
 */
export function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...Array.from(bytes)));
}

/**
 * Convert base64 string to bytes
 */
export function fromBase64(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

export interface EncryptResult {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  key: Uint8Array;
}

/**
 * Encrypt data using XChaCha20-Poly1305
 * @param data The file data as ArrayBuffer
 * @param key Optional key (generates random if not provided)
 */
export async function encryptFile(
  data: ArrayBuffer,
  key?: Uint8Array
): Promise<EncryptResult> {
  const encryptionKey = key ?? generateKey();

  if (encryptionKey.length !== KEY_LENGTH) {
    throw new Error(`Key must be ${KEY_LENGTH} bytes`);
  }

  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = xchacha20poly1305(encryptionKey, nonce);
  const ciphertext = cipher.encrypt(new Uint8Array(data));

  return { ciphertext, nonce, key: encryptionKey };
}

/**
 * Decrypt data using XChaCha20-Poly1305
 * @param ciphertext The encrypted data
 * @param key The decryption key
 * @param nonce The nonce used during encryption
 */
export async function decryptFile(
  ciphertext: Uint8Array,
  key: Uint8Array,
  nonce: Uint8Array
): Promise<ArrayBuffer> {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Key must be ${KEY_LENGTH} bytes`);
  }

  if (nonce.length !== NONCE_LENGTH) {
    throw new Error(`Nonce must be ${NONCE_LENGTH} bytes`);
  }

  const cipher = xchacha20poly1305(key, nonce);
  const plaintext = cipher.decrypt(ciphertext);

  return plaintext.slice().buffer;
}

/**
 * Compute SHA-256 hash of data
 */
export async function sha256(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return bytesToHex(new Uint8Array(hashBuffer));
}

/**
 * Read a File as ArrayBuffer
 */
export function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}
