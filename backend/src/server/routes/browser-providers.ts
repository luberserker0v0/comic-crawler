import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CreateBrowserSessionRequest } from '@comiccrawler/browser-provider-sdk';
import { BROWSER_PROVIDER_CONTRACT_VERSION } from '@comiccrawler/browser-provider-sdk';
import type { BrowserProviderRegistry } from '../../browser/provider-registry';

export function setupBrowserProviderRoutes(app: FastifyInstance, registry: BrowserProviderRegistry): void {
  app.get('/.well-known/comiccrawler-browser-provider', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send({
      data: {
        contractVersion: BROWSER_PROVIDER_CONTRACT_VERSION,
        transport: 'reverse-relay',
        endpoints: {
          enroll: '/api/browser-providers/enroll',
          controlWebSocket: '/api/browser-providers/connect',
          relayWebSocketTemplate: '/api/browser-providers/relay/{tunnelId}',
        },
      },
    });
  });

  app.post('/api/browser-providers/enrollment-tokens', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as { ttlSeconds?: number };
    reply.code(201).send({ data: registry.createEnrollmentToken(body.ttlSeconds) });
  });

  app.post('/api/browser-providers/enroll', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = bearerToken(request);
    if (!token) {
      reply.code(401).send({ error: 'A Bearer enrollment token is required.' });
      return;
    }
    try {
      reply.code(201).send({ data: await registry.enroll(token) });
    } catch (error) {
      reply.code(401).send({ error: errorMessage(error) });
    }
  });

  app.get('/api/browser-providers', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ data: { providers: registry.list(), activeSession: registry.getActiveSession() } });
  });

  app.delete('/api/browser-providers/:providerId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { providerId } = request.params as { providerId: string };
      await registry.removeProvider(providerId);
      reply.code(204).send();
    } catch (error) {
      reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.get('/api/browser-providers/sessions/active', async (_request: FastifyRequest, reply: FastifyReply) => {
    const session = registry.getActiveSession();
    if (!session) {
      reply.code(404).send({ error: 'No active browser provider session.' });
      return;
    }
    reply.send({ data: session });
  });

  app.post('/api/browser-providers/:providerId/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { providerId } = request.params as { providerId: string };
      reply.code(201).send({
        data: await registry.createSession(providerId, (request.body ?? {}) as CreateBrowserSessionRequest),
      });
    } catch (error) {
      reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.post('/api/browser-providers/sessions/:sessionId/heartbeat', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { sessionId } = request.params as { sessionId: string };
      const body = (request.body ?? {}) as { ttlSeconds?: number };
      reply.send({ data: await registry.heartbeat(sessionId, body.ttlSeconds) });
    } catch (error) {
      reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.delete('/api/browser-providers/sessions/:sessionId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { sessionId } = request.params as { sessionId: string };
      await registry.closeSession(sessionId);
      reply.code(204).send();
    } catch (error) {
      reply.code(400).send({ error: errorMessage(error) });
    }
  });
}

function bearerToken(request: FastifyRequest): string | undefined {
  return request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
