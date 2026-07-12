import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { SelectorDiscoveryService, SelectorDiscoverySettingsStore } from '../../selector-discovery';
import { runSelectorDiscoveryPreflight, SelectorDiscoveryBundleManager } from '../../selector-discovery';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { resolveRuntimeConfig } from '../../config/runtime';
import { DomReadinessChecker } from '../../fixtures/dom-readiness';

export function setupSelectorDiscoveryRoutes(
  app: FastifyInstance,
  discoveryService: SelectorDiscoveryService,
  settingsStore: SelectorDiscoverySettingsStore,
  bundleManager = new SelectorDiscoveryBundleManager()
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

  setupDiscoveryJobRoutes(app, '/api/selector-discovery', discoveryService);
  setupDiscoveryJobRoutes(app, '/api/site-discovery', discoveryService);
}

function setupDiscoveryJobRoutes(
  app: FastifyInstance,
  prefix: '/api/selector-discovery' | '/api/site-discovery',
  discoveryService: SelectorDiscoveryService
): void {
  app.post(prefix, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as {
        url?: string;
        target?: 'full' | 'chapter-only';
        aoBaseUrl?: string;
        providerDocument?: unknown;
        model?: string;
        forceDiscovery?: boolean;
      };
      if (!body.url) {
        reply.code(400).send({ error: 'URL is required.' });
        return;
      }
      if (body.target && body.target !== 'full' && body.target !== 'chapter-only') {
        reply.code(400).send({ error: 'Discovery target must be "full" or "chapter-only".' });
        return;
      }

      const job = await discoveryService.create({
        url: body.url,
        target: body.target,
        aoBaseUrl: body.aoBaseUrl,
        providerDocument: body.providerDocument as any,
        model: body.model,
        forceDiscovery: body.forceDiscovery,
      });
      reply.code(job.status === 'known_adapter' ? 200 : 202).send({ data: job });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post(`${prefix}/snapshot`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as {
        url?: string;
        html?: string;
        finalUrl?: string;
        target?: 'chapter-only';
        aoBaseUrl?: string;
        providerDocument?: unknown;
        model?: string;
        forceDiscovery?: boolean;
      };
      if (!body.url) {
        reply.code(400).send({ error: 'URL is required.' });
        return;
      }
      if (!body.html?.trim()) {
        reply.code(400).send({ error: 'HTML snapshot is required.' });
        return;
      }
      if (body.target && body.target !== 'chapter-only') {
        reply.code(400).send({ error: 'HTML snapshot discovery currently supports only chapter-only target.' });
        return;
      }
      const readiness = new DomReadinessChecker().check({
        url: body.finalUrl ?? body.url,
        html: body.html,
        target: 'chapterImages',
      });
      if (readiness.status !== 'ready') {
        reply.code(400).send({
          error: `HTML snapshot is not trusted enough for selector discovery: ${readiness.reasons.join(' ')}`,
          data: { readiness },
        });
        return;
      }

      const job = await discoveryService.create({
        url: body.url,
        target: 'chapter-only',
        aoBaseUrl: body.aoBaseUrl,
        providerDocument: body.providerDocument as any,
        model: body.model,
        forceDiscovery: body.forceDiscovery ?? true,
        htmlSnapshot: {
          html: body.html,
          finalUrl: body.finalUrl,
          pageType: 'chapter',
        },
      });
      reply.code(202).send({ data: job });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get(prefix, async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ data: { jobs: await discoveryService.list() } });
  });

  app.get(`${prefix}/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const job = await discoveryService.get(id);
    if (!job) {
      reply.code(404).send({ error: 'Discovery job not found.' });
      return;
    }
    reply.send({ data: job });
  });

  app.post(`${prefix}/:id/retry`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const job = await discoveryService.retry(id);
      reply.code(202).send({ data: job });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post(`${prefix}/:id/revalidate`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      reply.send({ data: await discoveryService.revalidate(id) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post(`${prefix}/:id/validate`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      reply.send({ data: await discoveryService.validateCandidate(id) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post(`${prefix}/:id/promote`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      reply.send({ data: await discoveryService.promote(id) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post(`${prefix}/:id/shadow-promote`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      reply.send({ data: await discoveryService.shadowPromote(id) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post(`${prefix}/:id/reject`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      reply.send({ data: await discoveryService.reject(id) });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

async function listBundleEvaluations(): Promise<Array<{
  hash: string;
  passed: boolean;
  createdAt?: string;
  model?: string;
  aoBaseUrl?: string;
  jobId?: string;
  url?: string;
  reasons: string[];
  path: string;
}>> {
  const workspaceRoot = resolveRuntimeConfig().agentWorkspacePath;
  const evaluationsRoot = join(workspaceRoot, 'bundle-evaluations');
  const entries = await fs.readdir(evaluationsRoot, { withFileTypes: true }).catch(() => []);
  const evaluations = await Promise.all(entries
    .filter((entry) => entry.isDirectory() && /^[a-f0-9]{64}$/i.test(entry.name))
    .map(async (entry) => {
      const directory = join(evaluationsRoot, entry.name);
      try {
        const summary = JSON.parse(await fs.readFile(join(directory, 'summary.json'), 'utf-8')) as any;
        return {
          hash: entry.name,
          passed: summary.passed === true,
          createdAt: summary.createdAt,
          model: summary.runtime?.model,
          aoBaseUrl: summary.runtime?.aoBaseUrl,
          jobId: summary.job?.id,
          url: summary.job?.url,
          caseCount: Array.isArray(summary.cases) ? new Set(summary.cases.map((item: any) => item.case?.id).filter(Boolean)).size : undefined,
          runCount: Array.isArray(summary.cases) ? summary.cases.length : undefined,
          policy: summary.policy,
          reasons: Array.isArray(summary.reasons) ? summary.reasons : [],
          path: directory,
        };
      } catch {
        return null;
      }
    }));

  return evaluations
    .filter((evaluation): evaluation is NonNullable<typeof evaluation> => Boolean(evaluation))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
    .slice(0, 20);
}
