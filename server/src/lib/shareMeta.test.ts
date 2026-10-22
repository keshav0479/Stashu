/**
 * Tests for per-stash social share card meta tags.
 *
 * Run with: npm test --workspace=server
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCardDescription,
  buildStashShareMeta,
  escapeHtml,
  fileKind,
  formatBytes,
  formatSats,
  injectHeadMeta,
  resolvePublicOrigin,
  type ShareCardImage,
  type StashShareInfo,
} from './shareMeta.js';

// Mirrors the real index.html head closely enough to catch the tags we strip.
const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Stashu - the blind vending machine." />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Stashu — Sell Files for Bitcoin" />
    <meta property="og:description" content="The blind vending machine." />
    <meta property="og:image" content="/favicon.png" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="Stashu — Sell Files for Bitcoin" />
    <meta name="twitter:description" content="Sell digital files for sats." />
    <meta name="theme-color" content="#0f172a" />
    <title>Stashu</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/index-abc123.js"></script>
  </body>
</html>
`;

function stash(overrides: Partial<StashShareInfo> = {}): StashShareInfo {
  return {
    id: 'b3b1b0a9-0000-4000-8000-000000000001',
    title: 'Blender Donut Tutorial',
    fileName: 'donut.mp4',
    fileSize: 47_395_635,
    priceSats: 2_000,
    ...overrides,
  };
}

/** Pull one meta tag's content out of rendered HTML. */
function metaContent(html: string, key: string): string | null {
  const pattern = new RegExp(
    `<meta\\s+(?:name|property)="${key.replace(':', ':')}"\\s+content="([^"]*)"`,
    'i'
  );
  return pattern.exec(html)?.[1] ?? null;
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** Inverse of escapeHtml, for the roundtrip assertion. */
function unescapeHtml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

describe('escapeHtml', () => {
  it('escapes the five characters that matter in an attribute', () => {
    assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });

  it('escapes ampersands first so nothing is double-escaped', () => {
    assert.equal(escapeHtml('&lt;'), '&amp;lt;');
  });

  it('roundtrips arbitrary text', () => {
    for (const original of [
      'plain text',
      '"><script>alert(1)</script>',
      "O'Brien & Sons <loud>",
      '100% & rising — ünïcødé 🐿️',
      '&amp;&lt;&gt;&quot;',
    ]) {
      assert.equal(unescapeHtml(escapeHtml(original)), original);
    }
  });
});

describe('formatSats', () => {
  it('uses the singular for exactly one sat', () => {
    assert.equal(formatSats(1), '1 sat');
  });

  it('groups thousands', () => {
    assert.equal(formatSats(2_000), '2,000 sats');
    assert.equal(formatSats(1_250_000), '1,250,000 sats');
  });
});

describe('formatBytes', () => {
  it('picks a unit per magnitude', () => {
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(1024), '1.0 KB');
    assert.equal(formatBytes(1024 * 1024), '1.0 MB');
    assert.equal(formatBytes(47_395_635), '45.2 MB');
  });
});

describe('fileKind', () => {
  it('returns the uppercase extension', () => {
    assert.equal(fileKind('donut.mp4'), 'MP4');
    assert.equal(fileKind('notes.tar.gz'), 'GZ');
    assert.equal(fileKind('/some/path/report.PDF'), 'PDF');
  });

  it('returns null when there is no usable extension', () => {
    assert.equal(fileKind('README'), null);
    assert.equal(fileKind('.gitignore'), null);
    assert.equal(fileKind('trailing.'), null);
    assert.equal(fileKind('weird.name with spaces'), null);
  });
});

