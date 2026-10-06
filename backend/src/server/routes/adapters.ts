import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
  AdapterListItem,
  AdapterCapabilityDetailResponse,
  AdapterFunctionDescriptor,
  AdapterFunctionTestRequest,
  ChapterImagesRequest,
  ChapterImagesResponse,
  DeletedAdapterListResponse,
  DeleteAdapterResponse,
  RestoreAdapterResponse,
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
import { getAdapterFunctionSource, getAdapterImplementation } from './adapter-function-source';
import { testAdapterFunction } from './adapter-function-runner';
import type { AdapterFunctionId } from './adapter-function-types';

export type { AdapterFunctionId } from './adapter-function-types';
export { testAdapterFunction } from './adapter-function-runner';

interface AdapterRouteOptions {
  challengeDiscoveryService?: ChallengeDiscoveryService;
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

    const extraction = await testAdapterFunction(adapter, 'extractChapterImageUrls', chapterUrl, {
      challengeDiscoveryId: body.challengeDiscoveryId,
      challengeDiscoveryService: options.challengeDiscoveryService,
    });
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
    const data: ChapterImagesResponse = {
      adapterId: adapter.id,
      chapterUrl,
      imageUrlCount: imageUrls.length,
      imageUrls,
      domSource: extraction.domSource,
      durationMs: extraction.durationMs,
    };
    reply.send({ data });
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

  app.get('/api/adapters/:id/functions/:functionId/source', async (request: FastifyRequest, reply: FastifyReply) => {
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

    const source = await getAdapterFunctionSource(adapter, functionId);
    reply.send({ data: source });
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

      const result = await testAdapterFunction(adapter, functionId, body.url, {
        challengeDiscoveryId: body.challengeDiscoveryId,
        challengeDiscoveryService: options.challengeDiscoveryService,
      });
    reply.send({ data: result });
  });

  app.post('/api/adapters/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { id: string; name: string; domains: string[] };

    if (!body.id || !body.name || !body.domains) {
      reply.code(400).send({ error: 'id, name, and domains are required' });
      return;
    }

    reply.send({ data: { message: 'Adapter registration endpoint' } });
  });
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
