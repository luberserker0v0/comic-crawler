import { afterEach, describe, expect, it, jest } from '@jest/globals';
import fastify from 'fastify';
import { AdapterRegistry } from '../../src/adapter/registry';
import { DynamicSiteAdapter } from '../../src/adapter/dynamic-site-adapter';
import { setupAdaptersRoutes } from '../../src/server/routes/adapters';

const apps: Array<ReturnType<typeof fastify>> = [];

describe('Integration: Dynamic/Playwright chapter image identities', () => {
  IntegrationDynamicPlaywrightChapterImageIdentitiesTestGroup1();
});

function IntegrationDynamicPlaywrightChapterImageIdentitiesTestGroup1(): void {
  afterEach(IntegrationDynamicPlaywrightChapterImageIdentitiesTestScenario1);
  it('preserves IDs across two rendered extractions with renewed URLs and reordered pages', IntegrationDynamicPlaywrightChapterImageIdentitiesTestPreservesIDsAcrossTwoRenderedExtractionsWithRenewedURLsAndReorderedPages);
}

async function IntegrationDynamicPlaywrightChapterImageIdentitiesTestScenario1() {
    await Promise.all(apps.splice(0).map((app) => app.close()));
}

async function IntegrationDynamicPlaywrightChapterImageIdentitiesTestPreservesIDsAcrossTwoRenderedExtractionsWithRenewedURLsAndReorderedPages() {
    let html = readerHtml('cdn-a', 'first', ['1', '2']);
    const app = createIdentityApp(() => html);
    const first = await extractIdentities(app);
    html = readerHtml('cdn-b', 'renewed&expires=999', ['2', '1']);
    const second = await extractIdentities(app);
    expect(second.chapter.id).toBe(first.chapter.id);
    expectRenewedIdentities(first, second);
}

function createIdentityApp(render: () => string) {
  const app = fastify();
  apps.push(app);
  const registry = new AdapterRegistry();
  registry.register(new DynamicSiteAdapter({
        adapterId: 'dynamic-reader',
        name: 'Dynamic Reader',
        domains: ['reader.example'],
        urlPatterns: ['https://reader.example/chapter/*'],
        capabilities: { verification: false, metadata: false, chapterImages: true },
        selectors: { images: { item: '.reader img', srcAttr: 'src' } },
        sourceDiscoveryId: 'integration-fixture',
        promotedAt: '2026-10-19T00:00:00.000Z',
  }));
  setupAdaptersRoutes(app, registry, { htmlRenderer: {
    render: jest.fn(async () => render()), dispose: jest.fn(async () => undefined),
  } });
  return app;
}

function readerHtml(host: string, token: string, pages: string[]): string {
  const images = pages.map((page) => `<img src="https://${host}.example/pages/${page}.jpg?token=${token}">`);
  return `<div class="reader">${images.join('')}</div>`;
}

async function extractIdentities(app: ReturnType<typeof fastify>) {
  const response = await app.inject({ method: 'POST', url: '/api/adapters/chapter-images',
    payload: { url: 'https://reader.example/chapter/1' } });
  expect(response.statusCode).toBe(200);
  return response.json().data;
}

function expectRenewedIdentities(first: any, second: any): void {
    expect(second.images).toEqual([
        expect.objectContaining({ id: first.images[1].id, orderIndex: 0, url: 'https://cdn-b.example/pages/2.jpg?token=renewed&expires=999' }),
        expect.objectContaining({ id: first.images[0].id, orderIndex: 1, url: 'https://cdn-b.example/pages/1.jpg?token=renewed&expires=999' }),
    ]);
    expect(second.imageUrls).toEqual(second.images.map((image: {
        url: string;
    }) => image.url));
}
