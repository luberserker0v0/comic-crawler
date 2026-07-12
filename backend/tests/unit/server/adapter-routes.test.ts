import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fastify from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AdapterRegistry } from '../../../src/adapter/registry';
import { HappyMhAdapter } from '../../../src/adapter/sites/happymh';
import { DynamicSiteAdapter } from '../../../src/adapter/dynamic-site-adapter';
import { AdapterBase } from '../../../src/adapter/base';
import { setupAdaptersRoutes } from '../../../src/server/routes/adapters';

class StaticDemoAdapter extends AdapterBase {
  readonly id: string = 'static-demo';
  readonly name = 'Static Demo';
  readonly domains = ['example.com'];
  readonly parseMode = 'static' as const;
  override readonly capabilities = { verification: true, metadata: true, chapterImages: true };

  override extractTitle(document: unknown): string {
    return this.asCheerio(document)('h1').first().text().trim();
  }

  override extractChapterList(document: unknown, sourceUrl: string) {
    const $ = this.asCheerio(document);
    return $('.chapters a').map((index, element) => ({
      id: $(element).attr('href') ?? String(index),
      title: $(element).text().trim(),
      url: this.resolveUrl(sourceUrl, $(element).attr('href') ?? ''),
      index,
    })).get();
  }

  override extractChapterImageUrls(document: unknown, sourceUrl: string): string[] {
    const $ = this.asCheerio(document);
    return $('.reader img').map((_, element) => this.resolveUrl(sourceUrl, $(element).attr('src') ?? '')).get();
  }
}

