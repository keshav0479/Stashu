/**
 * Per-stash social share cards (Open Graph + Twitter meta tags).
 *
 * Social crawlers — WhatsApp, X, Telegram, Discord, Slack, Nostr clients —
 * never run JavaScript. They fetch the raw HTML and read the <meta> tags out
 * of <head>. A Vite SPA sets its tags client-side, so to a crawler every
 * /s/:id link looks identical: the generic site card baked into index.html.
 * The server therefore rewrites those tags into the HTML it serves for a
 * stash link.
 *
 * Threat model. The card carries only fields already public through
 * GET /api/stash/:id and GET /api/stash/:id/manifest — title, description,
 * price, file name and size. It never carries the decrypt key, the preview
 * secret, the Cashu tokens, the blob URL or the seller pubkey. What it does
 * change is reach: a title that was previously public-but-unindexed now
 * travels in link previews and may be scraped by crawlers, so a seller who
 * wants an unlisted stash should keep the secret in the file, not the title.
 * Seller-controlled text is HTML-escaped here; it is the only untrusted input
 * on this path, and escaping it is what stops a title from closing the meta
 * tag and injecting markup into the page.
 */

/** Fields needed to describe a stash on a share card. All already public. */
export interface StashShareInfo {
  id: string;
  title: string;
  description?: string;
  fileName: string;
  fileSize: number;
  priceSats: number;
  /** Public image URL for the card, when the stash has one. */
  previewUrl?: string;
}

// Descriptions run to 2000 chars, far past what any crawler renders.
const MAX_CARD_DESCRIPTION_CHARS = 160;

// Fallback card image. Square and >=144px, which is what `summary` wants.
export const DEFAULT_CARD_IMAGE = '/apple-touch-icon.png';
export const DEFAULT_CARD_IMAGE_SIZE = 180;

/** The picture a share card points at, and how a crawler should frame it. */
export interface ShareCardImage {
  /** Absolute URL — relative og:image values are ignored by most crawlers. */
  url: string;
  /** True for a 1.91:1 banner, false for a small square thumbnail. */
  large: boolean;
  width?: number;
  height?: number;
}

/**
 * Escape text for an HTML attribute value. Ampersand first, or the escapes
 * introduced below get double-escaped.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Collapse newlines and control characters so a card line stays one line. */
function flatten(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value: string, maxChars: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxChars) return value;
  return `${chars
    .slice(0, maxChars - 1)
    .join('')
    .trimEnd()}…`;
}

/** `1234` -> `1,234 sats`, `1` -> `1 sat`. */
export function formatSats(sats: number): string {
  const amount = sats.toLocaleString('en-US');
  return `${amount} ${sats === 1 ? 'sat' : 'sats'}`;
}

/** Byte count as a short human string, matching the client's preview copy. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Uppercase extension for the card line (`notes.tar.gz` -> `GZ`). Returns
 * null when the name has no usable extension, so the caller can omit it.
 */
export function fileKind(fileName: string): string | null {
  const base = fileName.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;

  const ext = base.slice(dot + 1);
  if (!/^[A-Za-z0-9]{1,8}$/.test(ext)) return null;
  return ext.toUpperCase();
}

/**
 * The card's description line: price, size and file type, then the seller's
 * own description when they wrote one.
 */
export function buildCardDescription(stash: StashShareInfo): string {
  const kind = fileKind(stash.fileName);
  const facts = [formatSats(stash.priceSats), formatBytes(stash.fileSize), kind]
    .filter((part): part is string => Boolean(part))
    .join(' · ');

  const sellerText = stash.description ? flatten(stash.description) : '';
  const tail = sellerText || 'Pay with Lightning or Cashu to unlock.';

  return truncate(`${facts} — ${tail}`, MAX_CARD_DESCRIPTION_CHARS);
}

/**
 * Resolve the origin that share URLs should point at. Prefers an explicit
 * PUBLIC_ORIGIN, then the first configured CORS origin (production compose
 * sets it to `https://${DOMAIN}`, the site's own address), then the request's
 * own origin. Request headers are deliberately not trusted: X-Forwarded-Host
 * is attacker-settable, and an absolute og:url pointing at another host is
 * exactly what an open-redirect-flavoured card hijack needs.
 */
export function resolvePublicOrigin(requestUrl: string): string {
  const candidates = [
    process.env.PUBLIC_ORIGIN?.trim(),
    process.env.CORS_ORIGINS?.split(',')[0]?.trim(),
    requestUrl,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const { origin } = new URL(candidate);
      if (origin && origin !== 'null') return origin;
    } catch {
      continue;
    }
  }

  return '';
}

function metaTag(keyAttr: 'name' | 'property', key: string, content: string): string {
  return `    <meta ${keyAttr}="${key}" content="${escapeHtml(content)}" />`;
}

/**
 * Build the <head> block for one stash. Returns tags only — the caller
 * splices them into index.html with injectHeadMeta.
 */
export function buildStashShareMeta(
  stash: StashShareInfo,
  origin: string,
  image: ShareCardImage
): string {
  const title = flatten(stash.title) || 'Untitled stash';
  const description = buildCardDescription(stash);
  const pageUrl = `${origin}/s/${encodeURIComponent(stash.id)}`;
  const imageUrl = image.url;

  const tags = [
    `    <title>${escapeHtml(title)} · Stashu</title>`,
    metaTag('name', 'description', description),
    metaTag('property', 'og:type', 'website'),
    metaTag('property', 'og:site_name', 'Stashu'),
    metaTag('property', 'og:url', pageUrl),
    metaTag('property', 'og:title', title),
    metaTag('property', 'og:description', description),
    metaTag('property', 'og:image', imageUrl),
    metaTag('property', 'og:image:alt', `Preview of ${title}`),
    metaTag('name', 'twitter:card', image.large ? 'summary_large_image' : 'summary'),
    metaTag('name', 'twitter:title', title),
    metaTag('name', 'twitter:description', description),
    metaTag('name', 'twitter:image', imageUrl),
  ];

  // Declaring the size saves the crawler a fetch, so only claim it when we
  // actually know it — a seller's own image has never been measured.
  if (image.width && image.height) {
    tags.push(
      metaTag('property', 'og:image:width', String(image.width)),
      metaTag('property', 'og:image:height', String(image.height))
    );
  }

  return tags.join('\n');
}

/** True for the tags buildStashShareMeta replaces: <title> owns its own regex. */
function isReplaceableMetaTag(tag: string): boolean {
  const match = /\b(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag);
  if (!match) return false;

  const key = match[1].toLowerCase();
  return key === 'description' || key.startsWith('og:') || key.startsWith('twitter:');
}

/**
 * Replace index.html's generic social tags with a stash's own. Strips the
 * existing <title>, description, og:* and twitter:* tags — leaving two
 * og:title tags in place would let the crawler pick either one — then splices
 * the new block in before </head>.
 */
export function injectHeadMeta(html: string, metaHtml: string): string {
  const stripped = html
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
    .replace(/<meta\b[^>]*?>/gi, (tag) => (isReplaceableMetaTag(tag) ? '' : tag))
    // Collapse the blank lines the strips leave behind.
    .replace(/^[ \t]*\r?\n/gm, '');

  const headClose = stripped.search(/<\/head>/i);
  if (headClose === -1) return `${stripped}\n${metaHtml}`;

  // Drop the indentation sitting in front of </head> so the injected block
  // keeps its own instead of inheriting it.
  const before = stripped.slice(0, headClose).replace(/[ \t]*$/, '');
  return `${before}${metaHtml}\n  ${stripped.slice(headClose)}`;
}
