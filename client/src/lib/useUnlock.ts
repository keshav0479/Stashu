import { useState, useCallback } from 'react';
import { getStashInfo, unlockStash } from './api';
import { decryptFile, fromBase64 } from './crypto';
import { fetchFromBlossom } from './blossom';
import type { StashPublicInfo } from '../../../shared/types';

export type UnlockStatus = 'loading' | 'ready' | 'unlocking' | 'decrypting' | 'done' | 'error';

export interface UnlockState {
  status: UnlockStatus;
  stash: StashPublicInfo | null;
  error: string | null;
  downloadUrl: string | null;
  fileName: string | null;
}

export function useUnlock(stashId: string) {
  const [state, setState] = useState<UnlockState>({
    status: 'loading',
    stash: null,
    error: null,
    downloadUrl: null,
    fileName: null,
  });

  const loadStash = useCallback(async () => {
    try {
      setState((s) => ({ ...s, status: 'loading', error: null }));
      const stash = await getStashInfo(stashId);
      setState((s) => ({ ...s, status: 'ready', stash }));
    } catch (error) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to load stash',
      }));
    }
  }, [stashId]);

  const submitToken = useCallback(
    async (token: string) => {
      if (!token.trim()) {
        setState((s) => ({ ...s, error: 'Please enter a Cashu token' }));
        return;
      }

      try {
        // Step 1: Unlock with token
        setState((s) => ({ ...s, status: 'unlocking', error: null }));
        const unlockResult = await unlockStash(stashId, token);

        // Step 2: Fetch encrypted file from Blossom
        setState((s) => ({ ...s, status: 'decrypting' }));
        const ciphertext = await fetchFromBlossom(unlockResult.blobUrl);

        // Step 3: Parse secret key (format: base64Nonce:base64Key)
        const [nonceB64, keyB64] = unlockResult.secretKey.split(':');
        if (!nonceB64 || !keyB64) {
          throw new Error('Invalid secret key format');
        }
        const nonce = fromBase64(nonceB64);
        const key = fromBase64(keyB64);

        // Step 4: Decrypt the file
        const plaintext = await decryptFile(ciphertext, key, nonce);

        // Step 5: Create download URL
        const blob = new Blob([plaintext]);
        const downloadUrl = URL.createObjectURL(blob);
        const fileName = unlockResult.fileName || state.stash?.title || 'download';

        setState((s) => ({
          ...s,
          status: 'done',
          downloadUrl,
          fileName,
        }));
      } catch (error) {
        setState((s) => ({
          ...s,
          status: 'ready', // Go back to ready state so user can retry
          error: error instanceof Error ? error.message : 'Unlock failed',
        }));
      }
    },
    [stashId, state.stash]
  );

  const download = useCallback(() => {
    if (state.downloadUrl && state.fileName) {
      const a = document.createElement('a');
      a.href = state.downloadUrl;
      a.download = state.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }, [state.downloadUrl, state.fileName]);

  /**
   * Handle unlock from Lightning payment (bypasses token submission).
   * Receives secretKey + blobUrl directly from the server polling response.
   */
  const submitLightningResult = useCallback(
    async (data: { secretKey: string; blobUrl: string; fileName?: string }) => {
      try {
        setState((s) => ({ ...s, status: 'decrypting', error: null }));

        // Fetch encrypted file from Blossom
        const ciphertext = await fetchFromBlossom(data.blobUrl);

        // Parse secret key (format: base64Nonce:base64Key)
        const [nonceB64, keyB64] = data.secretKey.split(':');
        if (!nonceB64 || !keyB64) {
          throw new Error('Invalid secret key format');
        }
        const nonce = fromBase64(nonceB64);
        const key = fromBase64(keyB64);

        // Decrypt the file
        const plaintext = await decryptFile(ciphertext, key, nonce);

        // Create download URL
        const blob = new Blob([plaintext]);
        const downloadUrl = URL.createObjectURL(blob);
        const fileName = data.fileName || state.stash?.title || 'download';

        setState((s) => ({
          ...s,
          status: 'done',
          downloadUrl,
          fileName,
        }));
      } catch (error) {
        setState((s) => ({
          ...s,
          status: 'ready',
          error: error instanceof Error ? error.message : 'Decryption failed',
        }));
      }
    },
    [state.stash]
  );

  const reset = useCallback(() => {
    if (state.downloadUrl) {
      URL.revokeObjectURL(state.downloadUrl);
    }
    setState({
      status: 'loading',
      stash: null,
      error: null,
      downloadUrl: null,
      fileName: null,
    });
  }, [state.downloadUrl]);

  return {
    ...state,
    loadStash,
    submitToken,
    submitLightningResult,
    download,
    reset,
  };
}
