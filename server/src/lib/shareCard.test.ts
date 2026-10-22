/**
 * Tests for the rendered share card image.
 *
 * Run with: npm test --workspace=server
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  buildCardSvg,
  canDraw,
  cardTitle,
  isCardRendererAvailable,
  readCmapCoverage,
  renderCardPng,
  wrapText,
  type CardContent,
} from './shareCard.js';

function content(overrides: Partial<CardContent> = {}): CardContent {
  return {
    title: 'Blender Donut Tutorial',
    fileName: 'donut.mp4',
    fileSize: 47_395_635,
    priceSats: 2_000,
    ...overrides,
  };
}

/** Width of a PNG, read straight out of the IHDR chunk. */
function pngSize(png: Buffer): { width: number; height: number } {
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', 'not a PNG');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe('wrapText', () => {
  it('keeps a short line on one line', () => {
    assert.deepEqual(wrapText('Blender Donut', 62, 1048, 2), ['Blender Donut']);
  });

  it('returns nothing for empty input', () => {
    assert.deepEqual(wrapText('   ', 62, 1048, 2), []);
  });

  it('wraps onto a second line rather than overflowing', () => {
    const lines = wrapText(
      'Complete Lightroom Presets Pack for Moody Film Photography',
      62,
      1048,
      2
    );

    assert.equal(lines.length, 2);
    assert.ok(lines[0].length > 0);
  });

  it('never exceeds maxLines, and marks the cut with an ellipsis', () => {
    const lines = wrapText(`${'word '.repeat(80)}`, 62, 1048, 2);

    assert.equal(lines.length, 2);
    assert.ok(lines[1].endsWith('…'), `expected an ellipsis, got ${JSON.stringify(lines[1])}`);
  });

  it('breaks a word too wide for the card across lines, ending in an ellipsis', () => {
    // A pasted URL has no spaces to break on and would otherwise run off the edge.
    const lines = wrapText(`https://example.com/${'a'.repeat(300)}`, 62, 1048, 2);

    assert.equal(lines.length, 2, 'the overflow should spill onto the second line');
    assert.ok(lines[0].startsWith('https://example.com/'));
    assert.ok(lines[1].endsWith('…'), 'the cut should be marked, not silent');
    for (const line of lines) {
      assert.ok(line.length < 60, `line is implausibly long: ${line.length}`);
    }
  });

  it('cuts at a word boundary rather than mid-word when it can', () => {
    const lines = wrapText(
      'Complete Lightroom Presets Pack for Moody Film Photography and Portrait Retouching Workflows',
      62,
      1048,
      2
    );

    assert.equal(lines.length, 2);
    // Every word before the ellipsis is whole.
    const words = lines[1].slice(0, -1).split(' ');
    const source = new Set('for Moody Film Photography and Portrait'.split(' '));
    assert.ok(
      words.every((word) => source.has(word)),
      `cut mid-word: ${lines[1]}`
    );
  });

  it('never splits a surrogate pair when it breaks a word', () => {
    const lines = wrapText('𝐀'.repeat(200), 62, 1048, 2);
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

    for (const line of lines) {
      assert.ok(!loneSurrogate.test(line), 'a surrogate pair was split');
    }
  });
});

describe('readCmapCoverage', () => {
  const fontPath = new URL('../../assets/fonts/Outfit-Bold.ttf', import.meta.url);
  const coverage = readCmapCoverage(readFileSync(fontPath));

  it('reads every code point the vendored font maps', () => {
    // fontTools reports 360 mapped code points for this face.
    assert.equal(coverage?.size, 360);
  });

  it('covers Latin and the punctuation the card draws', () => {
    for (const char of 'Az09éßŁ…·—') {
      assert.ok(coverage?.has(char.codePointAt(0)!), `missing ${char}`);
    }
  });

  it('does not claim scripts or emoji the font lacks', () => {
    for (const char of ['Ж', '中', 'ع', '🐿', '️']) {
      assert.ok(!coverage?.has(char.codePointAt(0)!), `claimed ${char}`);
    }
  });

  it('returns null for bytes that are not a font', () => {
    assert.equal(readCmapCoverage(Buffer.alloc(64)), null);
  });
});

