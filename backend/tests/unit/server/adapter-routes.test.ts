import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { DEFAULTS } from '@comiccrawler/shared';
import fastify from 'fastify';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AdapterRegistry } from '../../../src/adapter/registry';
import { HappyMhAdapter } from '../../../src/adapter/sites/happymh';
import { DynamicSiteAdapter } from '../../../src/adapter/dynamic-site-adapter';
import { AdapterBase } from '../../../src/adapter/base';
import { setupAdaptersRoutes } from '../../../src/server/routes/adapters';
import {
  DELETED_ADAPTERS_KEY,
  registerProjectAdapters,
} from '../../../src/adapter/runtime-state';
import { AdapterCatalog } from '../../../src/adapter/catalog';
import { createAdapterPackage } from '../../../src/adapter/package-builder';
import { instantiateAdapterImplementationDraft } from '../../../src/selector-discovery/adapter-draft-runtime';
import type { IStorage } from '../../../src/storage/types';
import { BrowserRenderService } from '../../../src/browser/browser-render-service';

class MemoryStorage implements IStorage {
  readonly data = new Map<string, unknown>();

  async read<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T | undefined) ?? null;
  }

  async write(key: string, value: unknown): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async list(): Promise<string[]> {
    return Array.from(this.data.keys());
  }

  async exists(key: string): Promise<boolean> {
    return this.data.has(key);
  }
}

class RenderedDemoAdapter extends AdapterBase {
  readonly id: string = 'rendered-demo';
  readonly name = 'Rendered Demo';
  readonly domains = ['example.com'];
  readonly parseMode = 'playwright' as const;
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

class BlockedRenderedAdapter extends RenderedDemoAdapter {
  override readonly id = 'blocked-rendered';
  override readonly capabilities = { verification: true, metadata: false, chapterImages: true };
}

class ForbiddenRenderedAdapter extends RenderedDemoAdapter {
  override readonly id = 'forbidden-rendered';
  override readonly capabilities = { verification: true, metadata: false, chapterImages: true };
}

class TimeoutHappyMhAdapter extends HappyMhAdapter {
  override async loadDocument(): Promise<unknown> {
    throw new Error('page.goto: Timeout 30000ms exceeded.');
  }
}

type RouteOptions = Parameters<typeof setupAdaptersRoutes>[2];

function appWithAdapter(adapter: Parameters<AdapterRegistry['register']>[0], options?: RouteOptions) {
  const app = fastify();
  const registry = new AdapterRegistry();
  registry.register(adapter);
  setupAdaptersRoutes(app, registry, options);
  return app;
}

function appWithAdapters(adapters: Array<Parameters<AdapterRegistry['register']>[0]>, options?: RouteOptions) {
  const app = fastify();
  const registry = new AdapterRegistry();
  for (const adapter of adapters) registry.register(adapter);
  setupAdaptersRoutes(app, registry, options);
  return { app, registry };
}

function deletedProjectRecord() {
  return { adapterId: 'happymh', deletedAt: '2026-07-10T00:00:00.000Z',
    implementationKind: 'project-source', sourcePath: 'backend/src/adapter/sites/happymh/adapter.ts',
    sourceDeleted: true };
}

function verifiedDynamicAdapter(adapterId: string, name: string): DynamicSiteAdapter {
  return new DynamicSiteAdapter({ adapterId, name, domains: ['example.com'],
    urlPatterns: ['https://example.com/*'],
    capabilities: { verification: true, metadata: true, chapterImages: true },
    selectors: { metadata: { title: 'h1', author: '', cover: '', status: '', tags: '' },
      chapters: { list: '.chapters', item: 'a', title: 'a', url: 'a' },
      images: { item: '.reader img', srcAttr: 'src' } },
    sourceDiscoveryId: 'disc-1', promotedAt: '2026-07-09T00:00:00.000Z' });
}

function chapterOnlyDynamicAdapter(adapterId = 'dynamic-demo', name = 'Dynamic Demo') {
  return new DynamicSiteAdapter({ adapterId, name, domains: ['example.com'],
    urlPatterns: ['https://example.com/read/*'],
    capabilities: { verification: true, metadata: false, chapterImages: true },
    selectors: { images: { item: '.reader img', srcAttr: 'src' } },
    sourceDiscoveryId: 'disc-1', promotedAt: '2026-07-09T00:00:00.000Z' });
}

async function managedCatalogFixture(storage: IStorage, selector = 'img.page') {
  const catalog = new AdapterCatalog(storage);
  await catalog.initialize();
  const implementationTs = catalogAdapterSource(selector);
  const adapter = instantiateAdapterImplementationDraft(implementationTs);
  const document = createAdapterPackage({ adapter, implementationTs, origin: 'local-generated',
    createdAt: selector === 'img.page' ? '2026-07-09T00:00:00.000Z' : '2026-07-10T00:00:00.000Z',
    sourceDiscoveryId: 'disc-1' });
  await catalog.installApproved(document);
  return { adapter, catalog, document };
}

function catalogAdapterSource(selector: string): string {
  return `import { AdapterBase, CommonCapability, VerificationCapability, ChapterImagesCapability } from '../../base'; export class DynamicDemoAdapter extends AdapterBase {
  readonly id = 'dynamic-demo'; readonly name = 'Dynamic Demo'; readonly domains = ['demo.invalid'];
  readonly parseMode = 'playwright' as const;
  readonly capabilities = { verification: true, metadata: false, chapterImages: true };
  readonly common = new DemoCommon(this); readonly verification = new DemoVerification(this);
  readonly chapterImages = new DemoImages(this);
}
class DemoCommon extends CommonCapability { matchUrl(url: string): boolean { return url.includes('demo.invalid'); } }
class DemoVerification extends VerificationCapability {
  detectVerificationRequired(_input: string): boolean { return false; }
  describeVerificationHandoff(): Record<string, unknown> { return { supported: false }; }
}
class DemoImages extends ChapterImagesCapability {
  extractChapterImageUrls(document: unknown, sourceUrl: string): string[] {
    const $ = this.adapter.asCheerio(document); void sourceUrl; return $('${selector}')
      .map((_, node) => $(node).attr('src') ?? '').get();
  }
}`;
}

function postFunction(app: ReturnType<typeof fastify>, adapterId: string, functionId: string,
  payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: `/api/adapters/${adapterId}/functions/${functionId}/test`, payload });
}

