import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AdapterRegistry } from '../../adapter/registry';
import { getAdapterCapabilities } from '../../adapter/registry';

export function setupAdaptersRoutes(app: FastifyInstance, registry: AdapterRegistry): void {
  app.get('/api/adapters', async (_request: FastifyRequest, reply: FastifyReply) => {
    const adapters = registry.list();
    reply.send({ data: adapters });
  });

  app.post('/api/adapters/resolve', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = request.body as { url?: string; mode?: 'all' | 'chapters' };
      if (!body.url) {
        reply.code(400).send({ error: 'URL is required' });
        return;
      }
      const mode = body.mode ?? 'all';
      if (mode !== 'all' && mode !== 'chapters') {
        reply.code(400).send({ error: 'Mode must be "all" or "chapters"' });
        return;
      }

      const parsed = new URL(body.url);
      const requiredCapabilities = mode === 'chapters'
        ? { chapterImages: true }
        : { metadata: true, chapterImages: true };
      const matchedAdapter = registry.findByUrlWithCapabilities(parsed.href, requiredCapabilities);
      const anyMatchedAdapter = registry.findByUrl(parsed.href);

      reply.send({
        data: {
          url: parsed.href,
          hostname: parsed.hostname,
          mode,
          requiredCapabilities,
          status: matchedAdapter
            ? 'matched'
            : anyMatchedAdapter
              ? 'capability_mismatch'
              : 'not_found',
          adapter: matchedAdapter ? describeAdapter(matchedAdapter) : undefined,
          matchedAdapter: anyMatchedAdapter ? describeAdapter(anyMatchedAdapter) : undefined,
          discoveryTarget: mode === 'chapters' ? 'chapter-only' : 'full',
        },
      });
    } catch (error) {
      reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get('/api/adapters/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const adapter = registry.get(id);

    if (!adapter) {
      reply.code(404).send({ error: 'Adapter not found' });
      return;
    }

    reply.send({
      data: {
        id: adapter.id,
        name: adapter.name,
        domains: adapter.domains,
        parseMode: adapter.parseMode,
        supportsLogin: !!adapter.login,
        supportsSearch: !!adapter.search,
        capabilities: getAdapterCapabilities(adapter),
      },
    });
  });

  app.post('/api/adapters/register', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { id: string; name: string; domains: string[] };

    if (!body.id || !body.name || !body.domains) {
      reply.code(400).send({ error: 'id, name, and domains are required' });
      return;
    }

    reply.send({ data: { message: 'Adapter registration endpoint' } });
  });
}

function describeAdapter(adapter: NonNullable<ReturnType<AdapterRegistry['get']>>) {
  return {
    id: adapter.id,
    name: adapter.name,
    domains: adapter.domains,
    parseMode: adapter.parseMode,
    capabilities: getAdapterCapabilities(adapter),
  };
}
