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

/**
 * Code points a font can draw, read from its cmap. Only format 4 is parsed —
 * it is the only Unicode subtable Outfit ships. Returns null for anything
 * else so the caller falls back to a conservative set instead of guessing.
 */
export function readCmapCoverage(font: Buffer): Set<number> | null {
  const numTables = font.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < numTables; i++) {
    const record = 12 + i * 16;
    if (font.toString('latin1', record, record + 4) === 'cmap') {
      cmap = font.readUInt32BE(record + 8);
      break;
    }
  }
  if (cmap < 0) return null;

  const subtables = font.readUInt16BE(cmap + 2);
  for (let i = 0; i < subtables; i++) {
    const record = cmap + 4 + i * 8;
    const platform = font.readUInt16BE(record);
    const encoding = font.readUInt16BE(record + 2);
    const table = cmap + font.readUInt32BE(record + 4);
    const isUnicode = platform === 0 || (platform === 3 && encoding === 1);
    if (!isUnicode || font.readUInt16BE(table) !== 4) continue;

    const segments = font.readUInt16BE(table + 6) / 2;
    const ends = table + 14;
    const starts = ends + segments * 2 + 2;
    const deltas = starts + segments * 2;
    const rangeOffsets = deltas + segments * 2;
    const covered = new Set<number>();

    for (let seg = 0; seg < segments; seg++) {
      const start = font.readUInt16BE(starts + seg * 2);
      const end = font.readUInt16BE(ends + seg * 2);
      const delta = font.readInt16BE(deltas + seg * 2);
      const rangeOffsetAt = rangeOffsets + seg * 2;
      const rangeOffset = font.readUInt16BE(rangeOffsetAt);

      // 0xFFFF closes the last segment and never maps to a real glyph.
      for (let code = start; code <= end && code !== 0xffff; code++) {
        let glyph = (code + delta) & 0xffff;
        if (rangeOffset !== 0) {
          const raw = font.readUInt16BE(rangeOffsetAt + rangeOffset + (code - start) * 2);
          glyph = raw === 0 ? 0 : (raw + delta) & 0xffff;
        }
        // Glyph 0 is .notdef — the tofu box itself.
        if (glyph !== 0) covered.add(code);
      }
    }

    return covered;
  }

  return null;
}

let glyphCoverage: Set<number> | null | undefined;

function getGlyphCoverage(): Set<number> | null {
  if (glyphCoverage !== undefined) return glyphCoverage;

  try {
    glyphCoverage = FONT_DIR
      ? readCmapCoverage(readFileSync(path.join(FONT_DIR, 'Outfit-Bold.ttf')))
      : null;
  } catch {
    glyphCoverage = null;
  }

  return glyphCoverage;
}

/**
 * Whether the card font has a glyph for this code point. Without a readable
 * cmap it falls back to Latin-1, which any Latin face covers: better to drop
 * a rare letter than to draw a tofu box in its place.
 */
export function canDraw(codePoint: number): boolean {
  const coverage = getGlyphCoverage();
  if (coverage) return coverage.has(codePoint);
  return (codePoint >= 0x20 && codePoint <= 0x7e) || (codePoint >= 0xa0 && codePoint <= 0xff);
}

// Below this share of drawable letters a title is mostly in a script the font
// lacks, and what survives would be a misleading fragment ("Курс по Blender"
// -> "Blender"). The card then leaves the title off; the og:title text under
// the image still carries it in full, in the viewer's own system font.
const MIN_DRAWABLE_LETTER_SHARE = 0.5;

/**
 * The title as the card can draw it: characters the font lacks (emoji, other
 * scripts) are dropped instead of rendered as tofu, and null means the title
 * is better left off the card entirely.
 */
export function cardTitle(title: string): string | null {
  let drawable = '';
  let letters = 0;
  let drawableLetters = 0;

  for (const char of title) {
    if (/\s/.test(char)) {
      drawable += ' ';
      continue;
    }

    const isLetter = /[\p{L}\p{N}]/u.test(char);
    if (isLetter) letters++;

    if (canDraw(char.codePointAt(0)!)) {
      drawable += char;
      if (isLetter) drawableLetters++;
    }
  }

  const cleaned = drawable.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  if (letters > 0 && drawableLetters / letters < MIN_DRAWABLE_LETTER_SHARE) return null;
  return cleaned;
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
 * Greedy word wrap to at most `maxLines`. A word wider than a whole line is
 * broken across lines so a pasted URL wraps instead of running off the card,
 * and text that still overflows ends in an ellipsis — on a word boundary when
 * the last line has one.
 */
export function wrapText(
  text: string,
  fontSize: number,
  maxWidth: number,
  maxLines: number
): string[] {
  const fits = (line: string) => estimateTextWidth(line, fontSize) <= maxWidth;
  const lines: string[] = [];
  let current = '';

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);
    current = '';
    // Iterating by code point keeps surrogate pairs whole when a word breaks.
    for (const char of word) {
      if (current && !fits(current + char)) {
        lines.push(current);
        current = '';
      }
      current += char;
    }
  }
  if (current) lines.push(current);

  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (!fits(`${last}…`) && last.includes(' ')) {
    last = last.slice(0, last.lastIndexOf(' '));
  }
  // One overlong word has no boundary to fall back on, so cut inside it.
  const chars = Array.from(last);
  while (chars.length > 1 && !fits(`${chars.join('')}…`)) chars.pop();
  kept[maxLines - 1] = `${chars.join('').trimEnd()}…`;
  return kept;
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
  const title = cardTitle(content.title.trim() || 'Untitled stash');
  const titleLines = title ? wrapText(title, TITLE_SIZE, contentWidth, MAX_TITLE_LINES) : [];

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
