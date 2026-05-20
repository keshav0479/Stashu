import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { MAX_REQUEST_BODY_BYTES, requestBodyLimit } from './requestBodyLimit.js';

const app = new Hono();

app.use('*', requestBodyLimit);
app.post('/echo-size', async (c) => {
  const body = await c.req.text();
  return c.json({ size: body.length });
});

describe('request body limit middleware', () => {
  it('allows normal API-sized request bodies', async () => {
    const res = await app.request('/echo-size', {
      method: 'POST',
      body: 'ok',
    });

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { size: 2 });
  });

  it('rejects request bodies over 1MB', async () => {
    const res = await app.request('/echo-size', {
      method: 'POST',
      body: 'x'.repeat(MAX_REQUEST_BODY_BYTES + 1),
    });

    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { success: false, error: 'Payload too large' });
  });
});
