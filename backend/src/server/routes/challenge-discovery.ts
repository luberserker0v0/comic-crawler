import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ChallengeDiscoveryService } from '../../challenge';
import type { SelectorDiscoveryService } from '../../selector-discovery';
import type { BrowserTarget } from '@comiccrawler/shared';
import type { ApiSecurityService } from '../../security/api-security';
import { requestPrincipal } from '../middleware/api-security';

export function setupChallengeDiscoveryRoutes(
  app: FastifyInstance,
  challengeDiscoveryService: ChallengeDiscoveryService,
  selectorDiscoveryService?: SelectorDiscoveryService,
  options: {
    apiSecurity?: ApiSecurityService;
  } = {}
): void {
  app.post('/api/challenge-discovery', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as { url?: string; browserTarget?: BrowserTarget };
      if (!body.url) {
        reply.code(400).send({ error: 'URL is required.' });
        return;
      }
      const principal = options.apiSecurity
        ? requestPrincipal(request, options.apiSecurity)
        : undefined;
      const job = await challengeDiscoveryService.create({
        url: body.url,
        ownerUserId: principal?.userId ?? 'public',
        browserTarget: body.browserTarget,
      });
      reply.code(202).send({ data: job });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/challenge-discovery', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ data: { jobs: await challengeDiscoveryService.list() } });
  });

  app.get('/api/challenge-discovery/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const job = await challengeDiscoveryService.get(id);
    if (!job) {
      reply.code(404).send({ error: 'Challenge discovery job not found.' });
      return;
    }
    reply.send({ data: job });
  });

  app.delete('/api/challenge-discovery/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const deleted = await challengeDiscoveryService.deleteJob(id);
    if (!deleted) {
      reply.code(404).send({ error: 'Challenge discovery job not found.' });
      return;
    }
    reply.send({ data: { message: 'Challenge discovery job deleted.' } });
  });

  app.post('/api/challenge-discovery/:id/retry', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      reply.code(202).send({ data: await challengeDiscoveryService.retry(id) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/challenge-discovery/:id/promote', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      reply.send({ data: await challengeDiscoveryService.promote(id) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/challenge-discovery/:id/open-browser', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      reply.send({ data: await challengeDiscoveryService.openBrowser(id) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/challenge-discovery/:id/inspect-remote-page', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      reply.send({ data: await challengeDiscoveryService.inspectRemotePage(id) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/challenge-discovery/:id/create-selector-discovery-from-remote', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!selectorDiscoveryService) {
        reply.code(400).send({ error: 'Selector discovery service is not available.' });
        return;
      }
      const { id } = request.params as { id: string };
      const snapshot = await challengeDiscoveryService.readRemotePageSnapshot(id);
      const discovery = await selectorDiscoveryService.create({
        url: snapshot.job.normalizedUrl,
        target: 'chapter-only',
        forceDiscovery: true,
        htmlSnapshot: {
          html: snapshot.page.html,
          finalUrl: snapshot.page.url,
          pageType: 'chapter',
        },
      });
      reply.code(202).send({ data: { challenge: snapshot.job, discovery } });
      await challengeDiscoveryService.releaseBrowserLease(id);
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/challenge-discovery/:id/complete-human-verification', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { settle?: boolean; allowNavigate?: boolean } | undefined;
      const job = await challengeDiscoveryService.completeHumanVerification(id, {
          settle: body?.settle,
          allowNavigate: body?.allowNavigate,
        });
      reply.code(202).send({ data: job });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
