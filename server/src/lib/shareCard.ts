/**
 * Renders the 1200x630 PNG shown in link previews for a stash.
 *
 * The card is drawn as SVG and rasterised with resvg. PNG is not a taste
 * choice: X, WhatsApp and most Nostr clients reject SVG for og:image, and
 * Blossom serves our uploads as application/octet-stream, so the bytes have
 * to come from here with an image/png content type.
 *
 * Fonts are vendored rather than taken from the host. The production image is
 * node:22-alpine, which ships no fonts at all, so `loadSystemFonts` stays off
 * and the two Outfit faces below are the only ones resvg may use. That also
 * makes the output identical on a developer's Mac and in the container.
 *
 * Everything here is fail-soft. If resvg or the fonts cannot be loaded the
 * module reports itself unavailable, the route stops advertising a card and
 * share links fall back to the site icon — the behaviour from before cards
 * existed. A missing picture must never cost a seller the page itself.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml, fileKind, formatBytes, formatSats } from './shareMeta.js';

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

const PADDING = 76;
const TITLE_SIZE = 62;
const TITLE_LINE_HEIGHT = 78;
const MAX_TITLE_LINES = 2;

// Brand palette, kept in step with client/src/index.css.
const COLORS = {
  bg: '#020617',
  glowWarm: '#f97316',
  glowCool: '#6366f1',
  textPrimary: '#f8fafc',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  accent: '#f97316',
  hairline: '#1e293b',
};

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * The compiled tree (server/dist/server/src/lib) and the source tree
 * (server/src/lib) sit at different depths under the workspace, so probe
 * both rather than assuming one layout.
 */
function resolveFirstExisting(candidates: string[]): string | null {
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const FONT_DIR = resolveFirstExisting([
  path.resolve(moduleDir, '../../assets/fonts'), // server/src/lib -> server/assets
  path.resolve(moduleDir, '../../../../assets/fonts'), // server/dist/server/src/lib -> server/assets
  path.resolve(process.cwd(), 'server/assets/fonts'),
  path.resolve(process.cwd(), 'assets/fonts'),
]);

const LOGO_PATH = resolveFirstExisting([
  path.resolve(process.cwd(), 'client/dist/apple-touch-icon.png'),
  path.resolve(process.cwd(), 'client/public/apple-touch-icon.png'),
]);

type ResvgModule = typeof import('@resvg/resvg-js');

let resvgModule: ResvgModule | null | undefined;
let logoDataUri: string | null | undefined;

async function loadResvg(): Promise<ResvgModule | null> {
  if (resvgModule !== undefined) return resvgModule;

  if (!FONT_DIR) {
    console.error('Share card: vendored fonts not found; cards are disabled.');
    resvgModule = null;
    return null;
  }

  try {
    resvgModule = await import('@resvg/resvg-js');
  } catch (error) {
    // Most likely a platform without a prebuilt binary. Not fatal.
    console.error('Share card: resvg unavailable; cards are disabled:', error);
    resvgModule = null;
  }

  return resvgModule;
}

/** The squirrel mark, inlined so resvg needs no network or image resolver. */
function getLogoDataUri(): string | null {
  if (logoDataUri !== undefined) return logoDataUri;

  try {
    logoDataUri = LOGO_PATH
      ? `data:image/png;base64,${readFileSync(LOGO_PATH).toString('base64')}`
      : null;
  } catch {
    logoDataUri = null;
  }

  return logoDataUri;
}

/** True once resvg and the fonts have loaded, so callers can advertise a card. */
export async function isCardRendererAvailable(): Promise<boolean> {
  return (await loadResvg()) !== null;
}

// Per-character advance widths as a fraction of font size, measured against
// rendered Outfit Bold — the only wrapped text on the card. Deliberately a
// little generous: overestimating wraps a word early, while underestimating
// pushes the line past the padding and out of the card.
const NARROW_CHARS = new Set("ijlftIr.,;:!|'`()[]{}-");
const WIDE_CHARS = new Set('mwMW@%');

function estimateTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    if (char === ' ') units += 0.28;
    else if (NARROW_CHARS.has(char)) units += 0.32;
    else if (WIDE_CHARS.has(char)) units += 0.95;
    else if (char >= 'A' && char <= 'Z') units += 0.69;
    else units += 0.6;
  }
  return units * fontSize;
}

/**
 * Greedy word wrap to at most `maxLines`, ellipsising the final line. Words
 * longer than a line are hard-split so a pasted URL cannot overflow the card.
 */
export function wrapText(
  text: string,
  fontSize: number,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;

    if (estimateTextWidth(candidate, fontSize) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);

    if (lines.length === maxLines) {
      return ellipsiseLast(lines, word, fontSize, maxWidth);
    }

    // A single word too wide for its own line: cut it down to fit.
    current = word;
    while (estimateTextWidth(current, fontSize) > maxWidth && current.length > 1) {
      current = current.slice(0, -1);
    }
  }

  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

