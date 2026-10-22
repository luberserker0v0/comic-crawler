import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { OfficialAdapterRegistryService, RegistryInstallInput } from '../../adapter/official-registry';

export function setupAdapterRegistryRoutes(app: FastifyInstance,
  service: OfficialAdapterRegistryService): void {
  app.get('/api/adapter-registry/packages', (_request, reply) => sendResult(reply, () => service.list()));
  app.get('/api/adapter-registry/updates', (request, reply) => {
    const { adapterId } = request.query as { adapterId?: string };
    return sendResult(reply, () => service.check(adapterId));
  });
  app.post('/api/adapter-registry/install', (request, reply) =>
    installPackage(service, request, reply));
  app.post('/api/adapter-registry/update', (request, reply) =>
    updatePackages(service, request, reply));
}

async function installPackage(service: OfficialAdapterRegistryService,
  request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = request.body as RegistryInstallInput;
  if (!body?.adapterId) return void reply.code(400).send({ error: 'adapterId is required.' });
  await sendResult(reply, () => service.install(body));
}

async function updatePackages(service: OfficialAdapterRegistryService,
  request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = (request.body ?? {}) as { adapterId?: string; activate?: boolean };
  await sendResult(reply, () => service.update(body.adapterId, Boolean(body.activate)));
}

async function sendResult<T>(reply: FastifyReply, action: () => Promise<T>): Promise<void> {
  try { reply.send({ data: await action() }); }
  catch (error) { reply.code(422).send({ error: error instanceof Error ? error.message : String(error) }); }
}
