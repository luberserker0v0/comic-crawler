import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SelectorDiscoverySettingsStore } from '../../selector-discovery';
import { listSelectorDiscoveryAoProviders, runSelectorDiscoveryPreflight, SelectorDiscoveryBundleManager } from '../../selector-discovery';
import { listBundleEvaluations } from './selector-discovery-helpers';

export function setupSelectorDiscoverySettingsRoutes(
  app: FastifyInstance,
  settingsStore: SelectorDiscoverySettingsStore,
  bundleManager: SelectorDiscoveryBundleManager
): void {
  app.get('/api/config/selector-discovery', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ data: await settingsStore.getSummary() });
  });

  app.get('/api/config/selector-discovery/bundle-status', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      reply.send({ data: await bundleManager.getStatus() });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/config/selector-discovery/bundle-evaluations', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      reply.send({ data: { evaluations: await listBundleEvaluations() } });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/config/selector-discovery/models', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { settings, providerDocument } = await settingsStore.getRequired();
      const result = await listSelectorDiscoveryAoProviders({
        aoBaseUrl: settings.aoBaseUrl,
        providerDocument,
        model: settings.model,
        bundleManager,
      });
      reply.send({ data: result });
    } catch (error) {
      const maybePreflightError = error as { steps?: unknown[]; conversationId?: string; bundleHash?: string };
      reply.code(400).send({
        error: error instanceof Error ? error.message : String(error),
        data: maybePreflightError.steps
          ? {
              conversationId: maybePreflightError.conversationId,
              bundleHash: maybePreflightError.bundleHash,
              providers: [],
              models: [],
              steps: maybePreflightError.steps,
            }
          : undefined,
      });
    }
  });

  app.put('/api/config/selector-discovery', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as { aoBaseUrl?: string; providerDocument?: unknown; model?: string };
      const data = await settingsStore.save({
        aoBaseUrl: body.aoBaseUrl ?? '',
        model: body.model ?? '',
        providerDocument: body.providerDocument,
      });
      reply.send({ data });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/config/selector-discovery/test', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { settings, providerDocument } = await settingsStore.getRequired();
      const result = await runSelectorDiscoveryPreflight({
        aoBaseUrl: settings.aoBaseUrl,
        providerDocument,
        model: settings.model,
        bundleManager,
      });
      const firstFailure = result.steps.find((step) => !step.ok);
      reply.code(result.ok ? 200 : 400).send({
        data: result,
        error: firstFailure?.error,
      });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.delete('/api/config/selector-discovery/provider', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ data: await settingsStore.clearProvider() });
  });
}
