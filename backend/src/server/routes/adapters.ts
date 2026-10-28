import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
  AdapterListItem,
  AdapterCapabilityDetailResponse,
  AdapterFunctionDescriptor,
  AdapterFunctionTestRequest,
  ChapterImagesRequest,
  ChapterImagesResponse,
  EffectiveRenderContext,
  RenderContext,
  DeletedAdapterListResponse,
  DeleteAdapterResponse,
  RestoreAdapterResponse,
  IComicAdapter,
  ChapterIdentityDescriptor,
  ChapterImageDescriptor,
  AdapterPackageImportRequest,
  AdapterPackageImportResponse,
} from '@comiccrawler/shared';
import type { AdapterRegistry } from '../../adapter/registry';
import { getAdapterCapabilities } from '../../adapter/registry';
import {
  PROJECT_ADAPTER_SOURCE,
  deleteProjectAdapterSource,
  markAdapterDeleted,
  readDeletedAdapterRecords,
  removeDeletedAdapterRecord,
  restoreDeletedAdapter,
  projectAdapterSourceExists,
  resolveProjectAdapterSourceDir,
  type AdapterImplementationKind,
} from '../../adapter/runtime-state';
import type { IStorage } from '../../storage/types';
import type { AdapterCatalog } from '../../adapter/catalog';
import { instantiateCatalogPackage } from '../../adapter/catalog-runtime';
import { activateAdapterPackage, importAdapterPackage } from '../../adapter/package-transfer';
import type { ChallengeDiscoveryService } from '../../challenge';
import { getAdapterImplementation } from './adapter-function-source';
import { testAdapterFunction, type BrowserLeaseClaim } from './adapter-function-runner';
import type { AdapterFunctionId } from './adapter-function-types';
import type { BrowserTarget, NetworkConfig } from '@comiccrawler/shared';
import type { BrowserRenderService } from '../../browser/browser-render-service';
import type { HtmlRenderer } from '../../crawler/html-renderer';
import type { ApiSecurityService } from '../../security/api-security';
import { requestPrincipal } from '../middleware/api-security';
import { trackRequestCancellation } from '../request-cancellation';

export type { AdapterFunctionId } from './adapter-function-types';
export { testAdapterFunction } from './adapter-function-runner';

interface AdapterRouteOptions {
  challengeDiscoveryService?: ChallengeDiscoveryService;
  withBrowserSession?: <T>(
    request: FastifyRequest,
    target: BrowserTarget | undefined,
    initialUrl: string,
    renderContext: EffectiveRenderContext | undefined,
    action: (sessionId: string, claimBrowserLease: BrowserLeaseClaim) => Promise<T>,
    signal?: AbortSignal
  ) => Promise<T>;
  browserRenderService?: BrowserRenderService;
  htmlRenderer?: HtmlRenderer;
  getNetworkConfig?: () => NetworkConfig | Promise<NetworkConfig>;
  storage?: IStorage;
  adapterCatalog?: AdapterCatalog;
  apiSecurity?: ApiSecurityService;
}

export function setupAdaptersRoutes(app: FastifyInstance, registry: AdapterRegistry, options: AdapterRouteOptions = {}): void {
  const context = { registry, options };
  registerAdapterCollectionRoutes(app, context);
  registerAdapterItemRoutes(app, context);
  registerAdapterExecutionRoutes(app, context);
}

interface AdapterRouteContext { registry: AdapterRegistry; options: AdapterRouteOptions }
type RegisteredAdapter = NonNullable<ReturnType<AdapterRegistry['get']>>;

function registerAdapterCollectionRoutes(app: FastifyInstance, ctx: AdapterRouteContext): void {
  app.get('/api/adapters', (_request, reply) => listAdapters(ctx, reply));
  app.get('/api/adapters/deleted', (_request, reply) => listDeletedAdapters(ctx, reply));
  app.post('/api/adapters/resolve', (request, reply) => resolveAdapter(ctx, request, reply));
  app.post('/api/adapters/chapter-images', (request, reply) => extractChapterImages(ctx, request, reply));
  app.post('/api/adapter-packages/import', { bodyLimit: 6_000_000 },
    (request, reply) => importManagedPackage(ctx, request, reply));
}

