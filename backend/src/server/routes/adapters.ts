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
} from '@comiccrawler/shared';
import type { AdapterRegistry } from '../../adapter/registry';
import { getAdapterCapabilities } from '../../adapter/registry';
import {
  ACTIVE_DYNAMIC_ADAPTERS_KEY,
  ACTIVE_IMPLEMENTATION_ADAPTERS_KEY,
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
import type { DynamicSiteAdapterManifest } from '../../adapter/dynamic-site-adapter';
import type { ActiveImplementationAdapterRecord } from '../../selector-discovery/service';
import type { IStorage } from '../../storage/types';
import type { ChallengeDiscoveryService } from '../../challenge';
import { getAdapterImplementation } from './adapter-function-source';
import { testAdapterFunction } from './adapter-function-runner';
import type { AdapterFunctionId } from './adapter-function-types';
import type { BrowserTarget, NetworkConfig } from '@comiccrawler/shared';
import type { BrowserRenderService } from '../../browser/browser-render-service';
import type { HtmlRenderer } from '../../crawler/html-renderer';

export type { AdapterFunctionId } from './adapter-function-types';
export { testAdapterFunction } from './adapter-function-runner';

interface AdapterRouteOptions {
  challengeDiscoveryService?: ChallengeDiscoveryService;
  withBrowserSession?: <T>(
    request: FastifyRequest,
    target: BrowserTarget | undefined,
    initialUrl: string,
    renderContext: EffectiveRenderContext | undefined,
    action: (sessionId: string) => Promise<T>
  ) => Promise<T>;
  browserRenderService?: BrowserRenderService;
  htmlRenderer?: HtmlRenderer;
  getNetworkConfig?: () => NetworkConfig | Promise<NetworkConfig>;
  storage?: IStorage;
}

export function setupAdaptersRoutes(app: FastifyInstance, registry: AdapterRegistry, options: AdapterRouteOptions = {}): void {
  app.get('/api/adapters', async (_request: FastifyRequest, reply: FastifyReply) => {
    const adapters = await describeAdapterList(registry, options.storage);
    reply.send({ data: adapters });
  });

  app.get('/api/adapters/deleted', async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!options.storage) {
      reply.code(500).send({ error: 'Adapter runtime storage is not available.' });
      return;
    }

    const data: DeletedAdapterListResponse = {
      adapters: (await readDeletedAdapterRecords(options.storage)).map((record) => {
        const sourceExists = record.sourcePath ? projectAdapterSourceExists(record.adapterId) : undefined;
        const hasRuntimeBackup = Boolean(record.activeManifest || record.activeImplementationRecord);
        const restorable = hasRuntimeBackup || Boolean(record.sourcePath && sourceExists);
        return {
          adapterId: record.adapterId,
          deletedAt: record.deletedAt,
          implementationKind: record.implementationKind,
          sourcePath: record.sourcePath,
          sourceDirectory: record.sourceDirectory,
          sourceDeleted: record.sourceDeleted,
          sourceExists,
          restorable,
          restoreReason: restorable
            ? 'Adapter can be restored from saved runtime data or existing project source.'
            : record.sourcePath
              ? 'Project TypeScript source is missing. Restore it with git before restoring this adapter.'
              : 'No restorable runtime data is available.',
        };
      }),
    };
    reply.send({ data });
  });

  app.delete('/api/adapters/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!options.storage) {
      reply.code(500).send({ error: 'Adapter runtime storage is not available.' });
      return;
    }
    const { id } = request.params as { id: string };
    if (!registry.has(id)) {
      reply.code(404).send({ error: 'Adapter not found' });
      return;
    }

    const manifests = (await options.storage.read<DynamicSiteAdapterManifest[]>(ACTIVE_DYNAMIC_ADAPTERS_KEY)) ?? [];
    const implementationRecords = (await options.storage.read<ActiveImplementationAdapterRecord[]>(ACTIVE_IMPLEMENTATION_ADAPTERS_KEY)) ?? [];
    const activeManifest = manifests.find((item) => item.adapterId === id);
    const activeImplementationRecord = implementationRecords.find((item) => item.adapterId === id);
    const implementationKind: AdapterImplementationKind = activeImplementationRecord
      ? 'ts-implementation'
      : activeManifest
        ? 'selector-manifest'
        : PROJECT_ADAPTER_SOURCE[id]
          ? 'project-source'
          : 'summary';
    await options.storage.write(ACTIVE_DYNAMIC_ADAPTERS_KEY, manifests.filter((item) => item.adapterId !== id));
    await options.storage.write(ACTIVE_IMPLEMENTATION_ADAPTERS_KEY, implementationRecords.filter((item) => item.adapterId !== id));
    const sourceDeletion = PROJECT_ADAPTER_SOURCE[id]
      ? await deleteProjectAdapterSource(id)
      : { deleted: false };
    const deletedRecord = await markAdapterDeleted(options.storage, id, {
      implementationKind,
      sourcePath: PROJECT_ADAPTER_SOURCE[id],
      sourceDirectory: sourceDeletion.sourceDir,
      sourceDeleted: sourceDeletion.deleted,
      activeManifest,
      activeImplementationRecord,
    });
    registry.unregister(id);

    const data: DeleteAdapterResponse = {
      adapterId: id,
      message: sourceDeletion.deleted
        ? 'Adapter deleted and source files removed'
        : 'Adapter deleted',
      implementationKind,
      registryRemoved: !registry.has(id),
      deletedMarkerWritten: Boolean(deletedRecord),
      sourcePath: PROJECT_ADAPTER_SOURCE[id],
      sourceDirectory: sourceDeletion.sourceDir,
      sourceDeleted: sourceDeletion.deleted,
      runtimeRecordsRemoved: {
        selectorManifest: Boolean(activeManifest),
        tsImplementation: Boolean(activeImplementationRecord),
      },
    };
    reply.send({ data });
  });

  app.post('/api/adapters/:id/restore', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!options.storage) {
      reply.code(500).send({ error: 'Adapter runtime storage is not available.' });
      return;
    }
    const { id } = request.params as { id: string };
    if (registry.has(id)) {
      await removeDeletedAdapterRecord(options.storage, id);
      const data: RestoreAdapterResponse = {
        adapterId: id,
        message: 'Adapter is already active; stale deletion marker was removed.',
        restored: true,
        sourcePath: PROJECT_ADAPTER_SOURCE[id],
        sourceDirectory: resolveProjectAdapterSourceDir(id),
      };
      reply.send({ data });
      return;
    }

    const result = await restoreDeletedAdapter(options.storage, id, (adapter) => registry.register(adapter));
    if (!result.restored) {
      reply.code(result.record ? 409 : 404).send({ error: result.reason ?? 'Adapter could not be restored.' });
      return;
    }

    const data: RestoreAdapterResponse = {
      adapterId: id,
      message: 'Adapter restored',
      implementationKind: result.record?.implementationKind,
      restored: true,
      sourcePath: result.record?.sourcePath,
      sourceDirectory: result.record?.sourceDirectory,
    };
    reply.send({ data });
  });

  app.post('/api/adapters/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as { url?: string; mode?: 'all' | 'chapters' };
      if (!body.url) {
        reply.code(400).send({ error: 'URL is required' });
        return;
      }
      const mode = body.mode ?? 'all';
      if (mode !== 'all' && mode !== 'chapters') {
        reply.code(400).send({ error: 'Mode must be "all" or "chapters"' });
        return;
      }

      const parsed = new URL(body.url);
      const requiredCapabilities = mode === 'chapters'
        ? { chapterImages: true }
        : { metadata: true, chapterImages: true };
      const matchedAdapter = registry.findByUrlWithCapabilities(parsed.href, requiredCapabilities);
      const anyMatchedAdapter = registry.findByUrl(parsed.href);

      reply.send({
        data: {
          url: parsed.href,
          hostname: parsed.hostname,
          mode,
          requiredCapabilities,
          status: matchedAdapter
            ? 'matched'
            : anyMatchedAdapter
              ? 'capability_mismatch'
              : 'not_found',
          adapter: matchedAdapter ? describeAdapter(matchedAdapter) : undefined,
          matchedAdapter: anyMatchedAdapter ? describeAdapter(anyMatchedAdapter) : undefined,
          discoveryTarget: mode === 'chapters' ? 'chapter-only' : 'full',
        },
      });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/adapters/chapter-images', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as Partial<ChapterImagesRequest>;
    if (!body.url) {
      reply.code(400).send({ error: 'URL is required' });
      return;
    }

    let chapterUrl: string;
    try {
      chapterUrl = new URL(body.url).href;
    } catch {
      reply.code(400).send({ error: 'URL must be a valid absolute URL' });
      return;
    }

    const adapter = body.adapterId
      ? registry.get(body.adapterId)
      : registry.findByUrlWithCapabilities(chapterUrl, { chapterImages: true });
    if (!adapter) {
      reply.code(404).send({
        error: body.adapterId
          ? `Adapter "${body.adapterId}" was not found.`
          : 'No registered adapter with chapterImages capability matches this URL.',
      });
      return;
    }

    if (!adapter.matchUrl(chapterUrl)) {
      reply.code(422).send({ error: `Adapter "${adapter.id}" does not match this chapter URL.` });
      return;
    }
    if (!getAdapterCapabilities(adapter).chapterImages) {
      reply.code(422).send({ error: `Adapter "${adapter.id}" does not support chapterImages capability.` });
      return;
    }

    const renderContext = parseRenderContext(body.renderContext);
    if (renderContext instanceof Error) {
      reply.code(400).send({ error: renderContext.message });
      return;
    }

    const network = await options.getNetworkConfig?.();
    if (options.htmlRenderer) {
      const extraction = await testAdapterFunction(adapter, 'extractChapterImageUrls', chapterUrl, {
        challengeDiscoveryId: body.challengeDiscoveryId,
        challengeDiscoveryService: options.challengeDiscoveryService,
        network,
        renderContext,
        htmlRenderer: options.htmlRenderer,
      });
      return sendChapterImagesResponse(reply, adapter, chapterUrl, extraction, renderContext);
    }
    if (body.challengeDiscoveryId) {
      const extraction = await testAdapterFunction(adapter, 'extractChapterImageUrls', chapterUrl, {
        challengeDiscoveryId: body.challengeDiscoveryId,
        challengeDiscoveryService: options.challengeDiscoveryService,
        network,
        renderContext,
      });
      return sendChapterImagesResponse(reply, adapter, chapterUrl, extraction, renderContext);
    }
    if (!options.withBrowserSession || !options.browserRenderService) {
      const extraction = await testAdapterFunction(adapter, 'extractChapterImageUrls', chapterUrl, {
        challengeDiscoveryId: body.challengeDiscoveryId,
        challengeDiscoveryService: options.challengeDiscoveryService,
        network,
        renderContext,
      });
      return sendChapterImagesResponse(reply, adapter, chapterUrl, extraction, renderContext);
    }
    const extraction = await options.withBrowserSession(request, body.browserTarget, chapterUrl, renderContext, (sessionId) =>
      testAdapterFunction(adapter, 'extractChapterImageUrls', chapterUrl, {
        challengeDiscoveryId: body.challengeDiscoveryId,
        challengeDiscoveryService: options.challengeDiscoveryService,
        network,
        renderContext,
        htmlRenderer: createSessionRenderer(options.browserRenderService!, sessionId),
      }));
    return sendChapterImagesResponse(reply, adapter, chapterUrl, extraction, renderContext);
  });

  app.get('/api/adapters/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const adapter = registry.get(id);

    if (!adapter) {
      reply.code(404).send({ error: 'Adapter not found' });
      return;
    }

    const details = (await describeAdapterList(registry, options.storage)).find((item) => item.id === adapter.id);
    reply.send({ data: details ?? describeAdapter(adapter) });
  });

  app.get('/api/adapters/:id/capabilities', async (request: FastifyRequest, reply: FastifyReply) => {
    const adapter = getAdapterFromRequest(request, registry);
    if (!adapter) {
      reply.code(404).send({ error: 'Adapter not found' });
      return;
    }

    const data: AdapterCapabilityDetailResponse = {
      adapter: describeAdapter(adapter),
      functions: describeAdapterFunctions(adapter),
    };
    reply.send({ data });
  });

  app.get('/api/adapters/:id/implementation', async (request: FastifyRequest, reply: FastifyReply) => {
    const adapter = getAdapterFromRequest(request, registry);
    if (!adapter) {
      reply.code(404).send({ error: 'Adapter not found' });
      return;
    }

    const data = await getAdapterImplementation(adapter);
    reply.send({ data });
  });

  app.post('/api/adapters/:id/functions/:functionId/test', async (request: FastifyRequest, reply: FastifyReply) => {
    const adapter = getAdapterFromRequest(request, registry);
    if (!adapter) {
      reply.code(404).send({ error: 'Adapter not found' });
      return;
    }

    const { functionId } = request.params as { functionId: AdapterFunctionId };
    if (!isKnownAdapterFunction(functionId)) {
      reply.code(400).send({ error: 'Unknown adapter function.' });
      return;
    }

    const body = request.body as AdapterFunctionTestRequest;
    if (!body.url) {
      reply.code(400).send({ error: 'URL is required' });
      return;
    }

    const network = await options.getNetworkConfig?.();
    if (options.htmlRenderer) {
      const result = await testAdapterFunction(adapter, functionId, body.url, {
        challengeDiscoveryId: body.challengeDiscoveryId,
        challengeDiscoveryService: options.challengeDiscoveryService,
        network,
        htmlRenderer: options.htmlRenderer,
      });
      reply.send({ data: result });
      return;
    }
    if (body.challengeDiscoveryId) {
      const result = await testAdapterFunction(adapter, functionId, body.url, {
        challengeDiscoveryId: body.challengeDiscoveryId,
        challengeDiscoveryService: options.challengeDiscoveryService,
        network,
      });
      reply.send({ data: result });
      return;
    }
    if (!options.withBrowserSession || !options.browserRenderService) {
      const result = await testAdapterFunction(adapter, functionId, body.url, {
        challengeDiscoveryId: body.challengeDiscoveryId,
        challengeDiscoveryService: options.challengeDiscoveryService,
        network,
      });
      reply.send({ data: result });
      return;
    }
    const result = await options.withBrowserSession(request, body.browserTarget, body.url, undefined, (sessionId) =>
      testAdapterFunction(adapter, functionId, body.url, {
        challengeDiscoveryId: body.challengeDiscoveryId,
        challengeDiscoveryService: options.challengeDiscoveryService,
        network,
        htmlRenderer: createSessionRenderer(options.browserRenderService!, sessionId),
      }));
    reply.send({ data: result });
  });

}

