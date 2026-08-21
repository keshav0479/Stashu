/**
 * Tests for Cashu mint network resilience.
 *
 * Run with: npm test --workspace=server
 */

if (!process.env.TOKEN_ENCRYPTION_KEY) {
  const { randomBytes } = await import('node:crypto');
  process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('hex');
}
process.env.DB_PATH = ':memory:';
process.env.CASHU_REQUEST_TIMEOUT_MS = '25';
process.env.MINT_URL = 'https://mint.test';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createNewMintKeys, getEncodedTokenV4, setGlobalRequestOptions } from '@cashu/cashu-ts';

describe('Cashu mint request timeout', () => {
  it('aborts a hanging mint request instead of waiting forever', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        const abort = () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        };

        if (signal?.aborted) {
          abort();
        } else {
          signal?.addEventListener('abort', abort, { once: true });
        }
      })) as typeof fetch;

    try {
      const { createPaymentInvoice } = await import('./cashu.js');
      const startedAt = Date.now();

      await assert.rejects(createPaymentInvoice(5), /timed out after 25ms/i);
      assert.ok(Date.now() - startedAt < 1_000, 'mint timeout should fail promptly');
    } finally {
      globalThis.fetch = originalFetch;
      setGlobalRequestOptions({});
    }
  });
});