function readyChallengeOptions(readRemotePageSnapshot: jest.Mock): RouteOptions {
  return { challengeDiscoveryService: {
    get: jest.fn(async () => ({ id: 'chal-1', status: 'ready' })), readRemotePageSnapshot,
  } as any };
}

let previousAgentWorkspacePath: string | undefined;

let previousProjectSourceRoot: string | undefined;

let testAgentWorkspacePath: string | undefined;

describe('Adapter routes', () => {
  AdapterRoutesTestGroup1();
  AdapterRoutesTestGroup2();
  AdapterRoutesTestGroup3();
});

function AdapterRoutesTestGroup1(): void {
  beforeEach(AdapterRoutesTestScenario1);
  afterEach(AdapterRoutesTestScenario2);
  it('resolves HappyMH as a full adapter for manga catalog URLs', AdapterRoutesTestResolvesHappyMHAsAFullAdapterForMangaCatalogURLs);
  it('resolves HappyMH for specific chapter URLs', AdapterRoutesTestResolvesHappyMHForSpecificChapterURLs);
  it('extracts the complete ordered image URL list directly through the matched adapter', AdapterRoutesTestExtractsTheCompleteOrderedImageURLListDirectlyThroughTheMatchedAdapter);
  it('extracts chapter images through the task-bound Browser Worker session', AdapterRoutesTestExtractsChapterImagesThroughTheTaskBoundBrowserWorkerSession);
  it('reuses the verified challenge session instead of leasing a second Browser Worker session', AdapterRoutesTestReusesTheVerifiedChallengeSessionInsteadOfLeasingASecondBrowserWorkerSession);
  it.each([
    [{ viewport: { width: 0, height: 800 } }, 'renderContext.viewport.width'],
    [{ viewport: { width: 600.5, height: 800 } }, 'renderContext.viewport.width'],
    [{ viewport: { width: 600, height: 10001 } }, 'renderContext.viewport.height'],
    [{ viewport: { width: 600, height: 800 }, deviceScaleFactor: 0 }, 'renderContext.deviceScaleFactor'],
])('rejects an invalid chapter image render context', AdapterRoutesTestRejectsAnInvalidChapterImageRenderContext);
  it('lists adapters with same-level runtime metadata', AdapterRoutesTestListsAdaptersWithSameLevelRuntimeMetadata);
  it('deletes project-source adapters by removing source files and persisting a runtime deletion marker', AdapterRoutesTestDeletesProjectSourceAdaptersByRemovingSourceFilesAndPersistingARuntimeDeletionMarker);
}

function AdapterRoutesTestGroup2(): void {
  it('does not re-register a deleted project-source adapter during startup registration', AdapterRoutesTestDoesNotReRegisterADeletedProjectSourceAdapterDuringStartupRegistration);
  it('deactivates generated adapters in the catalog', AdapterRoutesTestDeactivatesGeneratedAdaptersInCatalog);
  it('lists deleted adapters with restore status', AdapterRoutesTestListsDeletedAdaptersWithRestoreStatus);
  it('restores deleted generated adapters from an approved catalog version', AdapterRoutesTestRestoresDeletedGeneratedAdaptersFromCatalog);
  it('rolls a generated adapter back to an approved catalog version', AdapterRoutesTestRollsBackGeneratedAdapter);
  it('lists approved catalog versions', AdapterRoutesTestListsApprovedCatalogVersions);
  it('exports an immutable catalog package', AdapterRoutesTestExportsCatalogPackage);
  it('imports a package inactive by default', AdapterRoutesTestImportsPackageInactive);
  it('does not restore deleted project-source adapters when the source directory is missing', AdapterRoutesTestDoesNotRestoreDeletedProjectSourceAdaptersWhenTheSourceDirectoryIsMissing);
  it('returns 404 when deleting an unknown adapter', AdapterRoutesTestReturns404WhenDeletingAnUnknownAdapter);
  it('lists adapter function descriptors by capability', AdapterRoutesTestListsAdapterFunctionDescriptorsByCapability);
  it('returns full project-source adapter implementation for Adapter Lab workbench', AdapterRoutesTestReturnsFullProjectSourceAdapterImplementationForAdapterLabWorkbench);
  it('returns a catalog package implementation for Adapter Lab workbench', AdapterRoutesTestReturnsCatalogPackageImplementationForAdapterLabWorkbench);
  it('tests metadata and chapter image functions with structured summaries', AdapterRoutesTestTestsMetadataAndChapterImageFunctionsWithStructuredSummaries);
}

