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
  makeDeleteEvent(url: string, hash: string) {
    return {
      kind: 24242,
      created_at: 1,
      tags: [
        ['t', 'delete'],
        ['x', hash],
      ],
      content: `Delete ${url}`,
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
  createBlossomDeleteAuthEvent: vi.fn((url: string, hash: string) =>
    blossomFixtures.makeDeleteEvent(url, hash)
  ),
}));

import {
  deleteFromBlossom,
  deleteStashFile,
  fetchFromBlossomWithFallback,
  mirrorToBlossom,
  uploadToBlossom,
  uploadWithFailover,
} from './blossom.js';

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

    const result = await uploadToBlossom(data, 'https://blossom.example.com');

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

    // Uploads always declare octet-stream — the bytes are ciphertext (issue #34)
    expect(headers['Content-Type']).toBe('application/octet-stream');
    expect(headers['X-SHA-256']).toBe(sha256(data));
    expect(token).toBe(expectedToken);
    expect(token).toMatch(/^[A-Za-z0-9\-_]+$/);
    expect(token).not.toContain('=');
  });

  it('retries with legacy standard base64 auth when a server rejects base64url', async () => {
    const data = new TextEncoder().encode('legacy server upload');
    const fetchMock = vi
      .fn()
      // Browsers throw (opaque CORS failure) instead of exposing the 400
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: 'https://blossom.example.com/blob' }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await uploadToBlossom(data, 'https://blossom.example.com');

    expect(result.sha256).toBe(sha256(data));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const eventJson = JSON.stringify(
      blossomFixtures.makeUploadEvent('https://blossom.example.com/upload', sha256(data))
    );
    const firstAuth = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    const secondAuth = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<
      string,
      string
    >;
    expect(firstAuth.Authorization).toBe(`Nostr ${toBase64Url(eventJson)}`);
    expect(secondAuth.Authorization).toBe(`Nostr ${btoa(eventJson)}`);
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
      fetchFromBlossomWithFallback(`https://blossom.example.com/${expectedHash}`, expectedHash)
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
      fetchFromBlossomWithFallback(`https://blossom.example.com/${expectedHash}`, expectedHash, 4)
    ).rejects.toThrow(/allowed size/i);
  });

  it('fails over to the next preset server when the selected server rejects uploads', async () => {
    const data = new TextEncoder().encode('failover upload');
    const fetchMock = vi.fn((url: RequestInfo | URL) =>
      String(url).startsWith('https://blossom.primal.net')
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve({ ok: true, json: async () => ({}) })
    );
    vi.stubGlobal('fetch', fetchMock);

    // A stale saved selection (e.g. primal) must not strand the seller
    const { result, server } = await uploadWithFailover(data, 'https://blossom.primal.net');

    expect(server).toBe('https://blossom.ditto.pub');
    expect(result.sha256).toBe(sha256(data));
    // Both auth encodings are tried on the dead server before moving on
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      'https://blossom.primal.net/upload',
      'https://blossom.primal.net/upload',
      'https://blossom.ditto.pub/upload',
    ]);
  });

  it('falls back to legacy servers for downloads of older replicas', async () => {
    const data = new TextEncoder().encode('legacy replica');
    const hash = sha256(data);
    const fetchMock = vi.fn((url: RequestInfo | URL) =>
      String(url) === `https://blossom.primal.net/${hash}`
        ? Promise.resolve({ ok: true, arrayBuffer: async () => data.buffer })
        : Promise.reject(new TypeError('Failed to fetch'))
    );
    vi.stubGlobal('fetch', fetchMock);

    const blob = await fetchFromBlossomWithFallback(`https://dead.example.com/${hash}`, hash);

    expect(blob).toEqual(data);
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      `https://dead.example.com/${hash}`,
      `https://blossom.ditto.pub/${hash}`,
      `https://blossom.data.haus/${hash}`,
      `https://blossom.primal.net/${hash}`,
    ]);
  });

  it('deletes with a Base64url token scoped to the blob (BUD-12)', async () => {
    const hash = 'd'.repeat(64);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    const result = await deleteFromBlossom(hash, 'https://blossom.example.com');

    expect(result).toBe('deleted');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe(`https://blossom.example.com/${hash}`);
    expect(init.method).toBe('DELETE');
    expect(headers.Authorization).toBe(
      `Nostr ${toBase64Url(
        JSON.stringify(blossomFixtures.makeDeleteEvent(`https://blossom.example.com/${hash}`, hash))
      )}`
    );
  });

  it('reports a missing blob and a refusing server without throwing', async () => {
    const hash = 'd'.repeat(64);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    expect(await deleteFromBlossom(hash, 'https://blossom.example.com')).toBe('not-found');

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    expect(await deleteFromBlossom(hash, 'https://blossom.example.com')).toBe('failed');

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await deleteFromBlossom(hash, 'https://blossom.example.com')).toBe('failed');
  });

  it('deletes a stash file from its own server, every mirror and the legacy servers', async () => {
    const hash = 'd'.repeat(64);
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      const target = String(url);
      // primal answers 404 without CORS headers, which a browser sees as this
      if (target.startsWith('https://blossom.primal.net')) {
        return Promise.reject(new TypeError('Failed to fetch'));
      }
      return Promise.resolve(
        target.startsWith('https://blossom.data.haus')
          ? { ok: false, status: 503 }
          : { ok: true, status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const { failedHosts } = await deleteStashFile(`https://self-hosted.example.com/${hash}`, hash);

    expect(new Set(fetchMock.mock.calls.map((call) => String(call[0])))).toEqual(
      new Set([
        `https://self-hosted.example.com/${hash}`,
        `https://blossom.ditto.pub/${hash}`,
        `https://blossom.data.haus/${hash}`,
        `https://blossom.primal.net/${hash}`,
      ])
    );
    // A refusing mirror is reported; a legacy server is asked but never is.
    expect(failedHosts).toEqual(['blossom.data.haus']);
  });

  it('reports a legacy server that was the one the file was uploaded to', async () => {
    const hash = 'd'.repeat(64);
    vi.stubGlobal(
      'fetch',
      vi.fn((url: RequestInfo | URL) =>
        String(url).startsWith('https://blossom.primal.net')
          ? Promise.reject(new TypeError('Failed to fetch'))
          : Promise.resolve({ ok: true, status: 200 })
      )
    );

    const { failedHosts } = await deleteStashFile(`https://blossom.primal.net/${hash}`, hash);

    expect(failedHosts).toEqual(['blossom.primal.net']);
  });

  it('reads the hash from the blob URL for stashes that never stored one', async () => {
    const hash = 'd'.repeat(64);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    await deleteStashFile(`https://blossom.ditto.pub/${hash}.bin`, undefined);

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContain(
      `https://blossom.ditto.pub/${hash}`
    );
  });
});
