import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LNURL_RESPONSE_BYTES, resolveAddress } from './lnaddress.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('resolveAddress response limits', () => {
  it('resolves a normal Lightning Address response', async () => {
    const urls: string[] = [];

    globalThis.fetch = (async (input) => {
      const url = String(input);
      urls.push(url);

      if (url === 'https://example.com/.well-known/lnurlp/alice') {
        return new Response(
          JSON.stringify({
            callback: 'https://pay.example.com/callback',
            minSendable: 1,
            maxSendable: 2000,
            tag: 'payRequest',
          })
        );
      }

      return new Response(JSON.stringify({ pr: 'lnbc1validinvoice' }));
    }) as typeof fetch;

    const invoice = await resolveAddress('alice@example.com', 1);

    assert.equal(invoice, 'lnbc1validinvoice');
    assert.deepEqual(urls, [
      'https://example.com/.well-known/lnurlp/alice',
      'https://pay.example.com/callback?amount=1000',
    ]);
  });

  it('rejects oversized Lightning Address metadata by content-length', async () => {
    globalThis.fetch = (async () => {
      return new Response('{}', {
        headers: { 'content-length': String(MAX_LNURL_RESPONSE_BYTES + 1) },
      });
    }) as typeof fetch;

    await assert.rejects(
      () => resolveAddress('alice@example.com', 1),
      /Response size exceeds limit/
    );
  });

  it('rejects oversized Lightning Address invoice responses while streaming', async () => {
    const urls: string[] = [];

    globalThis.fetch = (async (input) => {
      const url = String(input);
      urls.push(url);

      if (url === 'https://example.com/.well-known/lnurlp/alice') {
        return new Response(
          JSON.stringify({
            callback: 'https://pay.example.com/callback',
            minSendable: 1,
            maxSendable: 2000,
            tag: 'payRequest',
          })
        );
      }

      return new Response(JSON.stringify({ pr: `lnbc1${'x'.repeat(MAX_LNURL_RESPONSE_BYTES)}` }));
    }) as typeof fetch;

    await assert.rejects(
      () => resolveAddress('alice@example.com', 1),
      /Response size exceeds limit/
    );

    assert.deepEqual(urls, [
      'https://example.com/.well-known/lnurlp/alice',
      'https://pay.example.com/callback?amount=1000',
    ]);
  });
});
