import { afterEach, describe, expect, it } from '@jest/globals';
import fastify, { type FastifyInstance } from 'fastify';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import {
  ReverseRelayBrowserProviderClient,
  type BrowserProvider,
  type BrowserProviderCapabilities,
  type BrowserProviderDescriptor,
  type BrowserProviderSessionHandle,
} from '@comiccrawler/browser-provider-sdk';
import { BrowserProviderRegistry } from '../../../src/browser/provider-registry';
import { BrowserLeaseCoordinator } from '../../../src/browser/lease-coordinator';
import { EventBus } from '../../../src/events/bus';
import { setupBrowserProviderRoutes } from '../../../src/server/routes/browser-providers';
import { setupWebSocket } from '../../../src/server/websocket';
import { ApiSecurityService } from '../../../src/security/api-security';

const publicSecurity = ApiSecurityService.fromSecretDocument({ mode: 'public', defaultEffect: 'deny', rules: [] });

describe('browser provider routes', () => {
  let app: FastifyInstance | undefined;
  let httpServer: Server | undefined;
  let echoServer: WebSocketServer | undefined;

  afterEach(async () => {
    await app?.close();
    if (httpServer?.listening) await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
    if (echoServer) await new Promise<void>((resolve) => echoServer?.close(() => resolve()));
  });

  it('registers a provider instance and assigns its identity on the server', async () => {
    const registry = new BrowserProviderRegistry();
    const coordinator = new BrowserLeaseCoordinator(registry);
    app = fastify();
    setupBrowserProviderRoutes(app, registry, publicSecurity, coordinator);

    const discovery = await app.inject({ method: 'GET', url: '/.well-known/comiccrawler-browser-provider' });
    expect(discovery.statusCode).toBe(200);
    expect(discovery.json().data).toMatchObject({
      contractVersion: '2',
      transport: 'reverse-relay',
      apiSecurityMode: 'public',
      endpoints: { controlWebSocket: '/api/browser-providers/connect' },
    });

    const enrolled = await app.inject({
      method: 'POST',
      url: '/api/browser-providers/enroll',
      payload: { clientInstanceId: 'client-instance-1', providerName: 'Alice PC' },
    });
    expect(enrolled.statusCode).toBe(201);
    expect(enrolled.json().data).toMatchObject({
      providerId: expect.stringMatching(/^bp_/),
      clientInstanceId: 'client-instance-1',
      credentialId: expect.stringMatching(/^cred_/),
      credential: expect.stringMatching(/^ccbp_/),
    });

    const reused = await app.inject({
      method: 'POST',
      url: '/api/browser-providers/enroll',
      payload: { clientInstanceId: 'client-instance-1' },
    });
    expect(reused.statusCode).toBe(409);

    const listed = await app.inject({ method: 'GET', url: '/api/browser-providers' });
    expect(listed.json().data.providers).toEqual([
      expect.objectContaining({
        providerId: enrolled.json().data.providerId,
        online: false,
      }),
    ]);

    const workers = await app.inject({ method: 'GET', url: '/api/browser-workers' });
    expect(workers.statusCode).toBe(200);
    expect(workers.json().data.workers).toEqual([
      expect.objectContaining({
        workerId: enrolled.json().data.providerId,
        name: 'Alice PC',
        status: 'offline',
      }),
    ]);

    const removedSessionApi = await app.inject({
      method: 'POST',
      url: `/api/browser-providers/${enrolled.json().data.providerId}/sessions`,
    });
    expect(removedSessionApi.statusCode).toBe(404);

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/browser-providers/${enrolled.json().data.providerId}`,
    });
    expect(removed.statusCode).toBe(204);
    expect(registry.list()).toEqual([expect.objectContaining({ revokedAt: expect.any(String) })]);
  });

  it('rejects registration without a client instance identity', async () => {
    app = fastify();
    setupBrowserProviderRoutes(app, new BrowserProviderRegistry(), publicSecurity);
    const response = await app.inject({ method: 'POST', url: '/api/browser-providers/enroll' });
    expect(response.statusCode).toBe(409);
  });

  it('rotates and revokes one provider credential without affecting another instance', async () => {
    const registry = new BrowserProviderRegistry();
    const principal = publicSecurity.publicPrincipal();
    const first = await registry.register(principal, { clientInstanceId: 'instance-a' });
    const second = await registry.register(principal, { clientInstanceId: 'instance-b' });

    const rotated = await registry.rotateCredential(first.providerId);
    expect(registry.authenticateCredential(first.credential)).toBeUndefined();
    expect(registry.authenticateCredential(rotated.credential)?.providerId).toBe(first.providerId);
    expect(registry.authenticateCredential(second.credential)?.providerId).toBe(second.providerId);

    await registry.revokeProvider(first.providerId);
    expect(registry.authenticateCredential(rotated.credential)).toBeUndefined();
    expect(registry.authenticateCredential(second.credential)?.providerId).toBe(second.providerId);
  });

  it('keeps multiple Provider instances for the same user online concurrently', async () => {
    const registry = new BrowserProviderRegistry();
    const principal = publicSecurity.publicPrincipal();
    const first = await registry.register(principal, { clientInstanceId: 'alice-pc' });
    const second = await registry.register(principal, { clientInstanceId: 'alice-phone' });
    httpServer = createServer();
    setupWebSocket(httpServer, new EventBus(), registry, publicSecurity);
    httpServer.listen(0, '127.0.0.1');
    await once(httpServer, 'listening');
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Test server has no TCP address.');
    const endpoint = `ws://127.0.0.1:${address.port}/api/browser-providers/connect`;

    const pc = new WebSocket(endpoint, { headers: { authorization: `Bearer ${first.credential}` } });
    const phone = new WebSocket(endpoint, { headers: { authorization: `Bearer ${second.credential}` } });
    await Promise.all([once(pc, 'open'), once(phone, 'open')]);
    pc.send(JSON.stringify({ type: 'hello', descriptor: descriptor(first.providerId) }));
    phone.send(JSON.stringify({ type: 'hello', descriptor: descriptor(second.providerId) }));
    await waitUntil(() => registry.list().filter((record) => record.online && record.descriptor).length === 2);

    expect(registry.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: first.providerId, ownerUserId: 'public', online: true }),
      expect.objectContaining({ providerId: second.providerId, ownerUserId: 'public', online: true }),
    ]));
    pc.close();
    phone.close();
    registry.dispose();
  });

  it('creates sessions through the outbound provider control connection', async () => {
    const registry = new BrowserProviderRegistry();
    const enrollment = await registry.register(publicSecurity.publicPrincipal(), { clientInstanceId: 'control-test' });
    httpServer = createServer((request, response) => {
      if (request.url !== '/.well-known/comiccrawler-browser-provider') return response.writeHead(404).end();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: {
        contractVersion: '2',
        transport: 'reverse-relay',
        apiSecurityMode: 'public',
        endpoints: {
          enroll: '/api/browser-providers/enroll',
          controlWebSocket: '/api/browser-providers/connect',
          relayWebSocketTemplate: '/api/browser-providers/relay/{tunnelId}',
        },
      } }));
    });
    setupWebSocket(httpServer, new EventBus(), registry);
    httpServer.listen(0, '127.0.0.1');
    await once(httpServer, 'listening');
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Test server has no TCP address.');
    registry.setRelayBaseUrl(`http://127.0.0.1:${address.port}`);

    const control = new WebSocket(`ws://127.0.0.1:${address.port}/api/browser-providers/connect`, {
      headers: { authorization: `Bearer ${enrollment.credential}` },
    });
    await once(control, 'open');
    control.send(JSON.stringify({ type: 'hello', descriptor: descriptor(enrollment.providerId) }));
    await waitUntil(() => registry.list()[0]?.online === true && Boolean(registry.list()[0]?.descriptor));
    control.on('message', (data) => {
      const request = JSON.parse(data.toString()) as { type: string; requestId: string };
      control.send(JSON.stringify({
        type: 'response',
        requestId: request.requestId,
        ok: true,
        data: request.type === 'create-session' ? session(enrollment.providerId) : undefined,
      }));
    });

    const created = await registry.createSession(enrollment.providerId, { ttlSeconds: 60 });
    expect(created).toMatchObject({
      providerId: enrollment.providerId,
      transport: 'reverse-relay',
    });
    expect(created.connectUrl).toMatch(new RegExp(`^ws://127\\.0\\.0\\.1:${address.port}/api/browser-providers/sessions/`));
    expect(new URL(created.connectUrl).search).toBe('');
    const resolved = registry.resolveBrowserConfig({
      mode: 'remote',
      maxInstances: 1,
      timeout: 30_000,
      waitUntil: 'domcontentloaded',
    }, created.sessionId);
    expect(resolved.remote?.wsEndpoint).toBe(created.connectUrl);
    await registry.closeSession(created.sessionId);
    expect(() => registry.resolveBrowserConfig({
      mode: 'remote',
      maxInstances: 1,
      timeout: 30_000,
      waitUntil: 'domcontentloaded',
    }, created.sessionId)).toThrow('will not switch sessions automatically');
    control.close();
    registry.dispose();
  });

  it('relays browser WebSocket traffic through outbound provider tunnels', async () => {
    echoServer = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await once(echoServer, 'listening');
    const echoAddress = echoServer.address();
    if (!echoAddress || typeof echoAddress === 'string') throw new Error('Echo server has no TCP address.');
    echoServer.on('connection', (socket) => socket.on('message', (data, binary) => socket.send(data, { binary })));

    const registry = new BrowserProviderRegistry();
    const enrollment = await registry.register(publicSecurity.publicPrincipal(), { clientInstanceId: 'relay-test' });
    httpServer = createServer((request, response) => {
      if (request.url !== '/.well-known/comiccrawler-browser-provider') return response.writeHead(404).end();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ data: {
        contractVersion: '2',
        transport: 'reverse-relay',
        apiSecurityMode: 'public',
        endpoints: {
          enroll: '/api/browser-providers/enroll',
          controlWebSocket: '/api/browser-providers/connect',
          relayWebSocketTemplate: '/api/browser-providers/relay/{tunnelId}',
        },
      } }));
    });
    setupWebSocket(httpServer, new EventBus(), registry);
    httpServer.listen(0, '127.0.0.1');
    await once(httpServer, 'listening');
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Relay server has no TCP address.');
    const serverUrl = `http://127.0.0.1:${address.port}`;
    registry.setRelayBaseUrl(serverUrl);

    const provider = fakeProvider(enrollment.providerId, `ws://127.0.0.1:${echoAddress.port}`);
    const client = new ReverseRelayBrowserProviderClient({ serverUrl, credential: enrollment.credential, provider });
    const connected = client.connectOnce();
    await waitUntil(() => Boolean(registry.list()[0]?.descriptor));
    const session = await registry.createSession(enrollment.providerId);

    const resolved = registry.resolveBrowserConfig({
      mode: 'remote',
      maxInstances: 1,
      timeout: 30_000,
      waitUntil: 'domcontentloaded',
    }, session.sessionId);
    const browser = new WebSocket(session.connectUrl, { headers: resolved.remote?.headers });
    const localConnection = once(echoServer, 'connection');
    await once(browser, 'open');
    const echoed = once(browser, 'message');
    browser.send('relay-ok');
    await localConnection;
    const [payload] = await echoed;
    expect(payload.toString()).toBe('relay-ok');

    browser.close();
    await client.close();
    await connected;
    registry.dispose();
  });
});

