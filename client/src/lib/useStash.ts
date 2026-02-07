import { useState, useCallback } from 'react';
import { encryptFile, readFileAsArrayBuffer, toBase64 } from './crypto';
import { uploadToBlossom } from './blossom';
import { getPublicKey, encryptToSelf } from './nostr';
import { createStash } from './api';
import { hasIdentity, hasAcknowledgedRecovery } from './identity';

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
      const { ciphertext, nonce, key } = await encryptFile(fileData);
      const secretKey = `${toBase64(nonce)}:${toBase64(key)}`;

      setState((s) => ({ ...s, progress: 40 }));
      let keyBackup: string | undefined;
      try {
        keyBackup = encryptToSelf(secretKey);
      } catch {
        // Optional
      }

      setState((s) => ({ ...s, status: 'uploading', progress: 60 }));
      const uploadResult = await uploadToBlossom(ciphertext, file.type);

      setState((s) => ({ ...s, status: 'creating', progress: 80 }));
      const stashResult = await createStash({
        blobUrl: uploadResult.url,
        secretKey,
        keyBackup,
        sellerPubkey: pubkey,
        priceSats: options.priceSats,
        title: options.title,
        description: options.description,
        fileName: file.name,
        fileSize: file.size,
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
