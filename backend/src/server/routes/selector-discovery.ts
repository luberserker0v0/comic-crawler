import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AdapterFunctionTestRequest, AdapterImplementationResponse, AdapterImplementationSymbol } from '@comiccrawler/shared';
import type { SelectorDiscoveryService, SelectorDiscoverySettingsStore } from '../../selector-discovery';
import { runSelectorDiscoveryPreflight, SelectorDiscoveryBundleManager } from '../../selector-discovery';
import type { ChallengeDiscoveryService } from '../../challenge';
import { instantiateAdapterImplementationDraft } from '../../selector-discovery/adapter-draft-runtime';
import { describeAdapterFunctions, isKnownAdapterFunction, testAdapterFunction, type AdapterFunctionId } from './adapters';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { resolveRuntimeConfig } from '../../config/runtime';
import { DomReadinessChecker } from '../../fixtures/dom-readiness';

export function setupSelectorDiscoveryRoutes(
  app: FastifyInstance,
  discoveryService: SelectorDiscoveryService,
  settingsStore: SelectorDiscoverySettingsStore,
  bundleManager = new SelectorDiscoveryBundleManager(),
  options: { challengeDiscoveryService?: ChallengeDiscoveryService } = {}
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

  setupDiscoveryJobRoutes(app, '/api/selector-discovery', discoveryService, options);
  setupDiscoveryJobRoutes(app, '/api/site-discovery', discoveryService, options);
}

function setupDiscoveryJobRoutes(
  app: FastifyInstance,
  prefix: '/api/selector-discovery' | '/api/site-discovery',
  discoveryService: SelectorDiscoveryService,
  options: { challengeDiscoveryService?: ChallengeDiscoveryService } = {}
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

  app.get(`${prefix}/:id/implementation`, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const job = await discoveryService.get(id);
    if (!job) {
      reply.code(404).send({ error: 'Discovery job not found.' });
      return;
    }
    if (!job.adapterImplementationTs?.trim()) {
      reply.code(404).send({ error: 'Discovery job has no adapter implementation draft.' });
      return;
    }

    const data: AdapterImplementationResponse = {
      adapterId: job.adapterId ?? `selector-discovery:${job.id}`,
      sourceType: 'generated-draft',
      language: 'typescript',
      content: job.adapterImplementationTs,
      outline: createImplementationOutline(job.adapterImplementationTs),
      notes: 'AO-generated TypeScript adapter implementation draft. Function selection is a test target; review the full source as one artifact.',
    };
    reply.send({ data });
  });

  app.get(`${prefix}/:id/capabilities`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const adapter = await instantiateDiscoveryDraftAdapter(discoveryService, id);
      reply.send({
        data: {
          adapter: {
            id: adapter.id,
            name: adapter.name,
            domains: adapter.domains,
            parseMode: adapter.parseMode,
            capabilities: adapter.capabilities,
          },
          functions: describeAdapterFunctions(adapter as any),
        },
      });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post(`${prefix}/:id/functions/:functionId/test`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id, functionId } = request.params as { id: string; functionId: AdapterFunctionId };
      if (!isKnownAdapterFunction(functionId)) {
        reply.code(400).send({ error: 'Unknown adapter function.' });
        return;
      }
      const body = request.body as AdapterFunctionTestRequest;
      if (!body.url) {
        reply.code(400).send({ error: 'URL is required.' });
        return;
      }
      const adapter = await instantiateDiscoveryDraftAdapter(discoveryService, id);
      const result = await testAdapterFunction(adapter as any, functionId, body.url, {
        challengeDiscoveryId: body.challengeDiscoveryId,
        challengeDiscoveryService: options.challengeDiscoveryService,
      });
      reply.send({
        data: {
          ...result,
          adapterId: `selector-discovery:${id}`,
          resultSummary: {
            ...(result.resultSummary ?? {}),
            discoveryJobId: id,
            draftAdapterId: adapter.id,
          },
        },
      });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
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

async function instantiateDiscoveryDraftAdapter(discoveryService: SelectorDiscoveryService, id: string) {
  const job = await discoveryService.get(id);
  if (!job) {
    throw new Error('Discovery job not found.');
  }
  if (!job.adapterImplementationTs?.trim()) {
    throw new Error('Discovery job has no adapter implementation draft.');
  }
  if (job.implementationValidation && !job.implementationValidation.valid) {
    throw new Error(`Adapter implementation draft is invalid: ${job.implementationValidation.errors.join('; ') || 'unknown error'}`);
  }
  return instantiateAdapterImplementationDraft(job.adapterImplementationTs);
}

function createImplementationOutline(source: string): AdapterImplementationSymbol[] {
  const lines = source.split(/\r?\n/);
  const symbols: AdapterImplementationSymbol[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const classMatch = /\b(?:export\s+)?class\s+(\w+)\s+extends\s+(\w+)/.exec(line);
    if (classMatch?.[1]) {
      symbols.push({
        id: classMatch[1],
        label: classMatch[1],
        kind: 'class',
        startLine: index + 1,
        capability: capabilityFromBaseClass(classMatch[2]),
      });
      continue;
    }
    const methodMatch = /^\s*(?:public\s+|protected\s+|private\s+)?(?:override\s+)?(?:async\s+)?(matchUrl|detectVerificationRequired|describeVerificationHandoff|extractTitle|extractAuthor|extractDescription|extractCoverUrl|extractTags|extractStatus|extractChapterList|extractChapterImageUrls)\s*\(/.exec(line);
    if (methodMatch?.[1]) {
      symbols.push({
        id: methodMatch[1],
        label: methodMatch[1],
        kind: 'method',
        startLine: index + 1,
        capability: capabilityFromFunction(methodMatch[1]),
      });
    }
  }
  return symbols;
}

function capabilityFromBaseClass(baseClass?: string): AdapterImplementationSymbol['capability'] {
  if (baseClass === 'CommonCapability') return 'common';
  if (baseClass === 'VerificationCapability') return 'verification';
  if (baseClass === 'MetadataCapability') return 'metadata';
  if (baseClass === 'ChapterImagesCapability') return 'chapterImages';
  return undefined;
}

function capabilityFromFunction(functionId: string): AdapterImplementationSymbol['capability'] {
  if (functionId === 'matchUrl') return 'common';
  if (functionId === 'detectVerificationRequired' || functionId === 'describeVerificationHandoff') return 'verification';
  if (functionId === 'extractChapterImageUrls') return 'chapterImages';
  return 'metadata';
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
