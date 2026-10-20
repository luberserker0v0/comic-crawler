import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  listSelectorDiscoveryAoProviders, listSelectorDiscoveryAoProvidersByUrl,
  runSelectorDiscoveryPreflight, SelectorDiscoveryBundleManager,
  type SelectorDiscoverySettingsStore,
} from '../../selector-discovery';
import { listBundleEvaluations } from './selector-discovery-helpers';

type Context = { settings: SelectorDiscoverySettingsStore; bundles: SelectorDiscoveryBundleManager };

export function setupSelectorDiscoverySettingsRoutes(app: FastifyInstance,
  settings: SelectorDiscoverySettingsStore, bundles: SelectorDiscoveryBundleManager): void {
  const context = { settings, bundles };
  app.get('/api/config/selector-discovery', async (_request, reply) => reply.send({ data: await settings.getSummary() }));
  app.get('/api/config/selector-discovery/bundle-status', async (_request, reply) => sendResult(reply, () => bundles.getStatus()));
  app.get('/api/config/selector-discovery/bundle-evaluations', async (_request, reply) => sendEvaluations(reply));
  app.get('/api/config/selector-discovery/models', async (request, reply) => listModels(request, reply, context));
  app.put('/api/config/selector-discovery', async (request, reply) => saveSettings(request, reply, settings));
  app.post('/api/config/selector-discovery/test', async (_request, reply) => testSettings(reply, context));
  app.delete('/api/config/selector-discovery/provider', async (_request, reply) => reply.send({ data: await settings.clearProvider() }));
}

async function sendResult(reply: FastifyReply, action: () => Promise<unknown>): Promise<void> {
  try { reply.send({ data: await action() }); }
  catch (error) { sendError(reply, error); }
}

async function sendEvaluations(reply: FastifyReply): Promise<void> {
  try { reply.send({ data: { evaluations: await listBundleEvaluations() } }); }
  catch (error) { sendError(reply, error); }
}

async function listModels(request: FastifyRequest, reply: FastifyReply, context: Context): Promise<void> {
  try {
    const aoBaseUrl = (request.query as { aoBaseUrl?: string }).aoBaseUrl?.trim();
    if (aoBaseUrl) { reply.send({ data: await listSelectorDiscoveryAoProvidersByUrl({ aoBaseUrl }) }); return; }
    const { settings, providerDocument } = await context.settings.getRequired();
    const result = await listSelectorDiscoveryAoProviders({
      aoBaseUrl: settings.aoBaseUrl, providerDocument, model: settings.model, bundleManager: context.bundles,
    });
    reply.send({ data: result });
  } catch (error) { sendModelError(reply, error); }
}

function sendModelError(reply: FastifyReply, error: unknown): void {
  const detail = error as { steps?: unknown[]; conversationId?: string; bundleHash?: string };
  reply.code(400).send({
    error: error instanceof Error ? error.message : String(error),
    data: detail.steps ? {
      conversationId: detail.conversationId, bundleHash: detail.bundleHash,
      providers: [], models: [], steps: detail.steps,
    } : undefined,
  });
}

async function saveSettings(request: FastifyRequest, reply: FastifyReply,
  settings: SelectorDiscoverySettingsStore): Promise<void> {
  try {
    const body = request.body as { aoBaseUrl?: string; providerDocument?: unknown; model?: string };
    const data = await settings.save({
      aoBaseUrl: body.aoBaseUrl ?? '', model: body.model ?? '', providerDocument: body.providerDocument,
    });
    reply.send({ data });
  } catch (error) { sendError(reply, error); }
}

async function testSettings(reply: FastifyReply, context: Context): Promise<void> {
  try {
    const { settings, providerDocument } = await context.settings.getRequired();
    const result = await runSelectorDiscoveryPreflight({
      aoBaseUrl: settings.aoBaseUrl, providerDocument, model: settings.model, bundleManager: context.bundles,
    });
    const firstFailure = result.steps.find((step) => !step.ok);
    reply.code(result.ok ? 200 : 400).send({ data: result, error: firstFailure?.error });
  } catch (error) { sendError(reply, error); }
}

function sendError(reply: FastifyReply, error: unknown): void {
  reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
}
