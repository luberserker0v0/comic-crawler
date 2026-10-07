import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SelectorDiscoveryService, SelectorDiscoverySettingsStore } from '../../selector-discovery';
import { SelectorDiscoveryBundleManager } from '../../selector-discovery';
import type { ChallengeDiscoveryService } from '../../challenge';
import type { AdapterDraftService } from '../../adapter-drafts/service';
import { DomReadinessChecker } from '../../fixtures/dom-readiness';
import { setupSelectorDiscoverySettingsRoutes } from './selector-discovery-settings';
import { setupDiscoveryDraftFunctionRoutes } from './selector-discovery-function-routes';

export function setupSelectorDiscoveryRoutes(
  app: FastifyInstance,
  discoveryService: SelectorDiscoveryService,
  settingsStore: SelectorDiscoverySettingsStore,
  bundleManager = new SelectorDiscoveryBundleManager(),
  options: { challengeDiscoveryService?: ChallengeDiscoveryService; adapterDraftService?: AdapterDraftService } = {}
): void {
  setupSelectorDiscoverySettingsRoutes(app, settingsStore, bundleManager);

  setupDiscoveryJobRoutes(app, '/api/selector-discovery', discoveryService, options);
  setupDiscoveryJobRoutes(app, '/api/site-discovery', discoveryService, options);
}

function setupDiscoveryJobRoutes(
  app: FastifyInstance,
  prefix: '/api/selector-discovery' | '/api/site-discovery',
  discoveryService: SelectorDiscoveryService,
  options: { challengeDiscoveryService?: ChallengeDiscoveryService; adapterDraftService?: AdapterDraftService } = {}
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
      };
      if (!body.url) {
        reply.code(400).send({ error: 'URL is required.' });
        return;
      }
      if (body.target && body.target !== 'full' && body.target !== 'chapter-only') {
        reply.code(400).send({ error: 'Discovery target must be "full" or "chapter-only".' });
        return;
      }

      const job = await discoveryService.create({
        url: body.url,
        target: body.target,
        aoBaseUrl: body.aoBaseUrl,
        providerDocument: body.providerDocument as any,
        model: body.model,
        forceDiscovery: body.forceDiscovery,
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

      const job = await discoveryService.create({
        url: body.url,
        target: 'chapter-only',
        aoBaseUrl: body.aoBaseUrl,
        providerDocument: body.providerDocument as any,
        model: body.model,
        forceDiscovery: body.forceDiscovery ?? true,
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

  app.post(`${prefix}/:id/revalidate`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      reply.send({ data: await discoveryService.revalidate(id) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post(`${prefix}/:id/validate`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      reply.send({ data: await discoveryService.validateCandidate(id) });
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

  app.post(`${prefix}/:id/shadow-promote`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      reply.send({ data: await discoveryService.shadowPromote(id) });
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
