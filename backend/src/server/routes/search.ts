import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { CrawlerEngine } from '../../crawler/engine';

export function setupSearchRoutes(app: FastifyInstance, _crawlerEngine: CrawlerEngine): void {
  app.post('/api/search', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { query: string; adapterId?: string; limit?: number };

    if (!body.query) {
      reply.code(400).send({ error: 'Query is required' });
      return;
    }

    reply.send({ data: { message: 'Search endpoint', query: body.query } });
  });
}
