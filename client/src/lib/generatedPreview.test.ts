import { describe, expect, it } from 'vitest';
import {
  GENERATED_PREVIEW_VERSION,
  generatePreviewFromBytes,
  generatePreviewFromFile,
  serializeGeneratedPreviewPayload,
  type GeneratedPreviewPayload,
  type TextLineLimit,
} from './generatedPreview.js';
import { createStashProof, verifyPreview, verifyUnlockedFile } from './stashProof.js';

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
    const file = new File(['one\ntwo\nthree'], 'guide.md', { type: 'text/markdown' });

    const preview = await generatePreviewFromFile(file, { lineLimit: 10 });

    expect(preview.version).toBe(GENERATED_PREVIEW_VERSION);
    expect(preview.kind).toBe('text-head');
    expect(preview.fileName).toBe('guide.md');
    expect(preview.fileType).toBe('text/markdown');
    expect(preview.fileSize).toBe(file.size);
    expect(preview.contentType).toBe('text/plain; charset=utf-8');
    expect(decodeBase64Url(preview.bytes)).toBe('one\ntwo\nthree');
    expect(preview.metadata).toEqual({
      lineLimit: 10,
      linesIncluded: 3,
      bytesRead: file.size,
      truncated: false,
    });
  });

  it('normalizes CRLF line endings and applies the line limit', () => {
    const preview = generatePreviewFromBytes(
      {
        fileName: 'notes.txt',
        fileType: 'text/plain',
        fileSize: 18,
        content: bytes('a\r\nb\r\nc\r\nd\r\n'),
      },
      { lineLimit: 10 as TextLineLimit, maxChars: 3 }
    );

    expect(preview.kind).toBe('text-head');
    expect(decodeBase64Url(preview.bytes)).toBe('a\nb');
    expect(preview.metadata).toMatchObject({
      lineLimit: 10,
      linesIncluded: 2,
      truncated: true,
    });
  });

  it('truncates by the configured line limit', () => {
    const content = Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\n');

    const preview = generatePreviewFromBytes(
      {
        fileName: 'long.md',
        fileType: 'text/markdown',
        fileSize: bytes(content).length,
        content: bytes(content),
      },
      { lineLimit: 10 }
    );

    expect(decodeBase64Url(preview.bytes)).toBe(
      Array.from({ length: 10 }, (_, index) => `line ${index + 1}`).join('\n')
    );
    expect(preview.metadata).toMatchObject({
      lineLimit: 10,
      linesIncluded: 10,
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
      { maxBytes: 6 }
    );

    expect(decodeBase64Url(preview.bytes)).toBe('abcdef');
    expect(preview.metadata).toMatchObject({
      bytesRead: 6,
      truncated: true,
    });
  });

  it('treats code and prompt-like extensions as text when MIME type is empty', () => {
    const preview = generatePreviewFromBytes({
      fileName: 'prompt.py',
      fileType: '',
      fileSize: 23,
      content: bytes('print("hello stashu")\n'),
    });

    expect(preview.kind).toBe('text-head');
    expect(preview.fileType).toBe('application/octet-stream');
    expect(decodeBase64Url(preview.bytes)).toBe('print("hello stashu")\n');
  });

  it('treats text extensions case-insensitively on real File objects', async () => {
    const preview = await generatePreviewFromFile(new File(['# Hello'], 'README.MD'));

    expect(preview.kind).toBe('text-head');
    expect(preview.fileType).toBe('application/octet-stream');
    expect(decodeBase64Url(preview.bytes)).toBe('# Hello');
  });

  it('treats hidden config files as text', () => {
    const preview = generatePreviewFromBytes({
      fileName: '.env',
      fileType: '',
      fileSize: 15,
      content: bytes('TOKEN=example\n'),
    });

    expect(preview.kind).toBe('text-head');
    expect(decodeBase64Url(preview.bytes)).toBe('TOKEN=example\n');
  });

  it('treats structured application MIME types as text', () => {
    const preview = generatePreviewFromBytes({
      fileName: 'data',
      fileType: 'application/json; charset=utf-8',
      fileSize: 13,
      content: bytes('{"ok":true}\n'),
    });

    expect(preview.kind).toBe('text-head');
    expect(decodeBase64Url(preview.bytes)).toBe('{"ok":true}\n');
  });

  it('handles empty text files deterministically', async () => {
    const preview = await generatePreviewFromFile(
      new File([''], 'empty.txt', { type: 'text/plain' })
    );

    expect(preview.kind).toBe('text-head');
    expect(preview.bytes).toBe('');
    expect(preview.metadata).toEqual({
      lineLimit: 20,
      linesIncluded: 0,
      bytesRead: 0,
      truncated: false,
    });
  });

  it('falls back to a file summary for unsupported binary files', async () => {
    const file = new File([new Uint8Array([0, 1, 2, 3]).buffer], 'archive.bin', {
      type: 'application/octet-stream',
    });

    const preview = await generatePreviewFromFile(file);

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

  it('falls back to a file summary when text decoding fails', () => {
    const preview = generatePreviewFromBytes({
      fileName: 'broken.txt',
      fileType: 'text/plain',
      fileSize: 1,
      content: new Uint8Array([0xff]),
    });

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
      { maxBytes: content.length - 1 }
    );

    expect(preview.kind).toBe('text-head');
    expect(decodeBase64Url(preview.bytes)).toBe('ab');
    expect(preview.metadata).toMatchObject({
      bytesRead: 2,
      truncated: true,
    });
  });

  it('handles real File prefix reads that cut a multibyte character', async () => {
    const content = bytes('ab🙂');
    const preview = await generatePreviewFromFile(
      new File([content.slice().buffer as ArrayBuffer], 'emoji.md', { type: 'text/markdown' }),
      { maxBytes: content.length - 1 }
    );

    expect(preview.kind).toBe('text-head');
    expect(decodeBase64Url(preview.bytes)).toBe('ab');
    expect(preview.metadata).toMatchObject({
      bytesRead: 2,
      truncated: true,
    });
  });

  it('keeps unknown extensionless files as summaries even if bytes look textual', () => {
    const preview = generatePreviewFromBytes({
      fileName: 'payload',
      fileType: '',
      fileSize: 11,
      content: bytes('hello world'),
    });

    expect(preview.kind).toBe('file-summary');
    expect(preview.bytes).toBe('');
  });

  it('matches file and byte generation for the same source', async () => {
    const file = new File(['alpha\nbeta\ngamma'], 'same.md', { type: 'text/markdown' });
    const fromFile = await generatePreviewFromFile(file, { lineLimit: 20 });
    const fromBytes = generatePreviewFromBytes(
      {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
        content: bytes('alpha\nbeta\ngamma'),
      },
      { lineLimit: 20 }
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
      new File([fileBytes.slice().buffer as ArrayBuffer], 'proof.md', { type: 'text/markdown' })
    );
    const serializedPayload = serializeGeneratedPreviewPayload(payload);
    const { proof, secret } = createStashProof(serializedPayload, fileBytes);
    const tamperedPayload = serializeGeneratedPreviewPayload({
      ...payload,
      fileName: 'other.md',
    });

    expect(verifyPreview(serializedPayload, proof)).toBe(true);
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
