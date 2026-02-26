import { Mint, Wallet, getDecodedToken, getEncodedTokenV4 } from '@cashu/cashu-ts';
import type { Proof } from '@cashu/cashu-ts';

// Cashu Mint URL — configurable via env for production
const MINT_URL = process.env.MINT_URL || 'https://mint.minibits.cash/Bitcoin';

let wallet: Wallet | null = null;

async function getWallet(): Promise<Wallet> {
  if (!wallet) {
    const mint = new Mint(MINT_URL);
    wallet = new Wallet(mint);
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
  amountSats?: number;
  error?: string;
}

export interface MeltResult {
  success: boolean;
  preimage?: string;
  feeSats?: number;
  changeToken?: string; //(excess sats returned by mint)
  error?: string;
}

/**
 * Extract proofs from a decoded token
 */
function getProofsFromToken(decoded: { proofs: Proof[]; mint: string }): Proof[] {
  return decoded.proofs || [];
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
      amountSats: quote.amount,
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
 * @returns MeltResult including any change token (excess sats returned by mint)
 */
export async function meltToLightning(tokens: string[], invoice: string): Promise<MeltResult> {
  try {
    const w = await getWallet();

    // Extract proofs directly from tokens (they are already valid proofs on this mint)
    // Do NOT call w.receive() — that would try to re-swap already-owned proofs
    const allProofs: Proof[] = [];
    for (const token of tokens) {
      const decoded = getDecodedToken(token);
      const proofs = getProofsFromToken(decoded);
      allProofs.push(...proofs);
    }

    const totalValue = allProofs.reduce((sum: number, p) => sum + p.amount, 0);

    // Get melt quote
    const quote = await w.createMeltQuote(invoice);
    const needed = quote.amount + quote.fee_reserve;

    if (totalValue < needed) {
      return {
        success: false,
        error: `Not enough balance. You have ${totalValue} sats but need ${needed} sats (${quote.amount} + ${quote.fee_reserve} fee)`,
      };
    }

    // Execute melt (pay the invoice)
    const result = await w.meltProofs(quote, allProofs);

    if (result.quote.state !== 'PAID') {
      return {
        success: false,
        error: 'Lightning payment failed',
      };
    }

    // Persist change proofs if the mint returned excess sats
    let changeToken: string | undefined;
    if (result.change && result.change.length > 0) {
      const changeSats = result.change.reduce((sum: number, p) => sum + p.amount, 0);
      if (changeSats > 0) {
        changeToken = getEncodedTokenV4({
          mint: MINT_URL,
          proofs: result.change,
        });
        console.log(`💰 Change proofs recovered: ${changeSats} sats`);
      }
    }

    return {
      success: true,
      preimage: result.quote.payment_preimage || '',
      feeSats: quote.fee_reserve,
      changeToken,
    };
  } catch (error) {
    console.error('Melt error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Lightning withdrawal failed',
    };
  }
}

/**
 * Create a Lightning invoice for a buyer to pay via the Cashu mint
 * @param amountSats Amount in satoshis
 * @returns Lightning invoice string and quote ID for polling
 */
export async function createPaymentInvoice(
  amountSats: number
): Promise<{ invoice: string; quoteId: string; expiresAt: number }> {
  const w = await getWallet();
  const quote = await w.createMintQuote(amountSats);
  return {
    invoice: quote.request,
    quoteId: quote.quote,
    expiresAt: quote.expiry,
  };
}

/**
 * Check if a mint quote has been paid
 * @param quoteId The quote ID from createPaymentInvoice
 * @returns Whether the invoice has been paid
 */
export async function checkPaymentStatus(
  quoteId: string
): Promise<{ paid: boolean; issued: boolean }> {
  const w = await getWallet();
  const quote = await w.checkMintQuote(quoteId);
  return {
    paid: quote.state === 'PAID' || quote.state === 'ISSUED',
    issued: quote.state === 'ISSUED',
  };
}

/**
 * Mint new Cashu tokens after a Lightning invoice has been paid
 * @param amountSats Amount that was paid
 * @param quoteId The quote ID from createPaymentInvoice
 * @returns Encoded Cashu token
 */
export async function mintAfterPayment(amountSats: number, quoteId: string): Promise<string> {
  const w = await getWallet();
  const proofs = await w.mintProofs(amountSats, quoteId);

  return getEncodedTokenV4({
    mint: MINT_URL,
    proofs,
  });
}
