import type { FastifyInstance } from 'fastify';

export interface CorsOptions {
  origin: string[];
}

export function setupCors(app: FastifyInstance, options: CorsOptions): void {
  app.register(require('@fastify/cors'), {
    origin: options.origin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });
}
