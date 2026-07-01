import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { fromBase64, generateKey, sha256, toBase64 } from './crypto';
import { concat, randomBytes, toBytes, uint32Bytes, uint64Bytes } from './bytes';

export const STASH_BLOB_FORMAT = 'stashu-selective-v1' as const;

const KEY_PREFIX = `${STASH_BLOB_FORMAT}:`;
const MAGIC = new TextEncoder().encode('STASHU01');
const NONCE_LENGTH = 24;
const TAG_LENGTH = 16;
const PACKAGE_HEADER_LENGTH = MAGIC.length + 8 + 4;
const SEGMENT_HEADER_LENGTH = 1 + 8 + 8 + 8 + NONCE_LENGTH;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
export const MAX_STASH_CONTENT_LENGTH = 100 * 1024 * 1024;
export const MAX_SEALED_PACKAGE_OVERHEAD =
  PACKAGE_HEADER_LENGTH + 3 * SEGMENT_HEADER_LENGTH + 2 * TAG_LENGTH;

const encoder = new TextEncoder();

interface PublicSegment {
  visibility: 'public';
  offset: number;
  length: number;
  bytes: Uint8Array;
}

interface EncryptedSegment {
  visibility: 'encrypted';
  offset: number;
  length: number;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

type StashPackageSegment = PublicSegment | EncryptedSegment;

export interface StashPackage {
  version: typeof STASH_BLOB_FORMAT;
  contentLength: number;
  segments: StashPackageSegment[];
}

export interface PreviewContentRange {
  offset: number;
  bytes: Uint8Array | ArrayBuffer;
}

export interface SealedStashPackage {
  blob: Uint8Array;
  blobSha256: string;
  secretKey: string;
}

function readUint64(view: DataView, offset: number): number {
  const value = view.getBigUint64(offset, false);
  if (value > MAX_SAFE_BIGINT) {
    throw new Error('Package integer is too large');
  }
  return Number(value);
}

function segmentAad(contentLength: number, offset: number, length: number): Uint8Array {
  return encoder.encode(`${STASH_BLOB_FORMAT}:${contentLength}:${offset}:${length}`);
}

function encryptedSegment(
  content: Uint8Array,
  contentLength: number,
  offset: number,
  key: Uint8Array
): EncryptedSegment | undefined {
  if (content.length === 0) return undefined;

  const nonce = randomBytes(NONCE_LENGTH);
  const cipher = xchacha20poly1305(key, nonce, segmentAad(contentLength, offset, content.length));
  return {
    visibility: 'encrypted',
    offset,
    length: content.length,
    nonce,
    ciphertext: cipher.encrypt(content),
  };
}

function encodeSegment(segment: StashPackageSegment): Uint8Array {
  const encrypted = segment.visibility === 'encrypted';
  const payload = encrypted ? segment.ciphertext : segment.bytes;
  const nonce = encrypted ? segment.nonce : new Uint8Array(NONCE_LENGTH);

  return concat([
    new Uint8Array([encrypted ? 0 : 1]),
    uint64Bytes(segment.offset),
    uint64Bytes(segment.length),
    uint64Bytes(payload.length),
    nonce,
    payload,
  ]);
}

function serializePackage(contentLength: number, segments: StashPackageSegment[]): Uint8Array {
  return concat([
    MAGIC,
    uint64Bytes(contentLength),
    uint32Bytes(segments.length),
    ...segments.map(encodeSegment),
  ]);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function validatePreviewRange(
  content: Uint8Array,
  previewRange: PreviewContentRange | undefined
): { offset: number; bytes: Uint8Array } | undefined {
  if (!previewRange) return undefined;

  const bytes = toBytes(previewRange.bytes);
  if (
    !Number.isSafeInteger(previewRange.offset) ||
    previewRange.offset < 0 ||
    bytes.length === 0 ||
    previewRange.offset + bytes.length > content.length ||
    !bytesEqual(content.slice(previewRange.offset, previewRange.offset + bytes.length), bytes)
  ) {
    throw new Error('Public package range must match the file');
  }

  return { offset: previewRange.offset, bytes };
}

export function createSealedStashPackage(
  content: Uint8Array | ArrayBuffer,
  previewRange?: PreviewContentRange
): SealedStashPackage {
  const contentBytes = toBytes(content);
  if (contentBytes.length === 0 || contentBytes.length > MAX_STASH_CONTENT_LENGTH) {
    throw new Error('Sealed stash file size is outside the supported range');
  }

  const publicRange = validatePreviewRange(contentBytes, previewRange);
  const key = generateKey();
  const segments: StashPackageSegment[] = [];

  if (publicRange) {
    const prefix = encryptedSegment(
      contentBytes.slice(0, publicRange.offset),
      contentBytes.length,
      0,
      key
    );
    if (prefix) segments.push(prefix);

    segments.push({
      visibility: 'public',
      offset: publicRange.offset,
      length: publicRange.bytes.length,
      bytes: publicRange.bytes,
    });

    const suffixOffset = publicRange.offset + publicRange.bytes.length;
    const suffix = encryptedSegment(
      contentBytes.slice(suffixOffset),
      contentBytes.length,
      suffixOffset,
      key
    );
    if (suffix) segments.push(suffix);
  } else {
    const segment = encryptedSegment(contentBytes, contentBytes.length, 0, key);
    if (segment) segments.push(segment);
  }

  const blob = serializePackage(contentBytes.length, segments);
  return {
    blob,
    blobSha256: sha256(blob),
    secretKey: `${KEY_PREFIX}${toBase64(key)}`,
  };
}

export function isSealedStashSecretKey(secretKey: string): boolean {
  return secretKey.startsWith(KEY_PREFIX);
}

export function parseSealedStashPackage(blob: Uint8Array | ArrayBuffer): StashPackage {
  const bytes = toBytes(blob);
  if (bytes.length < PACKAGE_HEADER_LENGTH || !bytesEqual(bytes.slice(0, MAGIC.length), MAGIC)) {
    throw new Error('Invalid sealed stash package header');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const contentLength = readUint64(view, MAGIC.length);
  const segmentCount = view.getUint32(MAGIC.length + 8, false);
  if (
    contentLength === 0 ||
    contentLength > MAX_STASH_CONTENT_LENGTH ||
    segmentCount === 0 ||
    segmentCount > 3
  ) {
    throw new Error('Invalid sealed stash package shape');
  }

  const segments: StashPackageSegment[] = [];
  let cursor = PACKAGE_HEADER_LENGTH;
  let expectedOffset = 0;
  let publicSegments = 0;

  for (let index = 0; index < segmentCount; index += 1) {
    if (cursor + SEGMENT_HEADER_LENGTH > bytes.length) {
      throw new Error('Truncated sealed stash package');
    }

    const kind = view.getUint8(cursor);
    const offset = readUint64(view, cursor + 1);
    const length = readUint64(view, cursor + 9);
    const payloadLength = readUint64(view, cursor + 17);
    const nonce = bytes.slice(cursor + 25, cursor + SEGMENT_HEADER_LENGTH);
    cursor += SEGMENT_HEADER_LENGTH;

    if (
      (kind !== 0 && kind !== 1) ||
      length === 0 ||
      offset !== expectedOffset ||
      offset + length > contentLength ||
      cursor + payloadLength > bytes.length
    ) {
      throw new Error('Invalid sealed stash segment');
    }

    const payload = bytes.slice(cursor, cursor + payloadLength);
    cursor += payloadLength;

    if (kind === 0) {
      if (payloadLength !== length + TAG_LENGTH) {
        throw new Error('Invalid encrypted segment length');
      }
      segments.push({ visibility: 'encrypted', offset, length, nonce, ciphertext: payload });
    } else {
      if (payloadLength !== length || nonce.some((value) => value !== 0)) {
        throw new Error('Invalid public segment');
      }
      publicSegments += 1;
      segments.push({ visibility: 'public', offset, length, bytes: payload });
    }

    expectedOffset += length;
  }

  if (cursor !== bytes.length || expectedOffset !== contentLength || publicSegments > 1) {
    throw new Error('Invalid sealed stash package coverage');
  }

  return { version: STASH_BLOB_FORMAT, contentLength, segments };
}

export function verifySealedStashPackage(
  blob: Uint8Array | ArrayBuffer,
  expectedSha256: string,
  previewRange?: PreviewContentRange
): boolean {
  try {
    const bytes = toBytes(blob);
    if (sha256(bytes) !== expectedSha256) return false;

    const stashPackage = parseSealedStashPackage(bytes);
    const publicSegments = stashPackage.segments.filter(
      (segment): segment is PublicSegment => segment.visibility === 'public'
    );

    if (!previewRange) return publicSegments.length === 0;

    const previewBytes = toBytes(previewRange.bytes);
    return (
      publicSegments.length === 1 &&
      publicSegments[0].offset === previewRange.offset &&
      bytesEqual(publicSegments[0].bytes, previewBytes)
    );
  } catch {
    return false;
  }
}

export function decryptSealedStashPackage(
  blob: Uint8Array | ArrayBuffer,
  secretKey: string,
  expectedSha256?: string
): ArrayBuffer {
  const bytes = toBytes(blob);
  if (expectedSha256 && sha256(bytes) !== expectedSha256) {
    throw new Error('Sealed stash package hash mismatch');
  }
  if (!isSealedStashSecretKey(secretKey)) {
    throw new Error('Invalid sealed stash key format');
  }

  const key = fromBase64(secretKey.slice(KEY_PREFIX.length));
  if (key.length !== 32) {
    throw new Error('Invalid sealed stash key length');
  }

  const stashPackage = parseSealedStashPackage(bytes);
  const plaintext = new Uint8Array(stashPackage.contentLength);

  for (const segment of stashPackage.segments) {
    if (segment.visibility === 'public') {
      plaintext.set(segment.bytes, segment.offset);
      continue;
    }

    const cipher = xchacha20poly1305(
      key,
      segment.nonce,
      segmentAad(stashPackage.contentLength, segment.offset, segment.length)
    );
    plaintext.set(cipher.decrypt(segment.ciphertext), segment.offset);
  }

  return plaintext.buffer;
}
