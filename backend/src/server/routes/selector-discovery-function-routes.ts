import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  AdapterFunctionRevisionRequest,
  AdapterFunctionTestRequest,
  AdapterImplementationResponse,
  BrowserTarget,
  NetworkConfig,
} from '@comiccrawler/shared';
import type { SelectorDiscoveryService } from '../../selector-discovery';
import type { ChallengeDiscoveryService } from '../../challenge';
import type { AdapterDraftService } from '../../adapter-drafts/service';
import { instantiateAdapterImplementationDraft } from '../../selector-discovery/adapter-draft-runtime';
import { describeAdapterFunctions, isKnownAdapterFunction, testAdapterFunction, type AdapterFunctionId } from './adapters';
import { createImplementationOutline, instantiateDiscoveryDraftAdapter } from './selector-discovery-helpers';
import type { BrowserRenderService } from '../../browser/browser-render-service';
import type { HtmlRenderer } from '../../crawler/html-renderer';

interface DiscoveryFunctionRouteOptions {
  challengeDiscoveryService?: ChallengeDiscoveryService;
  adapterDraftService?: AdapterDraftService;
  withBrowserSession?: <T>(request: FastifyRequest, target: BrowserTarget | undefined,
    initialUrl: string, action: (sessionId: string) => Promise<T>) => Promise<T>;
  browserRenderService?: BrowserRenderService;
  htmlRenderer?: HtmlRenderer;
  getNetworkConfig?: () => NetworkConfig | Promise<NetworkConfig>;
}

interface FunctionRouteContext {
  service: SelectorDiscoveryService;
  options: DiscoveryFunctionRouteOptions;
}

export function setupDiscoveryDraftFunctionRoutes(
  app: FastifyInstance,
  prefix: '/api/selector-discovery',
  discoveryService: SelectorDiscoveryService,
  options: DiscoveryFunctionRouteOptions = {}
): void {
  const context = { service: discoveryService, options };
  app.get(`${prefix}/:id/implementation`, (request, reply) => getImplementation(request, reply, context));
  app.get(`${prefix}/:id/capabilities`, (request, reply) => getCapabilities(request, reply, context));
  app.post(`${prefix}/:id/functions/:functionId/test`, (request, reply) => testFunction(request, reply, context));
  app.post(`${prefix}/:id/functions/:functionId/revision-requests`,
    (request, reply) => requestRevision(request, reply, context));
  app.post(`${prefix}/:id/function-revisions/:revisionTaskId/retry`,
    (request, reply) => retryRevision(request, reply, context));
  app.post(`${prefix}/:id/drafts`, (request, reply) => createEditableDraft(request, reply, context));
}

async function getImplementation(request: FastifyRequest, reply: FastifyReply,
  context: FunctionRouteContext): Promise<void> {
  const job = await context.service.get(routeId(request));
  if (!job) return void reply.code(404).send({ error: 'Discovery job not found.' });
  if (!job.adapterImplementationTs?.trim()) return void reply.code(404).send(
    { error: 'Discovery job has no adapter implementation draft.' });
  const data: AdapterImplementationResponse = { adapterId: job.adapterId ?? `selector-discovery:${job.id}`,
    sourceType: 'generated-draft', language: 'typescript', content: job.adapterImplementationTs,
    outline: createImplementationOutline(job.adapterImplementationTs),
    notes: 'AO-generated TypeScript adapter implementation draft. Function selection is a test target; review the full source as one artifact.' };
  reply.send({ data });
}

async function getCapabilities(request: FastifyRequest, reply: FastifyReply,
  context: FunctionRouteContext): Promise<void> {
  try {
    const adapter = await instantiateDiscoveryDraftAdapter(context.service, routeId(request));
    reply.send({ data: { adapter: { id: adapter.id, name: adapter.name, domains: adapter.domains,
      parseMode: adapter.parseMode, capabilities: adapter.capabilities },
    functions: describeAdapterFunctions(adapter as any) } });
  } catch (error) { sendError(reply, error); }
}

async function testFunction(request: FastifyRequest, reply: FastifyReply,
  context: FunctionRouteContext): Promise<void> {
  try {
    const { id, functionId } = request.params as { id: string; functionId: AdapterFunctionId };
    if (!isKnownAdapterFunction(functionId)) return void reply.code(400).send({ error: 'Unknown adapter function.' });
    const body = request.body as AdapterFunctionTestRequest;
    if (!body.url) return void reply.code(400).send({ error: 'URL is required.' });
    const adapter = await instantiateDiscoveryDraftAdapter(context.service, id);
    const result = await executeFunctionTest(request, adapter, functionId, body, context.options);
    reply.send({ data: withDiscoverySummary(result, id, adapter.id) });
  } catch (error) { sendError(reply, error); }
}