function registerAdapterItemRoutes(app: FastifyInstance, ctx: AdapterRouteContext): void {
  app.delete('/api/adapters/:id', (request, reply) => deleteAdapter(ctx, request, reply));
  app.post('/api/adapters/:id/restore', (request, reply) => restoreAdapter(ctx, request, reply));
  app.post('/api/adapters/:id/rollback', (request, reply) => rollbackManagedAdapter(ctx, request, reply));
  app.get('/api/adapters/:id/versions', (request, reply) => listManagedAdapterVersions(ctx, request, reply));
  app.get('/api/adapters/:id/versions/:version/package',
    (request, reply) => exportManagedPackage(ctx, request, reply));
  app.get('/api/adapters/:id', (request, reply) => getAdapterDetails(ctx, request, reply));
  app.get('/api/adapters/:id/capabilities', (request, reply) => getAdapterCapabilityDetails(ctx, request, reply));
  app.get('/api/adapters/:id/implementation', (request, reply) => getImplementation(ctx, request, reply));
}

function registerAdapterExecutionRoutes(app: FastifyInstance, ctx: AdapterRouteContext): void {
  app.post('/api/adapters/:id/functions/:functionId/test',
    (request, reply) => testAdapterRouteFunction(ctx, request, reply));
}

async function listAdapters(ctx: AdapterRouteContext, reply: FastifyReply): Promise<void> {
  reply.send({ data: await describeAdapterList(ctx.registry, ctx.options.adapterCatalog) });
}

async function listDeletedAdapters(ctx: AdapterRouteContext, reply: FastifyReply): Promise<void> {
  const storage = requireAdapterStorage(ctx, reply);
  if (!storage) return;
  const records = await readDeletedAdapterRecords(storage);
  const catalogEntries = await ctx.options.adapterCatalog?.listEntries() ?? [];
  const managed = catalogEntries.filter((entry) => entry.deletedAt).map((entry) => ({
    adapterId: entry.adapterId, deletedAt: entry.deletedAt!, implementationKind: 'ts-implementation' as const,
    restorable: Boolean(entry.lastActiveVersion || entry.versions.length),
    restoreReason: 'Adapter can be restored from an approved catalog version.',
  }));
  const data: DeletedAdapterListResponse = { adapters: [...records.map(describeDeletedAdapter), ...managed] };
  reply.send({ data });
}

function describeDeletedAdapter(record: Awaited<ReturnType<typeof readDeletedAdapterRecords>>[number]) {
  const sourceExists = record.sourcePath ? projectAdapterSourceExists(record.adapterId) : undefined;
  const restorable = Boolean(record.sourcePath && sourceExists);
  const restoreReason = restorable
    ? 'Adapter can be restored from saved runtime data or existing project source.'
    : record.sourcePath ? 'Project TypeScript source is missing. Restore it with git before restoring this adapter.'
      : 'No restorable runtime data is available.';
  return { adapterId: record.adapterId, deletedAt: record.deletedAt,
    implementationKind: record.implementationKind, sourcePath: record.sourcePath,
    sourceDirectory: record.sourceDirectory, sourceDeleted: record.sourceDeleted,
    sourceExists, restorable, restoreReason };
}

function requireAdapterStorage(ctx: AdapterRouteContext, reply: FastifyReply): IStorage | undefined {
  if (ctx.options.storage) return ctx.options.storage;
  reply.code(500).send({ error: 'Adapter runtime storage is not available.' });
  return undefined;
}

async function deleteAdapter(ctx: AdapterRouteContext, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const storage = requireAdapterStorage(ctx, reply);
  if (!storage) return;
  const { id } = request.params as { id: string };
  if (!ctx.registry.has(id)) return void reply.code(404).send({ error: 'Adapter not found' });
  const managed = await ctx.options.adapterCatalog?.getEntry(id);
  if (managed?.activeVersion) return deleteManagedAdapter(ctx, id, reply);
  const sourceDeletion = PROJECT_ADAPTER_SOURCE[id] ? await deleteProjectAdapterSource(id) : { deleted: false };
  const record = await markAdapterDeleted(storage, id, createDeletionRecord(id, sourceDeletion));
  ctx.registry.unregister(id);
  reply.send({ data: createDeleteAdapterResponse(ctx, id, sourceDeletion, Boolean(record)) });
}

async function deleteManagedAdapter(
  ctx: AdapterRouteContext, id: string, reply: FastifyReply
): Promise<void> {
  await ctx.options.adapterCatalog!.deactivate(id);
  ctx.registry.unregister(id);
  const data: DeleteAdapterResponse = { adapterId: id, message: 'Adapter deactivated',
    implementationKind: 'ts-implementation', registryRemoved: true, catalogDeactivated: true,
    deletedMarkerWritten: false, sourceDeleted: false };
  reply.send({ data });
}

