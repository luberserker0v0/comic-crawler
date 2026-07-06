import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AdapterRegistry } from '../../adapter/registry';
import type { AgentAdminService } from '../../agent/admin-service';

export function setupAgentRoutes(
  app: FastifyInstance,
  agentAdminService: AgentAdminService,
  adapterRegistry: AdapterRegistry
): void {
  app.get('/api/agent/adapters', async (_request: FastifyRequest, reply: FastifyReply) => {
    const adapterIds = adapterRegistry.list().map((adapter) => adapter.id);
    const states = await agentAdminService.listAdapterStates(adapterIds);

    reply.send({
      data: states.map((state) => ({
        adapterId: state.adapterId,
        sessionStatus: state.session?.status ?? null,
        activeVersion: state.activeVersion?.version ?? null,
        latestCandidate: state.latestCandidate?.version ?? null,
        versionCount: state.versions?.versions.length ?? 0,
      })),
    });
  });

  app.get('/api/agent/adapters/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    if (!adapterRegistry.has(id)) {
      reply.code(404).send({ error: 'Adapter not found' });
      return;
    }

    const state = await agentAdminService.getAdapterState(id);
    reply.send({
      data: {
        adapterId: state.adapterId,
        session: state.session,
        activeVersion: state.activeVersion,
        latestCandidate: state.latestCandidate,
        versions: state.versions,
      },
    });
  });

  app.post('/api/agent/adapters/:id/promote', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { version?: string };

    if (!adapterRegistry.has(id)) {
      reply.code(404).send({ error: 'Adapter not found' });
      return;
    }

    const result = await agentAdminService.promoteCandidate(id, body.version);
    if (!result.success) {
      reply.code(400).send({ error: result.error });
      return;
    }

    reply.send({ data: result });
  });

  app.post('/api/agent/adapters/:id/reject', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { version?: string };

    if (!adapterRegistry.has(id)) {
      reply.code(404).send({ error: 'Adapter not found' });
      return;
    }

    const result = await agentAdminService.rejectCandidate(id, body.version);
    if (!result.success) {
      reply.code(400).send({ error: result.error });
      return;
    }

    reply.send({ data: result });
  });

  app.post('/api/agent/adapters/:id/rollback', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { version?: string };

    if (!adapterRegistry.has(id)) {
      reply.code(404).send({ error: 'Adapter not found' });
      return;
    }

    const result = await agentAdminService.rollback(id, body.version);
    if (!result.success) {
      reply.code(400).send({ error: result.error });
      return;
    }

    reply.send({ data: result });
  });
}
