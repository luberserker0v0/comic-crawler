import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SelectorDiscoveryService, SelectorDiscoverySettingsStore } from '../../selector-discovery';
import { SelectorDiscoveryBundleManager } from '../../selector-discovery';
import type { ChallengeDiscoveryService } from '../../challenge';
import type { AdapterDraftService } from '../../adapter-drafts/service';
import type { BrowserTarget, NetworkConfig } from '@comiccrawler/shared';
import type { BrowserRenderService } from '../../browser/browser-render-service';
import type { HtmlRenderer } from '../../crawler/html-renderer';
import { DomReadinessChecker } from '../../fixtures/dom-readiness';
import { setupSelectorDiscoverySettingsRoutes } from './selector-discovery-settings';
import { setupDiscoveryDraftFunctionRoutes } from './selector-discovery-function-routes';
import type { BrowserWorkerLeaseCoordinator } from '../../browser/browser-worker-lease-coordinator';
import type { ApiSecurityService } from '../../security/api-security';
import { requestPrincipal } from '../middleware/api-security';
import { isActiveSelectorDiscoveryJob } from '../../selector-discovery/lifecycle';

interface DiscoveryRouteOptions {
  challengeDiscoveryService?: ChallengeDiscoveryService;
  adapterDraftService?: AdapterDraftService;
  withBrowserSession?: <T>(request: FastifyRequest, target: BrowserTarget | undefined,
    initialUrl: string, action: (sessionId: string) => Promise<T>) => Promise<T>;
  browserRenderService?: BrowserRenderService;
  htmlRenderer?: HtmlRenderer;
  getNetworkConfig?: () => NetworkConfig | Promise<NetworkConfig>;
  browserLeaseCoordinator?: BrowserWorkerLeaseCoordinator;
  apiSecurity?: ApiSecurityService;
}

interface DiscoveryRouteContext {
  service: SelectorDiscoveryService;
  options: DiscoveryRouteOptions;
}

interface DiscoveryBody {
  url?: string;
  html?: string;
  finalUrl?: string;
  target?: 'full' | 'chapter-only';
  aoBaseUrl?: string;
  providerDocument?: unknown;
  model?: string;
  forceDiscovery?: boolean;
  browserTarget?: { mode?: string; workerId?: string; resourceId?: string };
}

type BrowserTargetInput = { mode?: string; workerId?: string; resourceId?: string } | undefined;

export function setupSelectorDiscoveryRoutes(
  app: FastifyInstance,
  discoveryService: SelectorDiscoveryService,
  settingsStore: SelectorDiscoverySettingsStore,
  bundleManager = new SelectorDiscoveryBundleManager(),
  options: DiscoveryRouteOptions = {}
): void {
  setupSelectorDiscoverySettingsRoutes(app, settingsStore, bundleManager);

  setupDiscoveryJobRoutes(app, '/api/selector-discovery', discoveryService, options);
}

function setupDiscoveryJobRoutes(
  app: FastifyInstance,
  prefix: '/api/selector-discovery',
  discoveryService: SelectorDiscoveryService,
  options: DiscoveryRouteOptions = {}
): void {
  const context = { service: discoveryService, options };
  app.post(prefix, (request, reply) => createDiscovery(request, reply, context));
  app.post(`${prefix}/snapshot`, (request, reply) => createSnapshotDiscovery(request, reply, context));
  app.get(prefix, (_request, reply) => listDiscoveries(reply, discoveryService));
  app.get(`${prefix}/:id`, (request, reply) => getDiscovery(request, reply, discoveryService));
  app.delete(`${prefix}/:id`, (request, reply) => deleteDiscovery(request, reply, discoveryService));
  setupDiscoveryDraftFunctionRoutes(app, prefix, discoveryService, options);
  app.post(`${prefix}/:id/retry`, (request, reply) => mutateDiscovery('retry', request, reply, discoveryService));
  app.post(`${prefix}/:id/promote`, (request, reply) => mutateDiscovery('promote', request, reply, discoveryService));
  app.post(`${prefix}/:id/reject`, (request, reply) => mutateDiscovery('reject', request, reply, discoveryService));
}

async function createDiscovery(request: FastifyRequest, reply: FastifyReply,
  context: DiscoveryRouteContext): Promise<void> {
  try {
    const body = request.body as DiscoveryBody;
    if (!body.url) return void reply.code(400).send({ error: 'URL is required.' });
    if (body.target && body.target !== 'full' && body.target !== 'chapter-only') return void reply.code(400)
      .send({ error: 'Discovery target must be "full" or "chapter-only".' });
    const ownerUserId = requestOwner(request, context.options);
    const browserTarget = validateBrowserTarget(body.browserTarget, ownerUserId,
      context.options.browserLeaseCoordinator);
    const job = await context.service.create(discoveryInput(body, ownerUserId, browserTarget));
    reply.code(job.status === 'known_adapter' ? 200 : 202).send({ data: job });
  } catch (error) { sendDiscoveryError(reply, error); }
}

