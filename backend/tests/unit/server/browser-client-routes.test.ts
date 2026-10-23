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

let app: FastifyInstance;

let gateway: BrowserSessionGateway;

describe('browser client routes', () => {
  browserClientRoutesTestGroup1();
});

function browserClientRoutesTestGroup1(): void {
  beforeEach(browserClientRoutesTestScenario1);
  afterEach(browserClientRoutesTestScenario2);
  it('discovers, enrolls, lists, rotates, and revokes a Browser Client', browserClientRoutesTestDiscoversEnrollsListsRotatesAndRevokesABrowserClient);
  it('rejects enrollment without capabilities', browserClientRoutesTestRejectsEnrollmentWithoutCapabilities);
  it('lists only browser resources owned by the requesting user', browserClientRoutesTestListsOwnedResources);
}

function browserClientRoutesTestScenario1() {
    const security = ApiSecurityService.fromSecretDocument({ mode: 'public', defaultEffect: 'deny', rules: [] });
    const registry = new BrowserClientRegistry();
    gateway = new BrowserSessionGateway(registry);
    app = fastify();
    setupApiSecurity(app, security);
    setupBrowserClientRoutes(app, registry, gateway, security);
}

async function browserClientRoutesTestScenario2() {
    gateway.dispose();
    await app.close();
}

async function browserClientRoutesTestDiscoversEnrollsListsRotatesAndRevokesABrowserClient() {
    const discovery = await app.inject({ method: 'GET', url: '/.well-known/comiccrawler-browser-client' });
    expect(discovery.statusCode).toBe(200);
    expectDiscovery(discovery.json().data);
    const enrolled = await enrollClient();
    const clientId = enrolled.json().data.clientId as string;
    await expectClientListed(clientId);
    expect((await app.inject({ method: 'GET', url: '/api/browser-workers' })).json().data.workers).toEqual([]);
    const rotated = await app.inject({ method: 'POST', url: `/api/browser-clients/${clientId}/credentials/rotate` });
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json().data.credential).not.toBe(enrolled.json().data.credential);
    const revoked = await app.inject({ method: 'DELETE', url: `/api/browser-clients/${clientId}` });
    expect(revoked.statusCode).toBe(204);
}

function expectDiscovery(data: unknown): void {
  expect(data).toEqual({ protocolVersion: 2, apiSecurityMode: 'public', endpoints: {
    enroll: '/api/browser-clients/enroll', controlWebSocket: '/api/browser-clients/connect',
  } });
}

async function enrollClient() {
  const response = await app.inject({ method: 'POST', url: '/api/browser-clients/enroll',
    payload: { name: 'Alice Chrome', capabilities } });
  expect(response.statusCode).toBe(201);
  expect(response.json().data).toMatchObject({ clientId: expect.stringMatching(/^bc_/),
    credentialId: expect.stringMatching(/^bcc_/), credential: expect.stringMatching(/^ccbc_/) });
  return response;
}

async function expectClientListed(clientId: string): Promise<void> {
  const listed = await app.inject({ method: 'GET', url: '/api/browser-clients' });
  expect(listed.json().data.clients).toEqual([
    expect.objectContaining({ clientId, name: 'Alice Chrome', ownerUserId: 'public' }),
  ]);
}

async function browserClientRoutesTestRejectsEnrollmentWithoutCapabilities() {
    const response = await app.inject({
        method: 'POST',
        url: '/api/browser-clients/enroll',
        payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('capabilities are required');
}

async function browserClientRoutesTestListsOwnedResources() {
    jest.spyOn(gateway, 'listResources').mockReturnValue([{
        resourceId: 'tab-1', workerId: 'worker-1', ownerUserId: 'public', kind: 'tab',
        url: 'https://comix.to/title/demo/1-chapter-1', title: 'Chapter 1',
        registeredAt: '2026-10-23T00:00:00.000Z',
    }]);
    const response = await app.inject({ method: 'GET', url: '/api/browser-resources' });
    expect(gateway.listResources).toHaveBeenCalledWith('public');
    expect(response.json().data.resources).toEqual([expect.objectContaining({
        resourceId: 'tab-1', workerId: 'worker-1', title: 'Chapter 1',
    })]);
    expect(response.json().data.resources[0].ownerUserId).toBeUndefined();
}
