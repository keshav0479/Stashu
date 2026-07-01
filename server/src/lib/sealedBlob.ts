import { decrypt } from './encryption.js';
import type { StashRow } from '../db/types.js';
import type { StashPublicInfo } from '../../../shared/types.js';

export const SEALED_BLOB_FORMAT = 'stashu-selective-v1' as const;

/**
 * Map a stash row's sealed-package columns onto the public response shape.
 * Legacy (non-sealed) stashes expose none of these fields.
 */
export function sealedStashFields(
  row: Pick<StashRow, 'blob_format' | 'blob_url' | 'blob_sha256'>
): Pick<StashPublicInfo, 'blobFormat' | 'sealedBlobUrl' | 'blobSha256'> {
  if (row.blob_format !== SEALED_BLOB_FORMAT) {
    return { blobFormat: undefined, sealedBlobUrl: undefined, blobSha256: undefined };
  }

  return {
    blobFormat: SEALED_BLOB_FORMAT,
    sealedBlobUrl: decrypt(row.blob_url),
    blobSha256: row.blob_sha256 ?? undefined,
  };
}
