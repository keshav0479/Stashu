import type {
  GeneratedPreviewPayload,
  StashProof,
  StashProofSecret,
  StashPublicInfo,
} from '../../../shared/types';
import { decodeGeneratedPreviewBytes, serializeGeneratedPreviewPayload } from './generatedPreview';
import { verifyPreview, verifyPreviewInclusion, verifyUnlockedFile } from './stashProof';
import {
  STASH_BLOB_FORMAT,
  parseSealedStashPackage,
  verifySealedStashPackage,
  type PreviewContentRange,
} from './stashPackage';

const decoder = new TextDecoder('utf-8', { fatal: true });

export type PreviewVerificationState = 'missing' | 'verified' | 'invalid';

export interface PreviewVerificationResult {
  state: PreviewVerificationState;
  text?: string;
}

export function decodeTextPreview(payload: GeneratedPreviewPayload): string | undefined {
  if (payload.kind !== 'text-peek') return undefined;
  return decoder.decode(decodeGeneratedPreviewBytes(payload));
}

export function verifyGeneratedPreviewBundle(
  generatedPreview: GeneratedPreviewPayload | undefined,
  previewProof: StashProof | undefined
): PreviewVerificationResult {
  if (!generatedPreview && !previewProof) {
    return { state: 'missing' };
  }

  if (!generatedPreview || !previewProof) {
    return { state: 'invalid' };
  }

  try {
    const serializedPreview = serializeGeneratedPreviewPayload(generatedPreview);
    if (!verifyPreview(serializedPreview, previewProof)) {
      return { state: 'invalid' };
    }

    if (generatedPreview.kind === 'file-summary') {
      return { state: previewProof.previewInclusion ? 'invalid' : 'verified' };
    }

    const previewBytes = decodeGeneratedPreviewBytes(generatedPreview);
    if (previewBytes.length > 0 && !verifyPreviewInclusion(previewBytes, previewProof)) {
      return { state: 'invalid' };
    }

    return {
      state: 'verified',
      text: decoder.decode(previewBytes),
    };
  } catch {
    return { state: 'invalid' };
  }
}

export function verifyUnlockedStashFile(
  stash: Pick<StashPublicInfo, 'previewProof'>,
  content: ArrayBuffer | Uint8Array,
  previewSecret: StashProofSecret | undefined
): boolean {
  if (!stash.previewProof) return true;
  if (!previewSecret) return false;

  return verifyUnlockedFile(content, stash.previewProof, previewSecret);
}

export function verifySealedStashPackageBundle(
  stash: Pick<StashPublicInfo, 'blobFormat' | 'blobSha256' | 'generatedPreview' | 'previewProof'>,
  blob: Uint8Array
): boolean {
  if (stash.blobFormat !== STASH_BLOB_FORMAT) return true;
  if (
    !stash.blobSha256 ||
    !stash.previewProof ||
    stash.previewProof.version !== 'stashu-preview-v2' ||
    stash.previewProof.sealedBlobSha256 !== stash.blobSha256
  ) {
    return false;
  }

  if (
    verifyGeneratedPreviewBundle(stash.generatedPreview, stash.previewProof).state !== 'verified'
  ) {
    return false;
  }

  let previewRange: PreviewContentRange | undefined;
  if (stash.generatedPreview?.kind === 'text-peek') {
    const metadata = stash.generatedPreview.metadata as { offset: number };
    previewRange = {
      offset: metadata.offset,
      bytes: decodeGeneratedPreviewBytes(stash.generatedPreview),
    };
  }

  try {
    if (parseSealedStashPackage(blob).contentLength !== stash.previewProof.contentLength) {
      return false;
    }
    return verifySealedStashPackage(blob, stash.blobSha256, previewRange);
  } catch {
    return false;
  }
}
