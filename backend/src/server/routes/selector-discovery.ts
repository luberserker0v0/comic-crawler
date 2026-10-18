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

export function setupSelectorDiscoveryRoutes(
  app: FastifyInstance,
  discoveryService: SelectorDiscoveryService,
  settingsStore: SelectorDiscoverySettingsStore,
  bundleManager = new SelectorDiscoveryBundleManager(),
  options: {
    challengeDiscoveryService?: ChallengeDiscoveryService;
    adapterDraftService?: AdapterDraftService;
    withBrowserSession?: <T>(request: FastifyRequest, target: BrowserTarget | undefined, initialUrl: string, action: (sessionId: string) => Promise<T>) => Promise<T>;
    browserRenderService?: BrowserRenderService;
    htmlRenderer?: HtmlRenderer;
    getNetworkConfig?: () => NetworkConfig | Promise<NetworkConfig>;
    browserLeaseCoordinator?: BrowserWorkerLeaseCoordinator;
    apiSecurity?: ApiSecurityService;
  } = {}
): void {
  setupSelectorDiscoverySettingsRoutes(app, settingsStore, bundleManager);

  setupDiscoveryJobRoutes(app, '/api/selector-discovery', discoveryService, options);
}

function setupDiscoveryJobRoutes(
  app: FastifyInstance,
  prefix: '/api/selector-discovery',
  discoveryService: SelectorDiscoveryService,
  options: {
    challengeDiscoveryService?: ChallengeDiscoveryService;
    adapterDraftService?: AdapterDraftService;
    withBrowserSession?: <T>(request: FastifyRequest, target: BrowserTarget | undefined, initialUrl: string, action: (sessionId: string) => Promise<T>) => Promise<T>;
    browserRenderService?: BrowserRenderService;
    htmlRenderer?: HtmlRenderer;
    getNetworkConfig?: () => NetworkConfig | Promise<NetworkConfig>;
    browserLeaseCoordinator?: BrowserWorkerLeaseCoordinator;
    apiSecurity?: ApiSecurityService;
  } = {}
): void {
  app.post(prefix, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as {
        url?: string;
        target?: 'full' | 'chapter-only';
        aoBaseUrl?: string;
        providerDocument?: unknown;
        model?: string;
        forceDiscovery?: boolean;
        browserTarget?: { mode?: string; workerId?: string; resourceId?: string };
      };
      if (!body.url) {
        reply.code(400).send({ error: 'URL is required.' });
        return;
      }
      if (body.target && body.target !== 'full' && body.target !== 'chapter-only') {
        reply.code(400).send({ error: 'Discovery target must be "full" or "chapter-only".' });
        return;
      }
      const principal = options.apiSecurity
        ? requestPrincipal(request, options.apiSecurity)
        : undefined;
      const browserTarget = validateBrowserTarget(body.browserTarget, principal?.userId ?? 'public', options.browserLeaseCoordinator);

      const job = await discoveryService.create({
        url: body.url,
        target: body.target,
        aoBaseUrl: body.aoBaseUrl,
        providerDocument: body.providerDocument as any,
        model: body.model,
        forceDiscovery: body.forceDiscovery,
        ownerUserId: principal?.userId ?? 'public',
        browserTarget,
      });
      reply.code(job.status === 'known_adapter' ? 200 : 202).send({ data: job });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post(`${prefix}/snapshot`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as {
        url?: string;
        html?: string;
        finalUrl?: string;
        target?: 'chapter-only';
        aoBaseUrl?: string;
        providerDocument?: unknown;
        model?: string;
        forceDiscovery?: boolean;
        browserTarget?: { mode?: string; workerId?: string; resourceId?: string };
      };
      if (!body.url) {
        reply.code(400).send({ error: 'URL is required.' });
        return;
      }
      if (!body.html?.trim()) {
        reply.code(400).send({ error: 'HTML snapshot is required.' });
        return;
      }
      if (body.target && body.target !== 'chapter-only') {
        reply.code(400).send({ error: 'HTML snapshot discovery currently supports only chapter-only target.' });
        return;
      }
      const readiness = new DomReadinessChecker().check({
        url: body.finalUrl ?? body.url,
        html: body.html,
        target: 'chapterImages',
      });
      if (readiness.status !== 'ready') {
        reply.code(400).send({
          error: `HTML snapshot is not trusted enough for selector discovery: ${readiness.reasons.join(' ')}`,
          data: { readiness },
        });
        return;
      }
      const principal = options.apiSecurity
        ? requestPrincipal(request, options.apiSecurity)
        : undefined;
      const browserTarget = validateBrowserTarget(body.browserTarget, principal?.userId ?? 'public', options.browserLeaseCoordinator);

      const job = await discoveryService.create({
        url: body.url,
        target: 'chapter-only',
        aoBaseUrl: body.aoBaseUrl,
        providerDocument: body.providerDocument as any,
        model: body.model,
        forceDiscovery: body.forceDiscovery ?? true,
        ownerUserId: principal?.userId ?? 'public',
        browserTarget,
        htmlSnapshot: {
          html: body.html,
          finalUrl: body.finalUrl,
          pageType: 'chapter',
        },
      });
      reply.code(202).send({ data: job });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get(prefix, async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ data: { jobs: await discoveryService.list() } });
  });

  app.get(`${prefix}/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const job = await discoveryService.get(id);
    if (!job) {
      reply.code(404).send({ error: 'Discovery job not found.' });
      return;
    }
    reply.send({ data: job });
  });

  setupDiscoveryDraftFunctionRoutes(app, prefix, discoveryService, options);

  app.post(`${prefix}/:id/retry`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const job = await discoveryService.retry(id);
      reply.code(202).send({ data: job });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post(`${prefix}/:id/promote`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      reply.send({ data: await discoveryService.promote(id) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post(`${prefix}/:id/reject`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      reply.send({ data: await discoveryService.reject(id) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function validateBrowserTarget(
  value: { mode?: string; workerId?: string; resourceId?: string } | undefined,
  ownerUserId: string,
  coordinator: BrowserWorkerLeaseCoordinator | undefined
) {
  if (value === undefined) return { mode: 'managed-profile' as const };
  const workerId = value.workerId?.trim();
  if (value.mode === 'managed-profile') {
    const target = workerId
      ? { mode: 'managed-profile' as const, workerId }
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