function createDeletionRecord(
  id: string,
  source: Awaited<ReturnType<typeof deleteProjectAdapterSource>> | { deleted: boolean }
) {
  return { implementationKind: PROJECT_ADAPTER_SOURCE[id] ? 'project-source' as const : 'summary' as const,
    sourcePath: PROJECT_ADAPTER_SOURCE[id], sourceDirectory: 'sourceDir' in source ? source.sourceDir : undefined,
    sourceDeleted: source.deleted };
}

function createDeleteAdapterResponse(
  ctx: AdapterRouteContext, id: string,
  source: Awaited<ReturnType<typeof deleteProjectAdapterSource>> | { deleted: boolean }, marked: boolean
): DeleteAdapterResponse {
  return { adapterId: id, message: source.deleted ? 'Adapter deleted and source files removed' : 'Adapter deleted',
    implementationKind: PROJECT_ADAPTER_SOURCE[id] ? 'project-source' : 'summary', registryRemoved: !ctx.registry.has(id),
    catalogDeactivated: false, deletedMarkerWritten: marked, sourcePath: PROJECT_ADAPTER_SOURCE[id],
    sourceDirectory: 'sourceDir' in source ? source.sourceDir : undefined, sourceDeleted: source.deleted,
  };
}

async function restoreAdapter(ctx: AdapterRouteContext, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const storage = requireAdapterStorage(ctx, reply);
  if (!storage) return;
  const { id } = request.params as { id: string };
  if (ctx.registry.has(id)) return restoreActiveAdapter(ctx, storage, id, reply);
  const managed = await ctx.options.adapterCatalog?.getEntry(id);
  if (managed?.deletedAt) return restoreManagedAdapter(ctx, id, reply);
  const result = await restoreDeletedAdapter(storage, id, (adapter) => ctx.registry.register(adapter));
  if (!result.restored) return void reply.code(result.record ? 409 : 404)
    .send({ error: result.reason ?? 'Adapter could not be restored.' });
  const data: RestoreAdapterResponse = { adapterId: id, message: 'Adapter restored',
    implementationKind: result.record?.implementationKind, restored: true,
    sourcePath: result.record?.sourcePath, sourceDirectory: result.record?.sourceDirectory };
  reply.send({ data });
}

async function restoreManagedAdapter(
  ctx: AdapterRouteContext, id: string, reply: FastifyReply
): Promise<void> {
  await ctx.options.adapterCatalog!.restore(id);
  const document = await ctx.options.adapterCatalog!.getActivePackage(id);
  if (!document) return void reply.code(409).send({ error: 'Approved adapter package was not found.' });
  ctx.registry.register(instantiateCatalogPackage(document));
  const data: RestoreAdapterResponse = { adapterId: id, message: 'Adapter restored',
    implementationKind: 'ts-implementation', restored: true };
  reply.send({ data });
}

async function rollbackManagedAdapter(
  ctx: AdapterRouteContext, request: FastifyRequest, reply: FastifyReply
): Promise<void> {
  const catalog = ctx.options.adapterCatalog;
  if (!catalog) return void reply.code(501).send({ error: 'Adapter Catalog is not available.' });
  const { id } = request.params as { id: string };
  const { version } = (request.body ?? {}) as { version?: string };
  try {
    const target = version ?? await previousManagedVersion(catalog, id);
    if (!target) throw new Error(`Adapter "${id}" has no previous approved version.`);
    const entry = await activateAdapterPackage(catalog, ctx.registry, id, target);
    reply.send({ data: { adapterId: id, activeVersion: entry.activeVersion, rolledBack: true } });
  } catch (error) { reply.code(400).send({ error: error instanceof Error ? error.message : String(error) }); }
}

async function previousManagedVersion(catalog: AdapterCatalog, id: string): Promise<string | undefined> {
  const entry = await catalog.getEntry(id);
  if (!entry) throw new Error(`Adapter "${id}" is not managed by the catalog.`);
  if (entry.lastActiveVersion && entry.lastActiveVersion !== entry.activeVersion) return entry.lastActiveVersion;
  return [...entry.versions].reverse().find((item) => item.version !== entry.activeVersion)?.version;
}

async function listManagedAdapterVersions(
  ctx: AdapterRouteContext, request: FastifyRequest, reply: FastifyReply
): Promise<void> {
  const catalog = ctx.options.adapterCatalog;
  if (!catalog) return void reply.code(501).send({ error: 'Adapter Catalog is not available.' });
  const { id } = request.params as { id: string };
  const entry = await catalog.getEntry(id);
  if (!entry) return void reply.code(404).send({ error: 'Catalog adapter not found.' });
  reply.send({ data: entry });
}