function AdapterRoutesTestGroup3(): void {
  it('starts verification handoff for rendered extraction failures with verification message', AdapterRoutesTestStartsVerificationHandoffForRenderedExtractionFailuresWithVerificationMessage);
  it('detects verification from HTTP 403 fetch failures and opens handoff', AdapterRoutesTestDetectsVerificationFromHTTP403FetchFailuresAndOpensHandoff);
  it('offers verification handoff when Playwright rendering times out', AdapterRoutesTestOffersVerificationHandoffWhenPlaywrightRenderingTimesOut);
  it('retests verification against verified browser HTML instead of refetching the blocked URL', AdapterRoutesTestRetestsVerificationAgainstVerifiedBrowserHTMLInsteadOfRefetchingTheBlockedURL);
  it('tests chapter-list extraction without hidden catalog expansion or fixture capture', AdapterRoutesTestTestsChapterListExtractionWithoutHiddenCatalogExpansionOrFixtureCapture);
  it('does not treat residual challenge keywords inside verified manga HTML as active verification', AdapterRoutesTestDoesNotTreatResidualChallengeKeywordsInsideVerifiedMangaHTMLAsActiveVerification);
  it('rejects verified browser snapshots from a different page path', AdapterRoutesTestRejectsVerifiedBrowserSnapshotsFromADifferentPagePath);
}

async function AdapterRoutesTestScenario1() {
    previousAgentWorkspacePath = process.env.AGENT_WORKSPACE_PATH;
    previousProjectSourceRoot = process.env.COMICCRAWLER_PROJECT_SOURCE_ROOT;
    testAgentWorkspacePath = await mkdtemp(join(tmpdir(), 'comiccrawler-adapter-lab-'));
    process.env.AGENT_WORKSPACE_PATH = testAgentWorkspacePath;
}

async function AdapterRoutesTestScenario2() {
    if (previousAgentWorkspacePath === undefined) {
        delete process.env.AGENT_WORKSPACE_PATH;
    }
    else {
        process.env.AGENT_WORKSPACE_PATH = previousAgentWorkspacePath;
    }
    if (previousProjectSourceRoot === undefined) {
        delete process.env.COMICCRAWLER_PROJECT_SOURCE_ROOT;
    }
    else {
        process.env.COMICCRAWLER_PROJECT_SOURCE_ROOT = previousProjectSourceRoot;
    }
    if (testAgentWorkspacePath) {
        await rm(testAgentWorkspacePath, { recursive: true, force: true });
    }
    testAgentWorkspacePath = undefined;
}

async function AdapterRoutesTestResolvesHappyMHAsAFullAdapterForMangaCatalogURLs() {
    const app = appWithAdapter(new HappyMhAdapter());
    const response = await app.inject({
        method: 'POST',
        url: '/api/adapters/resolve',
        payload: {
            url: 'https://m.happymh.com/manga/wozaixingjiguojiadangedelingzhu',
            mode: 'all',
        },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ status: 'matched', discoveryTarget: 'full',
      adapter: { id: 'happymh',
        capabilities: { verification: true, metadata: true, chapterImages: true } } });
    await app.close();
}

async function AdapterRoutesTestResolvesHappyMHForSpecificChapterURLs() {
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
}

async function AdapterRoutesTestExtractsTheCompleteOrderedImageURLListDirectlyThroughTheMatchedAdapter() {
    const adapter = new RenderedDemoAdapter();
    jest.spyOn(adapter as any, 'fetchHtml').mockResolvedValue('<div class="reader"><img src="/images/1.jpg"><img src="/images/2.jpg"><img src="/images/3.webp"></div>');
    const getNetworkConfig = jest.fn(async () => DEFAULTS.network);
    const htmlRenderer = { render: jest.fn(async () => '<html></html>'), dispose: jest.fn(async () => undefined) };
    const app = appWithAdapter(adapter, { htmlRenderer, getNetworkConfig });
    const response = await app.inject({
        method: 'POST',
        url: '/api/adapters/chapter-images',
        payload: { url: 'https://example.com/read/1' },
    });
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expectChapterImagePayload(data);
    expectChapterImageIdentities(data);
    expect(getNetworkConfig).toHaveBeenCalledTimes(1);
    await app.close();
}

function expectChapterImagePayload(data: any): void {
    expect(data).toMatchObject(CHAPTER_IMAGE_PAYLOAD);
}

const CHAPTER_IMAGE_PAYLOAD = {
        adapterId: 'rendered-demo',
        chapterUrl: 'https://example.com/read/1',
        chapter: {
            canonicalUrl: 'https://example.com/read/1',
            stability: 'deterministic',
            identitySource: 'normalized-url',
        },
        imageUrlCount: 3,
        imageUrls: [
            'https://example.com/images/1.jpg',
            'https://example.com/images/2.jpg',
            'https://example.com/images/3.webp',
        ],
        domSource: 'rendered',
        renderContext: {
            viewport: { width: 1920, height: 1080 },
            deviceScaleFactor: 1,
        },
};