describe('buildCardDescription', () => {
  it('leads with price, size and file type', () => {
    assert.equal(
      buildCardDescription(stash()),
      '2,000 sats · 45.2 MB · MP4 — Pay with Lightning or Cashu to unlock.'
    );
  });

  it("appends the seller's own description when there is one", () => {
    const description = buildCardDescription(stash({ description: 'Full 4K project files.' }));
    assert.equal(description, '2,000 sats · 45.2 MB · MP4 — Full 4K project files.');
  });

  it('flattens newlines so the card stays one line', () => {
    const description = buildCardDescription(stash({ description: 'line one\n\nline two' }));
    assert.ok(!description.includes('\n'));
    assert.ok(description.endsWith('line one line two'));
  });

  it('truncates long descriptions to something a crawler will render', () => {
    const description = buildCardDescription(stash({ description: 'x'.repeat(500) }));
    assert.ok(description.length <= 160, `got ${description.length} chars`);
    assert.ok(description.endsWith('…'));
  });

  it('omits the file type when the name has no extension', () => {
    assert.equal(
      buildCardDescription(stash({ fileName: 'README' })),
      '2,000 sats · 45.2 MB — Pay with Lightning or Cashu to unlock.'
    );
  });
});

const RENDERED_CARD: ShareCardImage = {
  url: 'https://stashu.dev/s/b3b1b0a9-0000-4000-8000-000000000001/card.png',
  large: true,
  width: 1200,
  height: 630,
};

const ICON_FALLBACK: ShareCardImage = {
  url: 'https://stashu.dev/apple-touch-icon.png',
  large: false,
  width: 180,
  height: 180,
};

describe('buildStashShareMeta', () => {
  it('carries the stash title and price into the card', () => {
    const html = buildStashShareMeta(stash(), 'https://stashu.dev', RENDERED_CARD);

    assert.equal(metaContent(html, 'og:title'), 'Blender Donut Tutorial');
    assert.equal(metaContent(html, 'twitter:title'), 'Blender Donut Tutorial');
    assert.ok(metaContent(html, 'og:description')?.startsWith('2,000 sats · 45.2 MB · MP4'));
  });

  it('builds an absolute og:url and og:image', () => {
    const html = buildStashShareMeta(stash(), 'https://stashu.dev', RENDERED_CARD);

    assert.equal(
      metaContent(html, 'og:url'),
      'https://stashu.dev/s/b3b1b0a9-0000-4000-8000-000000000001'
    );
    assert.equal(metaContent(html, 'og:image'), RENDERED_CARD.url);
    assert.equal(metaContent(html, 'twitter:image'), RENDERED_CARD.url);
  });

  it('asks for the large card when the image is a banner', () => {
    const large = buildStashShareMeta(stash(), 'https://stashu.dev', RENDERED_CARD);
    assert.equal(metaContent(large, 'twitter:card'), 'summary_large_image');
    assert.equal(metaContent(large, 'og:image:width'), '1200');
    assert.equal(metaContent(large, 'og:image:height'), '630');

    const small = buildStashShareMeta(stash(), 'https://stashu.dev', ICON_FALLBACK);
    assert.equal(metaContent(small, 'twitter:card'), 'summary');
    assert.equal(metaContent(small, 'og:image:width'), '180');
  });

  it('claims no dimensions for an image it has not measured', () => {
    const html = buildStashShareMeta(stash(), 'https://stashu.dev', {
      url: 'https://blossom.example.com/seller.png',
      large: true,
    });

    assert.equal(metaContent(html, 'og:image'), 'https://blossom.example.com/seller.png');
    assert.equal(metaContent(html, 'og:image:width'), null);
    assert.equal(metaContent(html, 'og:image:height'), null);
  });

  it('escapes a title that tries to break out of the meta tag', () => {
    const html = buildStashShareMeta(
      stash({ title: '"><script>alert(1)</script>', description: '"><img src=x onerror=1>' }),
      'https://stashu.dev',
      RENDERED_CARD
    );

    assert.ok(!html.includes('<script'), 'raw <script> survived into the head');
    assert.ok(!html.includes('<img'), 'raw <img> survived into the head');
    assert.ok(html.includes('&quot;&gt;&lt;script&gt;'));
  });

  it('falls back to a placeholder when the title is blank', () => {
    assert.equal(
      metaContent(buildStashShareMeta(stash({ title: '   ' }), '', RENDERED_CARD), 'og:title'),
      'Untitled stash'
    );
  });
});

