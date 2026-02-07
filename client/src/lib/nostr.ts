import type { EventTemplate, VerifiedEvent } from 'nostr-tools';
import { finalizeEvent } from 'nostr-tools/pure';
import { getOrCreateIdentity } from './identity';

export function getPublicKey(): string {
  return getOrCreateIdentity().publicKey;
}

export function signEvent(event: EventTemplate): VerifiedEvent {
  const identity = getOrCreateIdentity();
  return finalizeEvent(event, identity.secretKey);
}

export function createBlossomAuthEvent(url: string, sha256hash: string): VerifiedEvent {
  const expiration = Math.floor(Date.now() / 1000) + 300;
  const tags: string[][] = [
    ['t', 'upload'],
    ['expiration', String(expiration)],
  ];

  if (sha256hash) {
    tags.push(['x', sha256hash]);
  }

  return signEvent({
    kind: 24242,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: `Upload to ${url}`,
  });
}

export function encryptToSelf(plaintext: string): string {
  return plaintext;
}
