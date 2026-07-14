import { describe, expect, it } from '@jest/globals';
import fastify from 'fastify';
import { setupSelectorDiscoveryRoutes } from '../../../src/server/routes/selector-discovery';

describe('Selector discovery routes', () => {
  function createDiscoveryService(overrides: Partial<Record<string, any>> = {}) {
    return {
      create: async () => { throw new Error('not used'); },
      list: async () => [],
      get: async () => null,
      retry: async () => { throw new Error('not used'); },
      revalidate: async () => { throw new Error('not used'); },
      validateCandidate: async () => { throw new Error('not used'); },
      promote: async () => { throw new Error('not used'); },
      shadowPromote: async () => { throw new Error('not used'); },
      reject: async () => { throw new Error('not used'); },
      ...overrides,
    } as any;
  }

  function createSettingsStore() {
    return {
      getSummary: async () => ({ configured: false, providerIds: [], modelIds: [] }),
      save: async () => ({ configured: false, providerIds: [], modelIds: [] }),
      getRequired: async () => { throw new Error('not used'); },
      clearProvider: async () => ({ configured: false, providerIds: [], modelIds: [] }),
    } as any;
  }

  it('queues discovery through the canonical /api/selector-discovery endpoint', async () => {
    const app = fastify();
    const createCalls: any[] = [];

    setupSelectorDiscoveryRoutes(
      app,
      createDiscoveryService({
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
      }),
      createSettingsStore()
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
      createDiscoveryService({
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
      }),
      createSettingsStore()
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

  it('exposes and tests AO-generated TypeScript implementation drafts', async () => {
    const app = fastify();
    const source = `
import { AdapterBase } from '../../base';

export class GeneratedDemoAdapter extends AdapterBase {
  readonly id = 'generated-demo';
  readonly name = 'Generated Demo';
  readonly domains = ['example.com'];
  readonly parseMode = 'static' as const;
  override readonly capabilities = { verification: true, metadata: true, chapterImages: false };

  override matchUrl(url: string): boolean {
    return new URL(url).hostname === 'example.com';
  }

  override extractTitle(document: unknown): string {
    return this.asCheerio(document)('h1').first().text().trim();
  }
}
`;

    setupSelectorDiscoveryRoutes(
      app,
      createDiscoveryService({
        get: async (id: string) => id === 'disc-draft'
          ? {
              id,
              url: 'https://example.com/manga/manga_name',
              normalizedUrl: 'https://example.com/manga/manga_name',
              hostname: 'example.com',
              status: 'awaiting_review',
              target: 'full',
              createdAt: '2026-06-26T00:00:00.000Z',
              updatedAt: '2026-06-26T00:00:00.000Z',
              adapterImplementationTs: source,
              implementationValidation: { valid: true, errors: [], warnings: [], syntaxValid: true },
            }
          : null,
      }),
      createSettingsStore()
    );

    const implementation = await app.inject({
      method: 'GET',
      url: '/api/selector-discovery/disc-draft/implementation',
    });
    expect(implementation.statusCode).toBe(200);
    expect(implementation.json().data).toMatchObject({
      adapterId: 'selector-discovery:disc-draft',
      sourceType: 'generated-draft',
      language: 'typescript',
    });
    expect(implementation.json().data.outline).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'GeneratedDemoAdapter', kind: 'class' }),
      expect.objectContaining({ id: 'matchUrl', kind: 'method', capability: 'common' }),
      expect.objectContaining({ id: 'extractTitle', kind: 'method', capability: 'metadata' }),
    ]));

    const capabilities = await app.inject({
      method: 'GET',
      url: '/api/selector-discovery/disc-draft/capabilities',
    });
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json().data.adapter).toMatchObject({
      id: 'generated-demo',
      capabilities: { verification: true, metadata: true, chapterImages: false },
    });
    expect(capabilities.json().data.functions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'matchUrl', implemented: true }),
      expect.objectContaining({ id: 'extractTitle', implemented: true }),
    ]));

    const test = await app.inject({
      method: 'POST',
      url: '/api/selector-discovery/disc-draft/functions/matchUrl/test',
      payload: { url: 'https://example.com/manga/manga_name' },
    });
    expect(test.statusCode).toBe(200);
    expect(test.json().data).toMatchObject({
      ok: true,
      adapterId: 'selector-discovery:disc-draft',
      functionId: 'matchUrl',
      resultSummary: {
        matched: true,
        discoveryJobId: 'disc-draft',
        draftAdapterId: 'generated-demo',
      },
    });

    await app.close();
  });
});