async function exportManagedPackage(
  ctx: AdapterRouteContext, request: FastifyRequest, reply: FastifyReply
): Promise<void> {
  const catalog = ctx.options.adapterCatalog;
  if (!catalog) return void reply.code(501).send({ error: 'Adapter Catalog is not available.' });
  const { id, version } = request.params as { id: string; version: string };
  const document = await catalog.getPackage(id, version);
  if (!document) return void reply.code(404).send({ error: 'Adapter package not found.' });
  reply.send({ data: document });
}

async function importManagedPackage(
  ctx: AdapterRouteContext, request: FastifyRequest, reply: FastifyReply
): Promise<void> {
  const catalog = ctx.options.adapterCatalog;
  if (!catalog) return void reply.code(501).send({ error: 'Adapter Catalog is not available.' });
  const body = (request.body ?? {}) as Partial<AdapterPackageImportRequest>;
  if (!body.document) return void reply.code(400).send({ error: 'Adapter package document is required.' });
  try {
    const result = await importAdapterPackage(catalog, ctx.registry, body.document, Boolean(body.activate));
    const data: AdapterPackageImportResponse = { entry: result.entry, inspection: result.inspection,
      activated: Boolean(body.activate) };
    reply.send({ data });
  } catch (error) { reply.code(400).send({ error: error instanceof Error ? error.message : String(error) }); }
}

async function restoreActiveAdapter(
  ctx: AdapterRouteContext, storage: IStorage, id: string, reply: FastifyReply
): Promise<void> {
  await removeDeletedAdapterRecord(storage, id);
  const data: RestoreAdapterResponse = { adapterId: id,
    message: 'Adapter is already active; stale deletion marker was removed.', restored: true,
    sourcePath: PROJECT_ADAPTER_SOURCE[id], sourceDirectory: resolveProjectAdapterSourceDir(id) };
  reply.send({ data });
}

function resolveAdapter(ctx: AdapterRouteContext, request: FastifyRequest, reply: FastifyReply): void {
  try {
    const body = request.body as { url?: string; mode?: 'all' | 'chapters' | 'inspect' };
    if (!body.url) return void reply.code(400).send({ error: 'URL is required' });
    const mode = body.mode ?? 'all';
    if (!['all', 'chapters', 'inspect'].includes(mode))
      return void reply.code(400).send({ error: 'Mode must be "all", "chapters", or "inspect"' });
    reply.send({ data: createAdapterResolution(ctx.registry, new URL(body.url), mode) });
  } catch (error) { reply.code(400).send({ error: error instanceof Error ? error.message : String(error) }); }
}

function createAdapterResolution(registry: AdapterRegistry, url: URL, mode: 'all' | 'chapters' | 'inspect') {
  const requiredCapabilities = resolutionCapabilities(mode);
  const matched = registry.findByUrlWithCapabilities(url.href, requiredCapabilities);
  const anyMatched = registry.findByUrl(url.href);
  return { url: url.href, hostname: url.hostname, mode, requiredCapabilities,
    status: matched ? 'matched' : anyMatched ? 'capability_mismatch' : 'not_found',
    adapter: matched ? describeAdapter(matched) : undefined,
    matchedAdapter: anyMatched ? describeAdapter(anyMatched) : undefined,
    discoveryTarget: mode === 'chapters' ? 'chapter-only' : 'full' };
}

function resolutionCapabilities(mode: 'all' | 'chapters' | 'inspect') {
  if (mode === 'inspect') return {};
  return mode === 'chapters' ? { chapterImages: true } : { metadata: true, chapterImages: true };
}

async function extractChapterImages(
  ctx: AdapterRouteContext, request: FastifyRequest, reply: FastifyReply
): Promise<void> {
  const cancellation = trackRequestCancellation(request, reply);
  try {
    await extractChapterImagesForRequest(ctx, request, reply, cancellation.signal);
  } catch (error) {
    if (!cancellation.signal.aborted) throw error;
  } finally {
    cancellation.dispose();
  }
}

async function extractChapterImagesForRequest(
  ctx: AdapterRouteContext, request: FastifyRequest, reply: FastifyReply, signal: AbortSignal
): Promise<void> {
  const prepared = prepareChapterImageRequest(ctx, (request.body ?? {}) as Partial<ChapterImagesRequest>);
  if ('error' in prepared) return void reply.code(prepared.status).send({ error: prepared.error });
  const network = await ctx.options.getNetworkConfig?.();
  const extraction = await runChapterImageExtraction(ctx, request, prepared, network, signal);
  signal.throwIfAborted();
  sendChapterImagesResponse(reply, prepared.adapter, prepared.chapterUrl, extraction, prepared.renderContext);
}