describe('cardTitle', () => {
  it('drops emoji instead of drawing them as tofu boxes', () => {
    assert.equal(cardTitle('Squirrel pack 🐿️🐿️ with extras'), 'Squirrel pack with extras');
    assert.equal(cardTitle('🎨 Procreate Brush Pack'), 'Procreate Brush Pack');
  });

  it('keeps accented Latin', () => {
    assert.equal(cardTitle('Café Crème Brûlée'), 'Café Crème Brûlée');
  });

  it('leaves off a title that is mostly in a script the font lacks', () => {
    // Showing just "Blender" would misrepresent the stash.
    assert.equal(cardTitle('Курс по Blender для начинающих'), null);
    assert.equal(cardTitle('中文教程合集'), null);
  });

  it('leaves off a title made only of emoji', () => {
    assert.equal(cardTitle('🐿️🐿️'), null);
  });

  it('keeps a title with no letters at all', () => {
    assert.equal(cardTitle('$$$ 100% !!!'), '$$$ 100% !!!');
  });

  it('only ever returns characters the font can draw', () => {
    const title = cardTitle('Mixed: Ünïcødé, 日本, emoji 🎉 and — dashes') ?? '';
    for (const char of title) {
      assert.ok(canDraw(char.codePointAt(0)!), `undrawable ${JSON.stringify(char)} survived`);
    }
  });
});

describe('buildCardSvg', () => {
  it('declares the Open Graph card size', () => {
    const svg = buildCardSvg(content());

    assert.ok(svg.includes(`width="${CARD_WIDTH}"`));
    assert.ok(svg.includes(`height="${CARD_HEIGHT}"`));
    assert.equal(CARD_WIDTH / CARD_HEIGHT > 1.85, true, 'should be roughly 1.91:1');
  });

  it('puts the title, price and file facts on the card', () => {
    const svg = buildCardSvg(content());

    assert.ok(svg.includes('Blender Donut Tutorial'));
    assert.ok(svg.includes('2,000 sats'));
    assert.ok(svg.includes('45.2 MB'));
    assert.ok(svg.includes('MP4'));
  });

  it('escapes a title that would otherwise break the SVG', () => {
    const svg = buildCardSvg(content({ title: '</text><script>alert(1)</script>' }));

    assert.ok(!svg.includes('<script>'), 'raw markup survived into the SVG');
    assert.ok(svg.includes('&lt;/text&gt;'));
  });

  it('falls back to a placeholder title', () => {
    assert.ok(buildCardSvg(content({ title: '   ' })).includes('Untitled stash'));
  });

  it('leaves the title off rather than drawing tofu for an undrawable one', () => {
    const svg = buildCardSvg(content({ title: 'Курс по Blender для начинающих' }));

    assert.ok(!svg.includes('Курс'), 'Cyrillic reached the SVG');
    assert.ok(!svg.includes('>Blender<'), 'a misleading fragment reached the SVG');
    assert.ok(svg.includes('2,000 sats'), 'the rest of the card should still render');
  });

  it('omits the file type when the name has no extension', () => {
    const svg = buildCardSvg(content({ fileName: 'README', fileSize: 420 }));

    assert.ok(svg.includes('420 B'));
    assert.ok(!svg.includes('·'), 'separator should be dropped with nothing to separate');
  });

  it('puts "from" before a pay-what-you-want price, and only then', () => {
    assert.match(buildCardSvg(content({ payWhatYouWant: true })), />from <\/tspan>2,000 sats</);
    assert.ok(!buildCardSvg(content()).includes('from '));
  });
});

describe('renderCardPng', () => {
  it('renders a PNG at the Open Graph card size', async (t) => {
    if (!(await isCardRendererAvailable())) {
      // The fallback path is covered by the route; nothing to assert here.
      return t.skip('card renderer unavailable on this platform');
    }

    const png = await renderCardPng(content());
    assert.ok(png, 'expected a PNG buffer');
    assert.deepEqual(pngSize(png), { width: CARD_WIDTH, height: CARD_HEIGHT });
  });

  it('renders every stash shape without throwing', async (t) => {
    if (!(await isCardRendererAvailable())) {
      return t.skip('card renderer unavailable on this platform');
    }

    const shapes = [
      content({ title: 'A', fileName: 'README', fileSize: 1, priceSats: 1 }),
      content({ title: 'x'.repeat(200), priceSats: 21_000_000 }),
      content({ title: '"><script>alert(1)</script>' }),
      content({ title: 'Ünïcødé — em dash & ampersand' }),
    ];

    for (const shape of shapes) {
      const png = await renderCardPng(shape);
      assert.ok(png, `no PNG for ${shape.title.slice(0, 20)}`);
      assert.deepEqual(pngSize(png), { width: CARD_WIDTH, height: CARD_HEIGHT });
    }
  });
});
