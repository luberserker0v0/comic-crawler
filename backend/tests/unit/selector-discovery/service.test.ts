import { describe, expect, it } from '@jest/globals';
import type { IComicAdapter, ComicMetadata, ImageInfo } from '@comiccrawler/shared';
import { AdapterRegistry } from '../../../src/adapter/registry';
import { SelectorDiscoveryService } from '../../../src/selector-discovery/service';
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
