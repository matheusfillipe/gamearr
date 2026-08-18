import { describe, expect, test, afterEach } from 'bun:test';
import { QBittorrentClient } from '../../src/server/integrations/qbittorrent/QBittorrentClient';

const originalFetch = globalThis.fetch;
const PROXY_URL = 'http://prowlarr:9696/15/download?apikey=k&link=abc';
const MAGNET = 'magnet:?xt=urn:btih:B5D908DE3554374A74DE56903FAE6A27F04051FF&dn=Game';

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * An indexer proxy link commonly answers with a 30x to a magnet URI. Following that with
 * fetch() reports the magnet as an unreachable host, which surfaced to users as
 * "Unable to connect. Is the computer able to access the url?" against a healthy client.
 */
describe('QBittorrentClient magnet redirects', () => {
  test('hands an HTTP release URL to qBittorrent rather than resolving it first', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      seen.push(url);
      if (url.includes('/auth/login')) return new Response('Ok.', { status: 200 });
      if (url.includes('/torrents/add')) {
        expect(String(init?.body)).toContain(encodeURIComponent(PROXY_URL).slice(0, 20));
        return new Response('Ok.', { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const client = new QBittorrentClient({ host: 'http://qbittorrent:5080', username: 'u', password: 'p' });
    await client.addTorrent(PROXY_URL, { category: 'gamearr' });

    // The proxy URL must never be fetched here; qBittorrent resolves it.
    expect(seen.some((u) => u.startsWith('http://prowlarr:9696'))).toBe(false);
  });

  test('falls back to the magnet when qBittorrent cannot fetch the URL itself', async () => {
    let addCalls = 0;
    const bodies: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/login')) return new Response('Ok.', { status: 200 });
      if (url.includes('/torrents/add')) {
        addCalls++;
        const body = String(init?.body);
        bodies.push(body);
        // First attempt: qBittorrent refuses the proxy URL it cannot reach.
        if (addCalls === 1) return new Response('Fails.', { status: 200 });
        return new Response('Ok.', { status: 200 });
      }
      // The server-side fallback then sees the redirect to a magnet.
      if (url.startsWith('http://prowlarr:9696')) {
        return new Response(null, { status: 301, headers: { location: MAGNET } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const client = new QBittorrentClient({ host: 'http://qbittorrent:5080', username: 'u', password: 'p' });
    await client.addTorrent(PROXY_URL, { category: 'gamearr' });

    expect(addCalls).toBe(2);
    expect(decodeURIComponent(bodies[1])).toContain('magnet:?xt=urn:btih:B5D908DE');
  });
});
