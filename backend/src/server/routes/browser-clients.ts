import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  BROWSER_CLIENT_PROTOCOL_VERSION,
  type BrowserClientEnrollmentRequest,
} from '@comiccrawler/browser-client-sdk';
import type { BrowserClientRecord, BrowserClientRegistry } from '../../browser/browser-client-registry';
import type { BrowserSessionGateway } from '../../browser/browser-session-gateway';
import type { ApiPrincipal, ApiSecurityService } from '../../security/api-security';
import { requestPrincipal } from '../middleware/api-security';

export function setupBrowserClientRoutes(
  app: FastifyInstance,
  registry: BrowserClientRegistry,
  gateway: BrowserSessionGateway,
  security: ApiSecurityService
): void {
  app.get('/.well-known/comiccrawler-browser-client', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send({
      data: {
        protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION,
        apiSecurityMode: security.mode,
        endpoints: {
          enroll: '/api/browser-clients/enroll',
          controlWebSocket: '/api/browser-clients/connect',
        },
      },
    });
  });

  app.post('/api/browser-clients/enroll', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const principal = requestPrincipal(request, security);
      reply.code(201).send({
        data: await registry.enroll(principal, (request.body ?? {}) as BrowserClientEnrollmentRequest),
      });
    } catch (error) {
      reply.code(400).send({ error: errorMessage(error) });
    }
  });

  app.get('/api/browser-clients', async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = requestPrincipal(request, security);
    const mayReadAll = security.hasPermission(principal, 'browser-client:read')
      || security.hasPermission(principal, 'browser-client:manage');
    reply.send({ data: { clients: registry.list(mayReadAll ? undefined : principal.userId) } });
  });

  app.get('/api/browser-workers', async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = requestPrincipal(request, security);
    const mayReadAll = security.hasPermission(principal, 'browser-client:read')
      || security.hasPermission(principal, 'browser-client:manage');
    const workers = gateway.listWorkers(mayReadAll ? undefined : principal.userId).map((worker) => ({
      ...worker,
      status: worker.online ? (worker.activeSessionId ? 'busy' : 'idle') : 'offline',
    }));
    reply.send({ data: { workers } });
  });

  app.delete('/api/browser-clients/:clientId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { clientId } = request.params as { clientId: string };
      assertClientAccess(requestPrincipal(request, security), registry.getRecord(clientId), security, 'manage');
      await registry.revoke(clientId);
      gateway.revokeClient(clientId);
      reply.code(204).send();
    } catch (error) {
      sendRouteError(reply, error);
    }
  });

  app.post('/api/browser-clients/:clientId/credentials/rotate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { clientId } = request.params as { clientId: string };
      assertClientAccess(requestPrincipal(request, security), registry.getRecord(clientId), security, 'manage');
      const credential = await registry.rotateCredential(clientId);
      gateway.revokeClient(clientId, 'Browser Client credential was rotated.');
      reply.send({ data: credential });
    } catch (error) {
      sendRouteError(reply, error);
    }
  });
}

function assertClientAccess(
  principal: ApiPrincipal,
  record: BrowserClientRecord | undefined,
  security: ApiSecurityService,
  action: 'manage'
): void {
  if (!record) throw new RouteError(404, 'Browser Client was not found.');
  if (security.hasPermission(principal, `browser-client:${action}`)) return;
  if (record.ownerUserId === principal.userId
    && security.hasPermission(principal, `browser-client:${action}-own`)) return;
  throw new RouteError(403, 'Browser Client access is denied.');
}

class RouteError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message);
  }
}

function sendRouteError(reply: FastifyReply, error: unknown): void {
  reply.code(error instanceof RouteError ? error.statusCode : 400).send({ error: errorMessage(error) });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
