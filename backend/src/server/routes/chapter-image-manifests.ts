import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ChapterImageManifest, ChapterImageManifestResolvePagesRequest,
  ChapterImageManifestResolvePagesResponse } from '@comiccrawler/shared';
import { ChapterImageManifestConflictError, ChapterImageManifestRevisionError,
  type ChapterImageManifestService } from '../../adapter/chapter-image-manifest';
import type { ApiSecurityService } from '../../security/api-security';
import { requestPrincipal } from '../middleware/api-security';

interface ManifestRouteContext {
  service: ChapterImageManifestService;
  security: ApiSecurityService;
}

export function setupChapterImageManifestRoutes(
  app: FastifyInstance, service: ChapterImageManifestService, security: ApiSecurityService
): void {
  const context = { service, security };
  app.get('/api/chapter-image-manifests/resolve', (request, reply) => resolveManifest(context, request, reply));
  app.get('/api/chapter-image-manifests/:chapterId', (request, reply) => getManifest(context, request, reply));
  app.post('/api/chapter-image-manifests/:chapterId/resolve-pages',
    (request, reply) => resolveManifestPages(context, request, reply));
}

async function resolveManifest(
  context: ManifestRouteContext, request: FastifyRequest, reply: FastifyReply
): Promise<void> {
  const query = request.query as { url?: string; adapterId?: string };
  const error = validateAbsoluteUrl(query.url, 'url');
  if (error) return void reply.code(400).send({ error });
  try {
    const manifest = await context.service.resolve(owner(request, context), query.url!, clean(query.adapterId));
    if (!manifest) return void reply.code(404).send({ error: 'Chapter image manifest was not found.' });
    sendManifest(request, reply, manifest);
  } catch (caught) { sendLookupError(reply, caught); }
}

async function getManifest(
  context: ManifestRouteContext, request: FastifyRequest, reply: FastifyReply
): Promise<void> {
  const { chapterId } = request.params as { chapterId?: string };
  if (!chapterId?.trim()) return void reply.code(400).send({ error: 'chapterId is required.' });
  const manifest = await context.service.get(owner(request, context), chapterId);
  if (!manifest) return void reply.code(404).send({ error: 'Chapter image manifest was not found.' });
  sendManifest(request, reply, manifest);
}

async function resolveManifestPages(
  context: ManifestRouteContext, request: FastifyRequest, reply: FastifyReply
): Promise<void> {
  const { chapterId } = request.params as { chapterId?: string };
  const body = (request.body ?? {}) as Partial<ChapterImageManifestResolvePagesRequest>;
  const error = validatePageResolutionRequest(chapterId, body);
  if (error) return void reply.code(400).send({ error });
  try {
    const result = await context.service.resolvePages(owner(request, context), chapterId!, body.urls!, body.revision);
    if (!result) return void reply.code(404).send({ error: 'Chapter image manifest was not found.' });
    const data: ChapterImageManifestResolvePagesResponse = { chapterId: result.manifest.chapter.id,
      revision: result.manifest.revision, matches: result.matches };
    reply.header('ETag', quoteEtag(result.manifest.revision)).send({ data });
  } catch (caught) { sendLookupError(reply, caught); }
}

function sendManifest(request: FastifyRequest, reply: FastifyReply, manifest: ChapterImageManifest): void {
  const etag = quoteEtag(manifest.revision);
  reply.header('ETag', etag);
  if (etagMatches(request.headers['if-none-match'], etag)) { reply.code(304).send(); return; }
  reply.send({ data: manifest });
}

function validatePageResolutionRequest(
  chapterId: string | undefined, body: Partial<ChapterImageManifestResolvePagesRequest>
): string | undefined {
  if (!chapterId?.trim()) return 'chapterId is required.';
  if (!Array.isArray(body.urls) || body.urls.length < 1 || body.urls.length > 500)
    return 'urls must contain between 1 and 500 absolute URLs.';
  for (const url of body.urls) {
    const error = validateAbsoluteUrl(url, 'urls'); if (error) return error;
  }
  if (body.revision !== undefined && !/^sha256:[a-f0-9]{64}$/.test(body.revision))
    return 'revision must be a sha256 manifest revision.';
  return undefined;
}

function validateAbsoluteUrl(value: unknown, field: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return `${field} is required.`;
  try { new URL(value); return undefined; }
  catch { return `${field} must contain absolute URLs.`; }
}

function sendLookupError(reply: FastifyReply, error: unknown): void {
  if (error instanceof ChapterImageManifestConflictError
    || error instanceof ChapterImageManifestRevisionError) {
    reply.code(409).send({ error: error.message }); return;
  }
  if (error instanceof TypeError) { reply.code(400).send({ error: error.message }); return; }
  throw error;
}

function owner(request: FastifyRequest, context: ManifestRouteContext): string {
  return requestPrincipal(request, context.security).userId;
}

function clean(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function quoteEtag(revision: string): string {
  return `"${revision}"`;
}

function etagMatches(value: string | string[] | undefined, etag: string): boolean {
  const header = Array.isArray(value) ? value.join(',') : value;
  return header?.split(',').some((candidate) => candidate.trim() === etag || candidate.trim() === '*') ?? false;
}
