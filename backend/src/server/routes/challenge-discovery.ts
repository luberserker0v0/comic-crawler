import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ChallengeDiscoveryService } from '../../challenge';
import type { SelectorDiscoveryService } from '../../selector-discovery';

export function setupChallengeDiscoveryRoutes(
  app: FastifyInstance,
  challengeDiscoveryService: ChallengeDiscoveryService,
  selectorDiscoveryService?: SelectorDiscoveryService
): void {
  app.post('/api/challenge-discovery', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as { url?: string };
      if (!body.url) {
        reply.code(400).send({ error: 'URL is required.' });
        return;
      }
      reply.code(202).send({ data: await challengeDiscoveryService.create({ url: body.url }) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/challenge-discovery', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ data: { jobs: await challengeDiscoveryService.list() } });
  });

  app.post('/api/challenge-discovery/cdp/test', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as { cdpUrl?: string };
      reply.send({ data: await challengeDiscoveryService.testCdpConnection(body?.cdpUrl) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/challenge-discovery/browser-options', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      reply.send({ data: await challengeDiscoveryService.listLocalBrowsers() });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/challenge-discovery/browser-options/browse-executable', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      reply.send({ data: await challengeDiscoveryService.browseBrowserExecutable() });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
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

  app.post('/api/challenge-discovery/:id/open-external-browser', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { executablePath?: string; profileId?: string };
      reply.send({ data: await challengeDiscoveryService.openExternalBrowser(id, {
        executablePath: body?.executablePath,
        profileId: body?.profileId,
      }) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/challenge-discovery/:id/inspect-cdp-page', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { cdpUrl?: string };
      reply.send({ data: await challengeDiscoveryService.inspectCdpPage(id, body?.cdpUrl) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/challenge-discovery/:id/create-selector-discovery-from-cdp', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!selectorDiscoveryService) {
        reply.code(400).send({ error: 'Selector discovery service is not available.' });
        return;
      }
      const { id } = request.params as { id: string };
      const body = request.body as { cdpUrl?: string };
      const snapshot = await challengeDiscoveryService.readCdpPageSnapshot(id, body?.cdpUrl);
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
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/challenge-discovery/:id/complete-human-verification', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { settle?: boolean; allowNavigate?: boolean } | undefined;
      reply.code(202).send({
        data: await challengeDiscoveryService.completeHumanVerification(id, {
          settle: body?.settle,
          allowNavigate: body?.allowNavigate,
        }),
      });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
