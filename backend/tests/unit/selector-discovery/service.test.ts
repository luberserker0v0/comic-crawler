import { describe, expect, it } from '@jest/globals';
import type { IComicAdapter, ComicMetadata, ImageInfo } from '@comiccrawler/shared';
import { AdapterRegistry } from '../../../src/adapter/registry';
import { SelectorDiscoveryService } from '../../../src/selector-discovery/service';
import { DynamicSiteAdapter, type DynamicSiteAdapterManifest } from '../../../src/adapter/dynamic-site-adapter';
import type { IStorage } from '../../../src/storage/types';
import type { SelectorDiscoveryJob } from '../../../src/selector-discovery/types';

class MemoryStorage implements IStorage {
  private readonly values = new Map<string, unknown>();

  async read<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async write(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async list(): Promise<string[]> {
    return Array.from(this.values.keys());
  }

  async exists(key: string): Promise<boolean> {
    return this.values.has(key);
  }
}

class OracleAdapter implements IComicAdapter {
  readonly id = 'oracle';
  readonly name = 'Oracle';
  readonly domains = ['example.com'];
  readonly parseMode = 'static' as const;

  matchUrl(url: string): boolean {
    return new URL(url).hostname === 'example.com';
  }

  async fetchMetadata(_url: string): Promise<ComicMetadata> {
    return {
      id: 'example',
      title: 'Example Comic',
      chapters: [
        { id: 'c1', title: 'Chapter 1', url: 'https://example.com/manga/demo/chapter-1' },
      ],
    };
  }