async function createSnapshotDiscovery(request: FastifyRequest, reply: FastifyReply,
  context: DiscoveryRouteContext): Promise<void> {
  try {
    const body = request.body as DiscoveryBody;
    if (!validateSnapshotBody(body, reply)) return;
    if (!validateSnapshotReadiness(body, reply)) return;
    const ownerUserId = requestOwner(request, context.options);
    const browserTarget = validateBrowserTarget(body.browserTarget, ownerUserId,
      context.options.browserLeaseCoordinator);
    const input = { ...discoveryInput(body, ownerUserId, browserTarget), target: 'chapter-only' as const,
      forceDiscovery: body.forceDiscovery ?? true,
      htmlSnapshot: { html: body.html!, finalUrl: body.finalUrl, pageType: 'chapter' as const } };
    reply.code(202).send({ data: await context.service.create(input) });
  } catch (error) { sendDiscoveryError(reply, error); }
}

function validateSnapshotBody(body: DiscoveryBody, reply: FastifyReply): boolean {
  if (!body.url) { reply.code(400).send({ error: 'URL is required.' }); return false; }
  if (!body.html?.trim()) { reply.code(400).send({ error: 'HTML snapshot is required.' }); return false; }
  if (body.target && body.target !== 'chapter-only') {
    reply.code(400).send({ error: 'HTML snapshot discovery currently supports only chapter-only target.' });
    return false;
  }
  return true;
}

function validateSnapshotReadiness(body: DiscoveryBody, reply: FastifyReply): boolean {
  const readiness = new DomReadinessChecker().check({ url: body.finalUrl ?? body.url!,
    html: body.html!, target: 'chapterImages' });
  if (readiness.status === 'ready') return true;
  reply.code(400).send({ error:
    `HTML snapshot is not trusted enough for selector discovery: ${readiness.reasons.join(' ')}`,
  data: { readiness } });
  return false;
}

function discoveryInput(body: DiscoveryBody, ownerUserId: string, browserTarget: BrowserTarget) {
  return { url: body.url!, target: body.target, aoBaseUrl: body.aoBaseUrl,
    providerDocument: body.providerDocument as any, model: body.model,
    forceDiscovery: body.forceDiscovery, ownerUserId, browserTarget };
}

async function listDiscoveries(reply: FastifyReply, service: SelectorDiscoveryService): Promise<void> {
  reply.send({ data: { jobs: await service.list() } });
}

async function getDiscovery(request: FastifyRequest, reply: FastifyReply,
  service: SelectorDiscoveryService): Promise<void> {
  const job = await service.get(routeId(request));
  if (!job) return void reply.code(404).send({ error: 'Discovery job not found.' });
  reply.send({ data: job });
}

async function deleteDiscovery(request: FastifyRequest, reply: FastifyReply,
  service: SelectorDiscoveryService): Promise<void> {
  const id = routeId(request);
  const job = await service.get(id);
  if (!job) return void reply.code(404).send({ error: 'Discovery job not found.' });
  if (isActiveSelectorDiscoveryJob(job)) return void reply.code(409).send({
    error: `Discovery job "${id}" is ${job.status}; cancel or wait for it to finish before deletion.` });
  await service.deleteJob(id);
  reply.send({ data: { id, deleted: true, adapterPreserved: job.status === 'promoted' } });
}

async function mutateDiscovery(action: 'retry' | 'promote' | 'reject', request: FastifyRequest,
  reply: FastifyReply, service: SelectorDiscoveryService): Promise<void> {
  try {
    const result = await service[action](routeId(request));
    reply.code(action === 'retry' ? 202 : 200).send({ data: result });
  } catch (error) { sendDiscoveryError(reply, error); }
}

function routeId(request: FastifyRequest): string {
  return (request.params as { id: string }).id;
}

function requestOwner(request: FastifyRequest, options: DiscoveryRouteOptions): string {
  return options.apiSecurity ? requestPrincipal(request, options.apiSecurity).userId : 'public';
}

function sendDiscoveryError(reply: FastifyReply, error: unknown): void {
  reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
}

function validateBrowserTarget(value: BrowserTargetInput, ownerUserId: string,
  coordinator: BrowserWorkerLeaseCoordinator | undefined) {
  if (value === undefined) return { mode: 'managed-profile' as const };
  const workerId = value.workerId?.trim();
  if (value.mode === 'managed-profile') {
    const target = workerId ? { mode: 'managed-profile' as const, workerId }
      : { mode: 'managed-profile' as const };
    coordinator?.validateTarget(ownerUserId, target);
    return target;
  }
  const resourceId = value.resourceId?.trim();
  if (value.mode !== 'existing-tab' || !workerId || !resourceId) {
    throw new Error('browserTarget must select managed-profile or provide an existing-tab workerId and resourceId.');
  }
  const target = { mode: 'existing-tab' as const, workerId, resourceId };
  coordinator?.validateTarget(ownerUserId, target);
  return target;
}
