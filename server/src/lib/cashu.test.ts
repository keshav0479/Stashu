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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setGlobalRequestOptions } from '@cashu/cashu-ts';

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