type ChapterPreparation = { status: 400 | 404 | 422; error: string } | {
  body: Partial<ChapterImagesRequest>; chapterUrl: string; adapter: RegisteredAdapter;
  renderContext: EffectiveRenderContext;
};

function prepareChapterImageRequest(
  ctx: AdapterRouteContext, body: Partial<ChapterImagesRequest>
): ChapterPreparation {
  if (!body.url) return { status: 400, error: 'URL is required' } as const;
  let chapterUrl: string;
  try { chapterUrl = new URL(body.url).href; }
  catch { return { status: 400, error: 'URL must be a valid absolute URL' } as const; }
  const adapter = body.adapterId ? ctx.registry.get(body.adapterId)
    : ctx.registry.findByUrlWithCapabilities(chapterUrl, { chapterImages: true });
  if (!adapter) return { status: 404, error: body.adapterId ? `Adapter "${body.adapterId}" was not found.`
    : 'No registered adapter with chapterImages capability matches this URL.' } as const;
  if (!adapter.matchUrl(chapterUrl)) return { status: 422,
    error: `Adapter "${adapter.id}" does not match this chapter URL.` } as const;
  if (!getAdapterCapabilities(adapter).chapterImages) return { status: 422,
    error: `Adapter "${adapter.id}" does not support chapterImages capability.` } as const;
  const renderContext = parseRenderContext(body.renderContext);
  if (renderContext instanceof Error) return { status: 400, error: renderContext.message } as const;
  return { body, chapterUrl, adapter, renderContext };
}

type PreparedChapterRequest = Extract<ChapterPreparation, { adapter: RegisteredAdapter }>;

async function runChapterImageExtraction(
  ctx: AdapterRouteContext, request: FastifyRequest, input: PreparedChapterRequest,
  network: NetworkConfig | undefined, signal: AbortSignal
) {
  const base = { challengeDiscoveryId: input.body.challengeDiscoveryId,
    challengeDiscoveryService: ctx.options.challengeDiscoveryService, network,
    renderContext: input.renderContext, signal };
  if (ctx.options.htmlRenderer) return testAdapterFunction(input.adapter, 'extractChapterImageUrls',
    input.chapterUrl, { ...base, htmlRenderer: ctx.options.htmlRenderer });
  if (input.body.challengeDiscoveryId || !ctx.options.withBrowserSession || !ctx.options.browserRenderService)
    return testAdapterFunction(input.adapter, 'extractChapterImageUrls', input.chapterUrl, base);
  const ownerUserId = ctx.options.apiSecurity
    ? requestPrincipal(request, ctx.options.apiSecurity).userId : 'public';
  return ctx.options.withBrowserSession(request, input.body.browserTarget, input.chapterUrl,
    input.renderContext, (sessionId, claimBrowserLease) => testAdapterFunction(input.adapter, 'extractChapterImageUrls',
      input.chapterUrl, { ...base,
        htmlRenderer: createSessionRenderer(ctx.options.browserRenderService!, sessionId, signal),
        verificationHandoff: { ownerUserId, browserTarget: input.body.browserTarget, claimBrowserLease } }), signal);
}

async function getAdapterDetails(ctx: AdapterRouteContext, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const adapter = getAdapterFromRequest(request, ctx.registry);
  if (!adapter) return void reply.code(404).send({ error: 'Adapter not found' });
  const details = (await describeAdapterList(ctx.registry, ctx.options.adapterCatalog)).find((item) => item.id === adapter.id);
  reply.send({ data: details ?? describeAdapter(adapter) });
}

function getAdapterCapabilityDetails(ctx: AdapterRouteContext, request: FastifyRequest, reply: FastifyReply): void {
  const adapter = getAdapterFromRequest(request, ctx.registry);
  if (!adapter) return void reply.code(404).send({ error: 'Adapter not found' });
  const data: AdapterCapabilityDetailResponse = { adapter: describeAdapter(adapter),
    functions: describeAdapterFunctions(adapter) };
  reply.send({ data });
}

async function getImplementation(ctx: AdapterRouteContext, request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const adapter = getAdapterFromRequest(request, ctx.registry);
  if (!adapter) return void reply.code(404).send({ error: 'Adapter not found' });
  const managed = await ctx.options.adapterCatalog?.getActivePackage(adapter.id);
  reply.send({ data: await getAdapterImplementation(adapter, managed ?? undefined) });
}

