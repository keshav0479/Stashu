import { describe, expect, it } from 'vitest';
import {
  decodeGeneratedPreviewBytes,
  generatePreviewFromBytes,
  serializeGeneratedPreviewPayload,
} from './generatedPreview.js';
import { createStashProof } from './stashProof.js';
import {
  decodeTextPreview,
  verifyGeneratedPreviewBundle,
  verifyUnlockedStashFile,
} from './verifiedPreview.js';

const encoder = new TextEncoder();

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

describe('verified preview helpers', () => {
  it('verifies a generated text preview against its Merkle proof', () => {
    const content = bytes('first lines\npaid-only section');
    const preview = generatePreviewFromBytes(
      {
        fileName: 'prompt.md',
        fileType: 'text/markdown',
        fileSize: content.length,
        content,
      },
      { mode: 'auto', maxChars: 10, maxPreviewRatio: 0.5 }
    );
    const { proof } = createStashProof(serializeGeneratedPreviewPayload(preview), content, {
      previewContent: decodeGeneratedPreviewBytes(preview),
      salt: new Uint8Array(32).fill(1),
    });

    expect(verifyGeneratedPreviewBundle(preview, proof)).toEqual({
      state: 'verified',
      text: 'first line',
    });
  });

  it('rejects a preview payload that was changed after proof generation', () => {
    const content = bytes('real preview\nhidden');
    const preview = generatePreviewFromBytes(
      {
        fileName: 'prompt.md',
        fileType: 'text/markdown',
        fileSize: content.length,
        content,
      },
      { mode: 'auto', maxChars: 8, maxPreviewRatio: 0.5 }
    );
    const { proof } = createStashProof(serializeGeneratedPreviewPayload(preview), content, {
      previewContent: decodeGeneratedPreviewBytes(preview),
    });

    const tamperedPreview = { ...preview, fileName: 'other.md' };

    expect(verifyGeneratedPreviewBundle(tamperedPreview, proof)).toEqual({ state: 'invalid' });
  });

  it('rejects a text peek that is not proven as part of the file', () => {
    const content = bytes('preview\nhidden');
    const preview = generatePreviewFromBytes(
      {
        fileName: 'prompt.md',
        fileType: 'text/markdown',
        fileSize: content.length,
        content,
      },
      { mode: 'auto', maxChars: 7, maxPreviewRatio: 0.5 }
    );
    const { proof } = createStashProof(serializeGeneratedPreviewPayload(preview), content);

    expect(verifyGeneratedPreviewBundle(preview, proof)).toEqual({ state: 'invalid' });
  });

  it('verifies a picked excerpt from the middle of the file', () => {
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
    const { proof, secret } = createStashProof(serializeGeneratedPreviewPayload(preview), content, {
      previewContent: { offset, bytes: decodeGeneratedPreviewBytes(preview) },
      salt: new Uint8Array(32).fill(3),
    });

    expect(verifyGeneratedPreviewBundle(preview, proof)).toEqual({
      state: 'verified',
      text: 'safe excerpt',
    });
    expect(verifyUnlockedStashFile({ previewProof: proof }, content, secret)).toBe(true);
  });

  it('verifies the unlocked file with the revealed preview secret', () => {
    const content = bytes('preview\nhidden');
    const preview = generatePreviewFromBytes(
      {
        fileName: 'prompt.md',
        fileType: 'text/markdown',
        fileSize: content.length,
        content,
      },
      { mode: 'auto', maxChars: 7, maxPreviewRatio: 0.5 }
    );
    const { proof, secret } = createStashProof(serializeGeneratedPreviewPayload(preview), content, {
      previewContent: decodeGeneratedPreviewBytes(preview),
      salt: new Uint8Array(32).fill(2),
    });

    expect(verifyUnlockedStashFile({ previewProof: proof }, content, secret)).toBe(true);
    expect(verifyUnlockedStashFile({ previewProof: proof }, bytes('different'), secret)).toBe(
      false
    );
  });

  it('decodes display text for text previews', () => {
    const preview = generatePreviewFromBytes(
      {
        fileName: 'notes.txt',
        fileType: 'text/plain',
        fileSize: 5,
        content: bytes('hello'),
      },
      { mode: 'auto', maxChars: 2, maxPreviewRatio: 0.5 }
    );

    expect(decodeTextPreview(preview)).toBe('he');
  });
});
