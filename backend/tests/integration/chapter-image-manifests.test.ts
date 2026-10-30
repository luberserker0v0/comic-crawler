import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { ChapterImagesResponse } from '@comiccrawler/shared';
import fastify from 'fastify';
import { DynamicSiteAdapter } from '../../src/adapter/dynamic-site-adapter';
import { ChapterImageManifestService } from '../../src/adapter/chapter-image-manifest';
import { AdapterRegistry } from '../../src/adapter/registry';
import { ApiSecurityService } from '../../src/security/api-security';
import { setupApiSecurity } from '../../src/server/middleware/api-security';
import { setupAdaptersRoutes } from '../../src/server/routes/adapters';
import { setupChapterImageManifestRoutes } from '../../src/server/routes/chapter-image-manifests';
import type { IStorage } from '../../src/storage/types';

class MemoryStorage implements IStorage {
  readonly values = new Map<string, unknown>();
  async read<T>(key: string): Promise<T | null> { return (this.values.get(key) as T | undefined) ?? null; }
  async write(key: string, value: unknown): Promise<void> { this.values.set(key, structuredClone(value)); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
  async list(): Promise<string[]> { return [...this.values.keys()]; }
  async exists(key: string): Promise<boolean> { return this.values.has(key); }
}

const apps: Array<ReturnType<typeof fastify>> = [];

describe('Integration: persisted chapter image manifests', () => {
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));
  it('persists a successful extraction and serves it after restart without live extraction', testRestartLookup);
  it('does not persist a failed extraction', testFailedExtraction);
  it('returns 404 for an unknown URL instead of running a live fallback', testNoLiveFallback);
  it('does not expose one owner manifest to another authenticated owner', testOwnerIsolation);
});

async function testRestartLookup(): Promise<void> {
  const storage = new MemoryStorage();
  const extracted = await extractAndPersist(storage);
  const app = createLookupApp(storage);
  const resolved = await app.inject({ method: 'GET', url: manifestResolveUrl() });
  expect(resolved.statusCode).toBe(200);
  const manifest = resolved.json().data;
  expect(manifest.chapter.id).toBe(extracted.chapter.id);
  const cached = await app.inject({ method: 'GET',
    url: `/api/chapter-image-manifests/${encodeURIComponent(extracted.chapter.id)}`,
    headers: { 'if-none-match': resolved.headers.etag as string } });
  expect(cached.statusCode).toBe(304);
  await expectPageResolution(app, extracted.chapter.id, extracted.images[0].id, manifest.revision);
}

async function testNoLiveFallback(): Promise<void> {
  const app = createLookupApp(new MemoryStorage());
  const response = await app.inject({ method: 'GET', url: manifestResolveUrl() });
  expect(response.statusCode).toBe(404);
  expect(response.json()).toEqual({ error: 'Chapter image manifest was not found.' });
}

async function testFailedExtraction(): Promise<void> {
  const storage = new MemoryStorage(), app = createExtractionApp(storage, '<div class="reader"></div>');
  const extraction = await app.inject({ method: 'POST', url: '/api/adapters/chapter-images',
    payload: { url: 'https://reader.example/chapter/1' } });
  expect(extraction.statusCode).not.toBe(200);
  const lookup = createLookupApp(storage);
  const response = await lookup.inject({ method: 'GET', url: manifestResolveUrl() });
  expect(response.statusCode).toBe(404);
}

async function testOwnerIsolation(): Promise<void> {
  const storage = new MemoryStorage(), manifests = new ChapterImageManifestService(storage);
  await manifests.save('alice', manifestInput());
  const app = createTokenLookupApp(storage);
  const alice = await app.inject({ method: 'GET', url: manifestResolveUrl(), headers: auth('alice') });
  const bob = await app.inject({ method: 'GET', url: manifestResolveUrl(), headers: auth('bob') });
  expect(alice.statusCode).toBe(200);
  expect(bob.statusCode).toBe(404);
}

async function extractAndPersist(storage: MemoryStorage): Promise<any> {
  const app = createExtractionApp(storage);
  const response = await app.inject({ method: 'POST', url: '/api/adapters/chapter-images',
    payload: { url: 'https://reader.example/chapter/1?token=old' } });
  expect(response.statusCode).toBe(200);
  return response.json().data;
}

