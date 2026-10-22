/**
 * Tests for the rendered share card image.
 *
 * Run with: npm test --workspace=server
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  buildCardSvg,
  isCardRendererAvailable,
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

  it('hard-splits a single word too wide for the card', () => {
    // A pasted URL has no spaces to break on and would otherwise run off the edge.
    const lines = wrapText(`https://example.com/${'a'.repeat(300)}`, 62, 1048, 2);

    assert.ok(lines.length <= 2);
    for (const line of lines) {
      assert.ok(line.length < 120, `line is implausibly long: ${line.length}`);
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

  it('omits the file type when the name has no extension', () => {
    const svg = buildCardSvg(content({ fileName: 'README', fileSize: 420 }));

    assert.ok(svg.includes('420 B'));
    assert.ok(!svg.includes('·'), 'separator should be dropped with nothing to separate');
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
