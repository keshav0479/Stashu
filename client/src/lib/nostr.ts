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

/**
 * BUD-11 token for DELETE /<sha256> (BUD-12). The `x` tag limits it to this
 * one blob. It names no `server`, so a server could replay it elsewhere — but
 * only to delete that same blob, which is being deleted everywhere anyway.
 */
export function createBlossomDeleteAuthEvent(url: string, sha256hash: string): VerifiedEvent {
  const expiration = Math.floor(Date.now() / 1000) + 300;
  return signEvent({
    kind: 24242,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['t', 'delete'],
      ['expiration', String(expiration)],
      ['x', sha256hash],
    ],
    content: `Delete ${url}`,
  });
}

export function createBlossomMirrorAuthEvent(url: string, sha256hash: string): VerifiedEvent {
  const expiration = Math.floor(Date.now() / 1000) + 300;
  const tags: string[][] = [
    // BUD-11 defines PUT /mirror as an `upload`-authorized action.
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
    content: `Mirror to ${url}`,
  });
}
