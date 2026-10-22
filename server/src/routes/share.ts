/**
 * Server-rendered share cards for /s/:id.
 *
 * Registered ahead of the SPA fallback in production so that a crawler asking
 * for a stash link gets that stash's Open Graph tags instead of the generic
 * ones compiled into index.html. Browsers get the same HTML and the React app
 * boots over it as usual, so there is no user-agent sniffing here — everyone
 * is served the correct tags.
 *
 * Fail-soft by design: a missing stash, a decrypt error or a malformed row
 * falls back to the untouched index.html rather than erroring, because a
 * broken share card must never cost a buyer the page itself.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Context, Hono, Next } from 'hono';
import db from '../db/index.js';
import { decrypt } from '../lib/encryption.js';
import { rateLimit } from '../middleware/ratelimit.js';
import {
  buildStashShareMeta,
  injectHeadMeta,
  resolvePublicOrigin,
  DEFAULT_CARD_IMAGE,
  DEFAULT_CARD_IMAGE_SIZE,
  type ShareCardImage,
  type StashShareInfo,
} from '../lib/shareMeta.js';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  isCardRendererAvailable,
  renderCardPng,
} from '../lib/shareCard.js';
import type { StashRow } from '../db/types.js';

// Matches serveStatic's './client/dist' root, which is also cwd-relative.
const CLIENT_INDEX_PATH = path.join(process.cwd(), 'client', 'dist', 'index.html');

// index.html is immutable for the life of the process — a deploy restarts it.
let cachedIndexHtml: string | null = null;

async function loadIndexHtml(): Promise<string | null> {
  if (cachedIndexHtml !== null) return cachedIndexHtml;

  try {
    cachedIndexHtml = await readFile(CLIENT_INDEX_PATH, 'utf8');
    return cachedIndexHtml;
  } catch (error) {
    console.error('Share card: could not read client index.html:', error);
    return null;
  }
}

type ShareStashRow = Pick<
  StashRow,
  'id' | 'title' | 'description' | 'file_name' | 'file_size' | 'price_sats' | 'preview_url'
>;

// Only ever selects public columns — secret_key, preview_secret and blob_url
// must never be read here.
function getShareStash(id: string): StashShareInfo | null {
  const row = db
    .prepare(
      `SELECT id, title, description, file_name, file_size, price_sats, preview_url
       FROM stashes WHERE id = ?`
    )
    .get(id) as ShareStashRow | null;

  if (!row) return null;

  return {
    id: row.id,
    title: decrypt(row.title),
    description: row.description ? decrypt(row.description) : undefined,
    fileName: decrypt(row.file_name),
    fileSize: row.file_size,
    priceSats: row.price_sats,
    previewUrl: row.preview_url ?? undefined,
  };
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Pick the picture for a stash's card, best first:
 *  1. a seller's own preview image — a real picture of the goods;
 *  2. the card we render ourselves, when the renderer is available;
 *  3. the site icon, as a small square thumbnail.
 */
async function resolveCardImage(stash: StashShareInfo, origin: string): Promise<ShareCardImage> {
  // Creation validates previewUrl now, but rows written before that check
  // existed never had one, so anything that is not plain HTTPS is ignored.
  if (stash.previewUrl && isHttpsUrl(stash.previewUrl)) {
    // Never measured, so the dimensions stay unset rather than guessed.
    return { url: stash.previewUrl, large: true };
  }

  if (await isCardRendererAvailable()) {
    return {
      url: `${origin}/s/${encodeURIComponent(stash.id)}/card.png`,
      large: true,
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
    };
  }

  return {
    url: `${origin}${DEFAULT_CARD_IMAGE}`,
    large: false,
    width: DEFAULT_CARD_IMAGE_SIZE,
    height: DEFAULT_CARD_IMAGE_SIZE,
  };
}

/**
 * GET /s/:id — index.html with this stash's share card spliced into <head>.
 */
export async function shareCardHandler(c: Context, next: Next) {
  const html = await loadIndexHtml();
  // No built client to decorate: let the static handlers answer.
  if (html === null) return next();

  const serve = (body: string) => {
    // Short cache: crawlers re-fetch, and a deploy changes the asset hashes
    // referenced in this very HTML.
    c.header('Cache-Control', 'public, max-age=60');
    return c.html(body);
  };

  try {
    const id = c.req.param('id');
    const stash = id ? getShareStash(id) : null;
    if (!stash) return serve(html);

    const origin = resolvePublicOrigin(c.req.url);
    const image = await resolveCardImage(stash, origin);
    return serve(injectHeadMeta(html, buildStashShareMeta(stash, origin, image)));
  } catch (error) {
    console.error('Share card: falling back to the default card:', error);
    return serve(html);
  }
}

/**
 * GET /s/:id/card.png — the rendered card image.
 *
 * Redirects to the site icon rather than 404ing when the renderer is
 * unavailable: a crawler that has already read og:image should still get a
 * picture, and the meta tags only point here when rendering works.
 */
export async function shareCardImageHandler(c: Context): Promise<Response> {
  try {
    const id = c.req.param('id');
    const stash = id ? getShareStash(id) : null;

    if (stash) {
      const png = await renderCardPng({
        title: stash.title,
        fileName: stash.fileName,
        fileSize: stash.fileSize,
        priceSats: stash.priceSats,
      });

      if (png) {
        c.header('Content-Type', 'image/png');
        // Cards change only when the stash does, and crawlers refetch on their
        // own schedule, so a day is safe and keeps render load near zero.
        c.header('Cache-Control', 'public, max-age=86400');
        // A Node Buffer is Uint8Array<ArrayBufferLike>, which is wider than the
        // Uint8Array<ArrayBuffer> c.body accepts; this copies into its own one.
        return c.body(new Uint8Array(png));
      }
    }
  } catch (error) {
    // A row that fails to decrypt gets the icon, like the page handler does.
    console.error('Share card: image falling back to the icon:', error);
  }

  return c.redirect(DEFAULT_CARD_IMAGE, 302);
}

/**
 * Mount the share routes. Call this before the static handlers so a stash
 * link is answered here rather than by the SPA fallback.
 *
 * The image route is rate limited because every hit rasterises a PNG, and it
 * gets a fixed bucket key on purpose. The limiter otherwise keys on the first
 * two path segments, which here include the stash id: one bucket per id would
 * let a single client fill the limiter's shared, size-capped store with
 * random ids and evict every other route's bucket — unlock and pay included.
 */
export function registerShareRoutes(app: Hono) {
  app.use('/s/:id/card.png', rateLimit(60_000, 60, 'share-card'));
  app.get('/s/:id/card.png', shareCardImageHandler);
  app.get('/s/:id', shareCardHandler);
}
