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
  readonly parseMode = 'playwright' as const;

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

const IMPLEMENTATION_DRAFT_TEMPLATE = `
import type { ChapterInfo } from '@comiccrawler/shared';
import {
  AdapterBase,
  CommonCapability,
  VerificationCapability,
  MetadataCapability,
  ChapterImagesCapability,
} from '../../base';

export class GeneratedAdapter extends AdapterBase {
  readonly id = '__ADAPTER_ID__';
  readonly name = 'Generated Adapter';
  readonly domains = ['__DOMAIN__'];
  readonly parseMode = 'playwright' as const;
  readonly capabilities = { verification: true, metadata: true, chapterImages: true };
  readonly common = new GeneratedCommonCapability(this);
  readonly verification = new GeneratedVerificationCapability(this);
  readonly metadata = new GeneratedMetadataCapability(this);
  readonly chapterImages = new GeneratedChapterImagesCapability(this);
}

class GeneratedCommonCapability extends CommonCapability {
  matchUrl(url: string): boolean {
    return new URL(url).hostname === '__DOMAIN__';
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

function createImplementationDraftSource(adapterId = 'generated-adapter', domain = 'generated.test'): string {
  return IMPLEMENTATION_DRAFT_TEMPLATE
    .split('__ADAPTER_ID__').join(adapterId)
    .split('__DOMAIN__').join(domain);
}

function reviewJob(id: string, overrides: Partial<SelectorDiscoveryJob> = {}): SelectorDiscoveryJob {
  return {
    id, url: 'https://generated.test/manga/title', normalizedUrl: 'https://generated.test/manga/title',
    hostname: 'generated.test', status: 'awaiting_review', target: 'full', promotionMode: 'create',
    createdAt: '2026-06-25T00:00:00.000Z', updatedAt: '2026-06-25T00:00:00.000Z',
    adapterImplementationTs: createImplementationDraftSource(),
    implementationValidation: { valid: true, syntaxValid: true, errors: [], warnings: [] },
    ...overrides,
  };
}

async function persistJob(storage: IStorage, job: SelectorDiscoveryJob): Promise<void> {
  await storage.write(`selector-discovery-job-${job.id}`, job);
  await storage.write('selector-discovery-index', [job.id]);
}

describe('SelectorDiscoveryService adapter strategies', () => {
  SelectorDiscoveryServiceAdapterStrategiesTestGroup1();
  SelectorDiscoveryServiceAdapterStrategiesTestGroup2();
});

function SelectorDiscoveryServiceAdapterStrategiesTestGroup1(): void {
  it('persists the stable browser worker target on an adapter discovery job', SelectorDiscoveryServiceAdapterStrategiesTestPersistsTheStableBrowserWorkerTargetOnAnAdapterDiscoveryJob);
  it('creates augment jobs for full discovery when only a same-domain chapter-only adapter exists', SelectorDiscoveryServiceAdapterStrategiesTestCreatesAugmentJobsForFullDiscoveryWhenOnlyASameDomainChapterOnlyAdapterExists);
  it('prunes active dynamic manifests that are superseded by an existing same-domain adapter', SelectorDiscoveryServiceAdapterStrategiesTestPrunesActiveDynamicManifestsThatAreSupersededByAnExistingSameDomainAdapter);
  it('returns known_adapter for a matching adapter unless discovery is forced', SelectorDiscoveryServiceAdapterStrategiesTestReturnsKnownAdapterForAMatchingAdapterUnlessDiscoveryIsForced);
  it('preserves the discovery target when retrying a job', SelectorDiscoveryServiceAdapterStrategiesTestPreservesTheDiscoveryTargetWhenRetryingAJob);
  it('replaces the stub job when retrying a configuration_required job', SelectorDiscoveryServiceAdapterStrategiesTestReplacesTheStubJobWhenRetryingAConfigurationRequiredJob);
  it('promotes an awaiting_review TypeScript implementation draft', SelectorDiscoveryServiceAdapterStrategiesTestPromotesAnAwaitingReviewTypeScriptImplementationDraft);
  it('captures a golden fixture before registering an approved adapter', SelectorDiscoveryServiceAdapterStrategiesTestCapturesAGoldenFixtureBeforeRegisteringAnApprovedAdapter);
  it('does not register an adapter when golden fixture capture fails', SelectorDiscoveryServiceAdapterStrategiesTestDoesNotRegisterAnAdapterWhenGoldenFixtureCaptureFails);
  it('rejects invalid TypeScript implementation draft promotion', SelectorDiscoveryServiceAdapterStrategiesTestRejectsInvalidTypeScriptImplementationDraftPromotion);
}

function SelectorDiscoveryServiceAdapterStrategiesTestGroup2(): void {
  it('rejects TypeScript implementation draft adapter id collisions', SelectorDiscoveryServiceAdapterStrategiesTestRejectsTypeScriptImplementationDraftAdapterIdCollisions);
  it('rejects TypeScript implementation draft domain conflicts', SelectorDiscoveryServiceAdapterStrategiesTestRejectsTypeScriptImplementationDraftDomainConflicts);
  it('loads promoted TypeScript implementation adapters on startup', SelectorDiscoveryServiceAdapterStrategiesTestLoadsPromotedTypeScriptImplementationAdaptersOnStartup);
  it('records a function revision subtask under an awaiting review implementation draft', SelectorDiscoveryServiceAdapterStrategiesTestRecordsAFunctionRevisionSubtaskUnderAnAwaitingReviewImplementationDraft);
}

async function SelectorDiscoveryServiceAdapterStrategiesTestPersistsTheStableBrowserWorkerTargetOnAnAdapterDiscoveryJob() {
    const storage = new MemoryStorage();
    const service = new SelectorDiscoveryService(storage, new AdapterRegistry());
    const job = await service.create({
        url: 'https://affinity.example/manga/demo',
        ownerUserId: 'alice',
        browserTarget: { mode: 'managed-profile', workerId: 'worker-alice' },
    });
    expect(job).toMatchObject({
        ownerUserId: 'alice',
        browserTarget: { mode: 'managed-profile', workerId: 'worker-alice' },
        status: 'configuration_required',
    });
    expect(await service.get(job.id)).toMatchObject({
        ownerUserId: 'alice',
        browserTarget: { mode: 'managed-profile', workerId: 'worker-alice' },
    });
}

async function SelectorDiscoveryServiceAdapterStrategiesTestCreatesAugmentJobsForFullDiscoveryWhenOnlyASameDomainChapterOnlyAdapterExists() {
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
}

async function SelectorDiscoveryServiceAdapterStrategiesTestPrunesActiveDynamicManifestsThatAreSupersededByAnExistingSameDomainAdapter() {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    const staleManifest = staleDynamicManifest();
    registry.register(new OracleAdapter());
    await storage.write('selector-discovery-active-adapters', [staleManifest]);
    const service = new SelectorDiscoveryService(storage, registry);
    await service.loadActiveDynamicAdapters();
    const active = await storage.read<DynamicSiteAdapterManifest[]>('selector-discovery-active-adapters');
    expect(active).toEqual([]);
    expect(registry.get('oracle')).toBeDefined();
    expect(registry.get('example-chapter-only-fixture-replay')).toBeUndefined();
}

function staleDynamicManifest(): DynamicSiteAdapterManifest {
  return { adapterId: 'example-chapter-only-fixture-replay',
    name: 'Example Chapter-only Fixture Replay Candidate', domains: ['example.com'],
    urlPatterns: ['https://example.com/mangaread/*/*'],
    capabilities: { verification: true, metadata: false, chapterImages: true },
    selectors: { images: { item: '.reader img', srcAttr: 'src' } },
    sourceDiscoveryId: 'fixture-replay-example', promotedAt: '2026-06-25T00:00:00.000Z' };
}

async function SelectorDiscoveryServiceAdapterStrategiesTestReturnsKnownAdapterForAMatchingAdapterUnlessDiscoveryIsForced() {
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
}

async function SelectorDiscoveryServiceAdapterStrategiesTestPreservesTheDiscoveryTargetWhenRetryingAJob() {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    const service = new SelectorDiscoveryService(storage, registry);
    const job = retryJob('disc-retry', 'failed');
    await persistJob(storage, job);
    const retried = await service.retry('disc-retry');
    expect(retried.status).toBe('configuration_required');
    expect(retried.target).toBe('chapter-only');
    expect(retried.retriedFromId).toBe('disc-retry');
}

function retryJob(id: string, status: SelectorDiscoveryJob['status']): SelectorDiscoveryJob {
  const url = 'https://example.net/manga/demo/chapter-1';
  return { id, url, normalizedUrl: url, hostname: 'example.net', status,
    target: 'chapter-only', createdAt: '2026-06-25T00:00:00.000Z',
    updatedAt: '2026-06-25T00:00:00.000Z' };
}

async function SelectorDiscoveryServiceAdapterStrategiesTestReplacesTheStubJobWhenRetryingAConfigurationRequiredJob() {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    const service = new SelectorDiscoveryService(storage, registry);
    const job = retryJob('disc-stub', 'configuration_required');
    job.error = 'Selector discovery is not configured.';
    await persistJob(storage, job);
    const retried = await service.retry('disc-stub');
    expect(retried.id).not.toBe('disc-stub');
    expect(retried.status).toBe('configuration_required');
    expect(retried.normalizedUrl).toBe('https://example.net/manga/demo/chapter-1');
    expect(retried.retriedFromId).toBe('disc-stub');
    expect(await service.get('disc-stub')).toBeNull();
    expect((await service.list()).map((entry) => entry.id)).toEqual([retried.id]);
}

async function SelectorDiscoveryServiceAdapterStrategiesTestPromotesAnAwaitingReviewTypeScriptImplementationDraft() {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    const service = new SelectorDiscoveryService(storage, registry);
    await persistJob(storage, reviewJob('disc-ts'));
    const promoted = await service.promote('disc-ts');
    const active = await storage.read<Array<{ adapterId: string; adapterImplementationTs: string }>>(
      'selector-discovery-active-implementation-adapters');
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
}

async function SelectorDiscoveryServiceAdapterStrategiesTestCapturesAGoldenFixtureBeforeRegisteringAnApprovedAdapter() {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    const captureOrder: string[] = [];
    const service = new SelectorDiscoveryService(storage, registry, {
        captureApprovalFixture: fixtureCapture(registry, captureOrder),
    });
    await persistJob(storage, reviewJob('disc-fixture'));
    const promoted = await service.promote('disc-fixture');
    expect(captureOrder).toEqual(['capture:false']);
    expect(promoted.approvalFixture?.id).toBe('fixture-1');
    expect(registry.has('generated-adapter')).toBe(true);
}

function fixtureCapture(registry: AdapterRegistry, captureOrder: string[]) {
  return async ({ adapter }: { adapter: { id: string } }) => {
    captureOrder.push(`capture:${registry.has(adapter.id)}`);
    return { id: 'fixture-1', domain: 'generated.test',
      url: 'https://generated.test/manga/title', title: '', htmlLength: 10,
      capturedAt: '2026-06-25T00:00:00.000Z', path: '/fixtures/page.html',
      expectedPath: '/fixtures/expected.json', readiness: { status: 'ready' as const,
        target: 'metadata' as const, confidence: 1, reasons: [], recommendedAction: 'continue' as const } };
  };
}

async function SelectorDiscoveryServiceAdapterStrategiesTestDoesNotRegisterAnAdapterWhenGoldenFixtureCaptureFails() {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    const service = new SelectorDiscoveryService(storage, registry, {
        captureApprovalFixture: async () => {
            throw new Error('fixture capture failed');
        },
    });
    await persistJob(storage, reviewJob('disc-fixture-failed'));
    await expect(service.promote('disc-fixture-failed')).rejects.toThrow('fixture capture failed');
    expect(registry.has('generated-adapter')).toBe(false);
    await expect(service.get('disc-fixture-failed')).resolves.toMatchObject({ status: 'awaiting_review' });
}

async function SelectorDiscoveryServiceAdapterStrategiesTestRejectsInvalidTypeScriptImplementationDraftPromotion() {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    const service = new SelectorDiscoveryService(storage, registry);
    const validation = { valid: false, syntaxValid: true,
      errors: ['missing metadata capability'], warnings: [] };
    await persistJob(storage, reviewJob('disc-invalid-ts', { implementationValidation: validation }));
    await expect(service.promote('disc-invalid-ts')).rejects.toThrow('Adapter implementation draft is invalid');
    expect(registry.size).toBe(0);
}

async function SelectorDiscoveryServiceAdapterStrategiesTestRejectsTypeScriptImplementationDraftAdapterIdCollisions() {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    registry.register(new OracleAdapter());
    const service = new SelectorDiscoveryService(storage, registry);
    const source = createImplementationDraftSource('oracle', 'other.test');
    const url = 'https://other.test/manga/title';
    await persistJob(storage, reviewJob('disc-id-collision-ts', {
      url, normalizedUrl: url, hostname: 'other.test', adapterImplementationTs: source,
    }));
    await expect(service.promote('disc-id-collision-ts')).rejects.toThrow('Adapter "oracle" is already registered');
}

async function SelectorDiscoveryServiceAdapterStrategiesTestRejectsTypeScriptImplementationDraftDomainConflicts() {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    registry.register(new OracleAdapter());
    const service = new SelectorDiscoveryService(storage, registry);
    const url = 'https://example.com/manga/title';
    const source = createImplementationDraftSource('other-generated', 'example.com');
    await persistJob(storage, reviewJob('disc-domain-collision-ts', {
      url, normalizedUrl: url, hostname: 'example.com', adapterImplementationTs: source,
    }));
    await expect(service.promote('disc-domain-collision-ts')).rejects.toThrow('Domain conflict detected for example.com');
}

async function SelectorDiscoveryServiceAdapterStrategiesTestLoadsPromotedTypeScriptImplementationAdaptersOnStartup() {
    const storage = new MemoryStorage();
    await storage.write('selector-discovery-active-implementation-adapters', [
        {
            adapterId: 'generated-adapter',
            name: 'Generated Adapter',
            domains: ['generated.test'],
            urlPatterns: ['https://generated.test/*'],
            parseMode: 'playwright',
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
}

async function SelectorDiscoveryServiceAdapterStrategiesTestRecordsAFunctionRevisionSubtaskUnderAnAwaitingReviewImplementationDraft() {
    const storage = new MemoryStorage();
    const registry = new AdapterRegistry();
    const service = new SelectorDiscoveryService(storage, registry);
    await persistJob(storage, reviewJob('disc-revision'));
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
}
