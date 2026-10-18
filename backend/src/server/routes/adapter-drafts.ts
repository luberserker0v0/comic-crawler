import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AdapterFunctionTestRequest, BrowserTarget, NetworkConfig, SaveAdapterDraftContentRequest } from '@comiccrawler/shared';
import type { AdapterDraftService } from '../../adapter-drafts/service';
import type { ChallengeDiscoveryService } from '../../challenge';
import { DynamicSiteAdapter, type DynamicSiteAdapterManifest } from '../../adapter/dynamic-site-adapter';
import { isKnownAdapterFunction, testAdapterFunction } from './adapters';
import { instantiateAdapterImplementationDraft, instantiateProjectAdapterDraft } from '../../selector-discovery/adapter-draft-runtime';
import type { BrowserRenderService } from '../../browser/browser-render-service';
import type { HtmlRenderer } from '../../crawler/html-renderer';

interface AdapterDraftRouteOptions {
  challengeDiscoveryService?: ChallengeDiscoveryService;
  withBrowserSession?: <T>(
    request: FastifyRequest,
    target: BrowserTarget | undefined,
    initialUrl: string,
    action: (sessionId: string) => Promise<T>
  ) => Promise<T>;
  browserRenderService?: BrowserRenderService;
  htmlRenderer?: HtmlRenderer;
  getNetworkConfig?: () => NetworkConfig | Promise<NetworkConfig>;
}

export function setupAdapterDraftRoutes(app: FastifyInstance, service: AdapterDraftService, options: AdapterDraftRouteOptions = {}): void {
  app.get('/api/adapter-drafts', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ data: { drafts: await service.list() } });
  });

  app.post('/api/adapters/:id/drafts', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      reply.send({ data: await service.create(id) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/adapter-drafts/:draftId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { draftId } = request.params as { draftId: string };
    const draft = await service.get(draftId);
    if (!draft) {
      reply.code(404).send({ error: 'Adapter draft not found' });
      return;
    }
    reply.send({ data: draft });
  });

  app.put('/api/adapter-drafts/:draftId/content', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { draftId } = request.params as { draftId: string };
      const body = request.body as SaveAdapterDraftContentRequest;
      if (typeof body.content !== 'string') {
        reply.code(400).send({ error: 'content is required' });
        return;
      }
      reply.send({ data: await service.save(draftId, body.content) });
    } catch (error) {
      reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/adapter-drafts/:draftId/reset', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { draftId } = request.params as { draftId: string };
      reply.send({ data: await service.reset(draftId) });
    } catch (error) {
      reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/adapter-drafts/:draftId/functions/:functionId/test', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { draftId, functionId } = request.params as { draftId: string; functionId: string };
      if (!isKnownAdapterFunction(functionId)) {
        reply.code(400).send({ error: 'Unknown adapter function.' });
        return;
      }

      const draft = await service.get(draftId);
      if (!draft) {
        reply.code(404).send({ error: 'Adapter draft not found' });
        return;
      }
      const body = request.body as AdapterFunctionTestRequest;
      if (!body.url) {
        reply.code(400).send({ error: 'URL is required' });
        return;
      }

      const adapter = draft.draft.sourceKind === 'project-source'
        ? instantiateProjectAdapterDraft(draft.content, service.getProjectSourcePath(draft.draft.baseAdapterId))
        : draft.draft.sourceKind === 'generated-draft'
          ? instantiateAdapterImplementationDraft(draft.content)
          : new DynamicSiteAdapter(parseDynamicManifestDraft(draft.content));
      const network = await options.getNetworkConfig?.();
      if (options.htmlRenderer) {
        const result = await testAdapterFunction(adapter, functionId, body.url, {
          challengeDiscoveryId: body.challengeDiscoveryId,
          challengeDiscoveryService: options.challengeDiscoveryService,
          network,
          htmlRenderer: options.htmlRenderer,
        });
        reply.send({ data: withDraftSummary(result, draftId, draft.draft.baseAdapterId) });
        return;
      }
      if (body.challengeDiscoveryId) {
        const result = await testAdapterFunction(adapter, functionId, body.url, {
          challengeDiscoveryId: body.challengeDiscoveryId,
          challengeDiscoveryService: options.challengeDiscoveryService,
          network,
        });
        reply.send({ data: withDraftSummary(result, draftId, draft.draft.baseAdapterId) });
        return;
      }
      if (!options.withBrowserSession || !options.browserRenderService) {
        throw new Error('Browser Worker service is not configured.');
      }
      const result = await options.withBrowserSession(request, body.browserTarget, body.url, (sessionId) =>
        testAdapterFunction(adapter, functionId, body.url, {
          challengeDiscoveryId: body.challengeDiscoveryId,
          challengeDiscoveryService: options.challengeDiscoveryService,
          network,
          htmlRenderer: createSessionRenderer(options.browserRenderService!, sessionId),
        }));
      reply.send({ data: withDraftSummary(result, draftId, draft.draft.baseAdapterId) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete('/api/adapter-drafts/:draftId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { draftId } = request.params as { draftId: string };
    await service.discard(draftId);
    reply.send({ data: { message: 'Adapter draft discarded.' } });
  });
}

function withDraftSummary<T extends { resultSummary?: Record<string, unknown> }>(
  result: T,
  draftId: string,
  baseAdapterId: string
) {
  return {
    ...result,
    adapterId: draftId,
    resultSummary: { ...(result.resultSummary ?? {}), draftId, baseAdapterId },
  };
}

function createSessionRenderer(renderService: BrowserRenderService, sessionId: string): HtmlRenderer {
  return {
    render: async (url) => (await renderService.render(sessionId, url)).html,
    dispose: async () => undefined,
  };
}

function parseDynamicManifestDraft(content: string): DynamicSiteAdapterManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`Draft manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Draft manifest must be a JSON object.');
  }
  const manifest = parsed as Partial<DynamicSiteAdapterManifest>;
  if (!manifest.adapterId || typeof manifest.adapterId !== 'string') throw new Error('Draft manifest requires adapterId.');
  if (!manifest.name || typeof manifest.name !== 'string') throw new Error('Draft manifest requires name.');
  if (!Array.isArray(manifest.domains) || manifest.domains.length === 0) throw new Error('Draft manifest requires domains.');
  if (!Array.isArray(manifest.urlPatterns) || manifest.urlPatterns.length === 0) throw new Error('Draft manifest requires urlPatterns.');
  if (!manifest.selectors || typeof manifest.selectors !== 'object') throw new Error('Draft manifest requires selectors.');
  if (!manifest.selectors.images) throw new Error('Draft manifest requires selectors.images for executable draft tests.');
  return {
    sourceDiscoveryId: 'adapter-draft',
    promotedAt: new Date().toISOString(),
    ...manifest,
  } as DynamicSiteAdapterManifest;
}