function createExtractionApp(storage: MemoryStorage, html = readerHtml()): ReturnType<typeof fastify> {
  const app = track(fastify()), registry = new AdapterRegistry();
  registry.register(adapter());
  setupAdaptersRoutes(app, registry, { chapterImageManifestService: new ChapterImageManifestService(storage),
    htmlRenderer: { render: jest.fn(async () => html), dispose: jest.fn(async () => undefined) } });
  return app;
}

function createLookupApp(storage: MemoryStorage): ReturnType<typeof fastify> {
  const app = track(fastify()), security = publicSecurity();
  setupChapterImageManifestRoutes(app, new ChapterImageManifestService(storage), security);
  return app;
}

function createTokenLookupApp(storage: MemoryStorage): ReturnType<typeof fastify> {
  const app = track(fastify()), security = tokenSecurity();
  setupApiSecurity(app, security);
  setupChapterImageManifestRoutes(app, new ChapterImageManifestService(storage), security);
  return app;
}

async function expectPageResolution(
  app: ReturnType<typeof fastify>, chapterId: string, pageId: string, revision: string
): Promise<void> {
  const url = `/api/chapter-image-manifests/${encodeURIComponent(chapterId)}/resolve-pages`;
  const response = await app.inject({ method: 'POST',
    url, payload: { revision, urls: ['https://renewed-cdn.example/pages/1.jpg?token=new&expires=999'] } });
  expect(response.statusCode).toBe(200);
  expect(response.headers.etag).toBe(`"${revision}"`);
  expect(response.json().data.matches).toEqual([
    expect.objectContaining({ status: 'matched', pageId, orderIndex: 0 }),
  ]);
  const stale = await app.inject({ method: 'POST', url,
    payload: { revision: `sha256:${'0'.repeat(64)}`, urls: ['https://cdn.example/pages/1.jpg'] } });
  expect(stale.statusCode).toBe(409);
}

function adapter(): DynamicSiteAdapter {
  return new DynamicSiteAdapter({ adapterId: 'reader', name: 'Reader', domains: ['reader.example'],
    urlPatterns: ['https://reader.example/chapter/*'],
    capabilities: { verification: false, metadata: false, chapterImages: true },
    selectors: { images: { item: '.reader img', srcAttr: 'src' } },
    sourceDiscoveryId: 'integration', promotedAt: '2026-10-30T00:00:00.000Z' });
}

function readerHtml(): string {
  return '<div class="reader"><img src="https://cdn.example/pages/1.jpg?token=old"></div>';
}

function manifestResolveUrl(): string {
  return '/api/chapter-image-manifests/resolve?url='
    + encodeURIComponent('https://reader.example/chapter/1?token=renewed');
}

function publicSecurity(): ApiSecurityService {
  return ApiSecurityService.fromSecretDocument({ mode: 'public', defaultEffect: 'deny', rules: [] });
}

function tokenSecurity(): ApiSecurityService {
  const policy = { mode: 'token' as const, defaultEffect: 'deny' as const,
    rules: [{ id: 'manifests', methods: ['GET', 'POST'],
      path: '/api/chapter-image-manifests/**', permission: 'adapter:read' }] };
  return ApiSecurityService.fromSecretDocument(policy, { schemaVersion: 1,
    roles: [{ id: 'reader', permissions: ['adapter:read'] }], users: [
      { id: 'alice', token: token('alice'), roles: ['reader'], enabled: true },
      { id: 'bob', token: token('bob'), roles: ['reader'], enabled: true },
    ] });
}

function auth(userId: 'alice' | 'bob'): Record<string, string> {
  return { 'x-comiccrawler-user-id': userId, authorization: `Bearer ${token(userId)}` };
}

function token(userId: string): string {
  return `${userId}-token-${'x'.repeat(32)}`;
}

function manifestInput(): ChapterImagesResponse {
  const chapter = { id: 'chapter_test', canonicalUrl: 'https://reader.example/chapter/1',
    stability: 'deterministic' as const, identitySource: 'normalized-url' as const };
  const images = [{ id: 'page_test', orderIndex: 0, url: 'https://cdn.example/pages/1.jpg' }];
  return { adapterId: 'reader', chapterUrl: chapter.canonicalUrl, chapter, images,
    imageUrls: images.map((image) => image.url), imageUrlCount: images.length,
    domSource: 'rendered', durationMs: 1,
    renderContext: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 } };
}

function track<T extends ReturnType<typeof fastify>>(app: T): T {
  apps.push(app); return app;
}
