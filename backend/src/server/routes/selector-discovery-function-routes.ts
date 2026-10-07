import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AdapterFunctionRevisionRequest, AdapterFunctionTestRequest, AdapterImplementationResponse } from '@comiccrawler/shared';
import type { SelectorDiscoveryService } from '../../selector-discovery';
import type { ChallengeDiscoveryService } from '../../challenge';
import type { AdapterDraftService } from '../../adapter-drafts/service';
import { instantiateAdapterImplementationDraft } from '../../selector-discovery/adapter-draft-runtime';
import { describeAdapterFunctions, isKnownAdapterFunction, testAdapterFunction, type AdapterFunctionId } from './adapters';
import { createImplementationOutline, instantiateDiscoveryDraftAdapter } from './selector-discovery-helpers';

export function setupDiscoveryDraftFunctionRoutes(
  app: FastifyInstance,
  prefix: '/api/selector-discovery' | '/api/site-discovery',
  discoveryService: SelectorDiscoveryService,
  options: { challengeDiscoveryService?: ChallengeDiscoveryService; adapterDraftService?: AdapterDraftService } = {}
): void {
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

  app.post(`${prefix}/:id/functions/:functionId/revision-requests`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id, functionId } = request.params as { id: string; functionId: AdapterFunctionId };
      if (!isKnownAdapterFunction(functionId)) {
        reply.code(400).send({ error: 'Unknown adapter function.' });
        return;
      }
      const body = request.body as AdapterFunctionRevisionRequest;
      const instruction = typeof body.instruction === 'string' ? body.instruction : '';
      reply.code(202).send({
        data: await discoveryService.requestFunctionRevision({
          id,
          functionId,
          instruction,
          currentSource: typeof body.currentSource === 'string' ? body.currentSource : undefined,
        }),
      });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post(`${prefix}/:id/function-revisions/:revisionTaskId/retry`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id, revisionTaskId } = request.params as { id: string; revisionTaskId: string };
      const body = request.body as { currentSource?: string; modelMode?: 'current-settings' | 'previous-task' };
      reply.code(202).send({
        data: await discoveryService.retryFunctionRevision({
          id,
          revisionTaskId,
          currentSource: typeof body.currentSource === 'string' ? body.currentSource : undefined,
          modelMode: body.modelMode === 'previous-task' ? 'previous-task' : 'current-settings',
        }),
      });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post(`${prefix}/:id/drafts`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (!options.adapterDraftService) {
        reply.code(400).send({ error: 'Adapter draft service is not available.' });
        return;
      }
      const { id } = request.params as { id: string };
      const job = await discoveryService.get(id);
      if (!job) {
        reply.code(404).send({ error: 'Discovery job not found.' });
        return;
      }
      if (!job.adapterImplementationTs?.trim()) {
        reply.code(400).send({ error: 'Discovery job has no TypeScript implementation draft to edit.' });
        return;
      }
      const adapter = instantiateAdapterImplementationDraft(job.adapterImplementationTs);
      const draft = await options.adapterDraftService.createFromGeneratedImplementation({
        baseAdapterId: adapter.id,
        baseAdapterName: adapter.name,
        content: job.adapterImplementationTs,
      });
      reply.send({ data: draft });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