function fakeProvider(providerId: string, localWsEndpoint: string): BrowserProvider {
  const handle: BrowserProviderSessionHandle = {
    ...session(providerId),
    localWsEndpoint,
  };
  return {
    describe: async () => descriptor(providerId),
    createSession: async () => handle,
    getSession: async (sessionId) => sessionId === handle.sessionId ? handle : undefined,
    heartbeat: async () => handle,
    closeSession: async () => undefined,
    close: async () => undefined,
  };
}

function descriptor(providerId: string): BrowserProviderDescriptor {
  return {
    contractVersion: '2',
    providerId,
    processInstanceId: 'process-test',
    providerType: 'playwright',
    runtimeVersion: '1.64.0',
    capabilities: capabilities(),
    transports: ['reverse-relay'],
  };
}

function session(providerId: string): Omit<BrowserProviderSessionHandle, 'localWsEndpoint'> {
  const now = Date.now();
  return {
    sessionId: 'session-1',
    providerId,
    protocol: 'playwright',
    transport: 'reverse-relay',
    runtimeVersion: '1.64.0',
    capabilities: capabilities(),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
  };
}

function capabilities(): BrowserProviderCapabilities {
  return {
    browser: 'chromium',
    headed: true,
    interactive: true,
    persistentContext: false,
    screenshots: true,
    downloads: true,
    tracing: true,
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for provider handshake.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
