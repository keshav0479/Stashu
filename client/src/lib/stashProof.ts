import { bytesToHex, sha256 } from './crypto.js';

export const STASH_PROOF_VERSION = 'stashu-preview-v1' as const;
export const DEFAULT_CONTENT_CHUNK_SIZE = 64 * 1024;

const SALT_LENGTH = 32;
const MAX_FRAME_LENGTH = 0xffffffff;
const encoder = new TextEncoder();

export interface MerkleProofStep {
  side: 'left' | 'right';
  hash: string;
}

export interface PreviewInclusionProof {
  offset: number;
  length: number;
  leafHash: string;
  path: MerkleProofStep[];
}

export interface StashProof {
  version: typeof STASH_PROOF_VERSION;
  root: string;
  previewHash: string;
  contentMerkleRoot: string;
  contentLength: number;
  chunkSize: number;
  previewInclusion?: PreviewInclusionProof;
}

export interface StashProofSecret {
  contentSalt: string;
}

export interface StashProofBundle {
  proof: StashProof;
  secret: StashProofSecret;
}

export interface CreateStashProofOptions {
  salt?: Uint8Array;
  previewContent?: Uint8Array | ArrayBuffer | PreviewContentRange;
  chunkSize?: number;
}

export interface PreviewContentRange {
  offset: number;
  bytes: Uint8Array | ArrayBuffer;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toBytes(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function frame(part: Uint8Array): Uint8Array {
  if (part.length > MAX_FRAME_LENGTH) {
    throw new Error('Proof frame is too large');
  }

  const framed = new Uint8Array(4 + part.length);
  new DataView(framed.buffer).setUint32(0, part.length, false);
  framed.set(part, 4);
  return framed;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

function taggedHash(tag: string, parts: Uint8Array[]): string {
  return sha256(concat([frame(encoder.encode(tag)), ...parts.map(frame)]));
}

function isHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function hashToBytes(hash: string): Uint8Array {
  if (!isHash(hash)) {
    throw new Error('Invalid proof hash');
  }

  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hash.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function uint32Bytes(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function uint64Bytes(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Proof offset must be a safe non-negative integer');
  }

  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, Math.floor(value / 0x100000000), false);
  view.setUint32(4, value >>> 0, false);
  return bytes;
}

function previewLeaf(previewPayload: Uint8Array): string {
  return taggedHash(`${STASH_PROOF_VERSION}:preview`, [previewPayload]);
}

function publicContentLeaf(offset: number, content: Uint8Array): string {
  return taggedHash(`${STASH_PROOF_VERSION}:content-leaf-public`, [
    uint64Bytes(offset),
    uint32Bytes(content.length),
    content,
  ]);
}

function privateContentLeaf(offset: number, content: Uint8Array, salt: Uint8Array): string {
  return taggedHash(`${STASH_PROOF_VERSION}:content-leaf-private`, [
    uint64Bytes(offset),
    uint32Bytes(content.length),
    salt,
    content,
  ]);
}

function merkleParent(left: string, right: string): string {
  return taggedHash(`${STASH_PROOF_VERSION}:merkle-parent`, [
    hashToBytes(left),
    hashToBytes(right),
  ]);
}

function rootHash(previewHash: string, contentMerkleRoot: string): string {
  return taggedHash(`${STASH_PROOF_VERSION}:root`, [
    hashToBytes(previewHash),
    hashToBytes(contentMerkleRoot),
  ]);
}

function validateChunkSize(chunkSize: number): void {
  if (!Number.isInteger(chunkSize) || chunkSize < 1024 || chunkSize > 1024 * 1024) {
    throw new Error('Content chunk size must be between 1 KiB and 1 MiB');
  }
}

function bytesEqualAt(content: Uint8Array, offset: number, expected: Uint8Array): boolean {
  if (offset + expected.length > content.length) return false;

  for (let i = 0; i < expected.length; i += 1) {
    if (content[offset + i] !== expected[i]) return false;
  }

  return true;
}

function normalizePreviewRange(
  content: Uint8Array,
  previewContent: Uint8Array | ArrayBuffer | PreviewContentRange | undefined
): { offset: number; bytes: Uint8Array } | undefined {
  if (!previewContent) return undefined;

  const range =
    previewContent instanceof Uint8Array || previewContent instanceof ArrayBuffer
      ? { offset: 0, bytes: toBytes(previewContent) }
      : { offset: previewContent.offset, bytes: toBytes(previewContent.bytes) };

  if (
    !Number.isSafeInteger(range.offset) ||
    range.offset < 0 ||
    range.bytes.length === 0 ||
    range.offset + range.bytes.length > content.length
  ) {
    throw new Error('Preview content range is outside the file');
  }

  if (!bytesEqualAt(content, range.offset, range.bytes)) {
    throw new Error('Preview content must match the file at its declared offset');
  }

  return range;
}

function contentLeaves(
  content: Uint8Array,
  salt: Uint8Array,
  previewRange: { offset: number; bytes: Uint8Array } | undefined,
  chunkSize: number
): { leaves: string[]; previewLeafIndex?: number } {
  const leaves: string[] = [];
  let previewLeafIndex: number | undefined;

  const addPrivateLeaves = (start: number, end: number) => {
    let offset = start;
    while (offset < end) {
      const nextOffset = Math.min(offset + chunkSize, end);
      leaves.push(privateContentLeaf(offset, content.slice(offset, nextOffset), salt));
      offset = nextOffset;
    }
  };

  if (previewRange) {
    addPrivateLeaves(0, previewRange.offset);
    previewLeafIndex = leaves.length;
    leaves.push(publicContentLeaf(previewRange.offset, previewRange.bytes));
    addPrivateLeaves(previewRange.offset + previewRange.bytes.length, content.length);
  } else {
    addPrivateLeaves(0, content.length);
  }

  if (leaves.length === 0) {
    leaves.push(privateContentLeaf(0, new Uint8Array(), salt));
  }

  return { leaves, previewLeafIndex };
}

function merkleRoot(leaves: string[]): string {
  let level = leaves;

  while (level.length > 1) {
    const nextLevel: string[] = [];

    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 >= level.length) {
        nextLevel.push(level[i]);
      } else {
        nextLevel.push(merkleParent(level[i], level[i + 1]));
      }
    }

    level = nextLevel;
  }

  return level[0];
}

function merklePath(leaves: string[], leafIndex: number): MerkleProofStep[] {
  const path: MerkleProofStep[] = [];
  let level = leaves;
  let index = leafIndex;

  while (level.length > 1) {
    const isRight = index % 2 === 1;
    const siblingIndex = isRight ? index - 1 : index + 1;

    if (siblingIndex < level.length) {
      path.push({
        side: isRight ? 'left' : 'right',
        hash: level[siblingIndex],
      });
    }

    const nextLevel: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 >= level.length) {
        nextLevel.push(level[i]);
      } else {
        nextLevel.push(merkleParent(level[i], level[i + 1]));
      }
    }

