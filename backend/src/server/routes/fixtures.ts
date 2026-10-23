import type { DomReadinessCheckRequest, FixtureCaptureRequest, FixtureFunctionTestRequest } from '@comiccrawler/shared';
import * as cheerio from 'cheerio';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AdapterRegistry } from '../../adapter/registry';
import type { AdapterCatalog } from '../../adapter/catalog';
import { instantiateCatalogPackage } from '../../adapter/catalog-runtime';
import { DomReadinessChecker } from '../../fixtures/dom-readiness';
import { FixtureCaptureService, runFixtureFunction } from '../../fixtures/fixture-capture-service';

type Context = { registry: AdapterRegistry; catalog?: AdapterCatalog;
  service?: FixtureCaptureService; readiness: DomReadinessChecker };

export function setupFixtureRoutes(app: FastifyInstance, registry: AdapterRegistry,
  service?: FixtureCaptureService, catalog?: AdapterCatalog): void {
  const context = { registry, catalog, service, readiness: new DomReadinessChecker() };
  app.post('/api/dom-readiness/check', async (request, reply) => checkReadiness(request, reply, context));
  app.post('/api/fixtures/capture', async (request, reply) => captureFixture(request, reply, context));
  app.get('/api/fixtures/:domain/:id', async (request, reply) => getFixture(request, reply, context));
  app.post('/api/fixtures/:domain/:id/test-adapter-function', async (request, reply) => testFixture(request, reply, context));
  app.get('/api/adapters/:adapterId/versions/:version/fixture',
    async (request, reply) => getApprovedFixture(request, reply, context));
  app.post('/api/adapters/:adapterId/versions/:version/fixture/test-adapter-function',
    async (request, reply) => testApprovedFixture(request, reply, context));
  app.post('/api/adapters/:adapterId/versions/:version/fixture/verify',
    async (request, reply) => verifyApprovedFixture(request, reply, context));
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

async function getApprovedFixture(request: FastifyRequest, reply: FastifyReply, context: Context): Promise<void> {
  if (!requireService(context, reply)) return;
  try {
    const document = await approvedPackage(request, reply, context);
    if (!document) return;
    const includeHtml = (request.query as { includeHtml?: string }).includeHtml === 'true';
    reply.send({ data: await context.service.readApprovedAdapterFixture(document.manifest, includeHtml) });
  } catch (error) { sendError(reply, error, 404); }
}

async function testApprovedFixture(request: FastifyRequest, reply: FastifyReply, context: Context): Promise<void> {
  if (!requireService(context, reply)) return;
  try {
    const document = await approvedPackage(request, reply, context);
    if (!document) return;
    const adapter = instantiateCatalogPackage(document);
    const detail = await context.service.readApprovedAdapterFixture(document.manifest, true);
    const functionId = (request.body as { functionId?: string }).functionId ?? '';
    const result = await runFixtureFunction(adapter, functionId, cheerio.load(detail.html ?? ''), detail.fixture.url);
    reply.send({ data: { fixture: detail.fixture, adapterId: adapter.id, functionId, result } });
  } catch (error) { sendError(reply, error, 400); }
}

async function verifyApprovedFixture(request: FastifyRequest, reply: FastifyReply, context: Context): Promise<void> {
  if (!requireService(context, reply)) return;
  try {
    const document = await approvedPackage(request, reply, context);
    if (!document) return;
    const adapter = instantiateCatalogPackage(document);
    reply.send({ data: await context.service.verifyApprovedAdapterFixture(document.manifest, adapter) });
  } catch (error) { sendError(reply, error, 400); }
}

async function approvedPackage(request: FastifyRequest, reply: FastifyReply, context: Context) {
  if (!context.catalog) { reply.code(503).send({ error: 'Adapter Catalog is not available.' }); return null; }
  const { adapterId, version } = request.params as { adapterId: string; version: string };
  const document = await context.catalog.getPackage(adapterId, version);
  if (!document) { reply.code(404).send({ error: 'Adapter package not found.' }); return null; }
  if (!document.manifest.approvalFixture) {
    reply.code(404).send({ error: 'Approved fixture not found.' }); return null;
  }
  return document;
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