async function testAdapterRouteFunction(
  ctx: AdapterRouteContext, request: FastifyRequest, reply: FastifyReply
): Promise<void> {
  const adapter = getAdapterFromRequest(request, ctx.registry);
  if (!adapter) return void reply.code(404).send({ error: 'Adapter not found' });
  const { functionId } = request.params as { functionId: AdapterFunctionId };
  if (!isKnownAdapterFunction(functionId))
    return void reply.code(400).send({ error: 'Unknown adapter function.' });
  const body = request.body as AdapterFunctionTestRequest;
  if (!body.url) return void reply.code(400).send({ error: 'URL is required' });
  const result = await runAdapterRouteFunction(ctx, request, adapter, functionId, body);
  reply.send({ data: result });
}

async function runAdapterRouteFunction(
  ctx: AdapterRouteContext, request: FastifyRequest, adapter: RegisteredAdapter,
  functionId: AdapterFunctionId, body: AdapterFunctionTestRequest
) {
  const base = { challengeDiscoveryId: body.challengeDiscoveryId,
    challengeDiscoveryService: ctx.options.challengeDiscoveryService,
    network: await ctx.options.getNetworkConfig?.() };
  if (ctx.options.htmlRenderer) return testAdapterFunction(adapter, functionId, body.url,
    { ...base, htmlRenderer: ctx.options.htmlRenderer });
  if (!adapterFunctionNeedsBrowser(functionId)) return testAdapterFunction(adapter, functionId, body.url, base);
  if (body.challengeDiscoveryId || !ctx.options.withBrowserSession || !ctx.options.browserRenderService)
    return testAdapterFunction(adapter, functionId, body.url, base);
  const ownerUserId = ctx.options.apiSecurity
    ? requestPrincipal(request, ctx.options.apiSecurity).userId : 'public';
  return ctx.options.withBrowserSession(request, body.browserTarget, body.url, undefined,
    (sessionId, claimBrowserLease) => testAdapterFunction(adapter, functionId, body.url,
      { ...base, htmlRenderer: createSessionRenderer(ctx.options.browserRenderService!, sessionId),
        verificationHandoff: { ownerUserId, browserTarget: body.browserTarget, claimBrowserLease } }));
}

export function adapterFunctionNeedsBrowser(functionId: AdapterFunctionId): boolean {
  return !['matchUrl', 'getReaderContainerSelector', 'getReaderPageSelector',
    'getReaderEndSelector'].includes(functionId);
}

function sendChapterImagesResponse(
  reply: FastifyReply,
  adapter: IComicAdapter,
  chapterUrl: string,
  extraction: Awaited<ReturnType<typeof testAdapterFunction>>,
  renderContext: EffectiveRenderContext
): void {
  if (!extraction.ok) {
    return sendChapterImageFailure(reply, extraction);
  }
  const imageUrls = extractImageUrls(extraction.resultSummary?.imageUrls);
  const chapter = extraction.resultSummary?.chapter;
  const images = extraction.resultSummary?.images;
  if (!isChapterIdentityDescriptor(chapter) || !isChapterImageDescriptors(images, imageUrls)) {
    reply.code(500).send({ error: 'Chapter image extraction returned invalid identity descriptors.' });
    return;
  }
  reply.send({ data: createChapterImagesData(
    adapter, chapterUrl, imageUrls, chapter, images, extraction, renderContext) });
}

function createChapterImagesData(
  adapter: IComicAdapter, chapterUrl: string, imageUrls: string[], chapter: ChapterIdentityDescriptor,
  images: ChapterImageDescriptor[], extraction: Awaited<ReturnType<typeof testAdapterFunction>>,
  renderContext: EffectiveRenderContext
): ChapterImagesResponse {
  return { adapterId: adapter.id, chapterUrl, chapter, imageUrlCount: imageUrls.length, imageUrls, images,
    domSource: extraction.domSource, durationMs: extraction.durationMs, renderContext };
}

function sendChapterImageFailure(
  reply: FastifyReply, extraction: Awaited<ReturnType<typeof testAdapterFunction>>
): void {
  const verificationRequired = extraction.status === 'verification_required';
  reply.code(verificationRequired ? 409 : 422).send({
    error: extraction.error ?? 'Chapter image extraction failed.',
    ...(verificationRequired && extraction.errorCode ? { code: extraction.errorCode } : {}),
    data: extraction,
  });
}

function extractImageUrls(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((url): url is string => typeof url === 'string') : [];
}

