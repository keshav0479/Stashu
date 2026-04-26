import { describe, expect, it } from 'vitest';
import { createStashProof, verifyPreview, verifyUnlockedFile } from './stashProof.js';

const encoder = new TextEncoder();

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

describe('stash proof commitments', () => {
  it('keeps the public proof separate from the unlock-only salt', () => {
    const salt = new Uint8Array(32).fill(7);
    const { proof, secret } = createStashProof(bytes('preview'), bytes('hidden file'), salt);

    expect(proof.version).toBe('stashu-preview-v1');
    expect(proof.root).toMatch(/^[0-9a-f]{64}$/);
    expect(proof.previewHash).toMatch(/^[0-9a-f]{64}$/);
    expect(proof.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.keys(proof)).not.toContain('contentSalt');
    expect(secret.contentSalt).toBe('07'.repeat(32));
  });

  it('verifies the preview before payment', () => {
    const { proof } = createStashProof(bytes('public preview'), bytes('hidden file'));

    expect(verifyPreview(bytes('public preview'), proof)).toBe(true);
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
    const { proof } = createStashProof(
      bytes('public preview'),
      bytes('hidden file'),
      new Uint8Array(32).fill(1)
    );

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
    expect(first.contentHash).not.toBe(second.contentHash);
    expect(first.root).not.toBe(second.root);
  });

  it('rejects malformed proof hashes instead of throwing', () => {
    const { proof } = createStashProof(bytes('public preview'), bytes('hidden file'));

    expect(
      verifyPreview(bytes('public preview'), {
        ...proof,
        contentHash: 'bad',
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
