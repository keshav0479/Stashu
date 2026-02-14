/**
 * Simple in-memory rate limiter middleware for Hono
 * Uses a sliding window counter per IP address
 */

import { type Context, type Next } from 'hono';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}, 300_000);

// Cap store size to prevent memory abuse (evict oldest entries)
const MAX_ENTRIES = 10_000;

/**
 * Extract client IP safely.
 * Only trusts X-Forwarded-For when TRUSTED_PROXY=1 is set (meaning you have
 * a reverse proxy like nginx/Caddy that sets the header reliably).
 * Without a trusted proxy, falls back to 'unknown' (still limits per-path).
 */
function getClientIp(c: Context): string {
  if (process.env.TRUSTED_PROXY === '1') {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
    const realIp = c.req.header('x-real-ip');
    if (realIp) return realIp;
  }
  // Without trusted proxy, use a generic key (all clients share limit per route)
  return 'global';
}

/**
 * Normalize path to route prefix (strip dynamic segments like UUIDs/quoteIds)
 * This prevents attackers from creating unbounded map entries with unique paths
 */
function normalizeRoute(path: string): string {
  // /api/pay/some-uuid/status/some-quote → /api/pay
  // /api/stash/some-uuid → /api/stash
  // /api/unlock/some-uuid → /api/unlock
  const parts = path.split('/').filter(Boolean);
  // Keep only first 2 segments (e.g. "api", "pay")
  return '/' + parts.slice(0, 2).join('/');
}

/**
 * Create a rate limiter middleware
 * @param windowMs Time window in milliseconds
 * @param maxRequests Maximum requests per window
 */
export function rateLimit(windowMs: number, maxRequests: number) {
  return async (c: Context, next: Next) => {
    const ip = getClientIp(c);
    const route = normalizeRoute(c.req.path);
    const key = `${ip}:${route}`;
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || now > entry.resetAt) {
      // Evict if store is too large
      if (store.size >= MAX_ENTRIES) {
        const oldest = store.keys().next().value;
        if (oldest) store.delete(oldest);
      }
      store.set(key, { count: 1, resetAt: now + windowMs });
      await next();
      return;
    }

    if (entry.count >= maxRequests) {
      return c.json({ success: false, error: 'Too many requests. Please try again later.' }, 429);
    }

    entry.count++;
    await next();
  };
}
