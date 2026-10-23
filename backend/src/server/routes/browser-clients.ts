import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BROWSER_CLIENT_PROTOCOL_VERSION, type BrowserClientEnrollmentRequest } from '@comiccrawler/browser-client-sdk';
import type { BrowserClientRecord, BrowserClientRegistry } from '../../browser/browser-client-registry';
import type { BrowserSessionGateway } from '../../browser/browser-session-gateway';
import type { ApiPrincipal, ApiSecurityService } from '../../security/api-security';
import { requestPrincipal } from '../middleware/api-security';

type Context = { registry: BrowserClientRegistry; gateway: BrowserSessionGateway; security: ApiSecurityService };

export function setupBrowserClientRoutes(app: FastifyInstance, registry: BrowserClientRegistry,
  gateway: BrowserSessionGateway, security: ApiSecurityService): void {
  const context = { registry, gateway, security };
  app.get('/.well-known/comiccrawler-browser-client', async (_request, reply) => discovery(reply, security));
  app.post('/api/browser-clients/enroll', async (request, reply) => enroll(request, reply, context));
  app.get('/api/browser-clients', async (request, reply) => listClients(request, reply, context));
  app.get('/api/browser-workers', async (request, reply) => listWorkers(request, reply, context));
  app.get('/api/browser-resources', async (request, reply) => listResources(request, reply, context));
  app.delete('/api/browser-clients/:clientId', async (request, reply) => revoke(request, reply, context));
  app.post('/api/browser-clients/:clientId/credentials/rotate', async (request, reply) => rotate(request, reply, context));
}

function discovery(reply: FastifyReply, security: ApiSecurityService): void {
  reply.send({ data: {
    protocolVersion: BROWSER_CLIENT_PROTOCOL_VERSION, apiSecurityMode: security.mode,
    endpoints: { enroll: '/api/browser-clients/enroll', controlWebSocket: '/api/browser-clients/connect' },
  } });
}

async function enroll(request: FastifyRequest, reply: FastifyReply, context: Context): Promise<void> {
  try {
    const principal = requestPrincipal(request, context.security);
    const data = await context.registry.enroll(principal, (request.body ?? {}) as BrowserClientEnrollmentRequest);
    reply.code(201).send({ data });
  } catch (error) {
    reply.code(400).send({ error: errorMessage(error) });
  }
}

function listClients(request: FastifyRequest, reply: FastifyReply, context: Context): void {
  const principal = requestPrincipal(request, context.security);
  const owner = mayReadAll(principal, context.security) ? undefined : principal.userId;
  reply.send({ data: { clients: context.registry.list(owner) } });
}

function listWorkers(request: FastifyRequest, reply: FastifyReply, context: Context): void {
  const principal = requestPrincipal(request, context.security);
  const owner = mayReadAll(principal, context.security) ? undefined : principal.userId;
  const workers = context.gateway.listWorkers(owner).map((worker) => ({
    ...worker, status: worker.online ? (worker.activeSessionId ? 'busy' : 'idle') : 'offline',
  }));
  reply.send({ data: { workers } });
}

function listResources(request: FastifyRequest, reply: FastifyReply, context: Context): void {
  const principal = requestPrincipal(request, context.security);
  const resources = context.gateway.listResources(principal.userId).map(({ ownerUserId: _, ...resource }) => resource);
  reply.send({ data: { resources } });
}

function mayReadAll(principal: ApiPrincipal, security: ApiSecurityService): boolean {
  return security.hasPermission(principal, 'browser-client:read')
    || security.hasPermission(principal, 'browser-client:manage');
}

async function revoke(request: FastifyRequest, reply: FastifyReply, context: Context): Promise<void> {
  try {
    const clientId = requireClientAccess(request, context);
    await context.registry.revoke(clientId);
    context.gateway.revokeClient(clientId);
    reply.code(204).send();
  } catch (error) {
    sendRouteError(reply, error);
  }
}

async function rotate(request: FastifyRequest, reply: FastifyReply, context: Context): Promise<void> {
  try {
    const clientId = requireClientAccess(request, context);
    const credential = await context.registry.rotateCredential(clientId);
    context.gateway.revokeClient(clientId, 'Browser Client credential was rotated.');
    reply.send({ data: credential });
  } catch (error) {
    sendRouteError(reply, error);
  }
}

function requireClientAccess(request: FastifyRequest, context: Context): string {
  const { clientId } = request.params as { clientId: string };
  assertClientAccess(requestPrincipal(request, context.security), context.registry.getRecord(clientId), context.security, 'manage');
  return clientId;
}

function assertClientAccess(principal: ApiPrincipal, record: BrowserClientRecord | undefined,
  security: ApiSecurityService, action: 'manage'): void {
  if (!record) throw new RouteError(404, 'Browser Client was not found.');
  if (security.hasPermission(principal, `browser-client:${action}`)) return;
  if (record.ownerUserId === principal.userId && security.hasPermission(principal, `browser-client:${action}-own`)) return;
  throw new RouteError(403, 'Browser Client access is denied.');
}

class RouteError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); }
}

function sendRouteError(reply: FastifyReply, error: unknown): void {
  reply.code(error instanceof RouteError ? error.statusCode : 400).send({ error: errorMessage(error) });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