async function executeFunctionTest(request: FastifyRequest, adapter: any, functionId: AdapterFunctionId,
  body: AdapterFunctionTestRequest, options: DiscoveryFunctionRouteOptions) {
  const network = await options.getNetworkConfig?.();
  const base = { challengeDiscoveryId: body.challengeDiscoveryId,
    challengeDiscoveryService: options.challengeDiscoveryService, network };
  if (options.htmlRenderer) return testAdapterFunction(adapter, functionId, body.url,
    { ...base, htmlRenderer: options.htmlRenderer });
  if (body.challengeDiscoveryId) return testAdapterFunction(adapter, functionId, body.url, base);
  const { withBrowserSession, browserRenderService } = options;
  if (!withBrowserSession || !browserRenderService) throw new Error('Browser Worker service is not configured.');
  return withBrowserSession(request, body.browserTarget, body.url, (sessionId) =>
    testAdapterFunction(adapter, functionId, body.url,
      { ...base, htmlRenderer: createSessionRenderer(browserRenderService, sessionId) }));
}

async function requestRevision(request: FastifyRequest, reply: FastifyReply,
  context: FunctionRouteContext): Promise<void> {
  try {
    const { id, functionId } = request.params as { id: string; functionId: AdapterFunctionId };
    if (!isKnownAdapterFunction(functionId)) return void reply.code(400).send({ error: 'Unknown adapter function.' });
    const body = request.body as AdapterFunctionRevisionRequest;
    reply.code(202).send({ data: await context.service.requestFunctionRevision({ id, functionId,
      instruction: typeof body.instruction === 'string' ? body.instruction : '',
      currentSource: typeof body.currentSource === 'string' ? body.currentSource : undefined }) });
  } catch (error) { sendError(reply, error); }
}

async function retryRevision(request: FastifyRequest, reply: FastifyReply,
  context: FunctionRouteContext): Promise<void> {
  try {
    const { id, revisionTaskId } = request.params as { id: string; revisionTaskId: string };
    const body = request.body as { currentSource?: string; modelMode?: 'current-settings' | 'previous-task' };
    reply.code(202).send({ data: await context.service.retryFunctionRevision({ id, revisionTaskId,
      currentSource: typeof body.currentSource === 'string' ? body.currentSource : undefined,
      modelMode: body.modelMode === 'previous-task' ? 'previous-task' : 'current-settings' }) });
  } catch (error) { sendError(reply, error); }
}

async function createEditableDraft(request: FastifyRequest, reply: FastifyReply,
  context: FunctionRouteContext): Promise<void> {
  try {
    const drafts = context.options.adapterDraftService;
    if (!drafts) return void reply.code(400).send({ error: 'Adapter draft service is not available.' });
    const job = await context.service.get(routeId(request));
    if (!job) return void reply.code(404).send({ error: 'Discovery job not found.' });
    if (!job.adapterImplementationTs?.trim()) return void reply.code(400).send(
      { error: 'Discovery job has no TypeScript implementation draft to edit.' });
    const adapter = instantiateAdapterImplementationDraft(job.adapterImplementationTs);
    reply.send({ data: await drafts.createFromGeneratedImplementation({ baseAdapterId: adapter.id,
      baseAdapterName: adapter.name, content: job.adapterImplementationTs }) });
  } catch (error) { sendError(reply, error); }
}

function routeId(request: FastifyRequest): string {
  return (request.params as { id: string }).id;
}

function sendError(reply: FastifyReply, error: unknown): void {
  reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
}

function createSessionRenderer(renderService: BrowserRenderService, sessionId: string): HtmlRenderer {
  return {
    render: async (url) => (await renderService.render(sessionId, url)).html,
    dispose: async () => undefined,
  };
}

function withDiscoverySummary<T extends { resultSummary?: Record<string, unknown> }>(
  result: T,
  discoveryJobId: string,
  draftAdapterId: string
) {
  return {
    ...result,
    adapterId: `selector-discovery:${discoveryJobId}`,
    resultSummary: { ...(result.resultSummary ?? {}), discoveryJobId, draftAdapterId },
  };
}
