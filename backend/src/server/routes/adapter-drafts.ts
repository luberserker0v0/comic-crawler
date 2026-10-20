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

interface DraftRouteContext {
  service: AdapterDraftService;
  options: AdapterDraftRouteOptions;
}

export function setupAdapterDraftRoutes(app: FastifyInstance, service: AdapterDraftService, options: AdapterDraftRouteOptions = {}): void {
  const context = { service, options };
  app.get('/api/adapter-drafts', (_request, reply) => listDrafts(reply, service));
  app.post('/api/adapters/:id/drafts', (request, reply) => createDraft(request, reply, service));
  app.get('/api/adapter-drafts/:draftId', (request, reply) => getDraft(request, reply, service));
  app.put('/api/adapter-drafts/:draftId/content', (request, reply) => saveDraft(request, reply, service));
  app.post('/api/adapter-drafts/:draftId/reset', (request, reply) => resetDraft(request, reply, service));
  app.post('/api/adapter-drafts/:draftId/functions/:functionId/test',
    (request, reply) => testDraftFunction(request, reply, context));
  app.delete('/api/adapter-drafts/:draftId', (request, reply) => discardDraft(request, reply, service));
}

async function listDrafts(reply: FastifyReply, service: AdapterDraftService): Promise<void> {
  reply.send({ data: { drafts: await service.list() } });
}

async function createDraft(request: FastifyRequest, reply: FastifyReply,
  service: AdapterDraftService): Promise<void> {
  try { reply.send({ data: await service.create(draftParam(request, 'id')) }); }
  catch (error) { sendDraftError(reply, error, 400); }
}

async function getDraft(request: FastifyRequest, reply: FastifyReply,
  service: AdapterDraftService): Promise<void> {
  const draft = await service.get(draftParam(request));
  if (!draft) return void reply.code(404).send({ error: 'Adapter draft not found' });
  reply.send({ data: draft });
}

async function saveDraft(request: FastifyRequest, reply: FastifyReply,
  service: AdapterDraftService): Promise<void> {
  try {
    const body = request.body as SaveAdapterDraftContentRequest;
    if (typeof body.content !== 'string') return void reply.code(400).send({ error: 'content is required' });
    reply.send({ data: await service.save(draftParam(request), body.content) });
  } catch (error) { sendDraftError(reply, error, 404); }
}

async function resetDraft(request: FastifyRequest, reply: FastifyReply,
  service: AdapterDraftService): Promise<void> {
  try { reply.send({ data: await service.reset(draftParam(request)) }); }
  catch (error) { sendDraftError(reply, error, 404); }
}

async function discardDraft(request: FastifyRequest, reply: FastifyReply,
  service: AdapterDraftService): Promise<void> {
  await service.discard(draftParam(request));
  reply.send({ data: { message: 'Adapter draft discarded.' } });
}

async function testDraftFunction(request: FastifyRequest, reply: FastifyReply,
  context: DraftRouteContext): Promise<void> {
  try {
    const { draftId, functionId } = request.params as { draftId: string; functionId: string };
    if (!isKnownAdapterFunction(functionId)) return void reply.code(400).send({ error: 'Unknown adapter function.' });
    const draft = await context.service.get(draftId);
    if (!draft) return void reply.code(404).send({ error: 'Adapter draft not found' });
    const body = request.body as AdapterFunctionTestRequest;
    if (!body.url) return void reply.code(400).send({ error: 'URL is required' });
    const result = await executeDraftTest(request, functionId, body, draft, context);
    reply.send({ data: withDraftSummary(result, draftId, draft.draft.baseAdapterId) });
  } catch (error) { sendDraftError(reply, error, 400); }
}

async function executeDraftTest(request: FastifyRequest, functionId: any,
  body: AdapterFunctionTestRequest, draft: Awaited<ReturnType<AdapterDraftService['get']>> & {},
  context: DraftRouteContext) {
  const adapter = instantiateDraft(draft, context.service);
  const network = await context.options.getNetworkConfig?.();
  const testOptions = { challengeDiscoveryId: body.challengeDiscoveryId,
    challengeDiscoveryService: context.options.challengeDiscoveryService, network };
  if (context.options.htmlRenderer) return testAdapterFunction(adapter, functionId, body.url,
    { ...testOptions, htmlRenderer: context.options.htmlRenderer });
  if (body.challengeDiscoveryId) return testAdapterFunction(adapter, functionId, body.url, testOptions);
  const { withBrowserSession, browserRenderService } = context.options;
  if (!withBrowserSession || !browserRenderService) throw new Error('Browser Worker service is not configured.');
  return withBrowserSession(request, body.browserTarget, body.url, (sessionId) =>
    testAdapterFunction(adapter, functionId, body.url,
      { ...testOptions, htmlRenderer: createSessionRenderer(browserRenderService, sessionId) }));
}

function instantiateDraft(draft: NonNullable<Awaited<ReturnType<AdapterDraftService['get']>>>,
  service: AdapterDraftService) {
  if (draft.draft.sourceKind === 'project-source') return instantiateProjectAdapterDraft(
    draft.content, service.getProjectSourcePath(draft.draft.baseAdapterId));
  if (draft.draft.sourceKind === 'generated-draft') return instantiateAdapterImplementationDraft(draft.content);
  return new DynamicSiteAdapter(parseDynamicManifestDraft(draft.content));
}

function draftParam(request: FastifyRequest, key: 'draftId' | 'id' = 'draftId'): string {
  return (request.params as Record<string, string>)[key]!;
}

function sendDraftError(reply: FastifyReply, error: unknown, status: number): void {
  reply.code(status).send({ error: error instanceof Error ? error.message : String(error) });
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
  const parsed = parseManifestJson(content);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Draft manifest must be a JSON object.');
  }
  const manifest = parsed as Partial<DynamicSiteAdapterManifest>;
  validateManifestDraft(manifest);
  return { sourceDiscoveryId: 'adapter-draft', promotedAt: new Date().toISOString(),
    ...manifest } as DynamicSiteAdapterManifest;
}

function parseManifestJson(content: string): unknown {
  try { return JSON.parse(content); }
  catch (error) { throw new Error(
    `Draft manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
}

function validateManifestDraft(manifest: Partial<DynamicSiteAdapterManifest>): void {
  if (!manifest.adapterId || typeof manifest.adapterId !== 'string') throw new Error('Draft manifest requires adapterId.');
  if (!manifest.name || typeof manifest.name !== 'string') throw new Error('Draft manifest requires name.');
  if (!Array.isArray(manifest.domains) || manifest.domains.length === 0) throw new Error('Draft manifest requires domains.');
  if (!Array.isArray(manifest.urlPatterns) || manifest.urlPatterns.length === 0) throw new Error('Draft manifest requires urlPatterns.');
  if (!manifest.selectors || typeof manifest.selectors !== 'object') throw new Error('Draft manifest requires selectors.');
  if (!manifest.selectors.images) throw new Error('Draft manifest requires selectors.images for executable draft tests.');
}
