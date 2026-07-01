/**
 * Blossom Protocol Integration
 * Uploads encrypted files to a Blossom server with NIP-98 authentication
 * Supports BUD-04 mirroring for redundancy and fallback downloads
 */

import { createBlossomAuthEvent, createBlossomMirrorAuthEvent } from './nostr';
import { sha256 } from './crypto';

const DEFAULT_BLOSSOM_SERVER = import.meta.env.VITE_BLOSSOM_URL || 'https://blossom.primal.net';
const BLOSSOM_STORAGE_KEY = 'stashu_blossom_server';

export const PRESET_BLOSSOM_SERVERS = [{ label: 'Primal', url: 'https://blossom.primal.net' }];

export const MIRROR_SERVERS = PRESET_BLOSSOM_SERVERS.map((s) => s.url);

const BLOSSOM_MIRRORING_KEY = 'stashu_blossom_mirroring';

export function getMirroringEnabled(): boolean {
  const stored = localStorage.getItem(BLOSSOM_MIRRORING_KEY);
  return stored === null ? true : stored === 'true';
}

export function setMirroringEnabled(enabled: boolean): void {
  if (enabled) {
    localStorage.removeItem(BLOSSOM_MIRRORING_KEY);
  } else {
    localStorage.setItem(BLOSSOM_MIRRORING_KEY, 'false');
  }
}

export function getBlossomServer(): string {
  return localStorage.getItem(BLOSSOM_STORAGE_KEY) || DEFAULT_BLOSSOM_SERVER;
}

export function setBlossomServer(url: string): void {
  const normalized = url.trim().replace(/\/+$/, '');
  if (normalized === DEFAULT_BLOSSOM_SERVER) {
    localStorage.removeItem(BLOSSOM_STORAGE_KEY);
  } else {
    localStorage.setItem(BLOSSOM_STORAGE_KEY, normalized);
  }
}

export function validateBlossomUrl(url: string): { valid: boolean; error?: string } {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return { valid: false, error: 'URL is required' };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
      return { valid: false, error: 'Must use HTTPS' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL' };
  }
}

export interface BlossomUploadResult {
  url: string;
  sha256: string;
  size: number;
  type: string;
}

function encodeBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
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

  // BUD-11 requires Base64url without padding in the Authorization header.
  const authHeader = `Nostr ${encodeBase64Url(JSON.stringify(authEvent))}`;

  // Upload the file
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: authHeader,
      'Content-Type': contentType,
      'X-SHA-256': dataHash,
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
export async function fetchFromBlossom(url: string, maxBytes?: number): Promise<Uint8Array> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch from Blossom: ${response.status}`);
  }

  const declaredLength = response.headers?.get('content-length');
  if (maxBytes !== undefined && declaredLength && Number(declaredLength) > maxBytes) {
    throw new Error('Downloaded blob exceeds the allowed size');
  }

  if (maxBytes !== undefined && response.body) {
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalLength += value.length;
      if (totalLength > maxBytes) {
        await reader.cancel();
        throw new Error('Downloaded blob exceeds the allowed size');
      }
      chunks.push(value);
    }

    const blob = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      blob.set(chunk, offset);
      offset += chunk.length;
    }
    return blob;
  }

  const buffer = await response.arrayBuffer();
  if (maxBytes !== undefined && buffer.byteLength > maxBytes) {
    throw new Error('Downloaded blob exceeds the allowed size');
  }
  return new Uint8Array(buffer);
}

/**
 * Mirror a blob to another Blossom server (BUD-04)
 * Fire-and-forget — returns true/false, never throws
 */
export async function mirrorToBlossom(
  blobSha256: string,
  sourceUrl: string,
  mirrorServer: string
): Promise<boolean> {
  try {
    const mirrorUrl = `${mirrorServer}/mirror`;
    const authEvent = await createBlossomMirrorAuthEvent(mirrorUrl, blobSha256);
    const authHeader = `Nostr ${encodeBase64Url(JSON.stringify(authEvent))}`;

    const response = await fetch(mirrorUrl, {
      method: 'PUT',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: sourceUrl }),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Mirror to all backup servers except the primary (fire-and-forget)
 * Respects the seller's mirroring preference
 */
export function mirrorToBackupServers(
  blobSha256: string,
  sourceUrl: string,
  primaryServer: string
): void {
  if (!getMirroringEnabled()) return;
  const mirrors = MIRROR_SERVERS.filter((s) => s !== primaryServer);
  for (const server of mirrors) {
    mirrorToBlossom(blobSha256, sourceUrl, server).then((ok) => {
      if (ok) console.log(`Mirrored to ${server}`);
    });
  }
}

/**
 * Fetch from Blossom with fallback to mirror servers using SHA256 hash
 */
export async function fetchFromBlossomWithFallback(
  primaryUrl: string,
  blobSha256: string | null | undefined,
  maxBytes?: number
): Promise<Uint8Array> {
  const fetchVerified = async (url: string) => {
    const blob = await fetchFromBlossom(url, maxBytes);
    if (blobSha256 && sha256(blob) !== blobSha256) {
      throw new Error('Downloaded blob hash did not match its Blossom address');
    }
    return blob;
  };

  // Try primary first
  try {
    return await fetchVerified(primaryUrl);
  } catch (primaryError) {
    if (!blobSha256) throw primaryError;
    let lastError = primaryError;

    // Try each mirror server
    for (const server of MIRROR_SERVERS) {
      try {
        const fallbackUrl = `${server}/${blobSha256}`;
        if (fallbackUrl === primaryUrl) continue;
        return await fetchVerified(fallbackUrl);
      } catch (error) {
        lastError = error;
        continue;
      }
    }

    if (
      lastError instanceof Error &&
      /hash did not match|exceeds the allowed size/i.test(lastError.message)
    ) {
      throw lastError;
    }

    throw new Error(
      `File unavailable. Primary server and all mirrors failed. ` +
        `The file may have been removed from storage.`
    );
  }
}
