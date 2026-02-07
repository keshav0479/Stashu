import { useState, useCallback } from 'react';
import { encryptFile, readFileAsArrayBuffer, toBase64 } from './crypto';
import { uploadToBlossom } from './blossom';
import { connectWallet, encryptToPublicKey, hasNostrExtension } from './nostr';
import { createStash } from './api';

export type StashStatus =
  | 'idle'
  | 'connecting'
  | 'encrypting'
  | 'uploading'
  | 'creating'
  | 'done'
  | 'error';

export interface StashState {
  status: StashStatus;
  progress: number; // 0-100
  error: string | null;
  pubkey: string | null;
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
    pubkey: null,
    shareUrl: null,
  });

  const reset = useCallback(() => {
    setState({
      status: 'idle',
      progress: 0,
      error: null,
      pubkey: null,
      shareUrl: null,
    });
  }, []);

  const connect = useCallback(async () => {
    if (!hasNostrExtension()) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: 'No Nostr extension found. Install Alby or nos2x.',
      }));
      return false;
    }

    setState((s) => ({ ...s, status: 'connecting', progress: 10 }));

    try {
      const { pubkey } = await connectWallet();
      setState((s) => ({ ...s, pubkey, status: 'idle', progress: 0 }));
      return true;
    } catch (error) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: error instanceof Error ? error.message : 'Connection failed',
      }));
      return false;
    }
  }, []);

  const createStashFromFile = useCallback(
    async (file: File, options: StashOptions) => {
      if (!state.pubkey) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: 'Wallet not connected',
        }));
        return null;
      }

      try {
        // Step 1: Encrypt the file with XChaCha20-Poly1305
        setState((s) => ({ ...s, status: 'encrypting', progress: 20 }));
        const fileData = await readFileAsArrayBuffer(file);
        const { ciphertext, nonce, key } = await encryptFile(fileData);

        // Create secret key string: nonce + key in base64
        // This allows buyer to decrypt with just one string
        const secretKey = `${toBase64(nonce)}:${toBase64(key)}`;

        // Step 2: Encrypt key backup to seller's pubkey
        setState((s) => ({ ...s, progress: 40 }));
        let keyBackup: string | undefined;
        try {
          keyBackup = await encryptToPublicKey(state.pubkey, secretKey);
        } catch {
          // Key backup is optional - continue without it
        }

        // Step 3: Upload to Blossom
        setState((s) => ({ ...s, status: 'uploading', progress: 60 }));
        const uploadResult = await uploadToBlossom(ciphertext, file.type);

        // Step 4: Create stash on backend
        setState((s) => ({ ...s, status: 'creating', progress: 80 }));
        const stashResult = await createStash({
          blobUrl: uploadResult.url,
          secretKey,
          keyBackup,
          sellerPubkey: state.pubkey,
          priceSats: options.priceSats,
          title: options.title,
          description: options.description,
          fileName: file.name,
          fileSize: file.size,
        });

        // Done!
        const shareUrl = `${window.location.origin}/s/${stashResult.id}`;
        setState((s) => ({
          ...s,
          status: 'done',
          progress: 100,
          shareUrl,
        }));

        return shareUrl;
      } catch (error) {
        setState((s) => ({
          ...s,
          status: 'error',
          error: error instanceof Error ? error.message : 'Upload failed',
        }));
        return null;
      }
    },
    [state.pubkey]
  );

  return {
    ...state,
    isConnected: !!state.pubkey,
    hasExtension: hasNostrExtension(),
    connect,
    createStash: createStashFromFile,
    reset,
  };
}
