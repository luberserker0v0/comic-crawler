import { describe, expect, it } from '@jest/globals';
import type { ComicMetadata } from '@comiccrawler/shared';
import { AdapterRegistry } from '../../../src/adapter/registry';
import { AdapterBase } from '../../../src/adapter/base';
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

class OracleAdapter extends AdapterBase {
  readonly id = 'oracle';
  readonly name = 'Oracle';
  readonly domains = ['example.com'];
  readonly parseMode = 'static' as const;

  matchUrl(url: string): boolean {
    return new URL(url).hostname === 'example.com';
  }

  async loadDocument(url: string): Promise<unknown> {
    return url.includes('/chapter-') ? 'chapter' : 'metadata';
  }

  extractTitle(): string {
    return 'Example Comic';
  }

  extractChapterList(): ComicMetadata['chapters'] {
    return [
      { id: 'c1', title: 'Chapter 1', url: 'https://example.com/manga/demo/chapter-1' },
    ];
  }

  extractChapterImageUrls(): string[] {
    return ['https://example.com/images/1.webp'];
  }
}

function createImplementationDraftSource(adapterId = 'generated-adapter', domain = 'generated.test'): string {
  return `
import type { ChapterInfo } from '@comiccrawler/shared';
import {
  AdapterBase,
  CommonCapability,
  VerificationCapability,
  MetadataCapability,
  ChapterImagesCapability,
} from '../../base';

export class GeneratedAdapter extends AdapterBase {
  readonly id = '${adapterId}';
  readonly name = 'Generated Adapter';
  readonly domains = ['${domain}'];
  readonly parseMode = 'static' as const;
  readonly capabilities = { verification: true, metadata: true, chapterImages: true };
  readonly common = new GeneratedCommonCapability(this);
  readonly verification = new GeneratedVerificationCapability(this);
  readonly metadata = new GeneratedMetadataCapability(this);
  readonly chapterImages = new GeneratedChapterImagesCapability(this);
}

class GeneratedCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean {
    return new URL(url).hostname === '${domain}';
  }
}

class GeneratedVerificationCapability extends VerificationCapability {}

class GeneratedMetadataCapability extends MetadataCapability {
  extractTitle(document: unknown, sourceUrl: string): string {
    return this.adapter.asCheerio(document)('h1').text().trim();
  }

  extractChapterList(document: unknown, sourceUrl: string): ChapterInfo[] {
    const $ = this.adapter.asCheerio(document);
    return $('a[href*="/chapter-"]').map((_, element) => {
      const url = this.adapter.resolveUrl(sourceUrl, $(element).attr('href') ?? '');
      return { id: new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? 'chapter', title: $(element).text().trim(), url };
    }).get();
  }
}

class GeneratedChapterImagesCapability extends ChapterImagesCapability {
  extractChapterImageUrls(document: unknown, sourceUrl: string): string[] {
    const $ = this.adapter.asCheerio(document);
    return $('#reader img').map((_, element) => this.adapter.resolveUrl(sourceUrl, $(element).attr('src') ?? '')).get();
  }
}
`;
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
    const promotedManifest = promoted as DynamicSiteAdapterManifest;
    expect(promotedManifest.adapterId).toBe('example-dynamic');
    expect(promotedManifest.capabilities).toEqual({ verification: true, metadata: true, chapterImages: true });
    expect(promotedManifest.selectors.metadata?.title).toBe('h1');
    expect(promotedManifest.selectors.images).toEqual(baseManifest.selectors.images);
    expect(active).toHaveLength(1);
    expect(active?.[0]?.adapterId).toBe('example-dynamic');
    expect(registry.get('example-dynamic')?.capabilities).toEqual({ verification: true, metadata: true, chapterImages: true });
    await expect(storage.read<SelectorDiscoveryJob>('selector-discovery-job-disc-augment')).resolves.toMatchObject({
      status: 'promoted',
      phase: 'complete',
      adapterId: 'example-dynamic',
      adapterName: 'Example Dynamic Full',
    });
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
      adapterId: 'example-chapter-only-fixture-replay',
      name: 'Example Chapter-only Fixture Replay Candidate',
      domains: ['example.com'],
      urlPatterns: ['https://example.com/mangaread/*/*'],
      capabilities: { verification: true, metadata: false, chapterImages: true },
      selectors: { images: { item: '.reader img', srcAttr: 'src' } },
      sourceDiscoveryId: 'fixture-replay-example',
      promotedAt: '2026-06-25T00:00:00.000Z',
    };
    registry.register(new OracleAdapter());
    await storage.write('selector-discovery-active-adapters', [staleManifest]);
    const service = new SelectorDiscoveryService(storage, registry);

    await service.loadActiveDynamicAdapters();

    const active = await storage.read<DynamicSiteAdapterManifest[]>('selector-discovery-active-adapters');
    expect(active).toEqual([]);
    expect(registry.get('oracle')).toBeDefined();
    expect(registry.get('example-chapter-only-fixture-replay')).toBeUndefined();
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

  it('promotes an awaiting_review TypeScript implementation draft', async () => {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    const service = new SelectorDiscoveryService(storage, registry);
    const job: SelectorDiscoveryJob = {
      id: 'disc-ts',
      url: 'https://generated.test/manga/title',
      normalizedUrl: 'https://generated.test/manga/title',
      hostname: 'generated.test',
      status: 'awaiting_review',
      target: 'full',
      promotionMode: 'create',
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z',
      adapterImplementationTs: createImplementationDraftSource(),
      implementationValidation: { valid: true, syntaxValid: true, errors: [], warnings: [] },
    };
    await storage.write('selector-discovery-job-disc-ts', job);
    await storage.write('selector-discovery-index', ['disc-ts']);

    const promoted = await service.promote('disc-ts');
    const active = await storage.read<Array<{ adapterId: string; adapterImplementationTs: string }>>(
      'selector-discovery-active-implementation-adapters'
    );

    expect(promoted.adapterId).toBe('generated-adapter');
    expect(registry.findByUrl('https://generated.test/manga/title')?.id).toBe('generated-adapter');
    expect(active).toHaveLength(1);
    expect(active?.[0]?.adapterImplementationTs).toContain('GeneratedAdapter');
    await expect(storage.read<SelectorDiscoveryJob>('selector-discovery-job-disc-ts')).resolves.toMatchObject({
      status: 'promoted',
      phase: 'complete',
      adapterId: 'generated-adapter',
      adapterName: 'Generated Adapter',
    });
  });

  it('rejects invalid TypeScript implementation draft promotion', async () => {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    const service = new SelectorDiscoveryService(storage, registry);
    const job: SelectorDiscoveryJob = {
      id: 'disc-invalid-ts',
      url: 'https://generated.test/manga/title',
      normalizedUrl: 'https://generated.test/manga/title',
      hostname: 'generated.test',
      status: 'awaiting_review',
      target: 'full',
      promotionMode: 'create',
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z',
      adapterImplementationTs: createImplementationDraftSource(),
      implementationValidation: { valid: false, syntaxValid: true, errors: ['missing metadata capability'], warnings: [] },
    };
    await storage.write('selector-discovery-job-disc-invalid-ts', job);
    await storage.write('selector-discovery-index', ['disc-invalid-ts']);

    await expect(service.promote('disc-invalid-ts')).rejects.toThrow('Adapter implementation draft is invalid');
    expect(registry.size).toBe(0);
  });

  it('rejects TypeScript implementation draft adapter id collisions', async () => {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    registry.register(new OracleAdapter());
    const service = new SelectorDiscoveryService(storage, registry);
    const job: SelectorDiscoveryJob = {
      id: 'disc-id-collision-ts',
      url: 'https://other.test/manga/title',
      normalizedUrl: 'https://other.test/manga/title',
      hostname: 'other.test',
      status: 'awaiting_review',
      target: 'full',
      promotionMode: 'create',
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z',
      adapterImplementationTs: createImplementationDraftSource('oracle', 'other.test'),
      implementationValidation: { valid: true, syntaxValid: true, errors: [], warnings: [] },
    };
    await storage.write('selector-discovery-job-disc-id-collision-ts', job);
    await storage.write('selector-discovery-index', ['disc-id-collision-ts']);

    await expect(service.promote('disc-id-collision-ts')).rejects.toThrow('Adapter "oracle" is already registered');
  });

  it('rejects TypeScript implementation draft domain conflicts', async () => {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    registry.register(new OracleAdapter());
    const service = new SelectorDiscoveryService(storage, registry);
    const job: SelectorDiscoveryJob = {
      id: 'disc-domain-collision-ts',
      url: 'https://example.com/manga/title',
      normalizedUrl: 'https://example.com/manga/title',
      hostname: 'example.com',
      status: 'awaiting_review',
      target: 'full',
      promotionMode: 'create',
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z',
      adapterImplementationTs: createImplementationDraftSource('other-generated', 'example.com'),
      implementationValidation: { valid: true, syntaxValid: true, errors: [], warnings: [] },
    };
    await storage.write('selector-discovery-job-disc-domain-collision-ts', job);
    await storage.write('selector-discovery-index', ['disc-domain-collision-ts']);

    await expect(service.promote('disc-domain-collision-ts')).rejects.toThrow('Domain conflict detected for example.com');
  });

  it('loads promoted TypeScript implementation adapters on startup', async () => {
    const storage = new MemoryStorage();
    await storage.write('selector-discovery-active-implementation-adapters', [
      {
        adapterId: 'generated-adapter',
        name: 'Generated Adapter',
        domains: ['generated.test'],
        urlPatterns: ['https://generated.test/*'],
        parseMode: 'static',
        capabilities: { verification: true, metadata: true, chapterImages: true },
        sourceDiscoveryId: 'disc-ts',
        adapterImplementationTs: createImplementationDraftSource(),
        promotedAt: '2026-06-25T00:00:00.000Z',
      },
    ]);
    const registry = new AdapterRegistry();
    const service = new SelectorDiscoveryService(storage, registry);

    await service.loadActiveDynamicAdapters();

    expect(registry.findByUrl('https://generated.test/manga/title')?.id).toBe('generated-adapter');
  });

  it('records a function revision subtask under an awaiting review implementation draft', async () => {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    const service = new SelectorDiscoveryService(storage, registry);
    const job: SelectorDiscoveryJob = {
      id: 'disc-revision',
      url: 'https://generated.test/manga/title',
      normalizedUrl: 'https://generated.test/manga/title',
      hostname: 'generated.test',
      status: 'awaiting_review',
      target: 'full',
      promotionMode: 'create',
      createdAt: '2026-06-25T00:00:00.000Z',
      updatedAt: '2026-06-25T00:00:00.000Z',
      adapterImplementationTs: createImplementationDraftSource(),
      implementationValidation: { valid: true, syntaxValid: true, errors: [], warnings: [] },
    };
    await storage.write('selector-discovery-job-disc-revision', job);
    await storage.write('selector-discovery-index', ['disc-revision']);

    const updated = await service.requestFunctionRevision({
      id: 'disc-revision',
      functionId: 'extractTitle',
      instruction: 'Only read the primary catalog title.',
    });

    expect(updated.functionRevisionTasks).toHaveLength(1);
    expect(updated.functionRevisionTasks?.[0]).toMatchObject({
      parentDiscoveryId: 'disc-revision',
      functionId: 'extractTitle',
      instruction: 'Only read the primary catalog title.',
      status: 'queued',
    });
  });
});
