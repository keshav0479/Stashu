/**
 * NIP-98 HTTP Auth Middleware
 *
 * Verifies that requests to protected endpoints include a valid
 * Nostr event signature proving ownership of the pubkey.
 *
 * Header format: Authorization: Nostr <base64-encoded-kind-27235-event>
 *
 * Validation:
 * 1. Event kind must be 27235 (NIP-98 HTTP Auth)
 * 2. Schnorr signature must be valid
 * 3. created_at must be within ±60 seconds
 * 4. 'u' tag must match the request URL
 * 5. 'method' tag must match the HTTP method
 */

import { type Context, type Next } from 'hono';
import { verifyEvent } from 'nostr-tools/pure';

const MAX_AGE_SECONDS = 60;

/**
 * Hono Variables type for auth context.
 * Export this so route files can use it for typed `c.get('authedPubkey')`.
 */
export type AuthVariables = {
  authedPubkey: string;
};

interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/**
 * Hono middleware that requires a valid NIP-98 auth header.
 * On success, sets c.set('authedPubkey', event.pubkey).
 */
export async function requireAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Nostr ')) {
    return c.json({ success: false, error: 'Authorization required' }, 401);
  }

  const base64Event = authHeader.slice(6); // Remove "Nostr " prefix

  let event: NostrEvent;
  try {
    const decoded = atob(base64Event);
    event = JSON.parse(decoded);
  } catch {
    return c.json({ success: false, error: 'Invalid authorization event' }, 401);
  }

  // 1. Must be kind 27235 (NIP-98)
  if (event.kind !== 27235) {
    return c.json({ success: false, error: 'Invalid event kind (expected 27235)' }, 401);
  }

  // 2. Verify schnorr signature
  try {
    const isValid = verifyEvent(event);
    if (!isValid) {
      return c.json({ success: false, error: 'Invalid signature' }, 401);
    }
  } catch {
    return c.json({ success: false, error: 'Signature verification failed' }, 401);
  }

  // 3. Check timestamp (within ±60 seconds)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - event.created_at) > MAX_AGE_SECONDS) {
    return c.json({ success: false, error: 'Authorization expired' }, 401);
  }

  // 4. Verify 'u' tag matches request URL
  const uTag = event.tags.find((t) => t[0] === 'u');
  if (!uTag || !uTag[1]) {
    return c.json({ success: false, error: 'Missing URL tag in auth event' }, 401);
  }

  // Compare URL paths (ignore host differences between dev/prod)
  const requestUrl = new URL(c.req.url);
  const eventUrl = new URL(uTag[1]);
  if (requestUrl.pathname !== eventUrl.pathname) {
    return c.json({ success: false, error: 'URL mismatch in auth event' }, 401);
  }

  // 5. Verify 'method' tag matches HTTP method
  const methodTag = event.tags.find((t) => t[0] === 'method');
  if (!methodTag || methodTag[1]?.toUpperCase() !== c.req.method.toUpperCase()) {
    return c.json({ success: false, error: 'Method mismatch in auth event' }, 401);
  }

  // Auth passed — set pubkey for downstream handlers
  c.set('authedPubkey', event.pubkey);
  await next();
}
