import { useState, useCallback } from 'react';
import { getStashInfo, unlockStash, claimStash } from './api';
import { decryptFile, fromBase64 } from './crypto';
import { fetchFromBlossom } from './blossom';
import type { StashPublicInfo } from '../../../shared/types';

export type UnlockStatus =
  | 'loading'
  | 'claiming'
  | 'ready'
  | 'unlocking'
  | 'decrypting'
  | 'done'
  | 'error';

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

  const decryptAndFinish = useCallback(
    async (data: { secretKey: string; blobUrl: string; fileName?: string }) => {
      setState((s) => ({ ...s, status: 'decrypting', error: null }));

      const ciphertext = await fetchFromBlossom(data.blobUrl);

      const [nonceB64, keyB64] = data.secretKey.split(':');
      if (!nonceB64 || !keyB64) {
        throw new Error('Invalid secret key format');
      }
      const nonce = fromBase64(nonceB64);
      const key = fromBase64(keyB64);

      const plaintext = await decryptFile(ciphertext, key, nonce);

      const blob = new Blob([plaintext]);
      const downloadUrl = URL.createObjectURL(blob);
      const fileName = data.fileName || state.stash?.title || 'download';

      setState((s) => ({ ...s, status: 'done', downloadUrl, fileName }));
    },
    [state.stash]
  );

  const loadStash = useCallback(async () => {
    try {
      setState((s) => ({ ...s, status: 'loading', error: null }));
      const stash = await getStashInfo(stashId);
      // If a claim token exists, go straight to 'claiming' to avoid flashing payment UI
      const hasClaimToken = !!localStorage.getItem(`stashu-claim-${stashId}`);
      setState((s) => ({ ...s, status: hasClaimToken ? 'claiming' : 'ready', stash }));
    } catch (error) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to load stash',
      }));
    }
  }, [stashId]);

  const tryClaimToken = useCallback(async (): Promise<boolean> => {
    const claimToken = localStorage.getItem(`stashu-claim-${stashId}`);
    if (!claimToken) return false;

    try {
      setState((s) => ({ ...s, status: 'claiming', error: null }));
      const result = await claimStash(stashId, claimToken);
      await decryptAndFinish(result);
      return true;
    } catch (error) {
      const status = (error as Error & { status?: number }).status;
      if (status === 404 || status === 410) {
        // Token is invalid or expired — remove it permanently
        localStorage.removeItem(`stashu-claim-${stashId}`);
      }
      // For transient errors (network, 500), keep the token for next attempt
      setState((s) => ({ ...s, status: 'ready' }));
      return false;
    }
  }, [stashId, decryptAndFinish]);

  const submitToken = useCallback(
    async (token: string) => {
      if (!token.trim()) {
        setState((s) => ({ ...s, error: 'Please enter a Cashu token' }));
        return;
      }

      try {
        setState((s) => ({ ...s, status: 'unlocking', error: null }));
        const unlockResult = await unlockStash(stashId, token);

        // Store claim token for re-download
        if (unlockResult.claimToken) {
          localStorage.setItem(`stashu-claim-${stashId}`, unlockResult.claimToken);
        }

        await decryptAndFinish(unlockResult);
      } catch (error) {
        setState((s) => ({
          ...s,
          status: 'ready',
          error: error instanceof Error ? error.message : 'Unlock failed',
        }));
      }
    },
    [stashId, decryptAndFinish]
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
    async (data: {
      secretKey: string;
      blobUrl: string;
      fileName?: string;
      claimToken?: string;
    }) => {
      try {
        // Store claim token for re-download
        if (data.claimToken) {
          localStorage.setItem(`stashu-claim-${stashId}`, data.claimToken);
        }

        await decryptAndFinish(data);
      } catch (error) {
        setState((s) => ({
          ...s,
          status: 'ready',
          error: error instanceof Error ? error.message : 'Decryption failed',
        }));
      }
    },
    [stashId, decryptAndFinish]
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
    tryClaimToken,
    submitToken,
    submitLightningResult,
    download,
    reset,
  };
}
