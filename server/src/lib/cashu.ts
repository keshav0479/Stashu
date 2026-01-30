import { CashuMint, CashuWallet, getDecodedToken } from '@cashu/cashu-ts';

// Minibits Cashu Mint
const MINT_URL = 'https://mint.minibits.cash/Bitcoin';

let wallet: CashuWallet | null = null;

async function getWallet(): Promise<CashuWallet> {
  if (!wallet) {
    const mint = new CashuMint(MINT_URL);
    const keys = await mint.getKeys();
    wallet = new CashuWallet(mint, { keys });
  }
  return wallet;
}

export interface SwapResult {
  success: boolean;
  sellerToken?: string;
  error?: string;
}

/**
 * Verify a Cashu token has sufficient value and swap it for a new token
 * @param tokenString The Cashu token string from the buyer
 * @param expectedSats The expected amount in satoshis
 * @returns SwapResult with the new token for the seller
 */
export async function verifyAndSwapToken(
  tokenString: string,
  expectedSats: number
): Promise<SwapResult> {
  try {
    // Decode the token
    const decoded = getDecodedToken(tokenString);
    
    // Calculate total value
    const totalValue = decoded.token
      .flatMap((t: { proofs: Array<{ amount: number }> }) => t.proofs)
      .reduce((sum: number, proof: { amount: number }) => sum + proof.amount, 0);

    if (totalValue < expectedSats) {
      return {
        success: false,
        error: `Insufficient token value: ${totalValue} sats, expected ${expectedSats} sats`
      };
    }

    // Get all proofs from the token
    const proofs = decoded.token.flatMap(t => t.proofs);

    // Get wallet and swap proofs for new ones
    const w = await getWallet();
    const newProofs = await w.receive(tokenString);

    // Encode the new proofs as a token for the seller
    const sellerToken = w.getEncodedToken({
      mint: MINT_URL,
      proofs: newProofs
    });

    return {
      success: true,
      sellerToken
    };

  } catch (error) {
    console.error('Cashu swap error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Token swap failed'
    };
  }
}

/**
 * Get the total value of a Cashu token
 */
export function getTokenValue(tokenString: string): number {
  try {
    const decoded = getDecodedToken(tokenString);
    return decoded.token
      .flatMap((t: { proofs: Array<{ amount: number }> }) => t.proofs)
      .reduce((sum: number, proof: { amount: number }) => sum + proof.amount, 0);
  } catch {
    return 0;
  }
}
