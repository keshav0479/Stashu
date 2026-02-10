/**
 * NIP-98 HTTP Auth — Client-side request signing
 *
 * Creates Authorization headers for authenticated API requests.
 * Uses the seller's local Nostr keypair to sign kind 27235 events
 * that prove pubkey ownership to the server.
 */

import { signEvent } from './nostr';

/**
 * Create a NIP-98 Authorization header for an authenticated request.
 *
 * @param url Full request URL (e.g. https://api.stashu.com/api/dashboard/...)
 * @param method HTTP method (GET, POST, etc.)
 * @returns The full Authorization header value: "Nostr <base64-event>"
 */
export function createAuthHeader(url: string, method: string): string {
  const event = signEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['u', url],
      ['method', method.toUpperCase()],
    ],
    content: '',
  });

  return `Nostr ${btoa(JSON.stringify(event))}`;
}
