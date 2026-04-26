import { bytesToHex, sha256 } from './crypto.js';

export const STASH_PROOF_VERSION = 'stashu-preview-v1' as const;

const SALT_LENGTH = 32;
const MAX_FRAME_LENGTH = 0xffffffff;
const encoder = new TextEncoder();

export interface StashProof {
  version: typeof STASH_PROOF_VERSION;
  root: string;
  previewHash: string;
  contentHash: string;
}

export interface StashProofSecret {
  contentSalt: string;
}

export interface StashProofBundle {
  proof: StashProof;
  secret: StashProofSecret;
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

function previewLeaf(previewPayload: Uint8Array): string {
  return taggedHash(`${STASH_PROOF_VERSION}:preview`, [previewPayload]);
}

function contentLeaf(content: Uint8Array, salt: Uint8Array): string {
  return taggedHash(`${STASH_PROOF_VERSION}:content`, [salt, content]);
}

function rootHash(previewHash: string, contentHash: string): string {
  return taggedHash(`${STASH_PROOF_VERSION}:root`, [
    hashToBytes(previewHash),
    hashToBytes(contentHash),
  ]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isProofShape(proof: unknown): proof is StashProof {
  if (!isRecord(proof)) return false;

  return (
    proof.version === STASH_PROOF_VERSION &&
    typeof proof.previewHash === 'string' &&
    typeof proof.contentHash === 'string' &&
    typeof proof.root === 'string' &&
    isHash(proof.previewHash) &&
    isHash(proof.contentHash) &&
    isHash(proof.root)
  );
}

export function createStashProof(
  previewPayload: Uint8Array | ArrayBuffer,
  content: Uint8Array | ArrayBuffer,
  salt: Uint8Array = randomBytes(SALT_LENGTH)
): StashProofBundle {
  if (salt.length !== SALT_LENGTH) {
    throw new Error(`Content salt must be ${SALT_LENGTH} bytes`);
  }

  const previewHash = previewLeaf(toBytes(previewPayload));
  const contentHash = contentLeaf(toBytes(content), salt);

  return {
    proof: {
      version: STASH_PROOF_VERSION,
      previewHash,
      contentHash,
      root: rootHash(previewHash, contentHash),
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

  return rootHash(proof.previewHash, proof.contentHash) === proof.root;
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

  const salt = hashToBytes(secret.contentSalt);
  const contentHash = contentLeaf(toBytes(content), salt);
  if (contentHash !== proof.contentHash) return false;

  return rootHash(proof.previewHash, proof.contentHash) === proof.root;
}