  async fetchChapterImages(_chapterUrl: string): Promise<ImageInfo[]> {
    return [{ url: 'https://example.com/images/1.webp', index: 0 }];
  }
}

describe('SelectorDiscoveryService shadow promotion', () => {
  it('augments an existing chapter-only dynamic adapter instead of registering a second adapter', async () => {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    const baseManifest: DynamicSiteAdapterManifest = {
      adapterId: 'example-dynamic',
      name: 'Example Dynamic',
      domains: ['example.com'],
      urlPatterns: ['https://example.com/manga/*/chapter-*'],
      capabilities: { verification: true, metadata: false, chapterImages: true },
      selectors: {
        images: {
          container: '.reader',
          item: '.reader img[data-src]',
          srcAttr: 'data-src',
        },
      },
      sourceDiscoveryId: 'disc-chapter-only',
      promotedAt: '2026-06-25T00:00:00.000Z',
    };
    registry.register(new DynamicSiteAdapter(baseManifest));
    await storage.write('selector-discovery-active-adapters', [baseManifest]);
    const service = new SelectorDiscoveryService(storage, registry);
    const job: SelectorDiscoveryJob = {
      id: 'disc-augment',
      url: 'https://example.com/manga/demo',
      normalizedUrl: 'https://example.com/manga/demo',
      hostname: 'example.com',
      status: 'awaiting_review',
      target: 'full',
      promotionMode: 'augment',
      baseAdapterId: 'example-dynamic',
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z',
      parsedCandidate: {
        adapterId: 'example-dynamic',
        name: 'Example Dynamic Full',
        domains: ['example.com'],
        urlPatterns: ['https://example.com/manga/*'],
        selectors: {
          metadata: {
            title: 'h1',
            author: '.author',
            cover: '.cover img',
            status: '.status',
            tags: '.tag',
          },
          chapters: {
            list: '.chapters',
            item: 'a[href*="/chapter-"]',
            title: 'a',
            url: 'a',
          },
          images: {
            item: '',
            srcAttr: '',
          },
        },
        rawSections: {},
      },
    };
    await storage.write('selector-discovery-job-disc-augment', job);
    await storage.write('selector-discovery-index', ['disc-augment']);

    const promoted = await service.promote('disc-augment');
    const active = await storage.read<DynamicSiteAdapterManifest[]>('selector-discovery-active-adapters');

    expect(registry.size).toBe(1);
    expect(promoted.adapterId).toBe('example-dynamic');
    expect(promoted.capabilities).toEqual({ verification: true, metadata: true, chapterImages: true });
    expect(promoted.selectors.metadata?.title).toBe('h1');
    expect(promoted.selectors.images).toEqual(baseManifest.selectors.images);
    expect(active).toHaveLength(1);
    expect(active?.[0]?.adapterId).toBe('example-dynamic');
    expect(registry.get('example-dynamic')?.capabilities).toEqual({ verification: true, metadata: true, chapterImages: true });
  });

  it('rejects augment promotion when the candidate changes adapter identity', async () => {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    const baseManifest: DynamicSiteAdapterManifest = {
      adapterId: 'example-dynamic',
      name: 'Example Dynamic',
      domains: ['example.com'],
      urlPatterns: ['https://example.com/manga/*/chapter-*'],
      capabilities: { verification: true, metadata: false, chapterImages: true },
      selectors: { images: { item: '.reader img', srcAttr: 'src' } },
      sourceDiscoveryId: 'disc-chapter-only',
      promotedAt: '2026-06-25T00:00:00.000Z',
    };
    registry.register(new DynamicSiteAdapter(baseManifest));
    await storage.write('selector-discovery-active-adapters', [baseManifest]);
    const service = new SelectorDiscoveryService(storage, registry);
    const job: SelectorDiscoveryJob = {
      id: 'disc-bad-augment',
      url: 'https://example.com/manga/demo',
      normalizedUrl: 'https://example.com/manga/demo',
      hostname: 'example.com',
      status: 'awaiting_review',
      target: 'full',
      promotionMode: 'augment',
      baseAdapterId: 'example-dynamic',
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z',
      parsedCandidate: {
        adapterId: 'example-full-new',
        name: 'Example Full New',
        domains: ['example.com'],
        urlPatterns: ['https://example.com/manga/*'],
        selectors: {
          metadata: { title: 'h1', author: '', cover: '', status: '', tags: '' },
          chapters: { list: '.chapters', item: 'a', url: 'a' },
          images: { item: '', srcAttr: '' },
        },
        rawSections: {},
      },
    };
    await storage.write('selector-discovery-job-disc-bad-augment', job);
    await storage.write('selector-discovery-index', ['disc-bad-augment']);

    await expect(service.promote('disc-bad-augment')).rejects.toThrow('must keep existing adapter id "example-dynamic"');
    expect(registry.size).toBe(1);
  });

  it('creates augment jobs for full discovery when only a same-domain chapter-only adapter exists', async () => {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    registry.register(new DynamicSiteAdapter({
      adapterId: 'example-dynamic',
      name: 'Example Dynamic',
      domains: ['example.com'],
      urlPatterns: ['https://example.com/mangaread/*/*'],
      capabilities: { verification: true, metadata: false, chapterImages: true },
      selectors: { images: { item: '.reader img', srcAttr: 'src' } },
      sourceDiscoveryId: 'disc-chapter-only',
      promotedAt: '2026-06-25T00:00:00.000Z',
    }));
    const service = new SelectorDiscoveryService(storage, registry);

    const job = await service.create({ url: 'https://example.com/manga/demo', target: 'full', forceDiscovery: true });

    expect(job.status).toBe('configuration_required');
    expect(job.promotionMode).toBe('augment');
    expect(job.baseAdapterId).toBe('example-dynamic');
  });

  it('prunes active dynamic manifests that are superseded by an existing same-domain adapter', async () => {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    const staleManifest: DynamicSiteAdapterManifest = {
      adapterId: 'example-chapter-only-self-ao',
      name: 'Example Chapter-only Self-AO Candidate',
      domains: ['example.com'],
      urlPatterns: ['https://example.com/mangaread/*/*'],
      capabilities: { verification: true, metadata: false, chapterImages: true },
      selectors: { images: { item: '.reader img', srcAttr: 'src' } },
      sourceDiscoveryId: 'self-ao-example',
      promotedAt: '2026-06-25T00:00:00.000Z',
    };
    registry.register(new OracleAdapter());
    await storage.write('selector-discovery-active-adapters', [staleManifest]);
    const service = new SelectorDiscoveryService(storage, registry);

    await service.loadActiveDynamicAdapters();

    const active = await storage.read<DynamicSiteAdapterManifest[]>('selector-discovery-active-adapters');
    expect(active).toEqual([]);
    expect(registry.get('oracle')).toBeDefined();
    expect(registry.get('example-chapter-only-self-ao')).toBeUndefined();
  });

  it('returns known_adapter for a matching adapter unless discovery is forced', async () => {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    registry.register(new OracleAdapter());
    const service = new SelectorDiscoveryService(storage, registry);

    const known = await service.create({ url: 'https://example.com/manga/demo' });
    expect(known.status).toBe('known_adapter');
    expect(known.adapterId).toBe('oracle');

    const forced = await service.create({
      url: 'https://example.com/manga/demo/chapter-1',
      target: 'chapter-only',
      forceDiscovery: true,
    });
    expect(forced.status).toBe('configuration_required');
    expect(forced.target).toBe('chapter-only');
    expect(forced.adapterId).toBeUndefined();
    expect(forced.error).toContain('Selector discovery is not configured');
  });

  it('preserves the discovery target when retrying a job', async () => {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    const service = new SelectorDiscoveryService(storage, registry);
    const job: SelectorDiscoveryJob = {
      id: 'disc-retry',
      url: 'https://example.net/manga/demo/chapter-1',
      normalizedUrl: 'https://example.net/manga/demo/chapter-1',
      hostname: 'example.net',
      status: 'failed',
      target: 'chapter-only',
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z',
    };
    await storage.write('selector-discovery-job-disc-retry', job);
    await storage.write('selector-discovery-index', ['disc-retry']);

    const retried = await service.retry('disc-retry');

    expect(retried.status).toBe('configuration_required');
    expect(retried.target).toBe('chapter-only');
  });

  it('stores an evaluation artifact and leaves the runtime registry untouched', async () => {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    registry.register(new OracleAdapter());
    const service = new SelectorDiscoveryService(storage, registry);
    const job: SelectorDiscoveryJob = {
      id: 'disc-test',
      url: 'https://example.com/manga/demo',
      normalizedUrl: 'https://example.com/manga/demo',
      hostname: 'example.com',
      status: 'awaiting_review',
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z',
      candidateMarkdown: '## Adapter Identity',
      parsedCandidate: {
        adapterId: 'example-dynamic',
        name: 'Example Dynamic',
        domains: ['example.com'],
        urlPatterns: ['https://example.com/manga/*'],
        selectors: {
          metadata: {
            title: 'h1',
            author: '.author',
            cover: '.cover img',
            status: '.status',
            tags: '.tag',
          },
          chapters: {
            list: '.chapters',
            item: 'a[href*="/chapter-"]',
            title: 'a',
            url: 'a',
          },
          images: {
            item: '.reader img',
            srcAttr: 'src',
          },
        },
        rawSections: {},
      },
      extractionValidation: {
        valid: true,
        checkedAt: '2026-06-25T00:00:00.000Z',
        metadata: {
          title: 'Example Comic',
          chapterCount: 1,
          firstChapterUrl: 'https://example.com/manga/demo/chapter-1',
        },
        images: {
          chapterUrl: 'https://example.com/manga/demo/chapter-1',
          imageCount: 1,
          firstImageUrl: 'https://example.com/images/1.webp',
        },
        errors: [],
      },
    };
    await storage.write('selector-discovery-job-disc-test', job);
    await storage.write('selector-discovery-index', ['disc-test']);

    const updated = await service.shadowPromote('disc-test');

    expect(registry.size).toBe(1);
    expect(updated.shadowPromotion?.manifestAdapterId).toBe('example-dynamic');
    expect(updated.oracleComparison?.adapterId).toBe('oracle');
    expect(updated.oracleComparison?.titleMatched).toBe(true);
    expect(updated.oracleComparison?.chapterCountDelta).toBe(0);
    expect(await storage.exists('selector-discovery-shadow-promotion-disc-test')).toBe(true);
  });
});