function isChapterIdentityDescriptor(value: unknown): value is ChapterIdentityDescriptor {
  if (!value || typeof value !== 'object') return false;
  const chapter = value as Partial<ChapterIdentityDescriptor>;
  return typeof chapter.id === 'string'
    && typeof chapter.canonicalUrl === 'string'
    && chapter.stability === 'deterministic'
    && (chapter.identitySource === 'adapter' || chapter.identitySource === 'normalized-url');
}

function isChapterImageDescriptors(value: unknown, imageUrls: string[]): value is ChapterImageDescriptor[] {
  return Array.isArray(value)
    && value.length === imageUrls.length
    && value.every((image, index) => Boolean(image)
      && typeof image === 'object'
      && typeof (image as ChapterImageDescriptor).id === 'string'
      && (image as ChapterImageDescriptor).orderIndex === index
      && (image as ChapterImageDescriptor).url === imageUrls[index]
      && ((image as ChapterImageDescriptor).sourceFingerprint === undefined
        || typeof (image as ChapterImageDescriptor).sourceFingerprint === 'string'));
}

function createSessionRenderer(
  renderService: BrowserRenderService, sessionId: string, signal?: AbortSignal
): HtmlRenderer {
  return {
    render: async (url, options) => (await renderService.render(
      sessionId, url, { ...options, signal })).html,
    dispose: async () => undefined,
  };
}

const DEFAULT_RENDER_CONTEXT: EffectiveRenderContext = {
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
};

function parseRenderContext(value: RenderContext | undefined): EffectiveRenderContext | Error {
  if (value === undefined) return cloneDefaultRenderContext();
  if (!value || typeof value !== 'object' || !value.viewport || typeof value.viewport !== 'object')
    return new Error('renderContext.viewport is required when renderContext is provided.');
  const { width, height } = value.viewport;
  if (!validViewportDimension(width))
    return new Error('renderContext.viewport.width must be an integer between 1 and 10000 CSS pixels.');
  if (!validViewportDimension(height))
    return new Error('renderContext.viewport.height must be an integer between 1 and 10000 CSS pixels.');
  const deviceScaleFactor = value.deviceScaleFactor ?? DEFAULT_RENDER_CONTEXT.deviceScaleFactor;
  if (!Number.isFinite(deviceScaleFactor) || deviceScaleFactor < 0.1 || deviceScaleFactor > 10)
    return new Error('renderContext.deviceScaleFactor must be a finite number between 0.1 and 10.');
  return { viewport: { width, height }, deviceScaleFactor };
}

function cloneDefaultRenderContext(): EffectiveRenderContext {
  return { viewport: { ...DEFAULT_RENDER_CONTEXT.viewport },
    deviceScaleFactor: DEFAULT_RENDER_CONTEXT.deviceScaleFactor };
}

function validViewportDimension(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 10_000;
}

function describeAdapter(adapter: NonNullable<ReturnType<AdapterRegistry['get']>>) {
  return {
    id: adapter.id,
    name: adapter.name,
    domains: adapter.domains,
    parseMode: adapter.parseMode,
    capabilities: getAdapterCapabilities(adapter),
  };
}

async function describeAdapterList(
  registry: AdapterRegistry, catalog?: AdapterCatalog
): Promise<AdapterListItem[]> {
  const entries = catalog ? await catalog.listEntries() : [];
  const managed = new Map(entries.map((entry) => [entry.adapterId, entry]));
  return Promise.all(registry.getAll().map((adapter) => describeAdapterListItem(adapter, managed, catalog)));
}

async function describeAdapterListItem(
  adapter: NonNullable<ReturnType<AdapterRegistry['get']>>,
  entries: Map<string, Awaited<ReturnType<AdapterCatalog['getEntry']>>>, catalog?: AdapterCatalog
): Promise<AdapterListItem> {
  const entry = entries.get(adapter.id);
  const document = entry?.activeVersion ? await catalog?.getPackage(adapter.id, entry.activeVersion) : undefined;
  const sourcePath = PROJECT_ADAPTER_SOURCE[adapter.id];
  const implementationKind: AdapterImplementationKind = entry ? 'ts-implementation'
    : sourcePath ? 'project-source' : 'summary';
  const discoveryId = document?.manifest.sourceDiscoveryId;
  const promotedAt = document?.manifest.createdAt;
  return { ...describeAdapter(adapter), activeVersionLabel: entry?.activeVersion ?? 'current',
    versionCount: entry?.versions.length ?? 1,
    implementationKind, ...(sourcePath ? { sourcePath, sourceWillBeDeleted: true } : { sourceWillBeDeleted: false }),
    ...(discoveryId ? { sourceDiscoveryId: discoveryId } : {}), ...(promotedAt ? { promotedAt } : {}) };
}

