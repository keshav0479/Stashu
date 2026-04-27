import { describe, expect, it } from 'vitest';
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

describe('stash proof commitments', () => {
  it('keeps the public proof separate from the unlock-only salt', () => {
    const salt = new Uint8Array(32).fill(7);
    const { proof, secret } = createStashProof(bytes('preview'), bytes('hidden file'), { salt });

    expect(proof.version).toBe('stashu-preview-v1');
    expect(proof.root).toMatch(/^[0-9a-f]{64}$/);
    expect(proof.previewHash).toMatch(/^[0-9a-f]{64}$/);
    expect(proof.contentMerkleRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(proof.contentLength).toBe(11);
    expect(proof.chunkSize).toBe(64 * 1024);
    expect(Object.keys(proof)).not.toContain('contentSalt');
    expect(secret.contentSalt).toBe('07'.repeat(32));
  });

  it('verifies the preview before payment', () => {
    const { proof } = createStashProof(bytes('public preview'), bytes('hidden file'));

    expect(verifyPreview(bytes('public preview'), proof)).toBe(true);
  });

  it('proves a text peek is part of the committed file', () => {
    const previewContent = bytes('line 1\nline 2');
    const hiddenSuffix = bytes('\nline 3\nline 4');
    const content = new Uint8Array(previewContent.length + hiddenSuffix.length);
    content.set(previewContent);
    content.set(hiddenSuffix, previewContent.length);
    const { proof } = createStashProof(bytes('preview payload'), content, {
      previewContent,
      chunkSize: 1024,
      salt: new Uint8Array(32).fill(1),
    });

    expect(proof.previewInclusion).toMatchObject({
      offset: 0,
      length: previewContent.length,
    });
    expect(verifyPreviewInclusion(previewContent, proof)).toBe(true);
  });

  it('proves a seller-picked excerpt from the middle of the file', () => {
    const content = bytes('intro\nsafe excerpt\npaid-only ending');
    const excerpt = bytes('safe excerpt');
    const offset = bytes('intro\n').length;
    const { proof, secret } = createStashProof(bytes('preview payload'), content, {
      previewContent: { offset, bytes: excerpt },
      chunkSize: 1024,
      salt: new Uint8Array(32).fill(3),
    });

    expect(proof.previewInclusion).toMatchObject({
      offset,
      length: excerpt.length,
    });
    expect(verifyPreviewInclusion(excerpt, proof)).toBe(true);
    expect(verifyUnlockedFile(content, proof, secret)).toBe(true);
  });

  it('rejects preview inclusion when the visible bytes are changed', () => {
    const { proof } = createStashProof(bytes('preview payload'), bytes('preview hidden'), {
      previewContent: bytes('preview'),
    });

    expect(verifyPreviewInclusion(bytes('changed'), proof)).toBe(false);
  });

  it('requires preview content to match the declared file range', () => {
    expect(() =>
      createStashProof(bytes('preview payload'), bytes('real file'), {
        previewContent: bytes('fake'),
      })
    ).toThrow(/declared offset/);
  });

  it('rejects a middle excerpt with the wrong offset', () => {
    const content = bytes('intro\nsafe excerpt\npaid-only ending');

    expect(() =>
      createStashProof(bytes('preview payload'), content, {
        previewContent: { offset: 0, bytes: bytes('safe excerpt') },
      })
    ).toThrow(/declared offset/);
  });

  it('rejects a tampered preview', () => {
    const { proof } = createStashProof(bytes('public preview'), bytes('hidden file'));

    expect(verifyPreview(bytes('different preview'), proof)).toBe(false);
  });

  it('verifies the unlocked file with the reveal salt', () => {
    const { proof, secret } = createStashProof(bytes('public preview'), bytes('hidden file'));

    expect(verifyUnlockedFile(bytes('hidden file'), proof, secret)).toBe(true);
  });

  it('rejects a tampered unlocked file', () => {
    const { proof, secret } = createStashProof(bytes('public preview'), bytes('hidden file'));

    expect(verifyUnlockedFile(bytes('other file'), proof, secret)).toBe(false);
  });

  it('rejects a wrong reveal salt', () => {
    const { proof } = createStashProof(bytes('public preview'), bytes('hidden file'), {
      salt: new Uint8Array(32).fill(1),
    });

    expect(
      verifyUnlockedFile(bytes('hidden file'), proof, {
        contentSalt: '02'.repeat(32),
      })
    ).toBe(false);
  });

  it('uses fresh content salt by default', () => {
    const first = createStashProof(bytes('same preview'), bytes('same hidden file')).proof;
    const second = createStashProof(bytes('same preview'), bytes('same hidden file')).proof;

    expect(first.previewHash).toBe(second.previewHash);
    expect(first.contentMerkleRoot).not.toBe(second.contentMerkleRoot);
    expect(first.root).not.toBe(second.root);
  });

  it('rejects malformed proof hashes instead of throwing', () => {
    const { proof } = createStashProof(bytes('public preview'), bytes('hidden file'));

    expect(
      verifyPreview(bytes('public preview'), {
        ...proof,
        contentMerkleRoot: 'bad',
      })
    ).toBe(false);
  });

  it('rejects a tampered Merkle path instead of throwing', () => {
    const previewContent = bytes('preview');
    const { proof } = createStashProof(bytes('preview payload'), bytes('preview hidden'), {
      previewContent,
    });

    expect(
      verifyPreviewInclusion(previewContent, {
        ...proof,
        previewInclusion: {
          ...proof.previewInclusion!,
          path: [{ side: 'right', hash: 'bad' }],
        },
      })
    ).toBe(false);
  });

  it('rejects missing proof data instead of throwing', () => {
    expect(verifyPreview(bytes('public preview'), null)).toBe(false);
    expect(verifyUnlockedFile(bytes('hidden file'), null, null)).toBe(false);
  });

  it('rejects missing reveal salt instead of throwing', () => {
    const { proof } = createStashProof(bytes('public preview'), bytes('hidden file'));

    expect(verifyUnlockedFile(bytes('hidden file'), proof, {})).toBe(false);
  });
});
