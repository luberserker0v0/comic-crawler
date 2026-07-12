import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  DomReadinessCheckRequest,
  FixtureCaptureRequest,
  FixtureFunctionTestRequest,
} from '@comiccrawler/shared';
import * as cheerio from 'cheerio';
import type { AdapterRegistry } from '../../adapter/registry';
import { DomReadinessChecker } from '../../fixtures/dom-readiness';
import { FixtureCaptureService } from '../../fixtures/fixture-capture-service';

export function setupFixtureRoutes(
  app: FastifyInstance,
  adapterRegistry: AdapterRegistry,
  fixtureService?: FixtureCaptureService
): void {
  const readinessChecker = new DomReadinessChecker();

  app.post('/api/dom-readiness/check', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as DomReadinessCheckRequest;
    if (!body.url || !body.html || !body.target) {
      reply.code(400).send({ error: 'url, html, and target are required.' });
      return;
    }
    reply.send({
      data: {
        url: body.url,
        readiness: readinessChecker.check(body),
      },
    });
  });

  app.post('/api/fixtures/capture', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!fixtureService) {
      reply.code(503).send({ error: 'Fixture capture requires the human verification handoff service.' });
      return;
    }
    try {
      const body = request.body as FixtureCaptureRequest;
      if (!body.challengeDiscoveryId || !body.target) {
        reply.code(400).send({ error: 'challengeDiscoveryId and target are required.' });
        return;
      }
      const fixture = await fixtureService.captureBrowserDocument(body);
      reply.send({ data: { fixture } });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/fixtures/:domain/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!fixtureService) {
      reply.code(503).send({ error: 'Fixture service is not available.' });
      return;
    }
    try {
      const { domain, id } = request.params as { domain: string; id: string };
      const includeHtml = (request.query as { includeHtml?: string }).includeHtml === 'true';
      const detail = await fixtureService.readFixture(domain, id, includeHtml);
      reply.send({ data: detail });
    } catch (error) {
      reply.code(404).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post('/api/fixtures/:domain/:id/test-adapter-function', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!fixtureService) {
      reply.code(503).send({ error: 'Fixture service is not available.' });
      return;
    }
    try {
      const { domain, id } = request.params as { domain: string; id: string };
      const body = request.body as FixtureFunctionTestRequest;
      const adapter = adapterRegistry.get(body.adapterId);
      if (!adapter) {
        reply.code(404).send({ error: 'Adapter not found.' });
        return;
      }
      const detail = await fixtureService.readFixture(domain, id, true);
      const document = cheerio.load(detail.html ?? '');
      const result = await runFixtureFunction(adapter, body.functionId, document, detail.fixture.url);
      reply.send({
        data: {
          fixture: detail.fixture,
          adapterId: adapter.id,
          functionId: body.functionId,
          result,
        },
      });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}

async function runFixtureFunction(adapter: any, functionId: string, document: cheerio.CheerioAPI, url: string): Promise<unknown> {
  if (functionId === 'extractTitle') return { title: await adapter.extractTitle?.(document, url) };
  if (functionId === 'extractAuthor') return { author: await adapter.extractAuthor?.(document, url) };
  if (functionId === 'extractDescription') return { description: await adapter.extractDescription?.(document, url) };
  if (functionId === 'extractCoverUrl') return { coverUrl: await adapter.extractCoverUrl?.(document, url) };
  if (functionId === 'extractTags') return { tags: await adapter.extractTags?.(document, url) };
  if (functionId === 'extractStatus') return { status: await adapter.extractStatus?.(document, url) };
  if (functionId === 'extractChapterList') return { chapters: await adapter.extractChapterList?.(document, url) };
  if (functionId === 'extractChapterImageUrls') return { imageUrls: await adapter.extractChapterImageUrls?.(document, url) };
  if (functionId === 'matchUrl') return { matched: adapter.matchUrl(url) };
  throw new Error(`Function "${functionId}" cannot be tested against a fixture.`);
}
