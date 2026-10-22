/**
 * How much a buyer pays for a stash.
 *
 * A fixed-price stash charges its price, full stop. A pay-what-you-want stash
 * treats the price as a minimum: the buyer names an amount, and that exact
 * amount is what the Lightning invoice is made for, or what a Cashu token must
 * credit. Requiring the buyer to name it, instead of accepting "anything at or
 * above the minimum", keeps the protection fixed prices already give: a buyer
 * who pastes the wrong token — their whole wallet, say — is refused rather
 * than having it all swept to the seller as a tip, since ecash has no change
 * path back to them.
 *
 * Threat model: the server is the only place this is decided. A client that
 * edits the page, or calls the API directly with a lower amount, is refused
 * here; the amount is then recorded on the payment row and is what minting,
 * crash recovery and every balance total use.
 */

export type PaymentAmount = { ok: true; amountSats: number } | { ok: false; error: string };

export interface PricedStash {
  price_sats: number;
  pay_what_you_want: number;
}

/**
 * @param requested the buyer's chosen amount, straight from the request body
 * @param maxSats the most the mint issues in one Lightning payment, if known
 */
export function resolvePaymentAmount(
  stash: PricedStash,
  requested: unknown,
  maxSats: number | null
): PaymentAmount {
  const omitted = requested === undefined || requested === null;

  if (stash.pay_what_you_want !== 1) {
    // Tolerate a client echoing the price back; refuse anything else so a
    // client bug can't quietly charge a different amount.
    if (omitted || requested === stash.price_sats) {
      return { ok: true, amountSats: stash.price_sats };
    }
    return { ok: false, error: `This stash has a fixed price of ${stash.price_sats} sats` };
  }

  if (omitted) return { ok: true, amountSats: stash.price_sats };

  if (typeof requested !== 'number' || !Number.isSafeInteger(requested)) {
    return { ok: false, error: 'amountSats must be a whole number of sats' };
  }
  if (requested < stash.price_sats) {
    return { ok: false, error: `The minimum for this stash is ${stash.price_sats} sats` };
  }
  if (maxSats !== null && requested > maxSats) {
    return { ok: false, error: `The most you can pay in one payment is ${maxSats} sats` };
  }

  return { ok: true, amountSats: requested };
}
