import type { BrowserTarget } from '@comiccrawler/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ChallengeDiscoveryService } from '../../challenge';
import type { SelectorDiscoveryService } from '../../selector-discovery';
import type { ApiSecurityService } from '../../security/api-security';
import { requestPrincipal } from '../middleware/api-security';

type Context = { challenge: ChallengeDiscoveryService; selector?: SelectorDiscoveryService; security?: ApiSecurityService };

export function setupChallengeDiscoveryRoutes(app: FastifyInstance, challenge: ChallengeDiscoveryService,
  selector?: SelectorDiscoveryService, options: { apiSecurity?: ApiSecurityService } = {}): void {
  const context = { challenge, selector, security: options.apiSecurity };
  registerChallengeCollectionRoutes(app, context);
  registerChallengeActionRoutes(app, context);
  registerChallengeBridgeRoutes(app, context);
}

function registerChallengeCollectionRoutes(app: FastifyInstance, context: Context): void {
  app.post('/api/challenge-discovery', async (request, reply) => createChallenge(request, reply, context));
  app.get('/api/challenge-discovery', async (_request, reply) => reply.send({ data: { jobs: await context.challenge.list() } }));
  app.get('/api/challenge-discovery/:id', async (request, reply) => getChallenge(request, reply, context));
  app.delete('/api/challenge-discovery/:id', async (request, reply) => deleteChallenge(request, reply, context));
}

async function createChallenge(request: FastifyRequest, reply: FastifyReply, context: Context): Promise<void> {
  try {
    const body = request.body as { url?: string; browserTarget?: BrowserTarget };
    if (!body.url) { reply.code(400).send({ error: 'URL is required.' }); return; }
    const principal = context.security ? requestPrincipal(request, context.security) : undefined;
    const job = await context.challenge.create({
      url: body.url, ownerUserId: principal?.userId ?? 'public', browserTarget: body.browserTarget,
    });
    reply.code(202).send({ data: job });
  } catch (error) { sendError(reply, error); }
}

async function getChallenge(request: FastifyRequest, reply: FastifyReply, context: Context): Promise<void> {
  const job = await context.challenge.get(requestId(request));
  if (!job) { reply.code(404).send({ error: 'Challenge discovery job not found.' }); return; }
  reply.send({ data: job });
}

async function deleteChallenge(request: FastifyRequest, reply: FastifyReply, context: Context): Promise<void> {
  const deleted = await context.challenge.deleteJob(requestId(request));
  if (!deleted) { reply.code(404).send({ error: 'Challenge discovery job not found.' }); return; }
  reply.send({ data: { message: 'Challenge discovery job deleted.' } });
}

function registerChallengeActionRoutes(app: FastifyInstance, context: Context): void {
  app.post('/api/challenge-discovery/:id/retry', async (request, reply) => runAction(request, reply, context.challenge.retry.bind(context.challenge), 202));
  app.post('/api/challenge-discovery/:id/cancel', async (request, reply) => runAction(request, reply, context.challenge.cancel.bind(context.challenge)));
  app.post('/api/challenge-discovery/:id/promote', async (request, reply) => runAction(request, reply, context.challenge.promote.bind(context.challenge)));
  app.post('/api/challenge-discovery/:id/open-browser', async (request, reply) => runAction(request, reply, context.challenge.openBrowser.bind(context.challenge)));
  app.post('/api/challenge-discovery/:id/inspect-remote-page', async (request, reply) => runAction(request, reply, context.challenge.inspectRemotePage.bind(context.challenge)));
}

async function runAction(request: FastifyRequest, reply: FastifyReply,
  action: (id: string) => Promise<unknown>, statusCode = 200): Promise<void> {
  try { reply.code(statusCode).send({ data: await action(requestId(request)) }); }
  catch (error) { sendError(reply, error); }
}

function registerChallengeBridgeRoutes(app: FastifyInstance, context: Context): void {
  app.post('/api/challenge-discovery/:id/create-selector-discovery-from-remote',
    async (request, reply) => createSelectorDiscovery(request, reply, context));
  app.post('/api/challenge-discovery/:id/complete-human-verification',
    async (request, reply) => completeVerification(request, reply, context));
}

async function createSelectorDiscovery(request: FastifyRequest, reply: FastifyReply, context: Context): Promise<void> {
  try {
    if (!context.selector) { reply.code(400).send({ error: 'Selector discovery service is not available.' }); return; }
    const id = requestId(request);
    const snapshot = await context.challenge.readRemotePageSnapshot(id);
    const discovery = await context.selector.create({
      url: snapshot.job.normalizedUrl, target: 'chapter-only', forceDiscovery: true,
      htmlSnapshot: { html: snapshot.page.html, finalUrl: snapshot.page.url, pageType: 'chapter' },
    });
    reply.code(202).send({ data: { challenge: snapshot.job, discovery } });
    await context.challenge.releaseBrowserLease(id);
  } catch (error) { sendError(reply, error); }
}

async function completeVerification(request: FastifyRequest, reply: FastifyReply, context: Context): Promise<void> {
  try {
    const body = request.body as { settle?: boolean; allowNavigate?: boolean } | undefined;
    const job = await context.challenge.completeHumanVerification(requestId(request), {
      settle: body?.settle, allowNavigate: body?.allowNavigate,
    });
    reply.code(202).send({ data: job });
  } catch (error) { sendError(reply, error); }
}

function requestId(request: FastifyRequest): string {
  return (request.params as { id: string }).id;
}

function sendError(reply: FastifyReply, error: unknown): void {
  reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
}
