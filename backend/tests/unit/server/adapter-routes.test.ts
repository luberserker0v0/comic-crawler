import { describe, expect, it } from '@jest/globals';
import fastify from 'fastify';
import { AdapterRegistry } from '../../../src/adapter/registry';
import { HappyMhAdapter } from '../../../src/adapter/sites/happymh';
import { DynamicSiteAdapter } from '../../../src/adapter/dynamic-site-adapter';
import { setupAdaptersRoutes } from '../../../src/server/routes/adapters';

describe('Adapter routes', () => {
  it('resolves HappyMH as a full adapter for manga catalog URLs', async () => {
    const app = fastify();
    const registry = new AdapterRegistry();
    registry.register(new HappyMhAdapter());
    setupAdaptersRoutes(app, registry);

    const response = await app.inject({
      method: 'POST',
      url: '/api/adapters/resolve',
      payload: {
        url: 'https://m.happymh.com/manga/wozaixingjiguojiadangedelingzhu',
        mode: 'all',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      status: 'matched',
      discoveryTarget: 'full',
      adapter: {
        id: 'happymh',
        capabilities: { verification: true, metadata: true, chapterImages: true },
      },
    });

    await app.close();
  });

  it('resolves HappyMH for specific chapter URLs', async () => {
    const app = fastify();
    const registry = new AdapterRegistry();
    registry.register(new HappyMhAdapter());
    setupAdaptersRoutes(app, registry);

    const response = await app.inject({
      method: 'POST',
      url: '/api/adapters/resolve',
      payload: {
        url: 'https://m.happymh.com/mangaread/wozaixingjiguojiadangedelingzhu/3279871',
        mode: 'chapters',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.status).toBe('matched');
    expect(response.json().data.adapter.id).toBe('happymh');

    await app.close();
  });

  it('lists adapter function descriptors by capability', async () => {
    const app = fastify();
    const registry = new AdapterRegistry();
    registry.register(new DynamicSiteAdapter({
      adapterId: 'chapter-only',
      name: 'Chapter Only',
      domains: ['example.com'],
      urlPatterns: ['https://example.com/read/*'],
      capabilities: { verification: true, metadata: false, chapterImages: true },
      selectors: { images: { item: '.reader img', srcAttr: 'src' } },
      sourceDiscoveryId: 'disc-1',
      promotedAt: '2026-07-09T00:00:00.000Z',
    }));
    setupAdaptersRoutes(app, registry);

    const response = await app.inject({ method: 'GET', url: '/api/adapters/chapter-only/capabilities' });

    expect(response.statusCode).toBe(200);
    const functions = response.json().data.functions as Array<{ id: string; implemented: boolean }>;
    expect(functions.some((item) => item.id === 'fetchMetadata')).toBe(false);
    expect(functions.some((item) => item.id === 'fetchChapterImages')).toBe(false);
    expect(functions.find((item) => item.id === 'extractTitle')?.implemented).toBe(false);
    expect(functions.find((item) => item.id === 'extractChapterImageUrls')?.implemented).toBe(true);

    await app.close();
  });

  it('returns allowlisted built-in source snippets', async () => {
    const app = fastify();
    const registry = new AdapterRegistry();
    registry.register(new HappyMhAdapter());
    setupAdaptersRoutes(app, registry);

    const response = await app.inject({ method: 'GET', url: '/api/adapters/happymh/functions/extractTitle/source' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      adapterId: 'happymh',
      functionId: 'extractTitle',
      language: 'typescript',
      sourceKind: 'builtin-source',
    });
    expect(response.json().data.source).toContain('extractTitle');

    await app.close();
  });

  it('returns dynamic selector manifest source without reading arbitrary files', async () => {
    const app = fastify();
    const registry = new AdapterRegistry();
    registry.register(new DynamicSiteAdapter({
      adapterId: 'dynamic-demo',
      name: 'Dynamic Demo',
      domains: ['example.com'],
      urlPatterns: ['https://example.com/read/*'],
      capabilities: { verification: true, metadata: false, chapterImages: true },
      selectors: { images: { item: '.reader img', srcAttr: 'src' } },
      sourceDiscoveryId: 'disc-1',
      promotedAt: '2026-07-09T00:00:00.000Z',
    }));
    setupAdaptersRoutes(app, registry);

    const response = await app.inject({ method: 'GET', url: '/api/adapters/dynamic-demo/functions/extractChapterImageUrls/source' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      sourceKind: 'dynamic-manifest',
      language: 'json',
    });
    expect(response.json().data.source).toContain('"selectors"');

    await app.close();
  });

  it('tests metadata and chapter image functions with structured summaries', async () => {
    const app = fastify();
    const registry = new AdapterRegistry();
    const adapter = new DynamicSiteAdapter({
      adapterId: 'dynamic-full',
      name: 'Dynamic Full',
      domains: ['example.com'],
      urlPatterns: ['https://example.com/*'],
      capabilities: { verification: true, metadata: true, chapterImages: true },
      selectors: {
        metadata: { title: 'h1', author: '', cover: '', status: '', tags: '' },
        chapters: { list: '.chapters', item: 'a', title: 'a', url: 'a' },
        images: { item: '.reader img', srcAttr: 'src' },
      },
      sourceDiscoveryId: 'disc-1',
      promotedAt: '2026-07-09T00:00:00.000Z',
    });
    jest.spyOn(adapter as any, 'fetchHtml').mockImplementation(async (url: unknown) => {
      const value = String(url);
      if (value.includes('/manga/')) {
        return '<h1>Demo Title</h1><div class="chapters"><a href="/read/1">Chapter 1</a></div>';
      }
      return '<div class="reader"><img src="/images/1.jpg"><img src="/images/2.jpg"></div>';
    });
    registry.register(adapter);
    setupAdaptersRoutes(app, registry);

    const metadata = await app.inject({
      method: 'POST',
      url: '/api/adapters/dynamic-full/functions/extractTitle/test',
      payload: { url: 'https://example.com/manga/demo' },
    });
    const images = await app.inject({
      method: 'POST',
      url: '/api/adapters/dynamic-full/functions/extractChapterImageUrls/test',
      payload: { url: 'https://example.com/read/1' },
    });

    expect(metadata.statusCode).toBe(200);
    expect(metadata.json().data).toMatchObject({
      ok: true,
      resultSummary: { title: 'Demo Title' },
    });
    expect(images.statusCode).toBe(200);
    expect(images.json().data).toMatchObject({
      ok: true,
      resultSummary: { imageUrlCount: 2 },
    });

    await app.close();
  });

  it('marks verification-style failures as requiring verification', async () => {
    const app = fastify();
    const registry = new AdapterRegistry();
    const adapter = new DynamicSiteAdapter({
      adapterId: 'blocked-demo',
      name: 'Blocked Demo',
      domains: ['example.com'],
      urlPatterns: ['https://example.com/*'],
      capabilities: { verification: true, metadata: false, chapterImages: true },
      selectors: { images: { item: '.reader img', srcAttr: 'src' } },
      sourceDiscoveryId: 'disc-1',
      promotedAt: '2026-07-09T00:00:00.000Z',
    });
    jest.spyOn(adapter as any, 'fetchHtml').mockRejectedValue(new Error('Human verification is required before crawling can continue.'));
    registry.register(adapter);
    setupAdaptersRoutes(app, registry);

    const response = await app.inject({
      method: 'POST',
      url: '/api/adapters/blocked-demo/functions/extractChapterImageUrls/test',
      payload: { url: 'https://example.com/read/1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ ok: false, requiresVerification: true });

    await app.close();
  });

  it('detects verification from HTTP 403 fetch failures instead of only inspecting the URL text', async () => {
    const app = fastify();
    const registry = new AdapterRegistry();
    const adapter = new DynamicSiteAdapter({
      adapterId: 'forbidden-demo',
      name: 'Forbidden Demo',
      domains: ['example.com'],
      urlPatterns: ['https://example.com/*'],
      capabilities: { verification: true, metadata: false, chapterImages: true },
      selectors: { images: { item: '.reader img', srcAttr: 'src' } },
      sourceDiscoveryId: 'disc-1',
      promotedAt: '2026-07-09T00:00:00.000Z',
    });
    jest.spyOn(adapter as any, 'fetchHtml').mockRejectedValue(new Error('HTTP 403 for https://example.com/manga/demo'));
    registry.register(adapter);
    setupAdaptersRoutes(app, registry);

    const response = await app.inject({
      method: 'POST',
      url: '/api/adapters/forbidden-demo/functions/detectVerificationRequired/test',
      payload: { url: 'https://example.com/manga/demo' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      ok: false,
      status: 'verification_required',
      requiresVerification: true,
      retryableAfterVerification: false,
    });

    await app.close();
  });
});
