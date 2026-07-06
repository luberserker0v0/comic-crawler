import { describe, expect, it } from '@jest/globals';
import fastify from 'fastify';
import { setupSelectorDiscoveryRoutes } from '../../../src/server/routes/selector-discovery';

describe('Selector discovery routes', () => {
  it('queues discovery through the canonical /api/selector-discovery endpoint', async () => {
    const app = fastify();
    const createCalls: any[] = [];

    setupSelectorDiscoveryRoutes(
      app,
      {
        create: async (input: any) => {
          createCalls.push(input);
          return {
            id: 'disc-test',
            url: input.url,
            normalizedUrl: input.url,
            hostname: new URL(input.url).hostname,
            status: 'queued',
            target: input.target,
            createdAt: '2026-06-26T00:00:00.000Z',
            updatedAt: '2026-06-26T00:00:00.000Z',
          };
        },
        list: async () => [],
        get: async () => null,
        retry: async () => { throw new Error('not used'); },
        revalidate: async () => { throw new Error('not used'); },
        validateCandidate: async () => { throw new Error('not used'); },
        promote: async () => { throw new Error('not used'); },
        shadowPromote: async () => { throw new Error('not used'); },
        reject: async () => { throw new Error('not used'); },
      } as any,
      {
        getSummary: async () => ({ configured: false, providerIds: [], modelIds: [] }),
        save: async () => ({ configured: false, providerIds: [], modelIds: [] }),
        getRequired: async () => { throw new Error('not used'); },
        clearProvider: async () => ({ configured: false, providerIds: [], modelIds: [] }),
      } as any
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/selector-discovery',
      payload: {
        url: 'https://example.com/manga/demo/chapter-1',
        target: 'chapter-only',
        forceDiscovery: true,
      },
    });

    expect(response.statusCode).toBe(202);
    expect(createCalls).toEqual([
      expect.objectContaining({
        url: 'https://example.com/manga/demo/chapter-1',
        target: 'chapter-only',
        forceDiscovery: true,
      }),
    ]);
    expect(response.json().data).toEqual(expect.objectContaining({
      id: 'disc-test',
      status: 'queued',
      target: 'chapter-only',
    }));

    await app.close();
  });

  it('keeps /api/site-discovery as a backwards-compatible alias', async () => {
    const app = fastify();
    let called = false;

    setupSelectorDiscoveryRoutes(
      app,
      {
        create: async (input: any) => {
          called = true;
          return {
            id: 'disc-alias',
            url: input.url,
            normalizedUrl: input.url,
            hostname: new URL(input.url).hostname,
            status: 'queued',
            target: input.target,
            createdAt: '2026-06-26T00:00:00.000Z',
            updatedAt: '2026-06-26T00:00:00.000Z',
          };
        },
        list: async () => [],
        get: async () => null,
        retry: async () => { throw new Error('not used'); },
        revalidate: async () => { throw new Error('not used'); },
        validateCandidate: async () => { throw new Error('not used'); },
        promote: async () => { throw new Error('not used'); },
        shadowPromote: async () => { throw new Error('not used'); },
        reject: async () => { throw new Error('not used'); },
      } as any,
      {
        getSummary: async () => ({ configured: false, providerIds: [], modelIds: [] }),
        save: async () => ({ configured: false, providerIds: [], modelIds: [] }),
        getRequired: async () => { throw new Error('not used'); },
        clearProvider: async () => ({ configured: false, providerIds: [], modelIds: [] }),
      } as any
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/site-discovery',
      payload: { url: 'https://example.com/manga/demo', forceDiscovery: true },
    });

    expect(response.statusCode).toBe(202);
    expect(called).toBe(true);

    await app.close();
  });
});
