import { useState, useCallback } from 'react';
import { readFileAsArrayBuffer } from './crypto';
import {
  uploadToBlossom,
  getBlossomServer,
  mirrorToBackupServers,
  MIRROR_SERVERS,
  type BlossomUploadResult,
} from './blossom';
import { getPublicKey } from './nostr';
import { createStash } from './api';
import { hasIdentity, hasAcknowledgedRecovery } from './identity';
import {
  decodeGeneratedPreviewBytes,
  generatePreviewFromBytes,
  serializeGeneratedPreviewPayload,
  type TextLineLimit,
} from './generatedPreview';
import { createStashProof } from './stashProof';
import { createSealedStashPackage, STASH_BLOB_FORMAT } from './stashPackage';

export type StashStatus = 'idle' | 'encrypting' | 'uploading' | 'creating' | 'done' | 'error';

export interface StashState {
  status: StashStatus;
  progress: number;
  error: string | null;
  shareUrl: string | null;
}

export interface StashOptions {
  title: string;
  description?: string;
  priceSats: number;
  downloadWindowSeconds: number;
  peekMode?: 'none' | 'auto' | 'excerpt';
  previewLineLimit?: TextLineLimit;
  previewMaxChars?: number;
  previewRatio?: number;
  peekExcerpt?: {
    offset: number;
    text: string;
  };
}

export function useStash() {
  const [state, setState] = useState<StashState>({
    status: 'idle',
    progress: 0,
    error: null,
    shareUrl: null,
  });

  const reset = useCallback(() => {
    setState({ status: 'idle', progress: 0, error: null, shareUrl: null });
  }, []);

  const createStashFromFile = useCallback(async (file: File, options: StashOptions) => {
    const pubkey = getPublicKey();

    try {
      setState((s) => ({ ...s, status: 'encrypting', progress: 20 }));
      const fileData = await readFileAsArrayBuffer(file);
      const fileBytes = new Uint8Array(fileData);
      const generatedPreview = generatePreviewFromBytes(
        {
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          content: fileBytes,
        },
        {
          mode: options.peekMode ?? 'none',
          lineLimit: options.previewLineLimit,
          maxChars: options.previewMaxChars,
          maxPreviewRatio: options.previewRatio,
          excerpt: options.peekExcerpt,
        }
      );
      const previewContent =
        generatedPreview.kind === 'text-peek'
          ? {
              offset: (generatedPreview.metadata as { offset: number }).offset,
              bytes: decodeGeneratedPreviewBytes(generatedPreview),
            }
          : undefined;
      const sealedPackage = createSealedStashPackage(fileBytes, previewContent);
      const { proof: previewProof, secret: previewSecret } = createStashProof(
        serializeGeneratedPreviewPayload(generatedPreview),
        fileBytes,
        {
          previewContent:
            previewContent && previewContent.bytes.length > 0 ? previewContent : undefined,
          sealedBlobSha256: sealedPackage.blobSha256,
        }
      );

      setState((s) => ({ ...s, status: 'uploading', progress: 60 }));
      // Try the selected server first, then fail over through the presets —
      // public servers can reject encrypted blobs at any time (as Primal did)
      const selectedServer = getBlossomServer();
      const uploadServers = [
        selectedServer,
        ...MIRROR_SERVERS.filter((server) => server !== selectedServer),
      ];
      let uploadResult: BlossomUploadResult | undefined;
      let uploadedServer = selectedServer;
      let lastUploadError: unknown;
      for (const server of uploadServers) {
        try {
          uploadResult = await uploadToBlossom(sealedPackage.blob, server);
          uploadedServer = server;
          break;
        } catch (error) {
          lastUploadError = error;
        }
      }
      if (!uploadResult) {
        throw lastUploadError instanceof Error
          ? lastUploadError
          : new Error('All upload servers failed');
      }
      if (uploadResult.sha256 !== sealedPackage.blobSha256) {
        throw new Error('Uploaded sealed package hash did not match');
      }

      // Mirror to backup servers for redundancy (fire-and-forget)
      mirrorToBackupServers(uploadResult.sha256, uploadResult.url, uploadedServer);

      setState((s) => ({ ...s, status: 'creating', progress: 80 }));
      const stashResult = await createStash({
        blobUrl: uploadResult.url,
        blobSha256: uploadResult.sha256,
        secretKey: sealedPackage.secretKey,
        blobFormat: STASH_BLOB_FORMAT,
        sellerPubkey: pubkey,
        priceSats: options.priceSats,
        title: options.title,
        description: options.description,
        downloadWindowSeconds: options.downloadWindowSeconds,
        fileName: file.name,
        fileSize: file.size,
        generatedPreview,
        previewProof,
        previewSecret,
      });

      const shareUrl = `${window.location.origin}/s/${stashResult.id}`;
      setState((s) => ({ ...s, status: 'done', progress: 100, shareUrl }));

      try {
        localStorage.setItem('stashu_pubkey', pubkey);
        const existingStashes = JSON.parse(localStorage.getItem('stashu_stashes') || '[]');
        const newStash = { id: stashResult.id, title: options.title, createdAt: Date.now() };
        localStorage.setItem('stashu_stashes', JSON.stringify([...existingStashes, newStash]));
      } catch (e) {
        console.error('Failed to save to localStorage', e);
      }

      return shareUrl;
    } catch (error) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: error instanceof Error ? error.message : 'Upload failed',
      }));
      return null;
    }
  }, []);

  return {
    ...state,
    isReady: hasIdentity() && hasAcknowledgedRecovery(),
    needsRecoveryAck: hasIdentity() && !hasAcknowledgedRecovery(),
    createStash: createStashFromFile,
    reset,
  };
}
