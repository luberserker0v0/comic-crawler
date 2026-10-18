import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiPrincipal, ApiSecurityService } from '../../security/api-security';

const principals = new WeakMap<FastifyRequest, ApiPrincipal>();

export function setupApiSecurity(app: FastifyInstance, security: ApiSecurityService): void {
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const pathname = request.url.split('?', 1)[0]!;
    if (isPublicPath(pathname) || !pathname.startsWith('/api/')) return;

    const authentication = security.authenticate(request.headers);
    if (!authentication.ok) {
      reply.code(authentication.statusCode).send({ error: authentication.error });
      return;
    }
    principals.set(request, authentication.principal);
    if (security.mode === 'public') return;

    const permission = security.permissionFor(request.method, pathname);
    if (!permission || !security.hasPermission(authentication.principal, permission)) {
      reply.code(403).send({
        error: permission ? `Permission "${permission}" is required.` : 'API access is denied by policy.',
      });
      return;
    }
    if (permission.endsWith('-own')
      && !supportsOwnershipAwarePermission(pathname)) {
      reply.code(403).send({ error: `Ownership-aware permission "${permission}" is not implemented for this resource.` });
    }
  });
}

export function requestPrincipal(request: FastifyRequest, security: ApiSecurityService): ApiPrincipal {
  return principals.get(request) ?? security.publicPrincipal();
}

function isPublicPath(pathname: string): boolean {
  return pathname === '/api/status'
    || pathname === '/.well-known/comiccrawler-browser-client'
    || pathname === '/api-docs'
    || pathname.startsWith('/api-docs/');
}

function supportsOwnershipAwarePermission(pathname: string): boolean {
  return pathname.startsWith('/api/browser-clients')
    || /^\/api\/tasks\/[^/]+\/rebind-browser-target$/.test(pathname);
}
