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

export interface MeltQuoteResult {
  success: boolean;
  quote?: string;
  feeSats?: number;
  error?: string;
}

export interface MeltResult {
  success: boolean;
  preimage?: string;
  feeSats?: number;
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

/**
 * Get a melt quote for a Lightning invoice
 * Returns the fee estimate without executing the payment
 */
export async function getMeltQuote(invoice: string): Promise<MeltQuoteResult> {
  try {
    const w = await getWallet();
    const quote = await w.createMeltQuote(invoice);

    return {
      success: true,
      quote: quote.quote,
      feeSats: quote.fee_reserve,
    };
  } catch (error) {
    console.error('Melt quote error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get melt quote',
    };
  }
}

/**
 * Melt aggregated Cashu tokens to pay a Lightning invoice
 * @param tokens Array of encoded Cashu token strings
 * @param invoice BOLT11 Lightning invoice to pay
 */
export async function meltToLightning(tokens: string[], invoice: string): Promise<MeltResult> {
  try {
    const w = await getWallet();

    // Aggregate all proofs from all tokens by receiving them first
    const allProofs = [];
    for (const token of tokens) {
      const proofs = await w.receive(token);
      allProofs.push(...proofs);
    }

    // Get melt quote
    const quote = await w.createMeltQuote(invoice);

    // Execute melt (pay the invoice)
    const result = await w.meltProofs(quote, allProofs);

    if (result.quote.state !== 'PAID') {
      return {
        success: false,
        error: 'Lightning payment failed',
      };
    }

    return {
      success: true,
      preimage: result.quote.payment_preimage || '',
      feeSats: quote.fee_reserve,
    };
  } catch (error) {
    console.error('Melt error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Lightning withdrawal failed',
    };
  }
}
