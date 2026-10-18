import { afterEach, describe, expect, it } from '@jest/globals';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { listSelectorDiscoveryAoProvidersByUrl } from '../../../src/selector-discovery/preflight';

describe('listSelectorDiscoveryAoProvidersByUrl', () => {
  let server: Server | undefined;
  const seen: string[] = [];

  afterEach(async () => {
    seen.length = 0;
    if (!server) return;
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  });

  it('lists AO providers from a bare URL without saved settings or bundle upload', async () => {
    const baseUrl = await startFakeAoServer(async (request) => {
      seen.push(`${request.method} ${request.url}`);
      if (request.method === 'POST' && request.url === '/api/conversations') {
        return { status: 200, body: { id: 'conv-url-only' } };
      }
      if (request.url === '/api/conversations/conv-url-only/start') {
        return { status: 200, body: { id: 'conv-url-only', ready: true, sessionId: 'session-1' } };
      }
      if (request.url === '/api/conversations/conv-url-only') {
        return { status: 200, body: { id: 'conv-url-only', ready: true, sessionId: 'session-1' } };
      }
      if (request.url === '/api/conversations/conv-url-only/providers') {
        return {
          status: 200,
          body: {
            providers: [
              {
                id: 'demo-provider',
                models: {
                  'demo-model': { id: 'demo-model', name: 'Demo Model', status: 'active' },
                },
              },
            ],
          },
        };
      }
      if (request.method === 'DELETE' && request.url === '/api/conversations/conv-url-only') {
        return { status: 200, body: {} };
      }
      return { status: 404, body: { error: 'not found' } };
    });

    const result = await listSelectorDiscoveryAoProvidersByUrl({ aoBaseUrl: baseUrl });

    expect(result.models).toEqual([
      expect.objectContaining({ id: 'demo-provider/demo-model', providerId: 'demo-provider' }),
    ]);
    expect(result.providers).toEqual([
      expect.objectContaining({ id: 'demo-provider', modelCount: 1 }),
    ]);
    // No bundle upload and no session/message calls on the URL-only path.
    expect(seen.some((entry) => entry.includes('/config') || entry.includes('/skills/') || entry.includes('/message'))).toBe(false);
    expect(seen).toContain('DELETE /api/conversations/conv-url-only');
  });

  it('requires an AO URL', async () => {
    await expect(listSelectorDiscoveryAoProvidersByUrl({ aoBaseUrl: '   ' })).rejects.toThrow(/AO URL is required/);
  });

  async function startFakeAoServer(
    handler: (request: IncomingMessage, body: string) => Promise<{ status: number; body: unknown }>
  ): Promise<string> {
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk.toString();
      });
      request.on('end', async () => {
        const result = await handler(request, body);
        response.statusCode = result.status;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify(result.body));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address() as AddressInfo;
    return `http://127.0.0.1:${address.port}`;
  }
});
