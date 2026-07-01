import { describe, expect, it } from 'vitest';
import {
  createSealedStashPackage,
  decryptSealedStashPackage,
  parseSealedStashPackage,
  verifySealedStashPackage,
} from './stashPackage.js';
import { sha256 } from './crypto.js';

const encoder = new TextEncoder();

function bytes(value: string): Uint8Array {
  return encoder.encode(value);
}

describe('sealed selective-reveal stash packages', () => {
  it('roundtrips a file with a public middle excerpt and encrypted neighbors', () => {
    const content = bytes('intro\npublic excerpt\npaid-only ending');
    const excerpt = bytes('public excerpt');
    const offset = bytes('intro\n').length;
    const sealed = createSealedStashPackage(content, { offset, bytes: excerpt });

    expect(sealed.blobSha256).toBe(sha256(sealed.blob));
    expect(sealed.secretKey).toMatch(/^stashu-selective-v1:/);
    expect(
      verifySealedStashPackage(sealed.blob, sealed.blobSha256, { offset, bytes: excerpt })
    ).toBe(true);

    const stashPackage = parseSealedStashPackage(sealed.blob);
    expect(stashPackage.contentLength).toBe(content.length);
    expect(stashPackage.segments.map((segment) => segment.visibility)).toEqual([
      'encrypted',
      'public',
      'encrypted',
    ]);
    expect(new Uint8Array(decryptSealedStashPackage(sealed.blob, sealed.secretKey))).toEqual(
      content
    );
  });

  it('roundtrips a fully private file without a public excerpt', () => {
    const content = bytes('entirely private');
    const sealed = createSealedStashPackage(content);

    expect(verifySealedStashPackage(sealed.blob, sealed.blobSha256)).toBe(true);
    expect(parseSealedStashPackage(sealed.blob).segments).toHaveLength(1);
    expect(new Uint8Array(decryptSealedStashPackage(sealed.blob, sealed.secretKey))).toEqual(
      content
    );
  });

  it('rejects a detached public excerpt before payment', () => {
    const content = bytes('real excerpt\npaid-only ending');
    const sealed = createSealedStashPackage(content, {
      offset: 0,
      bytes: bytes('real excerpt'),
    });

    expect(
      verifySealedStashPackage(sealed.blob, sealed.blobSha256, {
        offset: 0,
        bytes: bytes('bait excerpt'),
      })
    ).toBe(false);
  });

  it('rejects a swapped sealed blob before payment', () => {
    const first = createSealedStashPackage(bytes('same excerpt\nfirst hidden'), {
      offset: 0,
      bytes: bytes('same excerpt'),
    });
    const second = createSealedStashPackage(bytes('same excerpt\nsecond hidden'), {
      offset: 0,
      bytes: bytes('same excerpt'),
    });

    expect(
      verifySealedStashPackage(second.blob, first.blobSha256, {
        offset: 0,
        bytes: bytes('same excerpt'),
      })
    ).toBe(false);
  });

  it('authenticates encrypted segment metadata and ciphertext during unlock', () => {
    const content = bytes('public\nhidden');
    const sealed = createSealedStashPackage(content, {
      offset: 0,
      bytes: bytes('public'),
    });
    const tampered = sealed.blob.slice();
    tampered[tampered.length - 1] ^= 1;

    expect(() => decryptSealedStashPackage(tampered, sealed.secretKey, sha256(tampered))).toThrow();
  });

  it('rejects trailing bytes and wrong keys', () => {
    const sealed = createSealedStashPackage(bytes('secret'));
    const withTrailingByte = new Uint8Array(sealed.blob.length + 1);
    withTrailingByte.set(sealed.blob);

    expect(() => parseSealedStashPackage(withTrailingByte)).toThrow(/coverage/);
    expect(() =>
      decryptSealedStashPackage(sealed.blob, `stashu-selective-v1:${btoa('wrong')}`)
    ).toThrow(/length/);
  });

  it('rejects packages that claim an oversized reconstructed file', () => {
    const sealed = createSealedStashPackage(bytes('secret'));
    const oversized = sealed.blob.slice();
    new DataView(oversized.buffer).setBigUint64(8, BigInt(100 * 1024 * 1024 + 1), false);

    expect(() => parseSealedStashPackage(oversized)).toThrow(/shape/);
  });
});
