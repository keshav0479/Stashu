import {
  Mint,
  Wallet,
  getDecodedToken,
  getEncodedTokenV4,
  setGlobalRequestOptions,
} from '@cashu/cashu-ts';
import type { Proof } from '@cashu/cashu-ts';
import db from '../db/index.js';
import { encrypt } from './encryption.js';

// Cashu Mint URL — configurable via env for production
const MINT_URL = process.env.MINT_URL || 'https://mint.minibits.cash/Bitcoin';
const configuredTimeout = Number(process.env.CASHU_REQUEST_TIMEOUT_MS);
const CASHU_REQUEST_TIMEOUT_MS =
  Number.isInteger(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 10_000;

setGlobalRequestOptions({ requestTimeout: CASHU_REQUEST_TIMEOUT_MS });

let wallet: Wallet | null = null;
let walletLoading: Promise<Wallet> | null = null;
// A short id that stays unmappable after a fresh load is a bad token, not a
// rotation. This bounds how often the public token endpoints can evict the
// process wallet, since decoding runs before any idempotency record exists.
let lastKeysetReloadAt = 0;
const KEYSET_RELOAD_COOLDOWN_MS = 60_000;

async function getWallet(): Promise<Wallet> {
  if (wallet) return wallet;

  if (!walletLoading) {
    walletLoading = (async () => {
      const mint = new Mint(MINT_URL);
      const loadingWallet = new Wallet(mint);
      // Cache only a fully initialized wallet so transient mint failures can recover.
      await loadingWallet.loadMint();
      wallet = loadingWallet;
      return loadingWallet;
    })().finally(() => {
      walletLoading = null;
    });
  }

  return walletLoading;
}

// Only a genuinely unmappable short id can be fixed by reloading keysets. An
// ambiguous id or an unknown version byte is a permanent property of the token
// (cashu-ts message text, pinned) — reloading those would just burn mint calls.
export function isStaleKeysetError(error: unknown): boolean {
  return error instanceof Error && /map short keyset id/i.test(error.message);
}

/**
 * The buyer's payment was received but the mint already issued the ecash for
 * this quote to a caller that lost it. Retrying can never succeed.
 */
export function isQuoteAlreadyIssued(error: unknown): boolean {
  const code = (error as { code?: number }).code;
  return code === 20002 || (error instanceof Error && /already issued/i.test(error.message));
}

/**
 * Discard a stale wallet and load a fresh one, but at most once per cooldown so
 * a stream of unmappable tokens cannot evict the process wallet on every
 * request. Returns the stale wallet unchanged when a reload is not warranted.
 */
async function refreshWallet(stale: Wallet): Promise<Wallet> {
  // Another caller already replaced the wallet we used — take theirs.
  if (wallet && wallet !== stale) return wallet;
  // A reload is already in flight — join it instead of starting a second.
  if (walletLoading) return walletLoading;
  if (Date.now() - lastKeysetReloadAt < KEYSET_RELOAD_COOLDOWN_MS) return stale;
  lastKeysetReloadAt = Date.now();
  wallet = null;
  return getWallet();
}

/**
 * Decode a token with wallet keyset context so short keyset ids resolve. On a
 * genuinely-unmappable id the mint is reloaded once (cooldown-bounded) so a
 * keyset rotation cannot strand a long-running process. Decoding is read-only,
 * which is what makes the retry safe.
 */
async function decodeTokenSafe(tokenString: string): Promise<{ proofs: Proof[]; mint: string }> {
  const w = await getWallet();
  try {
    return w.decodeToken(tokenString);
  } catch (error) {
    if (!isStaleKeysetError(error)) throw error;
    const fresh = await refreshWallet(w);
    if (fresh === w) throw error; // no reload happened (cooldown or already-fresh)
    return fresh.decodeToken(tokenString);
  }
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
  // Computed from the mint's change proofs at melt time, so callers never
  // re-decode the change token (and can never mis-value it to zero)
  changeSats?: number;
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
    // Decode with wallet keyset context so short keyset ids resolve; reloads
    // the mint once if the cached wallet predates a keyset rotation
    const proofs = getProofsFromToken(await decodeTokenSafe(tokenString));
    const w = await getWallet();
    const totalValue = proofs.reduce((sum, proof) => sum + proof.amount, 0);

    // Exact-amount check with the same wallet snapshot receive() uses for its
    // fee deduction, so unlike the route-level valuation guard it cannot race
    // a wallet reload. Throws on unknown keysets, which receive() rejects anyway.
    const receivable = totalValue - w.getFeesForProofs(proofs);
    if (receivable !== expectedSats) {
      console.error(
        `Token verification failed: would credit ${receivable} sats, expected ${expectedSats}`
      );
      return {
        success: false,
        error: 'Token value does not match the price',
      };
    }

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

export interface TokenValuation {
  valueSats: number;
  receivableSats: number;
}

/**
 * Face value of a token and its post-fee receivable value (NUT-02 input fees).
 * Returns null for undecodable tokens. Advisory only: on wallet or keyset
 * failures it falls back to face value. verifyAndSwapToken re-enforces the
 * exact amount at swap time, so a stale answer here can only blunt the error
 * message, never mis-credit.
 */
export async function getTokenValuation(tokenString: string): Promise<TokenValuation | null> {
  let w: Wallet | null = null;
  try {
    w = await getWallet();
  } catch {
    w = null;
  }

  let proofs: Proof[];
  try {
    // Wallet decode maps short keyset ids; raw decode is the offline fallback
    proofs = getProofsFromToken(
      w ? await decodeTokenSafe(tokenString) : getDecodedToken(tokenString)
    );
    // The decode may have refreshed the wallet; fee math must use the same one
    w = w ? await getWallet() : w;
  } catch {
    return null;
  }

  const valueSats = proofs.reduce((sum, proof) => sum + proof.amount, 0);
  if (w) {
    try {
      return { valueSats, receivableSats: valueSats - w.getFeesForProofs(proofs) };
    } catch {
      // Unknown keyset, the swap will surface it
    }
  }
  return { valueSats, receivableSats: valueSats };
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
 * Melt aggregated Cashu tokens to pay a Lightning invoice.
 * Tracks the melt in `pending_melts` table so it can be recovered on crash.
 *
 * @param tokens Array of encoded Cashu token strings
 * @param invoice BOLT11 Lightning invoice to pay
 * @param sellerPubkey Seller's pubkey (for pending_melts tracking)
 * @returns MeltResult including any change token (excess sats returned by mint)
 */
export async function meltWithRecovery(
  tokens: string[],
  invoice: string,
  sellerPubkey: string
): Promise<MeltResult> {
  try {
    // Extract proofs from stored tokens with keyset context, so short keyset
    // ids resolve even when the tokens were minted under a rotated keyset
    const allProofs: Proof[] = [];
    for (const token of tokens) {
      const decoded = await decodeTokenSafe(token);
      const proofs = getProofsFromToken(decoded);
      allProofs.push(...proofs);
    }
    const w = await getWallet();

    const totalValue = allProofs.reduce((sum: number, p) => sum + p.amount, 0);

    // Get melt quote
    const quote = await w.createMeltQuote(invoice);
    const needed = quote.amount + quote.fee_reserve;

    if (totalValue < needed) {
      console.error(`Melt failed: insufficient balance (${totalValue} < ${needed})`);
      return {
        success: false,
        error: 'Insufficient balance for withdrawal (including fees)',
      };
    }

    // Persist the melt intent BEFORE executing — crash recovery can check this
    // Proofs are bearer secrets — encrypt at rest
    db.prepare(
      `INSERT INTO pending_melts (seller_pubkey, quote_id, proofs_json, invoice, amount_sats, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    ).run(sellerPubkey, quote.quote, encrypt(JSON.stringify(allProofs)), invoice, totalValue);

    // Execute melt (pay the invoice)
    const result = await w.meltProofs(quote, allProofs);

    if (result.quote.state === 'PAID') {
      // Mark pending melt as completed
      db.prepare(`UPDATE pending_melts SET status = 'completed' WHERE quote_id = ?`).run(
        quote.quote
      );

      // Encode change proofs if the mint returned excess sats
      let changeToken: string | undefined;
      let changeSats = 0;
      if (result.change && result.change.length > 0) {
        changeSats = result.change.reduce((sum: number, p) => sum + p.amount, 0);
        if (changeSats > 0) {
          changeToken = getEncodedTokenV4({ mint: MINT_URL, proofs: result.change });
          console.log(`💰 Change proofs recovered: ${changeSats} sats`);
        }
      }

      return {
        success: true,
        preimage: result.quote.payment_preimage || '',
        feeSats: quote.fee_reserve,
        changeToken,
        changeSats,
      };
    } else {
      // Payment didn't succeed — mark failed so recovery doesn't retry endlessly
      db.prepare(`UPDATE pending_melts SET status = 'failed' WHERE quote_id = ?`).run(quote.quote);
      return { success: false, error: 'Lightning payment failed' };
    }
  } catch (error) {
    console.error('Melt error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Lightning withdrawal failed',
    };
  }
}

/**
 * Check the status of a melt quote — used by recovery to see if a pending melt actually went through.
 */
export async function checkMeltQuoteStatus(
  quoteId: string
): Promise<{ state: string; preimage?: string }> {
  const w = await getWallet();
  const quote = await w.checkMeltQuote(quoteId);
  return { state: quote.state, preimage: quote.payment_preimage || undefined };
}

/** @deprecated Use meltWithRecovery instead — kept for backward compatibility */
export async function meltToLightning(tokens: string[], invoice: string): Promise<MeltResult> {
  return meltWithRecovery(tokens, invoice, 'unknown');
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
