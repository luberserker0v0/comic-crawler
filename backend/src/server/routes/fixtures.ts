import type { DomReadinessCheckRequest, FixtureCaptureRequest, FixtureFunctionTestRequest } from '@comiccrawler/shared';
import * as cheerio from 'cheerio';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AdapterRegistry } from '../../adapter/registry';
import { DomReadinessChecker } from '../../fixtures/dom-readiness';
import { FixtureCaptureService, runFixtureFunction } from '../../fixtures/fixture-capture-service';

type Context = { registry: AdapterRegistry; service?: FixtureCaptureService; readiness: DomReadinessChecker };

export function setupFixtureRoutes(app: FastifyInstance, registry: AdapterRegistry, service?: FixtureCaptureService): void {
  const context = { registry, service, readiness: new DomReadinessChecker() };
  app.post('/api/dom-readiness/check', async (request, reply) => checkReadiness(request, reply, context));
  app.post('/api/fixtures/capture', async (request, reply) => captureFixture(request, reply, context));
  app.get('/api/fixtures/:domain/:id', async (request, reply) => getFixture(request, reply, context));
  app.post('/api/fixtures/:domain/:id/test-adapter-function', async (request, reply) => testFixture(request, reply, context));
  app.post('/api/fixtures/:domain/:id/verify-approved-adapter', async (request, reply) => verifyFixture(request, reply, context));
}

function checkReadiness(request: FastifyRequest, reply: FastifyReply, context: Context): void {
  const body = request.body as DomReadinessCheckRequest;
  if (!body.url || !body.html || !body.target) {
    reply.code(400).send({ error: 'url, html, and target are required.' }); return;
  }
  reply.send({ data: { url: body.url, readiness: context.readiness.check(body) } });
}

async function captureFixture(request: FastifyRequest, reply: FastifyReply, context: Context): Promise<void> {
  if (!requireService(context, reply, 'Fixture capture requires the human verification handoff service.')) return;
  try {
    const body = request.body as FixtureCaptureRequest;
    if (!body.challengeDiscoveryId || !body.target) {
      reply.code(400).send({ error: 'challengeDiscoveryId and target are required.' }); return;
    }
    reply.send({ data: { fixture: await context.service.captureBrowserDocument(body) } });
  } catch (error) { sendError(reply, error, 400); }
}

async function getFixture(request: FastifyRequest, reply: FastifyReply, context: Context): Promise<void> {
  if (!requireService(context, reply)) return;
  try {
    const { domain, id } = fixtureParams(request);
    const includeHtml = (request.query as { includeHtml?: string }).includeHtml === 'true';
    reply.send({ data: await context.service.readFixture(domain, id, includeHtml) });
  } catch (error) { sendError(reply, error, 404); }
}

async function testFixture(request: FastifyRequest, reply: FastifyReply, context: Context): Promise<void> {
  if (!requireService(context, reply)) return;
  try {
    const { domain, id } = fixtureParams(request);
    const body = request.body as FixtureFunctionTestRequest;
    const adapter = context.registry.get(body.adapterId);
    if (!adapter) { reply.code(404).send({ error: 'Adapter not found.' }); return; }
    const detail = await context.service.readFixture(domain, id, true);
    const result = await runFixtureFunction(adapter, body.functionId, cheerio.load(detail.html ?? ''), detail.fixture.url);
    reply.send({ data: { fixture: detail.fixture, adapterId: adapter.id, functionId: body.functionId, result } });
  } catch (error) { sendError(reply, error, 400); }
}

async function verifyFixture(request: FastifyRequest, reply: FastifyReply, context: Context): Promise<void> {
  if (!requireService(context, reply)) return;
  try {
    const { domain, id } = fixtureParams(request);
    const adapterId = (request.body as { adapterId?: string }).adapterId;
    const adapter = adapterId ? context.registry.get(adapterId) : undefined;
    if (!adapter) { reply.code(404).send({ error: 'Adapter not found.' }); return; }
    reply.send({ data: await context.service.verifyApprovedAdapterFixture(domain, id, adapter) });
  } catch (error) { sendError(reply, error, 400); }
}

function requireService(context: Context, reply: FastifyReply, message = 'Fixture service is not available.'):
  context is Context & { service: FixtureCaptureService } {
  if (context.service) return true;
  reply.code(503).send({ error: message });
  return false;
}

function fixtureParams(request: FastifyRequest): { domain: string; id: string } {
  return request.params as { domain: string; id: string };
}

function sendError(reply: FastifyReply, error: unknown, status: number): void {
  reply.code(status).send({ error: error instanceof Error ? error.message : String(error) });
}