/** Append an ellipsis to the last line, trimming until it fits. */
function ellipsiseLast(
  lines: string[],
  overflowWord: string,
  fontSize: number,
  maxWidth: number
): string[] {
  const result = [...lines];
  let last = result[result.length - 1];

  // Signal the cut with the first overflowing word when there is room.
  let candidate = `${last} ${overflowWord}`;
  while (
    candidate.length > last.length &&
    estimateTextWidth(`${candidate}…`, fontSize) > maxWidth
  ) {
    candidate = candidate.slice(0, -1);
  }
  last = candidate.length > last.length ? candidate : last;

  while (estimateTextWidth(`${last}…`, fontSize) > maxWidth && last.length > 1) {
    last = last.slice(0, -1);
  }

  result[result.length - 1] = `${last.trimEnd()}…`;
  return result;
}

export interface CardContent {
  title: string;
  fileName: string;
  fileSize: number;
  priceSats: number;
}

function textEl(
  text: string,
  x: number,
  y: number,
  size: number,
  weight: 400 | 700,
  fill: string,
  extra = ''
): string {
  return (
    `<text x="${x}" y="${y}" font-family="Outfit" font-weight="${weight}" ` +
    `font-size="${size}" fill="${fill}"${extra}>${escapeHtml(text)}</text>`
  );
}

/**
 * Compose the card as an SVG document. Exported so tests can assert the
 * layout without paying for rasterisation.
 */
export function buildCardSvg(content: CardContent): string {
  const contentWidth = CARD_WIDTH - PADDING * 2;
  const titleLines = wrapText(
    content.title.trim() || 'Untitled stash',
    TITLE_SIZE,
    contentWidth,
    MAX_TITLE_LINES
  );

  // Pin the title block's baseline to the bottom so one- and two-line titles
  // both sit above the price rather than drifting.
  const titleBottom = 368;
  const titleTop = titleBottom - (titleLines.length - 1) * TITLE_LINE_HEIGHT;

  const kind = fileKind(content.fileName);
  const fileLine = [formatBytes(content.fileSize), kind].filter(Boolean).join('  ·  ');

  const logo = getLogoDataUri();
  const logoEl = logo
    ? `<image href="${logo}" x="${PADDING}" y="68" width="64" height="64" />`
    : '';
  const wordmarkX = logo ? PADDING + 84 : PADDING;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <defs>
    <radialGradient id="warm" cx="0.82" cy="0.12" r="0.75">
      <stop offset="0" stop-color="${COLORS.glowWarm}" stop-opacity="0.26" />
      <stop offset="1" stop-color="${COLORS.glowWarm}" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="cool" cx="0.08" cy="0.95" r="0.7">
      <stop offset="0" stop-color="${COLORS.glowCool}" stop-opacity="0.2" />
      <stop offset="1" stop-color="${COLORS.glowCool}" stop-opacity="0" />
    </radialGradient>
  </defs>

  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${COLORS.bg}" />
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#warm)" />
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#cool)" />

  ${logoEl}
  ${textEl('STASHU', wordmarkX, 112, 30, 700, COLORS.accent, ' letter-spacing="3.5"')}

  ${titleLines
    .map((line, index) =>
      textEl(
        line,
        PADDING,
        titleTop + index * TITLE_LINE_HEIGHT,
        TITLE_SIZE,
        700,
        COLORS.textPrimary
      )
    )
    .join('\n  ')}

  ${textEl(formatSats(content.priceSats), PADDING, 480, 76, 700, COLORS.accent)}
  ${textEl(fileLine, PADDING, 536, 30, 400, COLORS.textSecondary)}

  <rect x="${PADDING}" y="566" width="${contentWidth}" height="1" fill="${COLORS.hairline}" />
  ${textEl('Pay with Lightning or Cashu to unlock', PADDING, 600, 25, 400, COLORS.textMuted)}
</svg>`;
}

/**
 * Rasterise a stash's card. Returns null when the renderer is unavailable, so
 * the caller can fall back to the static icon instead of failing the request.
 */
export async function renderCardPng(content: CardContent): Promise<Buffer | null> {
  const resvg = await loadResvg();
  if (!resvg || !FONT_DIR) return null;

  try {
    const image = new resvg.Resvg(buildCardSvg(content), {
      font: {
        loadSystemFonts: false,
        fontFiles: [
          path.join(FONT_DIR, 'Outfit-Regular.ttf'),
          path.join(FONT_DIR, 'Outfit-Bold.ttf'),
        ],
        defaultFontFamily: 'Outfit',
      },
    });

    return image.render().asPng();
  } catch (error) {
    console.error('Share card: render failed:', error);
    return null;
  }
}
