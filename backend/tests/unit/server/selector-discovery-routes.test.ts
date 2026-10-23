import { describe, expect, it } from '@jest/globals';
import fastify from 'fastify';
import { setupSelectorDiscoveryRoutes } from '../../../src/server/routes/selector-discovery';

function createDiscoveryService(overrides: Partial<Record<string, any>> = {}) {
    return {
      create: async () => { throw new Error('not used'); },
      list: async () => [],
      get: async () => null,
      retry: async () => { throw new Error('not used'); },
      promote: async () => { throw new Error('not used'); },
      reject: async () => { throw new Error('not used'); },
      deleteJob: async () => false,
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

describe('Selector discovery routes', () => {
  SelectorDiscoveryRoutesTestGroup1();
});

function SelectorDiscoveryRoutesTestGroup1(): void {
  it('queues discovery through the canonical /api/selector-discovery endpoint', SelectorDiscoveryRoutesTestQueuesDiscoveryThroughTheCanonicalApiSelectorDiscoveryEndpoint);
  it('exposes and tests AO-generated TypeScript implementation drafts', SelectorDiscoveryRoutesTestExposesAndTestsAOGeneratedTypeScriptImplementationDrafts);
  it('clears a promoted job without deleting its adapter', SelectorDiscoveryRoutesTestClearsPromotedJobWithoutDeletingItsAdapter);
}

async function SelectorDiscoveryRoutesTestClearsPromotedJobWithoutDeletingItsAdapter() {
  const app = fastify();
  const deleted: string[] = [];
  setupSelectorDiscoveryRoutes(app, createDiscoveryService({
    get: async () => ({ id: 'disc-promoted', status: 'promoted' }),
    deleteJob: async (id: string) => { deleted.push(id); return true; },
  }), createSettingsStore());
  const response = await app.inject({ method: 'DELETE', url: '/api/selector-discovery/disc-promoted' });
  expect(response.statusCode).toBe(200);
  expect(response.json().data).toEqual({ id: 'disc-promoted', deleted: true, adapterPreserved: true });
  expect(deleted).toEqual(['disc-promoted']);
  await app.close();
}

async function SelectorDiscoveryRoutesTestQueuesDiscoveryThroughTheCanonicalApiSelectorDiscoveryEndpoint() {
    const app = fastify();
    const createCalls: any[] = [];
    setupSelectorDiscoveryRoutes(app, createDiscoveryService({
        create: createDiscoveryJob(createCalls),
    }), createSettingsStore(), undefined, { htmlRenderer: { render: async () => '<html></html>', dispose: async () => undefined } });
    const response = await queueDiscovery(app);
    expect(response.statusCode).toBe(202);
    expectQueuedDiscovery(createCalls, response.json().data);
    await app.close();
}

function queueDiscovery(app: ReturnType<typeof fastify>) {
  return app.inject({ method: 'POST', url: '/api/selector-discovery', payload: {
    url: 'https://example.com/manga/demo/chapter-1', target: 'chapter-only', forceDiscovery: true,
  } });
}

function expectQueuedDiscovery(createCalls: any[], data: unknown): void {
    expect(createCalls).toEqual([
        expect.objectContaining({
            url: 'https://example.com/manga/demo/chapter-1',
            target: 'chapter-only',
            forceDiscovery: true,
        }),
    ]);
    expect(data).toEqual(expect.objectContaining({
        id: 'disc-test',
        status: 'queued',
        target: 'chapter-only',
    }));
}

function createDiscoveryJob(calls: any[]) {
  return async (input: any) => {
    calls.push(input);
    return { id: 'disc-test', url: input.url, normalizedUrl: input.url,
      hostname: new URL(input.url).hostname, status: 'queued', target: input.target,
      createdAt: '2026-06-26T00:00:00.000Z', updatedAt: '2026-06-26T00:00:00.000Z' };
  };
}

const SELECTOR_DISCOVERY_ROUTES_EXPOSES_AND_S_AOGENERATED_TYPE_SCRIPT_IMPLEMENTATION_DRAFTS_1_SOURCE = `
import { AdapterBase } from '../../base';

export class GeneratedDemoAdapter extends AdapterBase {
  readonly id = 'generated-demo';
  readonly name = 'Generated Demo';
  readonly domains = ['example.com'];
  readonly parseMode = 'playwright' as const;
  override readonly capabilities = { verification: true, metadata: true, chapterImages: false };

  override matchUrl(url: string): boolean {
    return new URL(url).hostname === 'example.com';
  }

  override extractTitle(document: unknown): string {
    return this.asCheerio(document)('h1').first().text().trim();
  }
}
`;

async function SelectorDiscoveryRoutesTestExposesAndTestsAOGeneratedTypeScriptImplementationDrafts() {
    const app = fastify();
    const source = SELECTOR_DISCOVERY_ROUTES_EXPOSES_AND_S_AOGENERATED_TYPE_SCRIPT_IMPLEMENTATION_DRAFTS_1_SOURCE;
    setupSelectorDiscoveryRoutes(app, createDiscoveryService({
        get: async (id: string) => id === 'disc-draft' ? implementationJob(source) : null,
    }), createSettingsStore(), undefined, { htmlRenderer: { render: async () => '<html></html>', dispose: async () => undefined } });
    await expectImplementationEndpoint(app);
    await expectCapabilitiesEndpoint(app);
    await expectDraftFunctionEndpoint(app);
    await app.close();
}

function implementationJob(source: string) {
  const url = 'https://example.com/manga/manga_name';
  return { id: 'disc-draft', url, normalizedUrl: url, hostname: 'example.com',
    status: 'awaiting_review', target: 'full', createdAt: '2026-06-26T00:00:00.000Z',
    updatedAt: '2026-06-26T00:00:00.000Z', adapterImplementationTs: source,
    implementationValidation: { valid: true, errors: [], warnings: [], syntaxValid: true } };
}

async function expectImplementationEndpoint(app: ReturnType<typeof fastify>): Promise<void> {
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
}

async function expectCapabilitiesEndpoint(app: ReturnType<typeof fastify>): Promise<void> {
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
}

async function expectDraftFunctionEndpoint(app: ReturnType<typeof fastify>): Promise<void> {
    const test = await app.inject({
        method: 'POST',
        url: '/api/selector-discovery/disc-draft/functions/matchUrl/test',
        payload: { url: 'https://example.com/manga/manga_name' },
    });
    expect(test.statusCode).toBe(200);
    expect(test.json().data).toMatchObject({ ok: true,
      adapterId: 'selector-discovery:disc-draft', functionId: 'matchUrl',
      resultSummary: { matched: true, discoveryJobId: 'disc-draft',
        draftAdapterId: 'generated-demo' } });
}
