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
