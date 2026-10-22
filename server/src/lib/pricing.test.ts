/**
 * Tests for the payment amount rule shared by the Lightning and Cashu paths.
 *
 * Run with: npm test --workspace=server
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePaymentAmount, type PricedStash } from './pricing.js';

const FIXED: PricedStash = { price_sats: 1_000, pay_what_you_want: 0 };
const PWYW: PricedStash = { price_sats: 1_000, pay_what_you_want: 1 };
const MINT_MAX = 1_000_000;

describe('resolvePaymentAmount — fixed price', () => {
  it('charges the price when no amount is sent', () => {
    // Every client from before pay-what-you-want sends no amount.
    assert.deepEqual(resolvePaymentAmount(FIXED, undefined, null), {
      ok: true,
      amountSats: 1_000,
    });
    assert.deepEqual(resolvePaymentAmount(FIXED, null, null), { ok: true, amountSats: 1_000 });
  });

  it('accepts the price echoed back', () => {
    assert.deepEqual(resolvePaymentAmount(FIXED, 1_000, null), { ok: true, amountSats: 1_000 });
  });

  it('refuses any other amount, more or less', () => {
    for (const requested of [999, 1_001, 5_000]) {
      const result = resolvePaymentAmount(FIXED, requested, MINT_MAX);
      assert.equal(result.ok, false, `accepted ${requested}`);
      assert.match(!result.ok ? result.error : '', /fixed price of 1000 sats/);
    }
  });
});

describe('resolvePaymentAmount — pay what you want', () => {
  it('defaults to the minimum when no amount is sent', () => {
    assert.deepEqual(resolvePaymentAmount(PWYW, undefined, MINT_MAX), {
      ok: true,
      amountSats: 1_000,
    });
  });

  it('accepts the minimum, anything above it, and the mint maximum', () => {
    for (const requested of [1_000, 1_001, 5_000, MINT_MAX]) {
      assert.deepEqual(resolvePaymentAmount(PWYW, requested, MINT_MAX), {
        ok: true,
        amountSats: requested,
      });
    }
  });

  it('refuses less than the minimum', () => {
    for (const requested of [999, 1, 0, -5_000]) {
      const result = resolvePaymentAmount(PWYW, requested, MINT_MAX);
      assert.equal(result.ok, false, `accepted ${requested}`);
      assert.match(!result.ok ? result.error : '', /minimum for this stash is 1000 sats/);
    }
  });

  it('refuses more than the mint will issue in one payment', () => {
    const result = resolvePaymentAmount(PWYW, MINT_MAX + 1, MINT_MAX);
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.error : '', /at most|most you can pay/i);
  });

  it('has no ceiling when the mint does not advertise one', () => {
    assert.deepEqual(resolvePaymentAmount(PWYW, 50_000_000, null), {
      ok: true,
      amountSats: 50_000_000,
    });
  });

  it('refuses anything that is not a whole number of sats', () => {
    // Strings and fractions must not be coerced: '2000' + 1 would be '20001'.
    for (const requested of [
      '2000',
      1_500.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 2,
      true,
      [2000],
    ]) {
      const result = resolvePaymentAmount(PWYW, requested, null);
      assert.equal(result.ok, false, `accepted ${String(requested)}`);
      assert.match(!result.ok ? result.error : '', /whole number/);
    }
  });
});
