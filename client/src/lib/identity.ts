import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { nsecEncode, npubEncode, decode } from 'nostr-tools/nip19';

const STORAGE_KEY = 'stashu_identity';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

interface StoredIdentity {
  sk: string;
  pk: string;
  createdAt: number;
}

export interface Identity {
  secretKey: Uint8Array;
  publicKey: string;
  nsec: string;
  npub: string;
}

export function hasIdentity(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null;
}

export function getOrCreateIdentity(): Identity {
  const stored = localStorage.getItem(STORAGE_KEY);

  if (stored) {
    const parsed: StoredIdentity = JSON.parse(stored);
    const secretKey = hexToBytes(parsed.sk);
    return {
      secretKey,
      publicKey: parsed.pk,
      nsec: nsecEncode(secretKey),
      npub: npubEncode(parsed.pk),
    };
  }

  const secretKey = generateSecretKey();
  const publicKey = getPublicKey(secretKey);

  const identity: StoredIdentity = {
    sk: bytesToHex(secretKey),
    pk: publicKey,
    createdAt: Date.now(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  localStorage.removeItem('stashu_identity_ack');

  return {
    secretKey,
    publicKey,
    nsec: nsecEncode(secretKey),
    npub: npubEncode(publicKey),
  };
}

export function getRecoveryToken(): string {
  return getOrCreateIdentity().nsec;
}

export function getPublicKeyHex(): string {
  return getOrCreateIdentity().publicKey;
}

export function importFromRecoveryToken(nsec: string): { success: boolean; error?: string } {
  try {
    if (!nsec.startsWith('nsec1')) {
      return { success: false, error: 'Invalid format. Must start with nsec1' };
    }

    const decoded = decode(nsec);
    if (decoded.type !== 'nsec') {
      return { success: false, error: 'Invalid recovery token type' };
    }

    const secretKey = decoded.data as Uint8Array;
    const publicKey = getPublicKey(secretKey);

    const identity: StoredIdentity = {
      sk: bytesToHex(secretKey),
      pk: publicKey,
      createdAt: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
    localStorage.setItem('stashu_identity_ack', 'true');

    return { success: true };
  } catch {
    return { success: false, error: 'Failed to decode recovery token' };
  }
}

export function hasAcknowledgedRecovery(): boolean {
  return localStorage.getItem('stashu_identity_ack') === 'true';
}

export function acknowledgeRecovery(): void {
  localStorage.setItem('stashu_identity_ack', 'true');
}

export function clearIdentity(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem('stashu_identity_ack');
}
