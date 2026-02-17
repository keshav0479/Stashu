import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM encryption for Cashu seller tokens.
 *
 * Reads TOKEN_ENCRYPTION_KEY from env (64 hex chars = 32 bytes).
 * Encrypted format: iv:authTag:ciphertext (all hex-encoded).
 *
 * Each encryption uses a random IV, so encrypting the same token
 * twice produces different ciphertexts — this prevents pattern analysis.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128-bit auth tag

function getEncryptionKey(): Buffer {
  const keyHex = process.env.TOKEN_ENCRYPTION_KEY;

  if (!keyHex) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY environment variable is not set. ' +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  if (keyHex.length !== 64) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Got ${keyHex.length} characters.`
    );
  }

  return Buffer.from(keyHex, 'hex');
}

/**
 * Encrypt a plaintext string (e.g. a Cashu token) using AES-256-GCM.
 * @param plaintext The string to encrypt
 * @returns Encrypted string in format "iv:authTag:ciphertext" (hex-encoded)
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt an encrypted string back to plaintext.
 * @param encryptedString String in format "iv:authTag:ciphertext" (hex-encoded)
 * @returns The original plaintext string
 */
export function decrypt(encryptedString: string): string {
  // Backward compatibility: if this is a plaintext Cashu token (not yet encrypted),
  // return it as-is. All Cashu tokens start with 'cashu' (e.g. cashuA..., cashuB...).
  // This allows a smooth migration from plaintext → encrypted without a separate script.
  if (encryptedString.startsWith('cashu')) {
    return encryptedString;
  }

  const key = getEncryptionKey();

  const parts = encryptedString.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted token format. Expected "iv:authTag:ciphertext".');
  }

  const [ivHex, authTagHex, ciphertext] = parts;

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
