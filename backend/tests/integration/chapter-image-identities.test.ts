import { afterEach, describe, expect, it, jest } from '@jest/globals';
import fastify from 'fastify';
import { AdapterRegistry } from '../../src/adapter/registry';
import { DynamicSiteAdapter } from '../../src/adapter/dynamic-site-adapter';
import { setupAdaptersRoutes } from '../../src/server/routes/adapters';

describe('Integration: Dynamic/Playwright chapter image identities', () => {
  const apps: Array<ReturnType<typeof fastify>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('preserves IDs across two rendered extractions with renewed URLs and reordered pages', async () => {
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
    let html = `
      <div class="reader">
        <img src="https://cdn-a.example/pages/1.jpg?token=first">
        <img src="https://cdn-a.example/pages/2.jpg?token=first">
      </div>`;
    const htmlRenderer = {
      render: jest.fn(async () => html),
      dispose: jest.fn(async () => undefined),
    };
    setupAdaptersRoutes(app, registry, { htmlRenderer });

    const firstResponse = await app.inject({
      method: 'POST',
      url: '/api/adapters/chapter-images',
      payload: { url: 'https://reader.example/chapter/1' },
    });
    expect(firstResponse.statusCode).toBe(200);
    const first = firstResponse.json().data;

    html = `
      <div class="reader">
        <img src="https://cdn-b.example/pages/2.jpg?token=renewed&expires=999">
        <img src="https://cdn-b.example/pages/1.jpg?token=renewed&expires=999">
      </div>`;
    const secondResponse = await app.inject({
      method: 'POST',
      url: '/api/adapters/chapter-images',
      payload: { url: 'https://reader.example/chapter/1' },
    });
    expect(secondResponse.statusCode).toBe(200);
    const second = secondResponse.json().data;

    expect(second.chapter.id).toBe(first.chapter.id);
    expect(second.images).toEqual([
      expect.objectContaining({ id: first.images[1].id, orderIndex: 0, url: 'https://cdn-b.example/pages/2.jpg?token=renewed&expires=999' }),
      expect.objectContaining({ id: first.images[0].id, orderIndex: 1, url: 'https://cdn-b.example/pages/1.jpg?token=renewed&expires=999' }),
    ]);
    expect(second.imageUrls).toEqual(second.images.map((image: { url: string }) => image.url));
  });
});
