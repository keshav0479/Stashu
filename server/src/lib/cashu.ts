import { CashuMint, CashuWallet, getDecodedToken, getEncodedTokenV4 } from '@cashu/cashu-ts';

// Minibits Cashu Mint
const MINT_URL = 'https://mint.minibits.cash/Bitcoin';

let wallet: CashuWallet | null = null;

async function getWallet(): Promise<CashuWallet> {
  if (!wallet) {
    const mint = new CashuMint(MINT_URL);
    wallet = new CashuWallet(mint);
    // Load keys from mint
    await wallet.loadMint();
  }
  return wallet;
}

export interface SwapResult {
  success: boolean;
  sellerToken?: string;
  error?: string;
}

/**
 * Extract proofs from a decoded token (handles both v0 and v1 formats)
 */
function getProofsFromToken(decoded: any): Array<{ amount: number }> {
  // v1 format: { mint, proofs, unit, memo }
  if (decoded.proofs && Array.isArray(decoded.proofs)) {
    return decoded.proofs;
  }
  // v0 format: { token: [{ mint, proofs }] }
  if (decoded.token && Array.isArray(decoded.token)) {
    return decoded.token.flatMap((t: any) => t.proofs || []);
  }
  return [];
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
    const proofs = getProofsFromToken(decoded);
    const totalValue = proofs.reduce((sum, proof) => sum + proof.amount, 0);

    if (totalValue < expectedSats) {
      return {
        success: false,
        error: `Insufficient token value: ${totalValue} sats, expected ${expectedSats} sats`,
      };
    }

    // Get wallet and swap proofs for new ones
    const w = await getWallet();
    const newProofs = await w.receive(tokenString);

    // Encode the new proofs as a token for the seller (v4 format)
    const sellerToken = getEncodedTokenV4({
      mint: MINT_URL,
      proofs: newProofs,
    });

    return {
      success: true,
      sellerToken,
    };
  } catch (error) {
    console.error('Cashu swap error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Token swap failed',
    };
  }
}

/**
 * Get the total value of a Cashu token
 */
export function getTokenValue(tokenString: string): number {
  try {
    const decoded = getDecodedToken(tokenString);
    const proofs = getProofsFromToken(decoded);
    return proofs.reduce((sum, proof) => sum + proof.amount, 0);
  } catch {
    return 0;
  }
}
