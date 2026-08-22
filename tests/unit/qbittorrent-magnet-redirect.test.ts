import { describe, expect, test, afterEach } from 'bun:test';
import { QBittorrentClient } from '../../src/server/integrations/qbittorrent/QBittorrentClient';
import { QBittorrentError } from '../../src/server/utils/errors';

const originalFetch = globalThis.fetch;
const PROXY_URL = 'http://prowlarr:9696/15/download?apikey=k&link=abc';
const MAGNET = 'magnet:?xt=urn:btih:B5D908DE3554374A74DE56903FAE6A27F04051FF&dn=Game';

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * An indexer proxy link commonly answers with a 30x to a magnet URI. Following that with
 * fetch() reports the magnet as an unreachable host, which surfaced to users as
 * "Unable to connect. Is the computer able to access the url?" against a healthy client,
 * so the redirect is followed by hand and the magnet handed to the client.
 *
 * The release URL is resolved here rather than passed straight to qBittorrent because
 * qBittorrent answers "Ok." to a URL add before it has fetched anything: an indexer that
 * answers 500 is then indistinguishable from a successful grab.
 */
describe('QBittorrentClient release URLs', () => {
  test('follows a redirect to a magnet and hands the magnet to qBittorrent', async () => {
    const bodies: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/login')) return new Response('Ok.', { status: 200 });
      if (url.includes('/torrents/add')) {
        bodies.push(String(init?.body));
        return new Response('Ok.', { status: 200 });
      }
      if (url.startsWith('http://prowlarr:9696')) {
        return new Response(null, { status: 301, headers: { location: MAGNET } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const client = new QBittorrentClient({ host: 'http://qbittorrent:5080', username: 'u', password: 'p' });
    await client.addTorrent(PROXY_URL, { category: 'gamearr' });

    expect(decodeURIComponent(bodies[0])).toContain('magnet:?xt=urn:btih:B5D908DE');
  });

  test('rejects an indexer error page rather than reporting a grab', async () => {
    const addBodies: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/login')) return new Response('Ok.', { status: 200 });
      if (url.includes('/torrents/add')) {
        addBodies.push(String(init?.body));
        return new Response('Ok.', { status: 200 });
      }
      if (url.startsWith('http://prowlarr:9696')) {
        return new Response('<error code="500" description="Download selectors didn\'t match" />', {
          status: 500,
          statusText: 'Internal Server Error',
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const client = new QBittorrentClient({ host: 'http://qbittorrent:5080', username: 'u', password: 'p' });

    await expect(client.addTorrent(PROXY_URL, { category: 'gamearr' })).rejects.toThrow(/500/);
    expect(addBodies).toHaveLength(0);
  });

  test('hands the URL to qBittorrent when this process cannot reach the indexer', async () => {
    const bodies: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/login')) return new Response('Ok.', { status: 200 });
      if (url.includes('/torrents/add')) {
        bodies.push(String(init?.body));
        return new Response('Ok.', { status: 200 });
      }
      if (url.startsWith('http://prowlarr:9696')) {
        throw new TypeError('Unable to connect');
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const client = new QBittorrentClient({ host: 'http://qbittorrent:5080', username: 'u', password: 'p' });
    await client.addTorrent(PROXY_URL, { category: 'gamearr' });

    expect(decodeURIComponent(bodies[0])).toContain(PROXY_URL);
  });

  test('tries the magnet fallback when the release URL is unusable', async () => {
    const bodies: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/auth/login')) return new Response('Ok.', { status: 200 });
      if (url.includes('/torrents/add')) {
        bodies.push(String(init?.body));
        return new Response('Ok.', { status: 200 });
      }
      if (url.startsWith('http://prowlarr:9696')) {
        return new Response('nope', { status: 404, statusText: 'Not Found' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const client = new QBittorrentClient({ host: 'http://qbittorrent:5080', username: 'u', password: 'p' });
    await client.addTorrent(PROXY_URL, { category: 'gamearr' }, MAGNET);

    expect(decodeURIComponent(bodies[0])).toContain('magnet:?xt=urn:btih:B5D908DE');
  });

  test('treats a torrent qBittorrent already holds as grabbed, not failed', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/login')) return new Response('Ok.', { status: 200 });
      if (url.includes('/torrents/add')) return new Response('Fails.', { status: 200 });
      if (url.includes('/torrents/info')) {
        return new Response(
          JSON.stringify([
            { hash: 'b5d908de3554374a74de56903fae6a27f04051ff', name: 'Game', added_on: 0, size: 1 },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const client = new QBittorrentClient({ host: 'http://qbittorrent:5080', username: 'u', password: 'p' });
    expect(await client.addTorrent(MAGNET, { category: 'gamearr' })).toBe('Ok.');
  });

  test('still fails when qBittorrent rejects a magnet it does not hold', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/auth/login')) return new Response('Ok.', { status: 200 });
      if (url.includes('/torrents/add')) return new Response('Fails.', { status: 200 });
      if (url.includes('/torrents/info')) {
        return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const client = new QBittorrentClient({ host: 'http://qbittorrent:5080', username: 'u', password: 'p' });
    await expect(client.addTorrent(MAGNET, { category: 'gamearr' })).rejects.toThrow(QBittorrentError);
  });
});