function expectChapterImageIdentities(data: any): void {
    expect(data.chapter.id).toMatch(/^chapter_/);
    expect(data.images).toHaveLength(3);
    expect(data.images.map((image: {
        url: string;
    }) => image.url)).toEqual(data.imageUrls);
    expect(data.images.map((image: {
        orderIndex: number;
    }) => image.orderIndex)).toEqual([0, 1, 2]);
    expect(data.images.every((image: {
        id: string;
    }) => image.id.startsWith('page_'))).toBe(true);
}

async function AdapterRoutesTestExtractsChapterImagesThroughTheTaskBoundBrowserWorkerSession() {
    const execute = jest.fn(browserCommandResult);
    const withBrowserSession = jest.fn(async (_request: unknown, _target: unknown, _initialUrl: string, _renderContext: unknown, action: (sessionId: string) => Promise<unknown>) => action('session-1'));
    const app = appWithAdapter(new RenderedDemoAdapter(), {
        browserRenderService: new BrowserRenderService({ execute }),
        withBrowserSession: withBrowserSession as any,
    });
    const renderContext = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 };
    const response = await app.inject({ method: 'POST', url: '/api/adapters/chapter-images',
      payload: { url: 'https://example.com/read/1', renderContext } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.imageUrls).toEqual([
        'https://example.com/images/1.jpg', 'https://example.com/images/2.jpg',
    ]);
    expect(withBrowserSession).toHaveBeenCalledWith(expect.anything(), undefined,
      'https://example.com/read/1', renderContext, expect.any(Function));
    expect(execute.mock.calls.map((call) => call[1].type)).toEqual(BROWSER_COMMAND_ORDER);
    await app.close();
}

async function browserCommandResult(_sessionId: string, command: {
        type: string;
        url?: string;
    }) {
        if (command.type === 'page.get-url')
            return { type: 'page.get-url' as const, url: 'about:blank' };
        if (command.type === 'page.navigate')
            return { type: 'page.navigate' as const, url: command.url! };
        if (command.type === 'page.wait-for-ready')
            return { type: 'page.wait-for-ready' as const, url: 'https://example.com/read/1' };
        if (command.type === 'page.prepare-content')
            return { type: 'page.prepare-content' as const, url: 'https://example.com/read/1' };
        return {
            type: 'page.get-content' as const,
            url: 'https://example.com/read/1',
            html: '<div class="reader"><img src="/images/1.jpg"><img src="/images/2.jpg"></div>',
        };
}

const BROWSER_COMMAND_ORDER = ['page.get-url', 'page.navigate', 'page.wait-for-ready',
  'page.prepare-content', 'page.get-content'];

