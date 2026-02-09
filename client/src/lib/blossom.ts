/**
 * Blossom Protocol Integration
 * Uploads encrypted files to a Blossom server with NIP-98 authentication
 */

import { createBlossomAuthEvent } from './nostr';
import { sha256 } from './crypto';

const DEFAULT_BLOSSOM_SERVER = import.meta.env.VITE_BLOSSOM_URL || 'https://blossom.primal.net';

export interface BlossomUploadResult {
  url: string;
  sha256: string;
  size: number;
  type: string;
}

/**
 * Upload a blob to Blossom server with NIP-98 authentication
 * @param data The encrypted file data
 * @param contentType MIME type of the file
 * @param server Optional Blossom server URL
 */
export async function uploadToBlossom(
  data: Uint8Array,
  contentType: string = 'application/octet-stream',
  server: string = DEFAULT_BLOSSOM_SERVER
): Promise<BlossomUploadResult> {
  const uploadUrl = `${server}/upload`;

  // Compute SHA-256 hash for Blossom auth
  const dataHash = sha256(data);

  // Create Blossom Authorization event (kind 24242)
  const authEvent = await createBlossomAuthEvent(uploadUrl, dataHash);

  // Encode auth event as base64 for Authorization header
  const authHeader = `Nostr ${btoa(JSON.stringify(authEvent))}`;

  // Upload the file
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: authHeader,
      'Content-Type': contentType,
    },
    body: data as unknown as BodyInit,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Blossom upload failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();

  // Blossom returns the blob URL
  return {
    url: result.url || `${server}/${dataHash}`,
    sha256: dataHash,
    size: data.length,
    type: contentType,
  };
}

/**
 * Get file from Blossom server
 * @param url The Blossom blob URL
 */
export async function fetchFromBlossom(url: string): Promise<Uint8Array> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch from Blossom: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}