describe('injectHeadMeta', () => {
  const rendered = injectHeadMeta(
    INDEX_HTML,
    buildStashShareMeta(stash(), 'https://stashu.dev', RENDERED_CARD)
  );

  it('leaves exactly one of each social tag', () => {
    for (const key of ['og:title', 'og:description', 'og:image', 'twitter:title']) {
      assert.equal(countOccurrences(rendered, `"${key}"`), 1, `${key} is not unique`);
    }
    assert.equal(countOccurrences(rendered, '<title>'), 1);
  });

  it('replaces the generic card with the stash card', () => {
    assert.ok(!rendered.includes('Sell Files for Bitcoin'));
    assert.equal(metaContent(rendered, 'og:title'), 'Blender Donut Tutorial');
    assert.ok(rendered.includes('<title>Blender Donut Tutorial · Stashu</title>'));
  });

  it('leaves the rest of the document alone', () => {
    assert.ok(rendered.includes('<meta charset="UTF-8" />'));
    assert.ok(rendered.includes('name="viewport"'));
    assert.ok(rendered.includes('name="theme-color"'));
    assert.ok(rendered.includes('<link rel="icon" type="image/png" href="/favicon.png" />'));
    assert.ok(rendered.includes('src="/assets/index-abc123.js"'));
    assert.ok(rendered.includes('<div id="root"></div>'));
  });

  it('keeps the new tags inside <head>', () => {
    assert.ok(rendered.indexOf('og:title') < rendered.indexOf('</head>'));
  });

  it('appends when the document has no head to splice into', () => {
    const result = injectHeadMeta('<p>no head here</p>', '    <meta name="x" content="y" />');
    assert.ok(result.includes('<p>no head here</p>'));
    assert.ok(result.includes('name="x"'));
  });

  it('never touches the body', () => {
    const body = `<body>
    <svg role="img"><title>Squirrel</title></svg>
    <meta property="og:title" content="not in the head, so not ours" />

    <script>const poem = \`line one

line three\`;</script>
  </body>`;
    const html = INDEX_HTML.replace(/<body>[\s\S]*<\/body>/, body);
    const result = injectHeadMeta(
      html,
      buildStashShareMeta(stash(), 'https://stashu.dev', RENDERED_CARD)
    );

    assert.ok(result.endsWith(html.slice(html.indexOf('</head>'))), 'the body was rewritten');
  });
});

describe('resolvePublicOrigin', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env.PUBLIC_ORIGIN = saved.PUBLIC_ORIGIN;
    process.env.CORS_ORIGINS = saved.CORS_ORIGINS;
    if (saved.PUBLIC_ORIGIN === undefined) delete process.env.PUBLIC_ORIGIN;
    if (saved.CORS_ORIGINS === undefined) delete process.env.CORS_ORIGINS;
  });

  it('prefers PUBLIC_ORIGIN', () => {
    process.env.PUBLIC_ORIGIN = 'https://stashu.dev';
    process.env.CORS_ORIGINS = 'https://ignored.example';

    assert.equal(resolvePublicOrigin('http://stashu:3000/s/abc'), 'https://stashu.dev');
  });

  it('falls back to the first configured CORS origin', () => {
    delete process.env.PUBLIC_ORIGIN;
    process.env.CORS_ORIGINS = 'https://stashu.dev,https://other.example';

    assert.equal(resolvePublicOrigin('http://stashu:3000/s/abc'), 'https://stashu.dev');
  });

  it('ignores the request host, which a proxy header could forge', () => {
    delete process.env.PUBLIC_ORIGIN;
    process.env.CORS_ORIGINS = 'https://stashu.dev';

    assert.equal(resolvePublicOrigin('https://evil.example/s/abc'), 'https://stashu.dev');
  });

  it('uses the request origin when nothing is configured', () => {
    delete process.env.PUBLIC_ORIGIN;
    delete process.env.CORS_ORIGINS;

    assert.equal(resolvePublicOrigin('http://localhost:3000/s/abc'), 'http://localhost:3000');
  });

  it('skips a malformed configured origin', () => {
    process.env.PUBLIC_ORIGIN = 'not a url';
    process.env.CORS_ORIGINS = 'https://stashu.dev';

    assert.equal(resolvePublicOrigin('http://localhost:3000/s/abc'), 'https://stashu.dev');
  });
});
