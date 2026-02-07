/**
 * NIP-07 Wallet Integration
 * Connects to browser extensions like Alby, Nos2x, or Nostr Connect
 */

import type { EventTemplate, UnsignedEvent, Event } from 'nostr-tools';

// NIP-07 window.nostr interface
declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent(event: UnsignedEvent): Promise<Event>;
      nip04?: {
        encrypt(pubkey: string, plaintext: string): Promise<string>;
        decrypt(pubkey: string, ciphertext: string): Promise<string>;
      };
      nip44?: {
        encrypt(pubkey: string, plaintext: string): Promise<string>;
        decrypt(pubkey: string, ciphertext: string): Promise<string>;
      };
    };
  }
}

export interface WalletState {
  connected: boolean;
  pubkey: string | null;
  error: string | null;
}

/**
 * Check if a NIP-07 extension is available
 */
export function hasNostrExtension(): boolean {
  return typeof window !== 'undefined' && !!window.nostr;
}

/**
 * Connect to NIP-07 wallet and get public key
 */
export async function connectWallet(): Promise<{ pubkey: string }> {
  if (!hasNostrExtension()) {
    throw new Error('No Nostr extension found. Please install Alby or nos2x.');
  }

  try {
    const pubkey = await window.nostr!.getPublicKey();
    return { pubkey };
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Failed to connect wallet');
  }
}

/**
 * Sign a Nostr event using NIP-07
 */
export async function signEvent(event: EventTemplate): Promise<Event> {
  if (!hasNostrExtension()) {
    throw new Error('No Nostr extension found');
  }

  try {
    const unsignedEvent: UnsignedEvent = {
      ...event,
      pubkey: await window.nostr!.getPublicKey(),
    };
    return await window.nostr!.signEvent(unsignedEvent);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Failed to sign event');
  }
}

/**
 * Create a Blossom Authorization event for file upload
 * @param url The URL being accessed (for content only)
 * @param sha256hash SHA-256 hash of the file being uploaded
 */
export async function createBlossomAuthEvent(url: string, sha256hash: string): Promise<Event> {
  // Calculate expiration (5 minutes from now)
  const expiration = Math.floor(Date.now() / 1000) + 300;

  const tags: string[][] = [
    ['t', 'upload'], // Required: action type
    ['expiration', String(expiration)],
  ];

  // Add 'x' tag with SHA-256 hash (required for upload per BUD-02)
  if (sha256hash) {
    tags.push(['x', sha256hash]);
  }

  const event: EventTemplate = {
    kind: 24242,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: `Upload to ${url}`,
  };

  return signEvent(event);
}

/**
 * Encrypt data using NIP-44 via extension
 * Falls back to NIP-04 if NIP-44 not available
 */
export async function encryptToPublicKey(
  recipientPubkey: string,
  plaintext: string
): Promise<string> {
  if (!hasNostrExtension()) {
    throw new Error('No Nostr extension found');
  }

  // Prefer NIP-44 (XChaCha20-Poly1305)
  if (window.nostr!.nip44) {
    return window.nostr!.nip44.encrypt(recipientPubkey, plaintext);
  }

  // Fallback to NIP-04 (less secure but more widely supported)
  if (window.nostr!.nip04) {
    return window.nostr!.nip04.encrypt(recipientPubkey, plaintext);
  }

  throw new Error('Extension does not support encryption (NIP-44/NIP-04)');
}
