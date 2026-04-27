import { describe, expect, it } from 'vitest';
import {
  GENERATED_PREVIEW_VERSION,
  decodeGeneratedPreviewBytes,
  generatePreviewFromBytes,
  generatePreviewFromFile,
  serializeGeneratedPreviewPayload,
  type GeneratedPreviewPayload,
  type TextLineLimit,
} from './generatedPreview.js';
import {
  createStashProof,
  verifyPreview,
  verifyPreviewInclusion,
  verifyUnlockedFile,
} from './stashProof.js';

const encoder = new TextEncoder();

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

function decodeBase64Url(value: string): string {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return atob(padded);
}

describe('generated preview payloads', () => {
  it('generates a text preview from a markdown file', async () => {
    const content = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join('\n');
    const file = new File([content], 'guide.md', { type: 'text/markdown' });

    const preview = await generatePreviewFromFile(file, {
      mode: 'auto',
      lineLimit: 10,
      maxPreviewRatio: 0.5,
    });

    expect(preview.version).toBe(GENERATED_PREVIEW_VERSION);
    expect(preview.kind).toBe('text-peek');
    expect(preview.fileName).toBe('guide.md');
    expect(preview.fileType).toBe('text/markdown');
    expect(preview.fileSize).toBe(file.size);
    expect(preview.contentType).toBe('text/plain; charset=utf-8');
    expect(decodeBase64Url(preview.bytes)).toBe(
      Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n')
    );
    expect(preview.metadata).toMatchObject({
      lineLimit: 10,
      linesIncluded: 10,
      truncated: true,
    });
  });

  it('uses the standard default when Auto Peek is enabled', async () => {
    const content = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join('\n');
    const file = new File([content], 'standard.md', { type: 'text/markdown' });

    const preview = await generatePreviewFromFile(file, { mode: 'auto' });

    expect(preview.kind).toBe('text-peek');
    expect(preview.options).toMatchObject({
      mode: 'auto',
      lineLimit: 10,
      maxChars: 2_000,
      maxPreviewRatio: 0.15,
    });
    expect(preview.metadata).toMatchObject({
      linesIncluded: 10,
      truncated: true,
    });
  });

  it('keeps exact source bytes while applying the character limit', () => {
    const preview = generatePreviewFromBytes(
      {
        fileName: 'notes.txt',
        fileType: 'text/plain',
        fileSize: 18,
        content: bytes('a\r\nb\r\nc\r\nd\r\n'),
      },
      { mode: 'auto', lineLimit: 10 as TextLineLimit, maxChars: 3, maxPreviewRatio: 0.5 }
    );

    expect(preview.kind).toBe('text-peek');
    expect(decodeBase64Url(preview.bytes)).toBe('a\r\n');
    expect(preview.metadata).toMatchObject({
      lineLimit: 10,
      linesIncluded: 2,
      previewBytes: 3,
      truncated: true,
    });
  });

  it('truncates by the configured line limit', () => {
    const content = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join('\n');

    const preview = generatePreviewFromBytes(
      {
        fileName: 'long.md',
        fileType: 'text/markdown',
        fileSize: bytes(content).length,
        content: bytes(content),
      },
      { mode: 'auto', lineLimit: 10, maxPreviewRatio: 0.5 }
    );

    expect(decodeBase64Url(preview.bytes)).toBe(
      Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n')
    );
    expect(preview.metadata).toMatchObject({
      lineLimit: 10,
      linesIncluded: 10,
      previewBytes: bytes(decodeBase64Url(preview.bytes)).length,
      truncated: true,
    });
  });

  it('truncates by the byte limit before decoding text', () => {
    const content = bytes('abcdef\nghijkl');

    const preview = generatePreviewFromBytes(
      {
        fileName: 'limited.txt',
        fileType: 'text/plain',
        fileSize: content.length,
        content,
      },
      { mode: 'auto', maxBytes: 6, maxPreviewRatio: 0.5 }
    );

    expect(decodeBase64Url(preview.bytes)).toBe('abcdef');
    expect(preview.metadata).toMatchObject({
      bytesRead: 6,
      previewBytes: 6,
      truncated: true,
    });
  });

  it('drops a partial trailing line when the ratio limit cuts text mid-line', () => {
    const content = bytes('line 1\nline 2\nline 3\nline 4\n');

    const preview = generatePreviewFromBytes(
      {
        fileName: 'limited.md',
        fileType: 'text/markdown',
        fileSize: content.length,
        content,
      },
      { mode: 'auto', maxPreviewRatio: 0.45 }
    );

    expect(preview.kind).toBe('text-peek');
    expect(decodeBase64Url(preview.bytes)).toBe('line 1');
    expect(preview.metadata).toMatchObject({
      linesIncluded: 1,
      truncated: true,
    });
  });

  it('treats code and prompt-like extensions as text when MIME type is empty', () => {
    const preview = generatePreviewFromBytes(
      {
        fileName: 'prompt.py',
        fileType: '',
        fileSize: 23,
        content: bytes('print("hello stashu")\n'),
      },
      { mode: 'auto', maxChars: 5, maxPreviewRatio: 0.5 }
    );

    expect(preview.kind).toBe('text-peek');
    expect(preview.fileType).toBe('application/octet-stream');
    expect(decodeBase64Url(preview.bytes)).toBe('print');
  });

  it('treats text extensions case-insensitively on real File objects', async () => {
    const preview = await generatePreviewFromFile(new File(['# Hello'], 'README.MD'), {
      mode: 'auto',
      maxChars: 3,
      maxPreviewRatio: 0.5,
    });

    expect(preview.kind).toBe('text-peek');
    expect(preview.fileType).toBe('application/octet-stream');
    expect(decodeBase64Url(preview.bytes)).toBe('# H');
  });

  it('treats hidden config files as text', () => {
    const preview = generatePreviewFromBytes(
      {
        fileName: '.env',
        fileType: '',
        fileSize: 15,
        content: bytes('TOKEN=example\n'),
      },
      { mode: 'auto', maxChars: 5, maxPreviewRatio: 0.5 }
    );

    expect(preview.kind).toBe('text-peek');
    expect(decodeBase64Url(preview.bytes)).toBe('TOKEN');
  });

  it('treats structured application MIME types as text', () => {
    const preview = generatePreviewFromBytes(
      {
        fileName: 'data',
        fileType: 'application/json; charset=utf-8',
        fileSize: 13,
        content: bytes('{"ok":true}\n'),
      },
      { mode: 'auto', maxChars: 5, maxPreviewRatio: 0.5 }
    );

    expect(preview.kind).toBe('text-peek');
    expect(decodeBase64Url(preview.bytes)).toBe('{"ok"');
  });

  it('treats CSV, YAML, and shell scripts as text-like files', () => {
    const cases = [
      { fileName: 'orders.csv', fileType: 'text/csv', content: 'price,sats\n1,100\n' },
      { fileName: 'config.yaml', fileType: '', content: 'relay:\n  enabled: true\n' },
      { fileName: 'deploy.sh', fileType: '', content: '#!/bin/sh\necho stashu\n' },
    ];

    for (const testCase of cases) {
      const content = bytes(testCase.content);
      const preview = generatePreviewFromBytes(
        {
          fileName: testCase.fileName,
          fileType: testCase.fileType,
          fileSize: content.length,
          content,
        },
        { mode: 'auto', maxChars: 5, maxPreviewRatio: 0.5 }
      );

      expect(preview.kind).toBe('text-peek');
    }
  });

  it('defaults to no public peek', async () => {
    const preview = await generatePreviewFromFile(
      new File(['secret prompt'], 'prompt.md', { type: 'text/markdown' })
    );

    expect(preview.kind).toBe('file-summary');
    expect(preview.bytes).toBe('');
    expect(preview.metadata).toEqual({ reason: 'preview-disabled' });
  });

  it('does not expose complete small text files in Auto Peek', async () => {
    const preview = await generatePreviewFromFile(
      new File([''], 'empty.txt', { type: 'text/plain' }),
      { mode: 'auto', maxPreviewRatio: 0.5 }
    );

    expect(preview.kind).toBe('file-summary');
    expect(preview.bytes).toBe('');
    expect(preview.metadata).toEqual({ reason: 'preview-would-reveal-file' });
  });

  it('generates a verified peek from a seller-picked excerpt', () => {
    const content = bytes('intro\nsafe excerpt\npaid-only ending');
    const offset = bytes('intro\n').length;
    const preview = generatePreviewFromBytes(
      {
        fileName: 'prompt.md',
        fileType: 'text/markdown',
        fileSize: content.length,
        content,
      },
      {
        mode: 'excerpt',
        maxPreviewRatio: 0.5,
        excerpt: {
          offset,
          text: 'safe excerpt',
        },
      }
    );

    expect(preview.kind).toBe('text-peek');
    expect(decodeBase64Url(preview.bytes)).toBe('safe excerpt');
    expect(preview.options).toMatchObject({ mode: 'excerpt', maxPreviewRatio: 0.5 });
    expect(preview.metadata).toMatchObject({
      offset,
      previewBytes: bytes('safe excerpt').length,
      truncated: true,
    });
  });

  it('rejects a seller-picked excerpt that does not match the file range', () => {
    const content = bytes('intro\nsafe excerpt\npaid-only ending');

    expect(() =>
      generatePreviewFromBytes(
        {
          fileName: 'prompt.md',
          fileType: 'text/markdown',
          fileSize: content.length,
          content,
        },
        {
          mode: 'excerpt',
          maxPreviewRatio: 0.5,
          excerpt: {
            offset: 0,
            text: 'safe excerpt',
          },
        }
      )
    ).toThrow(/does not match/);
  });

  it('rejects a seller-picked excerpt above the line limit', () => {
    const sourceText = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n');
    const excerptText = Array.from({ length: 11 }, (_, index) => `line ${index + 1}`).join('\n');
    const content = bytes(sourceText);

    expect(() =>
      generatePreviewFromBytes(
        {
          fileName: 'prompt.md',
          fileType: 'text/markdown',
          fileSize: content.length,
          content,
        },
        {
          mode: 'excerpt',
          lineLimit: 10,
          maxPreviewRatio: 0.5,
          excerpt: {
            offset: 0,
            text: excerptText,
          },
        }
      )
    ).toThrow(/too many lines/);
  });

  it('creates a file commitment without a public peek when disabled', async () => {
    const preview = await generatePreviewFromFile(
      new File(['secret prompt'], 'prompt.md', { type: 'text/markdown' }),
      { mode: 'none' }
    );

    expect(preview.kind).toBe('file-summary');
    expect(preview.bytes).toBe('');
    expect(preview.metadata).toEqual({ reason: 'preview-disabled' });
  });

  it('falls back to a file summary for unsupported binary files', async () => {
    const file = new File([new Uint8Array([0, 1, 2, 3]).buffer], 'archive.bin', {
      type: 'application/octet-stream',
    });

    const preview = await generatePreviewFromFile(file, { mode: 'auto' });

    expect(preview).toEqual({
      version: GENERATED_PREVIEW_VERSION,
      kind: 'file-summary',
      fileName: 'archive.bin',
      fileType: 'application/octet-stream',
      fileSize: 4,
      contentType: 'application/octet-stream',
      options: {},
      metadata: { reason: 'unsupported-type' },
      bytes: '',
    });
  });

  it('falls back to file summaries for images, PDFs, archives, and videos', async () => {
    const cases = [
      { fileName: 'photo.png', type: 'image/png' },
      { fileName: 'paper.pdf', type: 'application/pdf' },
      { fileName: 'bundle.zip', type: 'application/zip' },
      { fileName: 'clip.mp4', type: 'video/mp4' },
    ];

    for (const testCase of cases) {
      const file = new File([new Uint8Array([1, 2, 3, 4]).buffer], testCase.fileName, {
        type: testCase.type,
      });

      const preview = await generatePreviewFromFile(file, { mode: 'auto' });

      expect(preview.kind).toBe('file-summary');
      expect(preview.metadata).toEqual({ reason: 'unsupported-type' });
      expect(preview.bytes).toBe('');
    }
  });

  it('falls back to a file summary when text decoding fails', () => {
    const preview = generatePreviewFromBytes(
      {
        fileName: 'broken.txt',
        fileType: 'text/plain',
        fileSize: 10,
        content: new Uint8Array(10).fill(0xff),
      },
      { mode: 'auto', maxPreviewRatio: 0.5 }
    );

    expect(preview.kind).toBe('file-summary');
    expect(preview.metadata).toEqual({ reason: 'decode-failed' });
  });

  it('does not reject valid UTF-8 when the byte limit cuts a character suffix', () => {
    const content = bytes('ab🙂');
    const preview = generatePreviewFromBytes(
      {
        fileName: 'emoji.md',
        fileType: 'text/markdown',
        fileSize: content.length,
        content,
      },
      { mode: 'auto', maxBytes: content.length - 1, maxPreviewRatio: 0.5 }
    );

    expect(preview.kind).toBe('text-peek');
    expect(decodeBase64Url(preview.bytes)).toBe('ab');
    expect(preview.metadata).toMatchObject({
      bytesRead: 2,
      previewBytes: 2,
      truncated: true,
    });
  });

  it('handles real File prefix reads that cut a multibyte character', async () => {
    const content = bytes('ab🙂');
    const preview = await generatePreviewFromFile(
      new File([content.slice().buffer as ArrayBuffer], 'emoji.md', { type: 'text/markdown' }),
      { mode: 'auto', maxBytes: content.length - 1, maxPreviewRatio: 0.5 }
    );

    expect(preview.kind).toBe('text-peek');
    expect(decodeBase64Url(preview.bytes)).toBe('ab');
    expect(preview.metadata).toMatchObject({
      bytesRead: 2,
      previewBytes: 2,
      truncated: true,
    });
  });

  it('keeps unknown extensionless files as summaries even if bytes look textual', () => {
    const preview = generatePreviewFromBytes(
      {
        fileName: 'payload',
        fileType: '',
        fileSize: 11,
        content: bytes('hello world'),
      },
      { mode: 'auto' }
    );

    expect(preview.kind).toBe('file-summary');
    expect(preview.bytes).toBe('');
  });

  it('matches file and byte generation for the same source', async () => {
    const file = new File(['alpha\nbeta\ngamma'], 'same.md', { type: 'text/markdown' });
    const fromFile = await generatePreviewFromFile(file, { mode: 'auto', lineLimit: 20 });
    const fromBytes = generatePreviewFromBytes(
      {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        content: bytes('alpha\nbeta\ngamma'),
      },
      { mode: 'auto', lineLimit: 20 }
    );

    expect(fromFile).toEqual(fromBytes);
  });

  it('serializes payloads canonically', async () => {
    const payload = await generatePreviewFromFile(
      new File(['hello'], 'hello.txt', { type: 'text/plain' })
    );
    const reordered = {
      bytes: payload.bytes,
      metadata: payload.metadata,
      options: payload.options,
      contentType: payload.contentType,
      fileSize: payload.fileSize,
      fileType: payload.fileType,
      fileName: payload.fileName,
      kind: payload.kind,
      version: payload.version,
    } as GeneratedPreviewPayload;

    expect(serializeGeneratedPreviewPayload(payload)).toEqual(
      serializeGeneratedPreviewPayload(reordered)
    );
  });

  it('can be committed with stash proofs and rejects preview/file tampering', async () => {
    const fileBytes = bytes('one\ntwo\nthree');
    const payload = await generatePreviewFromFile(
      new File([fileBytes.slice().buffer as ArrayBuffer], 'proof.md', { type: 'text/markdown' }),
      { mode: 'auto', maxChars: 5, maxPreviewRatio: 0.5 }
    );
    const serializedPayload = serializeGeneratedPreviewPayload(payload);
    const previewContent = decodeGeneratedPreviewBytes(payload);
    const { proof, secret } = createStashProof(serializedPayload, fileBytes, { previewContent });
    const tamperedPayload = serializeGeneratedPreviewPayload({
      ...payload,
      fileName: 'other.md',
    });

    expect(verifyPreview(serializedPayload, proof)).toBe(true);
    expect(verifyPreviewInclusion(previewContent, proof)).toBe(true);
    expect(verifyPreview(tamperedPayload, proof)).toBe(false);
    expect(verifyUnlockedFile(fileBytes, proof, secret)).toBe(true);
    expect(verifyUnlockedFile(bytes('different file'), proof, secret)).toBe(false);
  });

  it('rejects unsupported text line limits', () => {
    expect(() =>
      generatePreviewFromBytes(
        {
          fileName: 'notes.md',
          fileType: 'text/markdown',
          fileSize: 5,
          content: bytes('hello'),
        },
        { lineLimit: 12 as TextLineLimit }
      )
    ).toThrow(/lineLimit/);
  });

  it('rejects invalid byte and character limits', () => {
    const source = {
      fileName: 'notes.md',
      fileType: 'text/markdown',
      fileSize: 5,
      content: bytes('hello'),
    };

    expect(() => generatePreviewFromBytes(source, { maxBytes: 0 })).toThrow(/maxBytes/);
    expect(() => generatePreviewFromBytes(source, { maxChars: -1 })).toThrow(/maxChars/);
  });
});
