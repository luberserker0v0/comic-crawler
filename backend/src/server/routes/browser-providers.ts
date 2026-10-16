import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  BrowserProviderRegistrationRequest,
} from '@comiccrawler/browser-provider-sdk';
import { BROWSER_PROVIDER_CONTRACT_VERSION } from '@comiccrawler/browser-provider-sdk';
import type { BrowserProviderRegistry, ProviderRecord } from '../../browser/provider-registry';
import type { BrowserLeaseCoordinator } from '../../browser/lease-coordinator';
import type { ApiPrincipal, ApiSecurityService } from '../../security/api-security';
import { requestPrincipal } from '../middleware/api-security';

export function setupBrowserProviderRoutes(
  app: FastifyInstance,
  registry: BrowserProviderRegistry,
  security: ApiSecurityService,
  leaseCoordinator?: BrowserLeaseCoordinator
): void {
  app.get('/.well-known/comiccrawler-browser-provider', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send({
      data: {
        contractVersion: BROWSER_PROVIDER_CONTRACT_VERSION,
        transport: 'reverse-relay',
        apiSecurityMode: security.mode,
        endpoints: {
          enroll: '/api/browser-providers/enroll',
          controlWebSocket: '/api/browser-providers/connect',
          relayWebSocketTemplate: '/api/browser-providers/relay/{tunnelId}',
        },
      },
    });
  });

  app.post('/api/browser-providers/enroll', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const principal = requestPrincipal(request, security);
      const body = (request.body ?? {}) as BrowserProviderRegistrationRequest;
      reply.code(201).send({ data: await registry.register(principal, body) });
    } catch (error) {
      reply.code(409).send({ error: errorMessage(error) });
    }
  });

  app.get('/api/browser-providers', async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = requestPrincipal(request, security);
    const mayReadAll = security.hasPermission(principal, 'browser-provider:read')
      || security.hasPermission(principal, 'browser-provider:manage');
    reply.send({
      data: {
        providers: registry.list(mayReadAll ? undefined : principal.userId),
      },
    });
  });

  app.get('/api/browser-workers', async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = requestPrincipal(request, security);
    const mayReadAll = security.hasPermission(principal, 'browser-provider:read')
      || security.hasPermission(principal, 'browser-provider:manage');
    reply.send({ data: { workers: leaseCoordinator?.listWorkers(mayReadAll ? undefined : principal.userId) ?? [] } });
  });

  app.delete('/api/browser-providers/:providerId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { providerId } = request.params as { providerId: string };
      assertProviderAccess(requestPrincipal(request, security), registry.getRecord(providerId), security, 'manage');
      await registry.revokeProvider(providerId);
      reply.code(204).send();
    } catch (error) {
      sendRouteError(reply, error);
    }
  });

  app.post('/api/browser-providers/:providerId/credentials/rotate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { providerId } = request.params as { providerId: string };
      assertProviderAccess(requestPrincipal(request, security), registry.getRecord(providerId), security, 'manage');
      reply.send({ data: await registry.rotateCredential(providerId) });
    } catch (error) {
      sendRouteError(reply, error);
    }
  });

}

function assertProviderAccess(
  principal: ApiPrincipal,
  record: ProviderRecord | undefined,
  security: ApiSecurityService,
  action: 'manage'
): void {
  if (!record) throw new RouteError(404, 'Browser provider was not found.');
  if (security.hasPermission(principal, `browser-provider:${action}`)) return;
  if (record.ownerUserId === principal.userId
    && security.hasPermission(principal, `browser-provider:${action}-own`)) return;
  throw new RouteError(403, 'Browser provider access is denied.');
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
