import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export interface AuthOptions {
  username: string;
  password: string;
}

export function setupAuth(app: FastifyInstance, options: AuthOptions): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.url.startsWith('/api/status') || request.url.startsWith('/ws')) {
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader) {
      reply.code(401).send({ error: 'Authorization header required' });
      return;
    }

    const [scheme, credentials] = authHeader.split(' ');
    if (scheme !== 'Basic') {
      reply.code(401).send({ error: 'Invalid authorization scheme' });
      return;
    }

    const [username, password] = Buffer.from(credentials, 'base64').toString().split(':');
    if (username !== options.username || password !== options.password) {
      reply.code(403).send({ error: 'Invalid credentials' });
      return;
    }
  });
}