describe('fee-aware token handling', () => {
  // Fake fee-charging mint: 1000 ppk = 1 sat of input fee per proof.
  // versionByte 0 gives a classic '00' keyset id, which round-trips through
  // v4 token encoding without needing known-keyset context.
  const pair = createNewMintKeys(7, undefined, { input_fee_ppk: 1000, versionByte: 0 });
  const keysHex = Object.fromEntries(
    Object.entries(pair.pubKeys).map(([amount, key]) => [amount, Buffer.from(key).toString('hex')])
  );
  // Order matters: '/v1/keysets' must be matched before its prefix '/v1/keys'
  const responses: Record<string, unknown> = {
    '/v1/keysets': {
      keysets: [{ id: pair.keysetId, unit: 'sat', active: true, input_fee_ppk: 1000 }],
    },
    '/v1/keys': { keysets: [{ id: pair.keysetId, unit: 'sat', keys: keysHex }] },
    '/v1/info': {
      name: 'test-mint',
      pubkey: keysHex['1'],
      version: 'test/1.0',
      nuts: {
        '4': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
        '5': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
      },
    },
  };

  // 102 sats across 4 power-of-two denominations, 4 sats of input fees, 98 receivable
  const proofFor = (amount: number, tag: string) => ({
    id: pair.keysetId,
    amount,
    secret: `fee-secret-${tag}`,
    C: '02' + 'a'.repeat(64),
  });
  const feeToken = () =>
    getEncodedTokenV4({
      mint: 'https://mint.test',
      proofs: [proofFor(64, '64'), proofFor(32, '32'), proofFor(4, '4'), proofFor(2, '2')],
    });

  function mockMint(requestedPaths: string[]) {
    return (async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedPaths.push(url);
      const path = Object.keys(responses).find((p) => url.includes(p));
      if (!path) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(responses[path]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
  }

  it('getTokenValuation deducts NUT-02 input fees from the receivable value', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockMint([]);
    try {
      const { getTokenValuation } = await import('./cashu.js');
      assert.deepEqual(await getTokenValuation(feeToken()), { valueSats: 102, receivableSats: 98 });
    } finally {
      globalThis.fetch = originalFetch;
      setGlobalRequestOptions({});
    }
  });

  it('verifyAndSwapToken rejects a post-fee amount mismatch without calling the mint swap', async () => {
    const requestedPaths: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockMint(requestedPaths);
    try {
      const { verifyAndSwapToken } = await import('./cashu.js');
      // Receivable 98 must fail against an expected 100 even though face value 102 covers it
      const result = await verifyAndSwapToken(feeToken(), 100);
      assert.equal(result.success, false);
      assert.match(result.error ?? '', /does not match the price/);
      assert.ok(
        !requestedPaths.some((p) => p.includes('/v1/swap')),
        'mint swap must never be attempted for a mismatched token'
      );
    } finally {
      globalThis.fetch = originalFetch;
      setGlobalRequestOptions({});
    }
  });
});

describe('v2 keyset handling (mint rotation)', () => {
  // A mint that rotated to a NUT-02 v2 keyset: 33-byte id, version byte 01.
  // Proofs reference it by the 8-byte short form, which must be mapped.
  const v2pair = createNewMintKeys(7, undefined, { input_fee_ppk: 0, versionByte: 1 });
  const v1pair = createNewMintKeys(7, undefined, { input_fee_ppk: 0, versionByte: 0 });
  const shortId = v2pair.keysetId.slice(0, 16);

  const keysHexOf = (pair: typeof v2pair) =>
    Object.fromEntries(
      Object.entries(pair.pubKeys).map(([amount, key]) => [
        amount,
        Buffer.from(key).toString('hex'),
      ])
    );

  const mintState = (pairs: (typeof v2pair)[]) => ({
    '/v1/melt/quote/bolt11': {
      quote: 'melt-quote-1',
      amount: 10_000,
      fee_reserve: 10,
      state: 'UNPAID',
      expiry: Math.floor(Date.now() / 1000) + 600,
    },
    '/v1/keysets': {
      keysets: pairs.map((p) => ({ id: p.keysetId, unit: 'sat', active: true, input_fee_ppk: 0 })),
    },
    '/v1/keys': {
      keysets: pairs.map((p) => ({ id: p.keysetId, unit: 'sat', keys: keysHexOf(p) })),
    },
    '/v1/info': {
      name: 'test-mint',
      pubkey: keysHexOf(v2pair)['1'],
      version: 'test/1.0',
      nuts: {
        '4': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
        '5': { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
      },
    },
  });

  const shortIdToken = () =>
    getEncodedTokenV4({
      mint: 'https://mint.test',
      proofs: [
        { id: shortId, amount: 4, secret: 'v2-secret-4', C: '02' + 'b'.repeat(64) },
        { id: shortId, amount: 2, secret: 'v2-secret-2', C: '02' + 'c'.repeat(64) },
      ],
    });

  function mutableMockMint(state: { responses: Record<string, unknown>; hits: string[] }) {
    return (async (input: RequestInfo | URL) => {
      const url = String(input);
      state.hits.push(url);
      const path = Object.keys(state.responses).find((p) => url.includes(p));
      if (!path) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(state.responses[path]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;
  }

  it('reloads the mint once when a short keyset id postdates the cached wallet', async () => {
    const state = {
      responses: mintState([v1pair]) as Record<string, unknown>,
      hits: [] as string[],
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mutableMockMint(state);
    try {
      const { getTokenValuation } = await import('./cashu.js');

      // Pin the cached wallet to a pre-rotation keyset list (v1 only)
      const v1Token = getEncodedTokenV4({
        mint: 'https://mint.test',
        proofs: [{ id: v1pair.keysetId, amount: 8, secret: 'v1-secret', C: '02' + 'd'.repeat(64) }],
      });
      assert.deepEqual(await getTokenValuation(v1Token), { valueSats: 8, receivableSats: 8 });

      // The mint rotates: v2 keyset appears. The cached wallet cannot know it.
      state.responses = mintState([v1pair, v2pair]) as Record<string, unknown>;
      state.hits.length = 0;

      const result = await getTokenValuation(shortIdToken());
      assert.deepEqual(result, { valueSats: 6, receivableSats: 6 });
      assert.ok(
        state.hits.some((u) => u.includes('/v1/keysets')),
        'the wallet must reload keysets to map the rotated short id'
      );

      // Cooldown: a different unmappable short id right after must NOT trigger
      // another reload, or a public token endpoint becomes a reload amplifier.
      state.hits.length = 0;
      const attackerToken = getEncodedTokenV4({
        mint: 'https://mint.test',
        proofs: [{ id: '01deadbeefdeadbe', amount: 1, secret: 'x', C: '02' + 'e'.repeat(64) }],
      });
      assert.equal(await getTokenValuation(attackerToken), null);
      assert.ok(
        !state.hits.some((u) => u.includes('/v1/keysets')),
        'a second unmappable id within the cooldown must not reload keysets'
      );
    } finally {
      globalThis.fetch = originalFetch;
      setGlobalRequestOptions({});
    }
  });

  it('meltWithRecovery decodes stored short-id tokens instead of failing on them', async () => {
    const state = {
      responses: mintState([v1pair, v2pair]) as Record<string, unknown>,
      hits: [] as string[],
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mutableMockMint(state);
    try {
      const { meltWithRecovery } = await import('./cashu.js');
      const result = await meltWithRecovery(
        [shortIdToken()],
        'lnbc-test-invoice',
        'seller-pubkey-test'
      );
      // 6 sats cannot cover a 10,010-sat quote: the point is that decoding
      // SUCCEEDED and we failed on balance, not on keyset mapping.
      assert.equal(result.success, false);
      assert.match(result.error ?? '', /insufficient balance/i);
      assert.doesNotMatch(result.error ?? '', /keyset/i);
    } finally {
      globalThis.fetch = originalFetch;
      setGlobalRequestOptions({});
    }
  });

  it('isQuoteAlreadyIssued recognises the mint 20002 terminal state only', async () => {
    const { isQuoteAlreadyIssued } = await import('./cashu.js');
    assert.equal(isQuoteAlreadyIssued(Object.assign(new Error('nope'), { code: 20002 })), true);
    assert.equal(isQuoteAlreadyIssued(new Error('Quote already issued')), true);
    assert.equal(isQuoteAlreadyIssued(new Error('network down')), false);
    assert.equal(isQuoteAlreadyIssued(Object.assign(new Error('x'), { code: 20001 })), false);
  });

  it('isStaleKeysetError reloads only the mappable case, not permanent id errors', async () => {
    const { isStaleKeysetError } = await import('./cashu.js');
    // Only this one can be fixed by reloading keysets
    assert.equal(
      isStaleKeysetError(new Error("Couldn't map short keyset ID 01ab to any known keysets")),
      true
    );
    // These are permanent properties of the token — reloading is pointless
    assert.equal(isStaleKeysetError(new Error('Short keyset ID 01ab is ambiguous.')), false);
    assert.equal(isStaleKeysetError(new Error('Unknown keyset ID version: 2')), false);
    assert.equal(isStaleKeysetError(new Error('network down')), false);
  });
});