function getAdapterFromRequest(request: FastifyRequest, registry: AdapterRegistry): NonNullable<ReturnType<AdapterRegistry['get']>> | undefined {
  const { id } = request.params as { id: string };
  return registry.get(id);
}

export function describeAdapterFunctions(adapter: NonNullable<ReturnType<AdapterRegistry['get']>>): AdapterFunctionDescriptor[] {
  const capabilities = getAdapterCapabilities(adapter);
  return ADAPTER_FUNCTION_DESCRIPTORS.map((descriptor) => ({ ...descriptor,
    implemented: descriptor.capability === 'common'
      || (descriptor.capability === 'readerPreparation' ? Boolean(adapter.readerPreparation)
        : capabilities[descriptor.capability]) }));
}

const ADAPTER_FUNCTION_DESCRIPTORS: Omit<AdapterFunctionDescriptor, 'implemented'>[] = [
    {
      id: 'matchUrl',
      label: 'matchUrl(url)',
      capability: 'common',
      inputKind: 'url',
      notes: 'Checks whether this adapter accepts the provided URL.',
    },
    {
      id: 'detectVerificationRequired',
      label: 'detectVerificationRequired(urlOrHtml)',
      capability: 'verification',
      inputKind: 'url',
      notes: 'Detects whether the provided URL or HTML text appears to require human verification.',
    },
    { id: 'getReaderContainerSelector', label: 'getReaderContainerSelector(url)',
      capability: 'readerPreparation', inputKind: 'chapterUrl',
      notes: 'Returns only the comic reader container selector.' },
    { id: 'getReaderPageSelector', label: 'getReaderPageSelector(url)',
      capability: 'readerPreparation', inputKind: 'chapterUrl',
      notes: 'Returns only the page candidate selector inside the reader.' },
    { id: 'getReaderEndSelector', label: 'getReaderEndSelector(url)',
      capability: 'readerPreparation', inputKind: 'chapterUrl',
      notes: 'Returns an optional stable reader end marker selector.' },
    {
      id: 'extractTitle',
      label: 'extractTitle(document)',
      capability: 'metadata',
      inputKind: 'mangaUrl',
      notes: 'Extracts only the manga title from a parsed manga catalog document.',
    },
    {
      id: 'extractAuthor',
      label: 'extractAuthor(document)',
      capability: 'metadata',
      inputKind: 'mangaUrl',
      notes: 'Extracts only the manga author from a parsed manga catalog document.',
    },
    {
      id: 'extractDescription',
      label: 'extractDescription(document)',
      capability: 'metadata',
      inputKind: 'mangaUrl',
      notes: 'Extracts only the manga description from a parsed manga catalog document.',
    },
    {
      id: 'extractCoverUrl',
      label: 'extractCoverUrl(document)',
      capability: 'metadata',
      inputKind: 'mangaUrl',
      notes: 'Extracts only the cover URL from a parsed manga catalog document.',
    },
    {
      id: 'extractTags',
      label: 'extractTags(document)',
      capability: 'metadata',
      inputKind: 'mangaUrl',
      notes: 'Extracts only tag/category labels from a parsed manga catalog document.',
    },
    {
      id: 'extractStatus',
      label: 'extractStatus(document)',
      capability: 'metadata',
      inputKind: 'mangaUrl',
      notes: 'Extracts only completion/ongoing status from a parsed manga catalog document.',
    },
    {
      id: 'extractChapterList',
      label: 'extractChapterList(document)',
      capability: 'metadata',
      inputKind: 'mangaUrl',
      notes: 'Extracts only the chapter list from a parsed manga catalog document.',
    },
    {
      id: 'extractChapterImageUrls',
      label: 'extractChapterImageUrls(document)',
      capability: 'chapterImages',
      inputKind: 'chapterUrl',
      notes: 'Extracts only raw chapter image URLs from a parsed chapter reader document.',
    },
];

export function isKnownAdapterFunction(functionId: string): functionId is AdapterFunctionId {
  return [
    'matchUrl',
    'detectVerificationRequired',
    'getReaderContainerSelector',
    'getReaderPageSelector',
    'getReaderEndSelector',
    'extractTitle',
    'extractAuthor',
    'extractDescription',
    'extractCoverUrl',
    'extractTags',
    'extractStatus',
    'extractChapterList',
    'extractChapterImageUrls',
  ].includes(functionId);
}