describe('Adapter routes', () => {
  let previousAgentWorkspacePath: string | undefined;
  let testAgentWorkspacePath: string | undefined;

  beforeEach(async () => {
    previousAgentWorkspacePath = process.env.AGENT_WORKSPACE_PATH;
    testAgentWorkspacePath = await mkdtemp(join(tmpdir(), 'comiccrawler-adapter-lab-'));
    process.env.AGENT_WORKSPACE_PATH = testAgentWorkspacePath;
  });

  afterEach(async () => {
    if (previousAgentWorkspacePath === undefined) {
      delete process.env.AGENT_WORKSPACE_PATH;
    } else {
      process.env.AGENT_WORKSPACE_PATH = previousAgentWorkspacePath;
    }
    if (testAgentWorkspacePath) {
      await rm(testAgentWorkspacePath, { recursive: true, force: true });
    }
    testAgentWorkspacePath = undefined;
  });
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

  it('returns full built-in adapter implementation for Adapter Lab workbench', async () => {
    const app = fastify();
    const registry = new AdapterRegistry();
    registry.register(new HappyMhAdapter());
    setupAdaptersRoutes(app, registry);

    const response = await app.inject({ method: 'GET', url: '/api/adapters/happymh/implementation' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      adapterId: 'happymh',
      sourceType: 'built-in',
      language: 'typescript',
    });
    expect(response.json().data.content).toContain('class HappyMhMetadataCapability');
    expect(response.json().data.content).toContain('function extractMangaSlug');
    expect(response.json().data.outline).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'extractTitle', kind: 'method' }),
      expect.objectContaining({ id: 'extractChapterList', kind: 'method' }),
      expect.objectContaining({ id: 'helper:extractMangaSlug', kind: 'helper' }),
    ]));

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

  it('returns full dynamic adapter manifest for Adapter Lab workbench', async () => {
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

    const response = await app.inject({ method: 'GET', url: '/api/adapters/dynamic-demo/implementation' });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      adapterId: 'dynamic-demo',
      sourceType: 'dynamic',
      language: 'json',
    });
    expect(response.json().data.content).toContain('"selectors"');
    expect(response.json().data.outline).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'manifest', kind: 'manifest-section' }),
      expect.objectContaining({ id: 'extractChapterImageUrls', capability: 'chapterImages' }),
    ]));

    await app.close();
  });

  it('tests metadata and chapter image functions with structured summaries', async () => {
    const app = fastify();
    const registry = new AdapterRegistry();
    const adapter = new StaticDemoAdapter();
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
      url: '/api/adapters/static-demo/functions/extractTitle/test',
      payload: { url: 'https://example.com/manga/demo' },
    });
    const images = await app.inject({
      method: 'POST',
      url: '/api/adapters/static-demo/functions/extractChapterImageUrls/test',
      payload: { url: 'https://example.com/read/1' },
    });

    expect(metadata.statusCode).toBe(200);
    expect(metadata.json().data).toMatchObject({
      ok: true,
      domSource: 'static',
      resultSummary: { title: 'Demo Title' },
    });
    expect(images.statusCode).toBe(200);
    expect(images.json().data).toMatchObject({
      ok: true,
      domSource: 'static',
      resultSummary: { imageUrlCount: 2 },
    });

    await app.close();
  });

  it('does not start verification handoff for static-mode extraction failures', async () => {
    const app = fastify();
    const registry = new AdapterRegistry();
    class BlockedStaticAdapter extends StaticDemoAdapter {
      override readonly id = 'blocked-demo';
      override readonly capabilities = { verification: true, metadata: false, chapterImages: true };
    }
    const adapter = new BlockedStaticAdapter();
    jest.spyOn(adapter as any, 'fetchHtml').mockRejectedValue(new Error('Human verification is required before crawling can continue.'));
    registry.register(adapter);
    setupAdaptersRoutes(app, registry);

    const response = await app.inject({
      method: 'POST',
      url: '/api/adapters/blocked-demo/functions/extractChapterImageUrls/test',
      payload: { url: 'https://example.com/read/1' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      ok: false,
      status: 'failed',
      requiresVerification: false,
      domSource: 'static',
    });

    await app.close();
  });

  it('detects verification from HTTP 403 fetch failures in static mode without opening handoff', async () => {
    const app = fastify();
    const registry = new AdapterRegistry();
    class ForbiddenStaticAdapter extends StaticDemoAdapter {
      override readonly id = 'forbidden-demo';
      override readonly capabilities = { verification: true, metadata: false, chapterImages: true };
    }
    const adapter = new ForbiddenStaticAdapter();
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
      ok: true,
      status: 'passed',
      requiresVerification: false,
      resultSummary: {
        verificationRequired: true,
        source: 'fetch-error',
        domSource: 'static',
      },
    });

    await app.close();
  });

  it('offers verification handoff when Playwright rendering times out', async () => {
    class TimeoutHappyMhAdapter extends HappyMhAdapter {
      override async loadDocument(): Promise<unknown> {
        throw new Error('page.goto: Timeout 30000ms exceeded.');
      }
    }

    const app = fastify();
    const registry = new AdapterRegistry();
    registry.register(new TimeoutHappyMhAdapter());
    const createDeferred = jest.fn(async () => ({
      id: 'chal-timeout',
      status: 'queued',
      normalizedUrl: 'https://m.happymh.com/manga/demo',
    }));
    setupAdaptersRoutes(app, registry, {
      challengeDiscoveryService: { createDeferred } as any,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/adapters/happymh/functions/extractTitle/test',
      payload: {
        url: 'https://m.happymh.com/manga/demo',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      ok: false,
      status: 'verification_required',
      requiresVerification: true,
      challengeDiscoveryId: 'chal-timeout',
    });
    expect(createDeferred).toHaveBeenCalledWith({ url: 'https://m.happymh.com/manga/demo' });

    await app.close();
  });

  it('retests verification against verified browser HTML instead of refetching the blocked URL', async () => {
    const app = fastify();
    const registry = new AdapterRegistry();
    const adapter = new DynamicSiteAdapter({
      adapterId: 'verified-demo',
      name: 'Verified Demo',
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
    const fetchHtmlSpy = jest.spyOn(adapter as any, 'fetchHtml').mockRejectedValue(new Error('HTTP 403 for https://example.com/manga/demo'));
    registry.register(adapter);
    const readCdpPageSnapshot = jest.fn(async (_id: string, _cdpUrl?: string, options?: { settle?: boolean; allowNavigate?: boolean }) => {
      expect(options?.settle).toBe(false);
      expect(options?.allowNavigate).toBe(false);
      return {
        job: { id: 'chal-1', status: 'ready', browserCdpUrl: 'http://127.0.0.1:9222', normalizedUrl: 'https://example.com/manga/demo' },
        page: {
          url: 'https://example.com/manga/demo',
          title: 'Demo',
          html: '<html><body><h1>Verified manga page</h1></body></html>',
        },
      };
    });
    setupAdaptersRoutes(app, registry, {
      challengeDiscoveryService: {
        get: jest.fn(async () => ({ id: 'chal-1', status: 'ready', browserCdpUrl: 'http://127.0.0.1:9222' })),
        readCdpPageSnapshot,
      } as any,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/adapters/verified-demo/functions/detectVerificationRequired/test',
      payload: {
        url: 'https://example.com/manga/demo',
        challengeDiscoveryId: 'chal-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      ok: true,
      status: 'passed',
      resultSummary: {
        verificationRequired: false,
        source: 'verified-browser-html',
        domSource: 'verified-fixture',
      },
    });
    expect(fetchHtmlSpy).not.toHaveBeenCalled();

    await app.close();
  });

  it('tests chapter-list extraction without hidden catalog expansion or fixture capture', async () => {
    const app = fastify();
    const registry = new AdapterRegistry();
    const adapter = new DynamicSiteAdapter({
      adapterId: 'verified-chapters-demo',
      name: 'Verified Chapters Demo',
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
    registry.register(adapter);
    const readCdpPageSnapshot = jest.fn(async (_id: string, _cdpUrl?: string, options?: { settle?: boolean; expandCatalog?: boolean; allowNavigate?: boolean }) => {
      expect(options).toMatchObject({ settle: false, allowNavigate: false });
      expect(options).not.toHaveProperty('expandCatalog');
      return {
        job: { id: 'chal-1', status: 'ready', browserCdpUrl: 'http://127.0.0.1:9222', normalizedUrl: 'https://example.com/manga/demo' },
        page: {
          url: 'https://example.com/manga/demo',
          title: 'Demo',
          html: '<html><body><h1>Verified manga page</h1><div class="chapters"><a href="/mangaread/demo/1">Chapter 1</a></div></body></html>',
        },
      };
    });
    setupAdaptersRoutes(app, registry, {
      challengeDiscoveryService: {
        get: jest.fn(async () => ({ id: 'chal-1', status: 'ready', browserCdpUrl: 'http://127.0.0.1:9222' })),
        readCdpPageSnapshot,
      } as any,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/adapters/verified-chapters-demo/functions/extractChapterList/test',
      payload: {
        url: 'https://example.com/manga/demo',
        challengeDiscoveryId: 'chal-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      ok: true,
      status: 'passed',
      domSource: 'verified-fixture',
      resultSummary: {
        chapterCount: 1,
        chapters: [
          expect.objectContaining({ title: 'Chapter 1' }),
        ],
      },
    });
    expect(response.json().data.timings).toEqual(expect.arrayContaining([
      expect.objectContaining({ step: 'dom_acquisition' }),
      expect.objectContaining({ step: 'extraction' }),
      expect.objectContaining({ step: 'readiness' }),
    ]));
    expect(readCdpPageSnapshot).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it('does not treat residual challenge keywords inside verified manga HTML as active verification', async () => {
    const app = fastify();
    const registry = new AdapterRegistry();
    const adapter = new DynamicSiteAdapter({
      adapterId: 'verified-keyword-demo',
      name: 'Verified Keyword Demo',
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
    registry.register(adapter);
    setupAdaptersRoutes(app, registry, {
      challengeDiscoveryService: {
        get: jest.fn(async () => ({ id: 'chal-1', status: 'ready', browserCdpUrl: 'http://127.0.0.1:9222' })),
        readCdpPageSnapshot: jest.fn(async () => ({
          job: { id: 'chal-1', status: 'ready' },
          page: {
            url: 'https://example.com/manga/demo',
            title: 'Demo',
            html: [
              '<html><head><title>Demo</title></head><body>',
              '<h1>Verified manga page</h1>',
              '<div class="chapters"><a href="/read/1">Chapter 1</a></div>',
              '<script>window.i18n = {"challengeLabel":"人机验证"}</script>',
              '</body></html>',
            ].join(''),
          },
        })),
      } as any,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/adapters/verified-keyword-demo/functions/detectVerificationRequired/test',
      payload: {
        url: 'https://example.com/manga/demo',
        challengeDiscoveryId: 'chal-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      ok: true,
      status: 'passed',
      resultSummary: {
        verificationRequired: false,
        source: 'verified-browser-html',
      },
    });

    await app.close();
  });

  it('rejects verified browser snapshots from a different page path', async () => {
    const app = fastify();
    const registry = new AdapterRegistry();
    const adapter = new DynamicSiteAdapter({
      adapterId: 'wrong-page-demo',
      name: 'Wrong Page Demo',
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
    registry.register(adapter);
    setupAdaptersRoutes(app, registry, {
      challengeDiscoveryService: {
        get: jest.fn(async () => ({ id: 'chal-1', status: 'ready', browserCdpUrl: 'http://127.0.0.1:9222' })),
        readCdpPageSnapshot: jest.fn(async () => ({
          job: { id: 'chal-1', status: 'ready' },
          page: {
            url: 'https://example.com/mangaread/demo/1',
            title: 'Wrong page',
            html: '<html><body><h1>Wrong page</h1></body></html>',
          },
        })),
      } as any,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/adapters/wrong-page-demo/functions/extractTitle/test',
      payload: {
        url: 'https://example.com/manga/demo',
        challengeDiscoveryId: 'chal-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      ok: false,
      status: 'failed',
    });
    expect(response.json().data.error).toContain('does not match the test URL');

    await app.close();
  });
});
