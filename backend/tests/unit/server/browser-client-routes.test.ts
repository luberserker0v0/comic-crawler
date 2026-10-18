import fastify, { type FastifyInstance } from 'fastify';
import type { BrowserCapabilities } from '@comiccrawler/browser-client-sdk';
import { BrowserClientRegistry } from '../../../src/browser/browser-client-registry';
import { BrowserSessionGateway } from '../../../src/browser/browser-session-gateway';
import { ApiSecurityService } from '../../../src/security/api-security';
import { setupApiSecurity } from '../../../src/server/middleware/api-security';
import { setupBrowserClientRoutes } from '../../../src/server/routes/browser-clients';

const capabilities: BrowserCapabilities = {
  executionMode: 'managed-profile',
  navigation: true,
  renderedDom: true,
  humanHandoff: true,
  responsiveViewport: true,
};

describe('browser client routes', () => {
  let app: FastifyInstance;
  let gateway: BrowserSessionGateway;

  beforeEach(() => {
    const security = ApiSecurityService.fromSecretDocument({ mode: 'public', defaultEffect: 'deny', rules: [] });
    const registry = new BrowserClientRegistry();
    gateway = new BrowserSessionGateway(registry);
    app = fastify();
    setupApiSecurity(app, security);
    setupBrowserClientRoutes(app, registry, gateway, security);
  });

  afterEach(async () => {
    gateway.dispose();
    await app.close();
  });

  it('discovers, enrolls, lists, rotates, and revokes a Browser Client', async () => {
    const discovery = await app.inject({
      method: 'GET',
      url: '/.well-known/comiccrawler-browser-client',
    });
    expect(discovery.statusCode).toBe(200);
    expect(discovery.json().data).toEqual({
      protocolVersion: 2,
      apiSecurityMode: 'public',
      endpoints: {
        enroll: '/api/browser-clients/enroll',
        controlWebSocket: '/api/browser-clients/connect',
      },
    });

    const enrolled = await app.inject({
      method: 'POST',
      url: '/api/browser-clients/enroll',
      payload: { name: 'Alice Chrome', capabilities },
    });
    expect(enrolled.statusCode).toBe(201);
    expect(enrolled.json().data).toMatchObject({
      clientId: expect.stringMatching(/^bc_/),
      credentialId: expect.stringMatching(/^bcc_/),
      credential: expect.stringMatching(/^ccbc_/),
    });
    const clientId = enrolled.json().data.clientId as string;

    const listed = await app.inject({ method: 'GET', url: '/api/browser-clients' });
    expect(listed.json().data.clients).toEqual([
      expect.objectContaining({ clientId, name: 'Alice Chrome', ownerUserId: 'public' }),
    ]);
    expect((await app.inject({ method: 'GET', url: '/api/browser-workers' })).json().data.workers).toEqual([]);

    const rotated = await app.inject({
      method: 'POST',
      url: `/api/browser-clients/${clientId}/credentials/rotate`,
    });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().data.credential).not.toBe(enrolled.json().data.credential);

    const revoked = await app.inject({ method: 'DELETE', url: `/api/browser-clients/${clientId}` });
    expect(revoked.statusCode).toBe(204);
  });

  it('rejects enrollment without capabilities', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/browser-clients/enroll',
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('capabilities are required');
  });
});