async function AdapterRoutesTestReusesTheVerifiedChallengeSessionInsteadOfLeasingASecondBrowserWorkerSession() {
    const withBrowserSession = jest.fn(async () => {
        throw new Error('A second Browser Worker session must not be acquired.');
    });
    const readRemotePageSnapshot = jest.fn(readyChapterSnapshot);
    const app = appWithAdapter(new RenderedDemoAdapter(),
      reuseChallengeOptions(readRemotePageSnapshot, withBrowserSession));
    const response = await app.inject({ method: 'POST', url: '/api/adapters/chapter-images',
      payload: { url: 'https://example.com/read/1', challengeDiscoveryId: 'chal-1' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.imageUrls).toEqual([
        'https://example.com/images/1.jpg', 'https://example.com/images/2.jpg',
    ]);
    expect(readRemotePageSnapshot).toHaveBeenCalledWith('chal-1',
      { settle: true, allowNavigate: false });
    expect(withBrowserSession).not.toHaveBeenCalled();
    await app.close();
}

function reuseChallengeOptions(readRemotePageSnapshot: jest.Mock, withBrowserSession: jest.Mock): RouteOptions {
  return { challengeDiscoveryService: { get: jest.fn(async () => ({ id: 'chal-1', status: 'ready' })),
    readRemotePageSnapshot } as any,
    browserRenderService: new BrowserRenderService({ execute: async () => {
      throw new Error('Unexpected BrowserRenderService call.');
    } }), withBrowserSession: withBrowserSession as any };
}

async function readyChapterSnapshot() {
  return { job: { id: 'chal-1', status: 'ready' }, page: {
    url: 'https://example.com/read/1', title: 'Chapter 1',
    html: '<div class="reader"><img src="/images/1.jpg"><img src="/images/2.jpg"></div>',
  } };
}

async function AdapterRoutesTestRejectsAnInvalidChapterImageRenderContext(
  renderContext: unknown, expectedError: string
) {
    const app = fastify();
    const registry = new AdapterRegistry();
    registry.register(new RenderedDemoAdapter());
    setupAdaptersRoutes(app, registry);
    const response = await app.inject({
        method: 'POST',
        url: '/api/adapters/chapter-images',
        payload: { url: 'https://example.com/read/1', renderContext },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain(expectedError);
    await app.close();
}

async function AdapterRoutesTestListsAdaptersWithSameLevelRuntimeMetadata() {
    const storage = new MemoryStorage();
    const managed = await managedCatalogFixture(storage);
    const { app } = appWithAdapters([new HappyMhAdapter(), managed.adapter],
      { storage, adapterCatalog: managed.catalog });
    const response = await app.inject({ method: 'GET', url: '/api/adapters' });
    expect(response.statusCode).toBe(200);
    expectRuntimeMetadata(response.json().data, managed.document.manifest.version);
    await app.close();
}

function expectRuntimeMetadata(data: unknown, activeVersion: string): void {
    expect(data).toEqual(expect.arrayContaining([
        expect.objectContaining({
            id: 'happymh',
            activeVersionLabel: 'current',
            versionCount: 1,
            implementationKind: 'project-source',
        }),
        expect.objectContaining({
            id: 'dynamic-demo',
            activeVersionLabel: activeVersion,
            versionCount: 1,
            implementationKind: 'ts-implementation',
        }),
    ]));
}

async function AdapterRoutesTestDeletesProjectSourceAdaptersByRemovingSourceFilesAndPersistingARuntimeDeletionMarker() {
    const storage = new MemoryStorage();
    const { sourceRoot, adapterSourceDir } = await createProjectSourceFixture();
    process.env.COMICCRAWLER_PROJECT_SOURCE_ROOT = sourceRoot;
    const { app, registry } = appWithAdapters([new HappyMhAdapter()], { storage });
    const response = await app.inject({ method: 'DELETE', url: '/api/adapters/happymh' });
    expect(response.statusCode).toBe(200);
    expectDeletedProjectResponse(response.json().data);
    expect(registry.has('happymh')).toBe(false);
    expect(existsSync(adapterSourceDir)).toBe(false);
    expect(await storage.read(DELETED_ADAPTERS_KEY)).toEqual([
        expect.objectContaining({ adapterId: 'happymh', implementationKind: 'project-source', sourceDeleted: true }),
    ]);
    await app.close();
    await rm(sourceRoot, { recursive: true, force: true });
}

async function createProjectSourceFixture() {
  const sourceRoot = await mkdtemp(join(tmpdir(), 'comiccrawler-source-root-'));
  const adapterSourceDir = join(sourceRoot, 'backend', 'src', 'adapter', 'sites', 'happymh');
  await mkdir(adapterSourceDir, { recursive: true });
  await writeFile(join(adapterSourceDir, 'adapter.ts'), 'export class HappyMhAdapter {}\n', 'utf-8');
  return { sourceRoot, adapterSourceDir };
}

function expectDeletedProjectResponse(data: unknown): void {
    expect(data).toMatchObject({
        adapterId: 'happymh',
        implementationKind: 'project-source',
        registryRemoved: true,
        catalogDeactivated: false,
        deletedMarkerWritten: true,
        sourcePath: 'backend/src/adapter/sites/happymh/adapter.ts',
        sourceDeleted: true,
    });
}

async function AdapterRoutesTestDoesNotReRegisterADeletedProjectSourceAdapterDuringStartupRegistration() {
    const registry = new AdapterRegistry();
    const storage = new MemoryStorage();
    await storage.write(DELETED_ADAPTERS_KEY, [{ adapterId: 'happymh', deletedAt: '2026-07-09T00:00:00.000Z' }]);
    await registerProjectAdapters(storage, (adapter) => registry.register(adapter), [new HappyMhAdapter()]);
    expect(registry.has('happymh')).toBe(false);
}

async function AdapterRoutesTestDeactivatesGeneratedAdaptersInCatalog() {
    const storage = new MemoryStorage();
    const managed = await managedCatalogFixture(storage);
    const { app, registry } = appWithAdapters([managed.adapter],
      { storage, adapterCatalog: managed.catalog });
    const response = await app.inject({ method: 'DELETE', url: '/api/adapters/dynamic-demo' });
    expect(response.statusCode).toBe(200);
    expectCatalogDeactivationResponse(response.json().data);
    expect(registry.has('dynamic-demo')).toBe(false);
    expect(await managed.catalog.getEntry('dynamic-demo')).toMatchObject({
      activeVersion: null, lastActiveVersion: managed.document.manifest.version,
      deletedAt: expect.any(String),
    });
    await app.close();
}

function expectCatalogDeactivationResponse(data: unknown): void {
  expect(data).toMatchObject({
    adapterId: 'dynamic-demo', implementationKind: 'ts-implementation',
    registryRemoved: true, catalogDeactivated: true,
    deletedMarkerWritten: false, sourceDeleted: false,
  });
}

async function AdapterRoutesTestListsDeletedAdaptersWithRestoreStatus() {
    const app = fastify();
    const registry = new AdapterRegistry();
    const storage = new MemoryStorage();
    const managed = await managedCatalogFixture(storage);
    await managed.catalog.deactivate('dynamic-demo');
    const sourceRoot = await mkdtemp(join(tmpdir(), 'comiccrawler-source-root-'));
    process.env.COMICCRAWLER_PROJECT_SOURCE_ROOT = sourceRoot;
    await storage.write(DELETED_ADAPTERS_KEY, [deletedProjectRecord()]);
    setupAdaptersRoutes(app, registry, { storage, adapterCatalog: managed.catalog });
    const response = await app.inject({ method: 'GET', url: '/api/adapters/deleted' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.adapters).toEqual(expect.arrayContaining([
        expect.objectContaining({ adapterId: 'dynamic-demo', restorable: true }),
        expect.objectContaining({ adapterId: 'happymh', restorable: false }),
    ]));
    await app.close();
    await rm(sourceRoot, { recursive: true, force: true });
}

async function AdapterRoutesTestRestoresDeletedGeneratedAdaptersFromCatalog() {
    const app = fastify();
    const registry = new AdapterRegistry();
    const storage = new MemoryStorage();
    const managed = await managedCatalogFixture(storage);
    await managed.catalog.deactivate('dynamic-demo');
    setupAdaptersRoutes(app, registry, { storage, adapterCatalog: managed.catalog });
    const response = await app.inject({ method: 'POST', url: '/api/adapters/dynamic-demo/restore' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ adapterId: 'dynamic-demo', restored: true });
    expect(registry.has('dynamic-demo')).toBe(true);
    expect((await managed.catalog.getEntry('dynamic-demo'))?.activeVersion)
      .toBe(managed.document.manifest.version);
    await app.close();
}

async function AdapterRoutesTestRollsBackGeneratedAdapter() {
  const storage = new MemoryStorage();
  const first = await managedCatalogFixture(storage);
  const secondSource = catalogAdapterSource('img.reader');
  const secondAdapter = instantiateAdapterImplementationDraft(secondSource);
  const secondPackage = createAdapterPackage({ adapter: secondAdapter, implementationTs: secondSource,
    origin: 'local-generated', createdAt: '2026-07-10T00:00:00.000Z' });
  await first.catalog.installApproved(secondPackage);
  const { app } = appWithAdapters([secondAdapter], { storage, adapterCatalog: first.catalog });
  const response = await app.inject({ method: 'POST', url: '/api/adapters/dynamic-demo/rollback', payload: {} });
  expect(response.statusCode).toBe(200);
  expect(response.json().data).toMatchObject({ activeVersion: first.document.manifest.version, rolledBack: true });
  await app.close();
}

async function AdapterRoutesTestListsApprovedCatalogVersions() {
  const storage = new MemoryStorage();
  const managed = await managedCatalogFixture(storage);
  const { app } = appWithAdapters([managed.adapter], { storage, adapterCatalog: managed.catalog });
  const response = await app.inject({ method: 'GET', url: '/api/adapters/dynamic-demo/versions' });
  expect(response.statusCode).toBe(200);
  expect(response.json().data).toMatchObject({ adapterId: 'dynamic-demo',
    activeVersion: managed.document.manifest.version,
    versions: [expect.objectContaining({ version: managed.document.manifest.version, status: 'active' })] });
  await app.close();
}

async function AdapterRoutesTestExportsCatalogPackage() {
  const storage = new MemoryStorage();
  const managed = await managedCatalogFixture(storage);
  const { app } = appWithAdapters([managed.adapter], { storage, adapterCatalog: managed.catalog });
  const path = `/api/adapters/dynamic-demo/versions/${managed.document.manifest.version}/package`;
  const response = await app.inject({ method: 'GET', url: path });
  expect(response.statusCode).toBe(200);
  expect(response.json().data).toEqual(managed.document);
  await app.close();
}

async function AdapterRoutesTestImportsPackageInactive() {
  const storage = new MemoryStorage();
  const catalog = new AdapterCatalog(storage);
  await catalog.initialize();
  const source = catalogAdapterSource('img.page');
  const adapter = instantiateAdapterImplementationDraft(source);
  const document = createAdapterPackage({ adapter, implementationTs: source,
    origin: 'local-generated', createdAt: '2026-10-22T00:00:00.000Z' });
  const { app, registry } = appWithAdapters([], { storage, adapterCatalog: catalog });
  const response = await app.inject({ method: 'POST', url: '/api/adapter-packages/import',
    payload: { document } });
  expect(response.statusCode).toBe(200);
  expect(response.json().data).toMatchObject({ activated: false,
    entry: { adapterId: 'dynamic-demo', activeVersion: null } });
  expect(registry.has('dynamic-demo')).toBe(false);
  await app.close();
}

async function AdapterRoutesTestDoesNotRestoreDeletedProjectSourceAdaptersWhenTheSourceDirectoryIsMissing() {
    const app = fastify();
    const registry = new AdapterRegistry();
    const storage = new MemoryStorage();
    const sourceRoot = await mkdtemp(join(tmpdir(), 'comiccrawler-source-root-'));
    process.env.COMICCRAWLER_PROJECT_SOURCE_ROOT = sourceRoot;
    await storage.write(DELETED_ADAPTERS_KEY, [deletedProjectRecord()]);
    setupAdaptersRoutes(app, registry, { storage });
    const response = await app.inject({ method: 'POST', url: '/api/adapters/happymh/restore' });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toContain('Project TypeScript source is missing');
    expect(registry.has('happymh')).toBe(false);
    await app.close();
    await rm(sourceRoot, { recursive: true, force: true });
}

async function AdapterRoutesTestReturns404WhenDeletingAnUnknownAdapter() {
    const app = fastify();
    const registry = new AdapterRegistry();
    setupAdaptersRoutes(app, registry, { storage: new MemoryStorage() });
    const response = await app.inject({ method: 'DELETE', url: '/api/adapters/missing' });
    expect(response.statusCode).toBe(404);
    await app.close();
}

async function AdapterRoutesTestListsAdapterFunctionDescriptorsByCapability() {
    const app = appWithAdapter(chapterOnlyDynamicAdapter('chapter-only', 'Chapter Only'));
    const response = await app.inject({ method: 'GET', url: '/api/adapters/chapter-only/capabilities' });
    expect(response.statusCode).toBe(200);
    const functions = response.json().data.functions as Array<{
        id: string;
        implemented: boolean;
    }>;
    expect(functions.find((item) => item.id === 'extractTitle')?.implemented).toBe(false);
    expect(functions.find((item) => item.id === 'extractChapterImageUrls')?.implemented).toBe(true);
    await app.close();
}

async function AdapterRoutesTestReturnsFullProjectSourceAdapterImplementationForAdapterLabWorkbench() {
    const app = appWithAdapter(new HappyMhAdapter());
    const response = await app.inject({ method: 'GET', url: '/api/adapters/happymh/implementation' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
        adapterId: 'happymh',
        sourceType: 'project-source',
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
}

async function AdapterRoutesTestReturnsCatalogPackageImplementationForAdapterLabWorkbench() {
    const storage = new MemoryStorage();
    const managed = await managedCatalogFixture(storage);
    const { app } = appWithAdapters([managed.adapter], { storage, adapterCatalog: managed.catalog });
    const response = await app.inject({ method: 'GET', url: '/api/adapters/dynamic-demo/implementation' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
        adapterId: 'dynamic-demo',
        sourceType: 'catalog-package',
        language: 'typescript',
    });
    expect(response.json().data.content).toContain('class DynamicDemoAdapter');
    expect(response.json().data.outline).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'extractChapterImageUrls', kind: 'method' }),
    ]));
    await app.close();
}

async function AdapterRoutesTestTestsMetadataAndChapterImageFunctionsWithStructuredSummaries() {
    const adapter = new RenderedDemoAdapter();
    jest.spyOn(adapter as any, 'fetchHtml').mockImplementation(structuredTestHtml);
    const app = appWithAdapter(adapter);
    const metadata = await postFunction(app, 'rendered-demo', 'extractTitle',
      { url: 'https://example.com/manga/demo' });
    const images = await postFunction(app, 'rendered-demo', 'extractChapterImageUrls',
      { url: 'https://example.com/read/1' });
    expectStructuredFunctionResults(metadata, images);
    await app.close();
}

async function structuredTestHtml(url: unknown): Promise<string> {
  return String(url).includes('/manga/')
    ? '<h1>Demo Title</h1><div class="chapters"><a href="/read/1">Chapter 1</a></div>'
    : '<div class="reader"><img src="/images/1.jpg"><img src="/images/2.jpg"></div>';
}

function expectStructuredFunctionResults(metadata: any, images: any): void {
    expect(metadata.statusCode).toBe(200);
    expect(metadata.json().data).toMatchObject({
        ok: true,
        domSource: 'rendered',
        resultSummary: { title: 'Demo Title' },
    });
    expect(images.statusCode).toBe(200);
    expect(images.json().data).toMatchObject({ ok: true, domSource: 'rendered',
      resultSummary: { imageUrlCount: 2, imageUrls: [
        'https://example.com/images/1.jpg', 'https://example.com/images/2.jpg',
      ] } });
}

async function AdapterRoutesTestStartsVerificationHandoffForRenderedExtractionFailuresWithVerificationMessage() {
    const adapter = new BlockedRenderedAdapter();
    jest.spyOn(adapter as any, 'fetchHtml').mockRejectedValue(new Error('Human verification is required before crawling can continue.'));
    const app = appWithAdapter(adapter);
    const response = await postFunction(app, 'blocked-rendered', 'extractChapterImageUrls',
      { url: 'https://example.com/read/1' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
        ok: false,
        status: 'verification_required',
        requiresVerification: true,
        domSource: 'handoff-required',
    });
    await app.close();
}

async function AdapterRoutesTestDetectsVerificationFromHTTP403FetchFailuresAndOpensHandoff() {
    const adapter = new ForbiddenRenderedAdapter();
    jest.spyOn(adapter as any, 'fetchHtml').mockRejectedValue(new Error('HTTP 403 for https://example.com/manga/demo'));
    const app = appWithAdapter(adapter);
    const response = await postFunction(app, 'forbidden-rendered', 'detectVerificationRequired',
      { url: 'https://example.com/manga/demo' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
        ok: false,
        status: 'verification_required',
        requiresVerification: true,
        domSource: 'handoff-required',
    });
    await app.close();
}

async function AdapterRoutesTestOffersVerificationHandoffWhenPlaywrightRenderingTimesOut() {
    const createDeferred = jest.fn(async () => ({
        id: 'chal-timeout',
        status: 'queued',
        normalizedUrl: 'https://m.happymh.com/manga/demo',
    }));
    const app = appWithAdapter(new TimeoutHappyMhAdapter(), {
        challengeDiscoveryService: { createDeferred } as any,
    });
    const response = await postFunction(app, 'happymh', 'extractTitle',
      { url: 'https://m.happymh.com/manga/demo' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ ok: false, status: 'verification_required',
      requiresVerification: true, challengeDiscoveryId: 'chal-timeout' });
    expect(createDeferred).toHaveBeenCalledWith({ url: 'https://m.happymh.com/manga/demo' });
    await app.close();
}

async function AdapterRoutesTestRetestsVerificationAgainstVerifiedBrowserHTMLInsteadOfRefetchingTheBlockedURL() {
    const adapter = verifiedDynamicAdapter('verified-demo', 'Verified Demo');
    const fetchHtmlSpy = jest.spyOn(adapter as any, 'fetchHtml').mockRejectedValue(new Error('HTTP 403 for https://example.com/manga/demo'));
    const app = appWithAdapter(adapter, readyChallengeOptions(jest.fn(verifiedMangaSnapshot)));
    const response = await postFunction(app, 'verified-demo', 'detectVerificationRequired',
      { url: 'https://example.com/manga/demo', challengeDiscoveryId: 'chal-1' });
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
}

async function verifiedMangaSnapshot(_id: string, options?: { settle?: boolean; allowNavigate?: boolean }) {
  expect(options).toMatchObject({ settle: false, allowNavigate: false });
  return { job: { id: 'chal-1', status: 'ready', normalizedUrl: 'https://example.com/manga/demo' },
    page: { url: 'https://example.com/manga/demo', title: 'Demo',
      html: '<html><body><h1>Verified manga page</h1></body></html>' } };
}

async function AdapterRoutesTestTestsChapterListExtractionWithoutHiddenCatalogExpansionOrFixtureCapture() {
    const adapter = verifiedDynamicAdapter('verified-chapters-demo', 'Verified Chapters Demo');
    const readRemotePageSnapshot = jest.fn(verifiedChapterListSnapshot);
    const app = appWithAdapter(adapter, readyChallengeOptions(readRemotePageSnapshot));
    const response = await postFunction(app, 'verified-chapters-demo', 'extractChapterList',
      { url: 'https://example.com/manga/demo', challengeDiscoveryId: 'chal-1' });
    expectChapterListResult(response.json().data);
    expect(readRemotePageSnapshot).toHaveBeenCalledTimes(1);
    await app.close();
}

async function verifiedChapterListSnapshot(_id: string, options?: object) {
  expect(options).toMatchObject({ settle: false, allowNavigate: false });
  expect(options).not.toHaveProperty('expandCatalog');
  return { job: { id: 'chal-1', status: 'ready', normalizedUrl: 'https://example.com/manga/demo' },
    page: { url: 'https://example.com/manga/demo', title: 'Demo',
      html: '<html><body><h1>Verified manga page</h1><div class="chapters"><a href="/mangaread/demo/1">Chapter 1</a></div></body></html>' } };
}

function expectChapterListResult(data: any): void {
    expect(data).toMatchObject({
        ok: true,
        status: 'passed',
        domSource: 'verified-fixture',
        resultSummary: {
            chapterCount: 1,
            chapterDiagnostics: {
                available: true,
                allMangareadLinkCount: 1,
                sameSlugLinkCount: 1,
                returnedChapterCount: 1,
            },
            chapters: [
                expect.objectContaining({ title: 'Chapter 1' }),
            ],
        },
    });
    expectChapterListTimings(data.timings);
}

function expectChapterListTimings(timings: unknown): void {
    expect(timings).toEqual(expect.arrayContaining([
        expect.objectContaining({ step: 'dom_acquisition' }),
        expect.objectContaining({ step: 'extraction' }),
        expect.objectContaining({ step: 'readiness' }),
    ]));
}

async function AdapterRoutesTestDoesNotTreatResidualChallengeKeywordsInsideVerifiedMangaHTMLAsActiveVerification() {
    const adapter = verifiedDynamicAdapter('verified-keyword-demo', 'Verified Keyword Demo');
    const app = appWithAdapter(adapter, readyChallengeOptions(jest.fn(residualKeywordSnapshot)));
    const response = await postFunction(app, 'verified-keyword-demo', 'detectVerificationRequired',
      { url: 'https://example.com/manga/demo', challengeDiscoveryId: 'chal-1' });
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
}

async function residualKeywordSnapshot() {
  const html = ['<html><head><title>Demo</title></head><body>',
    '<h1>Verified manga page</h1>',
    '<div class="chapters"><a href="/read/1">Chapter 1</a></div>',
    '<script>window.i18n = {"challengeLabel":"人机验证"}</script>', '</body></html>'].join('');
  return { job: { id: 'chal-1', status: 'ready' },
    page: { url: 'https://example.com/manga/demo', title: 'Demo', html } };
}

async function AdapterRoutesTestRejectsVerifiedBrowserSnapshotsFromADifferentPagePath() {
    const adapter = verifiedDynamicAdapter('wrong-page-demo', 'Wrong Page Demo');
    const app = appWithAdapter(adapter, readyChallengeOptions(jest.fn(wrongPageSnapshot)));
    const response = await postFunction(app, 'wrong-page-demo', 'extractTitle',
      { url: 'https://example.com/manga/demo', challengeDiscoveryId: 'chal-1' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
        ok: false,
        status: 'failed',
    });
    expect(response.json().data.error).toContain('does not match the test URL');
    await app.close();
}

async function wrongPageSnapshot() {
  return { job: { id: 'chal-1', status: 'ready' }, page: {
    url: 'https://example.com/mangaread/demo/1', title: 'Wrong page',
    html: '<html><body><h1>Wrong page</h1></body></html>',
  } };
}