function sendChapterImagesResponse(
  reply: FastifyReply,
  adapter: IComicAdapter,
  chapterUrl: string,
  extraction: Awaited<ReturnType<typeof testAdapterFunction>>,
  renderContext: EffectiveRenderContext
): void {
  if (!extraction.ok) {
    reply.code(extraction.status === 'verification_required' ? 409 : 422).send({
      error: extraction.error ?? 'Chapter image extraction failed.',
      data: extraction,
    });
    return;
  }
  const imageUrls = Array.isArray(extraction.resultSummary?.imageUrls)
    ? extraction.resultSummary.imageUrls.filter((url): url is string => typeof url === 'string')
    : [];
  const chapter = extraction.resultSummary?.chapter;
  const images = extraction.resultSummary?.images;
  if (!isChapterIdentityDescriptor(chapter) || !isChapterImageDescriptors(images, imageUrls)) {
    reply.code(500).send({ error: 'Chapter image extraction returned invalid identity descriptors.' });
    return;
  }
  const data: ChapterImagesResponse = {
    adapterId: adapter.id,
    chapterUrl,
    chapter,
    imageUrlCount: imageUrls.length,
    imageUrls,
    images,
    domSource: extraction.domSource,
    durationMs: extraction.durationMs,
    renderContext,
  };
  reply.send({ data });
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

function createSessionRenderer(renderService: BrowserRenderService, sessionId: string): HtmlRenderer {
  return {
    render: async (url) => (await renderService.render(sessionId, url)).html,
    dispose: async () => undefined,
  };
}

const DEFAULT_RENDER_CONTEXT: EffectiveRenderContext = {
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
};

function parseRenderContext(value: RenderContext | undefined): EffectiveRenderContext | Error {
  if (value === undefined) {
    return {
      viewport: { ...DEFAULT_RENDER_CONTEXT.viewport },
      deviceScaleFactor: DEFAULT_RENDER_CONTEXT.deviceScaleFactor,
    };
  }
  if (!value || typeof value !== 'object' || !value.viewport || typeof value.viewport !== 'object') {
    return new Error('renderContext.viewport is required when renderContext is provided.');
  }
  const { width, height } = value.viewport;
  if (!Number.isInteger(width) || width < 1 || width > 10_000) {
    return new Error('renderContext.viewport.width must be an integer between 1 and 10000 CSS pixels.');
  }
  if (!Number.isInteger(height) || height < 1 || height > 10_000) {
    return new Error('renderContext.viewport.height must be an integer between 1 and 10000 CSS pixels.');
  }
  const deviceScaleFactor = value.deviceScaleFactor ?? DEFAULT_RENDER_CONTEXT.deviceScaleFactor;
  if (!Number.isFinite(deviceScaleFactor) || deviceScaleFactor < 0.1 || deviceScaleFactor > 10) {
    return new Error('renderContext.deviceScaleFactor must be a finite number between 0.1 and 10.');
  }
  return { viewport: { width, height }, deviceScaleFactor };
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

async function describeAdapterList(registry: AdapterRegistry, storage?: IStorage): Promise<AdapterListItem[]> {
  const manifests = storage
    ? (await storage.read<DynamicSiteAdapterManifest[]>(ACTIVE_DYNAMIC_ADAPTERS_KEY)) ?? []
    : [];
  const implementationRecords = storage
    ? (await storage.read<ActiveImplementationAdapterRecord[]>(ACTIVE_IMPLEMENTATION_ADAPTERS_KEY)) ?? []
    : [];

  return registry.getAll().map((adapter) => {
    const implementationRecord = implementationRecords.find((record) => record.adapterId === adapter.id);
    const manifest = manifests.find((record) => record.adapterId === adapter.id);
    const implementationKind: AdapterImplementationKind = implementationRecord
      ? 'ts-implementation'
      : manifest
        ? 'selector-manifest'
        : PROJECT_ADAPTER_SOURCE[adapter.id]
          ? 'project-source'
          : 'summary';
    return {
      ...describeAdapter(adapter),
      activeVersionLabel: implementationRecord?.promotedAt ?? manifest?.promotedAt ?? 'current',
      versionCount: 1,
      implementationKind,
      ...(PROJECT_ADAPTER_SOURCE[adapter.id]
        ? { sourcePath: PROJECT_ADAPTER_SOURCE[adapter.id], sourceWillBeDeleted: true }
        : { sourceWillBeDeleted: false }),
      ...(implementationRecord?.sourceDiscoveryId || manifest?.sourceDiscoveryId
        ? { sourceDiscoveryId: implementationRecord?.sourceDiscoveryId ?? manifest?.sourceDiscoveryId }
        : {}),
      ...(implementationRecord?.promotedAt || manifest?.promotedAt
        ? { promotedAt: implementationRecord?.promotedAt ?? manifest?.promotedAt }
        : {}),
    };
  });
}

function getAdapterFromRequest(request: FastifyRequest, registry: AdapterRegistry): NonNullable<ReturnType<AdapterRegistry['get']>> | undefined {
  const { id } = request.params as { id: string };
  return registry.get(id);
}

export function describeAdapterFunctions(adapter: NonNullable<ReturnType<AdapterRegistry['get']>>): AdapterFunctionDescriptor[] {
  const capabilities = getAdapterCapabilities(adapter);
  return [
    {
      id: 'matchUrl',
      label: 'matchUrl(url)',
      capability: 'common',
      implemented: true,
      inputKind: 'url',
      notes: 'Checks whether this adapter accepts the provided URL.',
    },
    {
      id: 'detectVerificationRequired',
      label: 'detectVerificationRequired(urlOrHtml)',
      capability: 'verification',
      implemented: capabilities.verification,
      inputKind: 'url',
      notes: 'Detects whether the provided URL or HTML text appears to require human verification.',
    },
    {
      id: 'describeVerificationHandoff',
      label: 'describeVerificationHandoff()',
      capability: 'verification',
      implemented: capabilities.verification,
      inputKind: 'url',
      notes: 'Describes the pipeline-level human verification handoff flow.',
    },
    {
      id: 'extractTitle',
      label: 'extractTitle(document)',
      capability: 'metadata',
      implemented: capabilities.metadata,
      inputKind: 'mangaUrl',
      notes: 'Extracts only the manga title from a parsed manga catalog document.',
    },
    {
      id: 'extractAuthor',
      label: 'extractAuthor(document)',
      capability: 'metadata',
      implemented: capabilities.metadata,
      inputKind: 'mangaUrl',
      notes: 'Extracts only the manga author from a parsed manga catalog document.',
    },
    {
      id: 'extractDescription',
      label: 'extractDescription(document)',
      capability: 'metadata',
      implemented: capabilities.metadata,
      inputKind: 'mangaUrl',
      notes: 'Extracts only the manga description from a parsed manga catalog document.',
    },
    {
      id: 'extractCoverUrl',
      label: 'extractCoverUrl(document)',
      capability: 'metadata',
      implemented: capabilities.metadata,
      inputKind: 'mangaUrl',
      notes: 'Extracts only the cover URL from a parsed manga catalog document.',
    },
    {
      id: 'extractTags',
      label: 'extractTags(document)',
      capability: 'metadata',
      implemented: capabilities.metadata,
      inputKind: 'mangaUrl',
      notes: 'Extracts only tag/category labels from a parsed manga catalog document.',
    },
    {
      id: 'extractStatus',
      label: 'extractStatus(document)',
      capability: 'metadata',
      implemented: capabilities.metadata,
      inputKind: 'mangaUrl',
      notes: 'Extracts only completion/ongoing status from a parsed manga catalog document.',
    },
    {
      id: 'extractChapterList',
      label: 'extractChapterList(document)',
      capability: 'metadata',
      implemented: capabilities.metadata,
      inputKind: 'mangaUrl',
      notes: 'Extracts only the chapter list from a parsed manga catalog document.',
    },
    {
      id: 'extractChapterImageUrls',
      label: 'extractChapterImageUrls(document)',
      capability: 'chapterImages',
      implemented: capabilities.chapterImages,
      inputKind: 'chapterUrl',
      notes: 'Extracts only raw chapter image URLs from a parsed chapter reader document.',
    },
  ];
}

export function isKnownAdapterFunction(functionId: string): functionId is AdapterFunctionId {
  return [
    'matchUrl',
    'detectVerificationRequired',
    'describeVerificationHandoff',
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
