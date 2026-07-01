import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from './crypto.js';

const blossomFixtures = vi.hoisted(() => ({
  makeUploadEvent(url: string, hash: string) {
    return {
      kind: 24242,
      created_at: 1,
      tags: [
        ['t', 'upload'],
        ['x', hash],
      ],
      content: `Upload to ${url}`,
    };
  },
  makeMirrorEvent(url: string, hash: string) {
    return {
      kind: 24242,
      created_at: 1,
      tags: [
        ['t', 'upload'],
        ['x', hash],
      ],
      content: `Mirror to ${url}`,
    };
  },
}));

function toBase64Url(value: string): string {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

vi.mock('./nostr.js', () => ({
  createBlossomAuthEvent: vi.fn((url: string, hash: string) =>
    blossomFixtures.makeUploadEvent(url, hash)
  ),
  createBlossomMirrorAuthEvent: vi.fn((url: string, hash: string) =>
    blossomFixtures.makeMirrorEvent(url, hash)
  ),
}));

import { fetchFromBlossomWithFallback, mirrorToBlossom, uploadToBlossom } from './blossom.js';

describe('Blossom protocol client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads with Base64url auth and X-SHA-256 header', async () => {
    const data = new TextEncoder().encode('hello blossom');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://blossom.example.com/blob' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToBlossom(data, 'text/plain', 'https://blossom.example.com');

    expect(result.sha256).toBe(sha256(data));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const token = headers.Authorization.slice('Nostr '.length);
    const expectedToken = toBase64Url(
      JSON.stringify(
        blossomFixtures.makeUploadEvent('https://blossom.example.com/upload', sha256(data))
      )
    );

    expect(headers['Content-Type']).toBe('text/plain');
    expect(headers['X-SHA-256']).toBe(sha256(data));
    expect(token).toBe(expectedToken);
    expect(token).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(token).not.toContain('=');
  });

  it('mirrors with Base64url auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const ok = await mirrorToBlossom(
      'c'.repeat(64),
      'https://source.example.com/ciphertext',
      'https://mirror.example.com'
    );

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const token = headers.Authorization.slice('Nostr '.length);
    const expectedToken = toBase64Url(
      JSON.stringify(
        blossomFixtures.makeMirrorEvent('https://mirror.example.com/mirror', 'c'.repeat(64))
      )
    );

    expect(headers['Content-Type']).toBe('application/json');
    expect(token).toBe(expectedToken);
    expect(token).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(token).not.toContain('=');
    expect(init.body).toBe(JSON.stringify({ url: 'https://source.example.com/ciphertext' }));
  });

  it('rejects downloaded bytes that do not match the Blossom hash', async () => {
    const expectedHash = sha256(new TextEncoder().encode('expected'));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode('swapped').buffer,
      })
    );

    await expect(
      fetchFromBlossomWithFallback(`https://blossom.primal.net/${expectedHash}`, expectedHash)
    ).rejects.toThrow(/hash did not match/i);
  });

  it('rejects oversized downloads before using them as sealed packages', async () => {
    const data = new TextEncoder().encode('too large');
    const expectedHash = sha256(data);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: async () => data.buffer,
      })
    );

    await expect(
      fetchFromBlossomWithFallback(`https://blossom.primal.net/${expectedHash}`, expectedHash, 4)
    ).rejects.toThrow(/allowed size/i);
  });
});