    level = nextLevel;
    index = Math.floor(index / 2);
  }

  return path;
}

function verifyMerklePath(leafHash: string, path: MerkleProofStep[], root: string): boolean {
  let current = leafHash;

  for (const step of path) {
    current =
      step.side === 'left' ? merkleParent(step.hash, current) : merkleParent(current, step.hash);
  }

  return current === root;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPreviewInclusionProof(value: unknown): value is PreviewInclusionProof {
  if (!isRecord(value)) return false;

  return (
    Number.isSafeInteger(value.offset) &&
    (value.offset as number) >= 0 &&
    Number.isInteger(value.length) &&
    (value.length as number) > 0 &&
    typeof value.leafHash === 'string' &&
    isHash(value.leafHash) &&
    Array.isArray(value.path) &&
    value.path.every(
      (step) =>
        isRecord(step) &&
        (step.side === 'left' || step.side === 'right') &&
        typeof step.hash === 'string' &&
        isHash(step.hash)
    )
  );
}

function isProofShape(proof: unknown): proof is StashProof {
  if (!isRecord(proof)) return false;

  return (
    proof.version === STASH_PROOF_VERSION &&
    typeof proof.previewHash === 'string' &&
    typeof proof.contentMerkleRoot === 'string' &&
    typeof proof.root === 'string' &&
    Number.isInteger(proof.contentLength) &&
    (proof.contentLength as number) >= 0 &&
    Number.isInteger(proof.chunkSize) &&
    isHash(proof.previewHash) &&
    isHash(proof.contentMerkleRoot) &&
    isHash(proof.root) &&
    (proof.previewInclusion === undefined || isPreviewInclusionProof(proof.previewInclusion))
  );
}

export function createStashProof(
  previewPayload: Uint8Array | ArrayBuffer,
  content: Uint8Array | ArrayBuffer,
  options: CreateStashProofOptions = {}
): StashProofBundle {
  const salt = options.salt ?? randomBytes(SALT_LENGTH);
  if (salt.length !== SALT_LENGTH) {
    throw new Error(`Content salt must be ${SALT_LENGTH} bytes`);
  }

  const chunkSize = options.chunkSize ?? DEFAULT_CONTENT_CHUNK_SIZE;
  validateChunkSize(chunkSize);

  const contentBytes = toBytes(content);
  const previewRange = normalizePreviewRange(contentBytes, options.previewContent);
  const previewHash = previewLeaf(toBytes(previewPayload));
  const { leaves, previewLeafIndex } = contentLeaves(contentBytes, salt, previewRange, chunkSize);
  const contentMerkleRoot = merkleRoot(leaves);
  const previewInclusion =
    previewRange && previewLeafIndex !== undefined
      ? {
          offset: previewRange.offset,
          length: previewRange.bytes.length,
          leafHash: leaves[previewLeafIndex],
          path: merklePath(leaves, previewLeafIndex),
        }
      : undefined;

  return {
    proof: {
      version: STASH_PROOF_VERSION,
      previewHash,
      contentMerkleRoot,
      contentLength: contentBytes.length,
      chunkSize,
      previewInclusion,
      root: rootHash(previewHash, contentMerkleRoot),
    },
    secret: {
      contentSalt: bytesToHex(salt),
    },
  };
}

export function verifyPreview(previewPayload: Uint8Array | ArrayBuffer, proof: unknown): boolean {
  if (!isProofShape(proof)) return false;

  const previewHash = previewLeaf(toBytes(previewPayload));
  if (previewHash !== proof.previewHash) return false;

  return rootHash(proof.previewHash, proof.contentMerkleRoot) === proof.root;
}

export function verifyPreviewInclusion(
  previewContent: Uint8Array | ArrayBuffer,
  proof: unknown
): boolean {
  if (!isProofShape(proof) || !proof.previewInclusion) return false;

  const previewBytes = toBytes(previewContent);
  if (
    proof.previewInclusion.length !== previewBytes.length ||
    proof.previewInclusion.offset + proof.previewInclusion.length > proof.contentLength
  ) {
    return false;
  }

  const leafHash = publicContentLeaf(proof.previewInclusion.offset, previewBytes);
  return (
    leafHash === proof.previewInclusion.leafHash &&
    verifyMerklePath(leafHash, proof.previewInclusion.path, proof.contentMerkleRoot) &&
    rootHash(proof.previewHash, proof.contentMerkleRoot) === proof.root
  );
}

export function verifyUnlockedFile(
  content: Uint8Array | ArrayBuffer,
  proof: unknown,
  secret: unknown
): boolean {
  if (
    !isProofShape(proof) ||
    !isRecord(secret) ||
    typeof secret.contentSalt !== 'string' ||
    !/^[0-9a-f]{64}$/.test(secret.contentSalt)
  ) {
    return false;
  }

  if (!validateChunkSizeForVerify(proof.chunkSize)) return false;

  const salt = hashToBytes(secret.contentSalt);
  const contentBytes = toBytes(content);
  if (contentBytes.length !== proof.contentLength) return false;

  const previewRange = proof.previewInclusion
    ? {
        offset: proof.previewInclusion.offset,
        bytes: contentBytes.slice(
          proof.previewInclusion.offset,
          proof.previewInclusion.offset + proof.previewInclusion.length
        ),
      }
    : undefined;
  const { leaves } = contentLeaves(contentBytes, salt, previewRange, proof.chunkSize);
  const contentMerkleRoot = merkleRoot(leaves);
  if (contentMerkleRoot !== proof.contentMerkleRoot) return false;

  if (proof.previewInclusion) {
    if (!previewRange || !verifyPreviewInclusion(previewRange.bytes, proof)) {
      return false;
    }
  }

  return rootHash(proof.previewHash, proof.contentMerkleRoot) === proof.root;
}

function validateChunkSizeForVerify(chunkSize: number): boolean {
  try {
    validateChunkSize(chunkSize);
    return true;
  } catch {
    return false;
  }
}
