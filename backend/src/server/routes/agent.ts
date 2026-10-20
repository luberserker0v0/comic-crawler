import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AdapterRegistry } from '../../adapter/registry';
import type { AgentAdminService } from '../../agent/admin-service';

type Context = { service: AgentAdminService; registry: AdapterRegistry };
type Action = 'promoteCandidate' | 'rejectCandidate' | 'rollback';

export function setupAgentRoutes(app: FastifyInstance, service: AgentAdminService, registry: AdapterRegistry): void {
  const context = { service, registry };
  app.get('/api/agent/adapters', async (_request, reply) => listAdapters(reply, context));
  app.get('/api/agent/adapters/:id', async (request, reply) => getAdapter(request, reply, context));
  app.post('/api/agent/adapters/:id/promote', async (request, reply) => mutateAdapter(request, reply, context, 'promoteCandidate'));
  app.post('/api/agent/adapters/:id/reject', async (request, reply) => mutateAdapter(request, reply, context, 'rejectCandidate'));
  app.post('/api/agent/adapters/:id/rollback', async (request, reply) => mutateAdapter(request, reply, context, 'rollback'));
}

async function listAdapters(reply: FastifyReply, context: Context): Promise<void> {
  const ids = context.registry.list().map((adapter) => adapter.id);
  const states = await context.service.listAdapterStates(ids);
  reply.send({ data: states.map((state) => ({
    adapterId: state.adapterId, sessionStatus: state.session?.status ?? null,
    activeVersion: state.activeVersion?.version ?? null,
    latestCandidate: state.latestCandidate?.version ?? null,
    versionCount: state.versions?.versions.length ?? 0,
  })) });
}

async function getAdapter(request: FastifyRequest, reply: FastifyReply, context: Context): Promise<void> {
  const { id } = request.params as { id: string };
  if (!ensureAdapter(id, reply, context.registry)) return;
  const state = await context.service.getAdapterState(id);
  reply.send({ data: {
    adapterId: state.adapterId, session: state.session, activeVersion: state.activeVersion,
    latestCandidate: state.latestCandidate, versions: state.versions,
  } });
}

async function mutateAdapter(request: FastifyRequest, reply: FastifyReply, context: Context, action: Action): Promise<void> {
  const { id } = request.params as { id: string };
  const { version } = (request.body ?? {}) as { version?: string };
  if (!ensureAdapter(id, reply, context.registry)) return;
  const result = await context.service[action](id, version);
  if (!result.success) {
    reply.code(400).send({ error: result.error });
    return;
  }
  reply.send({ data: result });
}

function ensureAdapter(id: string, reply: FastifyReply, registry: AdapterRegistry): boolean {
  if (registry.has(id)) return true;
  reply.code(404).send({ error: 'Adapter not found' });
  return false;
}
